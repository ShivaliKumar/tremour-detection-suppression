"""
TREMORGUARD backend.

    uvicorn main:app --host 127.0.0.1 --port 8000

This process is the only owner of the ESP32 COM port. Do not run the original
combine.py at the same time.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import asdict

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from scipy.signal import butter, get_window, sosfiltfilt

from config import (ALLOWED_BAUD_RATES, DEFAULTS, ESP32_FAILSAFE_S, EXPORTED_DIR, FRONTEND_DIST, LIMITS,
                    PROCESSED_DIR, RAW_DIR, SettingsError, SettingsStore)
from engine import Engine
from serial_manager import SCENARIOS, list_ports
from websocket_manager import WebSocketManager

store = SettingsStore()
engine = Engine(store)
ws_manager = WebSocketManager()


async def broadcaster():
    """Push new samples + status to every client at the graph refresh rate."""
    last_seq = engine.latest_seq()
    while True:
        s = store.get()
        await asyncio.sleep(s.graph_refresh_ms / 1000)
        if not ws_manager.clients:
            last_seq = engine.latest_seq()
            continue
        try:
            samples = engine.samples_since(last_seq, limit=2000)
            if samples:
                last_seq = samples[-1]["seq"]
                if engine.ml.available:
                    engine.ml.predict(engine.last_row)
            frame = {"type": "telemetry", "samples": samples, "status": engine.status(), "analysis": engine.analysis()}
            await ws_manager.broadcast(json.dumps(frame, separators=(",", ":")))
        except Exception as e:     # keep broadcasting no matter what
            print(f"[broadcaster] {e!r}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.start()
    task = asyncio.create_task(broadcaster())
    yield
    task.cancel()
    await asyncio.to_thread(engine.stop)


app = FastAPI(title="TREMORGUARD", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def _err(e: Exception, code: int = 400):
    raise HTTPException(status_code=code, detail=str(e))


# ======================================================================= status
@app.get("/api/status")
def get_status():
    return engine.status()


@app.get("/api/events")
def get_events():
    return list(engine.events)


# ======================================================================= settings
def _settings_payload():
    return {
        "settings": asdict(store.get()),
        "defaults": asdict(DEFAULTS),
        "limits": LIMITS,
        "baud_rates": ALLOWED_BAUD_RATES,
        "esp32_failsafe_s": ESP32_FAILSAFE_S,
    }


@app.get("/api/settings")
def get_settings():
    return _settings_payload()


@app.put("/api/settings")
async def put_settings(patch: dict):
    try:
        old, new = store.update(patch)
    except SettingsError as e:
        raise HTTPException(status_code=422, detail={"errors": e.errors})
    await asyncio.to_thread(engine.apply_settings, old, new)
    return _settings_payload()


@app.post("/api/settings/reset")
async def reset_settings():
    old, new = store.reset()
    await asyncio.to_thread(engine.apply_settings, old, new)
    engine.event("info", "Settings restored to defaults")
    return _settings_payload()


# ======================================================================= source / servo
@app.get("/api/serial/ports")
def get_ports():
    return list_ports()


@app.post("/api/source/connect")
async def connect_source():
    await asyncio.to_thread(engine.reconnect)
    return engine.status()


@app.post("/api/source/disconnect")
async def disconnect_source():
    await asyncio.to_thread(engine.disconnect)
    return engine.status()


class ScenarioBody(BaseModel):
    scenario: str


@app.post("/api/simulator/scenario")
def set_scenario(body: ScenarioBody):
    if body.scenario not in SCENARIOS:
        _err(ValueError(f"scenario must be one of {SCENARIOS}"))
    engine.set_scenario(body.scenario)
    return {"scenario": body.scenario}


class ActuationBody(BaseModel):
    enabled: bool


@app.post("/api/actuation")
async def set_actuation(body: ActuationBody):
    """Enable/disable automatic suppression. There is no manual 'engage' command by design."""
    old, new = store.update({"actuation_enabled": body.enabled})
    await asyncio.to_thread(engine.apply_settings, old, new)
    engine.event("info" if body.enabled else "warning",
                 f"Automatic suppression {'enabled' if body.enabled else 'disabled'} by operator")
    return {"actuation_enabled": body.enabled}


# ======================================================================= labels
class LabelBody(BaseModel):
    name: str
    description: str = ""


@app.get("/api/labels")
def get_labels():
    return engine.recorder.labels


@app.post("/api/labels")
def add_label(body: LabelBody):
    try:
        return engine.recorder.add_label(body.name, body.description)
    except ValueError as e:
        _err(e)


@app.delete("/api/labels/{name}")
def delete_label(name: str):
    try:
        engine.recorder.delete_label(name)
    except KeyError:
        _err(KeyError("label not found"), 404)
    except ValueError as e:
        _err(e)
    return {"ok": True}


# ======================================================================= recording
class StartBody(BaseModel):
    label: str
    description: str = ""


class ResumeBody(BaseModel):
    label: str | None = None


@app.get("/api/recording")
def recording_status():
    return engine.recorder.status()


@app.post("/api/recording/start")
def recording_start(body: StartBody):
    st = engine.status()
    if st["source"]["state"] != "connected":
        _err(RuntimeError("Cannot record: no data source connected"), 409)
    try:
        src = "simulated" if st["source"]["simulated"] else "hardware"
        r = engine.recorder.start(body.label, body.description, src, asdict(store.get()))
        engine.event("info", f"Recording {r['session_id']} started ({body.label})")
        return r
    except (ValueError, RuntimeError) as e:
        _err(e, 409)


@app.post("/api/recording/pause")
def recording_pause():
    try:
        return engine.recorder.pause()
    except RuntimeError as e:
        _err(e, 409)


@app.post("/api/recording/resume")
def recording_resume(body: ResumeBody):
    try:
        return engine.recorder.resume(body.label)
    except (ValueError, RuntimeError) as e:
        _err(e, 409)


@app.post("/api/recording/stop")
def recording_stop():
    try:
        s = engine.recorder.stop()
        engine.event("ok", f"Recording {s['id']} saved ({s['samples']} samples)")
        return s
    except RuntimeError as e:
        _err(e, 409)


@app.post("/api/recording/discard")
def recording_discard():
    try:
        engine.recorder.discard()
        engine.event("warning", "Recording discarded")
        return {"ok": True}
    except RuntimeError as e:
        _err(e, 409)


# ======================================================================= sessions
@app.get("/api/sessions")
def sessions():
    return [{k: v for k, v in s.items() if k != "settings"} for s in engine.recorder.sessions]


def _session_or_404(sid: str) -> dict:
    try:
        return engine.recorder.get_session(sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")


def _nanmean(a):
    a = a[~np.isnan(a)]
    return float(a.mean()) if a.size else None


def _session_stats(c: dict) -> dict:
    valid = c["data_valid"] == 1
    return {
        "mean_emg": _nanmean(c["emg"][valid]),
        "mean_emg_avg": _nanmean(c["emg_avg"][valid]),
        "mean_rms": _nanmean(c["rms"][valid]),
        "median_peak_frequency": float(np.nanmedian(c["peak_frequency"][valid])) if valid.any() else None,
        "mean_peak_power": _nanmean(c["peak_power"][valid]),
        "az_std": float(np.nanstd(c["az"][valid])) if valid.any() else None,
        "tremor_pct": float(np.nanmean(c["tremor_detected"]) * 100) if c["tremor_detected"].size else 0.0,
        "servo_pct": float(np.nanmean(c["servo_engaged"]) * 100) if c["servo_engaged"].size else 0.0,
        "emg_active_pct": float(np.nanmean(c["emg_active"]) * 100) if c["emg_active"].size else 0.0,
        "mpu_active_pct": float(np.nanmean(c["mpu_active"]) * 100) if c["mpu_active"].size else 0.0,
    }


def _average_spectrum(az: np.ndarray, settings) -> tuple[list, list]:
    """Mean |FFT| over sliding windows, using the live detector's filter and window."""
    n = settings.mpu_buffer_size
    az = az[~np.isnan(az)]
    nyq = settings.fs / 2
    sos = butter(settings.filter_order, [settings.lowcut / nyq, settings.highcut / nyq], btype="band", output="sos")
    win = get_window("hann", n)
    freqs = np.fft.rfftfreq(n, 1 / settings.fs)
    if az.size < n:
        return freqs.round(4).tolist(), []
    specs = [np.abs(np.fft.rfft(sosfiltfilt(sos, az[i:i + n]) * win)) for i in range(0, az.size - n + 1, n // 2)]
    return freqs.round(4).tolist(), np.mean(specs, axis=0).round(5).tolist()


@app.get("/api/sessions/compare")
def compare_sessions(ids: str):
    out = []
    s = store.get()
    for sid in [i for i in ids.split(",") if i][:4]:
        meta = _session_or_404(sid)
        c = engine.recorder.load_session(sid)
        freqs, spec = _average_spectrum(c["az"], s)
        out.append({"id": sid, "label": meta["label"], "source": meta.get("source"),
                    "samples": meta["samples"], "stats": _session_stats(c), "freqs": freqs, "spectrum": spec})
    return out


@app.get("/api/sessions/{sid}")
def session_detail(sid: str, points: int = 2500):
    meta = _session_or_404(sid)
    c = engine.recorder.load_session(sid)
    n = c["timestamp"].size
    step = max(1, n // max(100, min(points, 10000)))
    t0 = c["timestamp"][0] if n else 0
    keys = ["emg", "emg_avg", "ax", "ay", "az", "magnitude", "filtered_az", "rms", "peak_frequency",
            "peak_power", "tremor_detected", "servo_engaged", "segment"]
    series = {k: np.where(np.isnan(c[k][::step]), None, np.round(c[k][::step], 5)).tolist() for k in keys}
    series["t"] = np.round(c["timestamp"][::step] - t0, 3).tolist()
    return {"session": meta, "stats": _session_stats(c) if n else None, "step": step, "series": series}


@app.get("/api/sessions/{sid}/download")
def session_download(sid: str, kind: str = "processed"):
    meta = _session_or_404(sid)
    path = (RAW_DIR / meta["raw_file"]) if kind == "raw" else (PROCESSED_DIR / meta["file"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(path, media_type="text/csv", filename=path.name)


@app.delete("/api/sessions/{sid}")
def session_delete(sid: str):
    _session_or_404(sid)
    engine.recorder.delete_session(sid)
    engine.event("warning", f"Session {sid} deleted")
    return {"ok": True}


@app.post("/api/datasets/export")
def export_dataset():
    name = engine.recorder.export_all()
    return {"file": name}


@app.get("/api/datasets/exported/{name}")
def download_export(name: str):
    path = (EXPORTED_DIR / name).resolve()
    if path.parent != EXPORTED_DIR.resolve() or not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/csv", filename=path.name)


# ======================================================================= ML
@app.get("/api/ml/status")
def ml_status():
    return engine.ml.status()


@app.post("/api/ml/reload")
def ml_reload():
    engine.ml.load()
    return engine.ml.status()


# ======================================================================= websocket
@app.websocket("/ws")
async def websocket(ws: WebSocket):
    s = store.get()
    hello = {
        "type": "hello",
        "settings": asdict(s),
        "samples": engine.samples_since(0, limit=int(s.graph_window_s * s.fs)),
        "status": engine.status(),
        "analysis": engine.analysis(),
    }
    await ws_manager.connect(ws, json.dumps(hello, separators=(",", ":")))
    try:
        while True:
            await ws.receive_text()     # clients don't send anything meaningful; keeps the socket open
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws)


# ======================================================================= frontend (production build)
if FRONTEND_DIST.exists():
    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
