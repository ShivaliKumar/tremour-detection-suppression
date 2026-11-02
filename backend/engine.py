"""
Acquisition engine: the single owner of the data source.

Per sample (in the source thread):
    validate -> buffers -> processing + detection -> servo control -> recorder -> live ring buffer

The WebSocket broadcaster reads the ring buffer at the graph refresh rate, so
acquisition rate and graph refresh rate are independent.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import asdict
from threading import RLock
from typing import Optional

import numpy as np

from config import Settings, SettingsStore
from data_recorder import DataRecorder
from ml_model import MLModel
from sensor_processor import MpuFeatures, SensorProcessor
from serial_manager import Sample, SerialSource, SimulatedSource, SourceCallbacks, validate_sample
from servo_controller import ServoController
from tremor_detector import TremorDetector

PROCESSING_KEYS = ("fs", "emg_window", "emg_avg_samples", "lowcut", "highcut", "filter_order", "mpu_buffer_size")
SOURCE_KEYS = ("source", "port", "baud", "auto_reconnect")


def _r(v: Optional[float], nd: int = 4):
    return None if v is None else round(float(v), nd)


class Engine(SourceCallbacks):
    def __init__(self, store: SettingsStore):
        self.store = store
        s = store.get()
        self.lock = RLock()
        self.processor = SensorProcessor(s)
        self.detector = TremorDetector(s)
        self.servo = ServoController(s)
        self.recorder = DataRecorder()
        self.ml = MLModel()

        self.source: Optional[SerialSource | SimulatedSource] = None
        self.sim_scenario = "cycle"
        self.source_state = "disconnected"     # disconnected | connecting | connected
        self.source_info = ""
        self.last_error: Optional[str] = None
        self.events: deque[dict] = deque(maxlen=100)

        self.seq = 0
        self.ring: deque[dict] = deque(maxlen=3000)
        self.last_row: Optional[dict] = None
        self.features: Optional[MpuFeatures] = None
        self.emg_avg = 0.0
        self._reset_health()

    # ================================================================ lifecycle
    def start(self):
        self._start_source(self.store.get())

    def stop(self):
        self._stop_source()
        if self.recorder.state != "idle":
            self.recorder.stop()

    def _start_source(self, s: Settings):
        with self.lock:
            self.source_state = "connecting"
            self.source_info = s.port if s.source == "serial" else "simulator"
            self.last_error = None
        if s.source == "simulator":
            self.source = SimulatedSource(s.fs, self, self.sim_scenario, servo_state=lambda: bool(self.servo.commanded))
            self.event("warning", "Simulator started - all data is SIMULATED")
        else:
            self.source = SerialSource(s.port, s.baud, s.auto_reconnect, self)
            self.event("info", f"Opening {s.port} @ {s.baud} baud")
        self.source.start()

    def _stop_source(self):
        src, self.source = self.source, None
        if src is not None:
            src.stop()      # never called while holding self.lock (the thread needs it)
        with self.lock:
            self.servo.attach(None, False)
            self.source_state = "disconnected"

    def reconnect(self):
        self._stop_source()
        self._start_source(self.store.get())

    def disconnect(self):
        self._stop_source()
        self.event("info", "Source disconnected by operator")

    def set_scenario(self, scenario: str):
        self.sim_scenario = scenario
        if isinstance(self.source, SimulatedSource):
            self.source.scenario = scenario

    def apply_settings(self, old: Settings, new: Settings):
        if any(getattr(old, k) != getattr(new, k) for k in SOURCE_KEYS) or (
                new.source == "simulator" and old.fs != new.fs):
            self._stop_source()
            with self.lock:
                self._configure(new, reset=True)
            self._start_source(new)
            return
        with self.lock:
            self._configure(new, reset=any(getattr(old, k) != getattr(new, k) for k in PROCESSING_KEYS))

    def _configure(self, s: Settings, reset: bool):
        self.detector.configure(s)
        self.servo.configure(s)
        if reset:
            self.processor.configure(s)
            self.detector.reset()
            self.features = None
            self.event("info", "Processing parameters changed - buffers reset")

    def event(self, level: str, message: str):
        self.events.appendleft({"time": time.time(), "level": level, "message": message})

    # ================================================================ health
    def _reset_health(self):
        self.last_sample_time = 0.0
        self.sample_times: deque[float] = deque(maxlen=2000)
        self.sample_index = 0
        self.valid_count = 0
        self.invalid_count = 0
        self.malformed_count = 0
        self.last_invalid: Optional[tuple[float, str]] = None
        self.has_gyro = False
        self.stale = False
        self._same_mpu = 0
        self._same_emg = 0
        self._prev_mpu: Optional[tuple] = None
        self._prev_emg: Optional[float] = None
        self._low_gravity = 0

    def _sensor_health(self, now: float) -> dict:
        s = self.store.get()
        no_data = self.source_state != "connected" or self.last_sample_time == 0 or self.stale
        recent_invalid = self.last_invalid is not None and now - self.last_invalid[0] < 1.0

        def mk(state, detail):
            return {"state": state, "detail": detail}

        if no_data:
            mpu = emg = mk("no_data", "No samples received" if self.source_state == "connected" else "Source disconnected")
        else:
            if recent_invalid and "acceleration" in self.last_invalid[1]:
                mpu = mk("error", self.last_invalid[1])
            elif self._same_mpu >= s.fs:
                mpu = mk("error", "Signal frozen (identical readings for >1 s)")
            elif self._low_gravity >= s.fs / 2:
                mpu = mk("error", "Acceleration magnitude near 0 g - check wiring")
            else:
                mpu = mk("ok", "Streaming")
            if recent_invalid and "EMG" in self.last_invalid[1]:
                emg = mk("error", self.last_invalid[1])
            elif self._same_emg >= 2 * s.fs:
                emg = mk("warning", f"Flat signal at {self._prev_emg:.0f} for >2 s - check electrodes")
            else:
                emg = mk("ok", "Streaming")
        return {"mpu": mpu, "emg": emg}

    def _inhibit(self, now: float, health: dict) -> Optional[str]:
        if self.source_state != "connected":
            return "source disconnected"
        if self.stale or self.last_sample_time == 0:
            return "no data from sensors"
        if health["mpu"]["state"] == "error":
            return "MPU6050 sensor error"
        if health["emg"]["state"] == "error":
            return "sEMG sensor error"
        if not self.processor.warmed_up:
            return "warming up buffers"
        return None

    # ================================================================ source callbacks
    def on_connect(self, writer, hardware: bool, info: str):
        with self.lock:
            s = self.store.get()
            self.source_state = "connected"
            self.source_info = info
            self.last_error = None
            self._reset_health()
            self.processor.configure(s)
            self.detector.reset()
            self.features = None
            self.servo.attach(writer, hardware)
            self.servo.release()        # start released; first command is '0' like the original
            self.event("ok", f"Connected: {info}")

    def on_disconnect(self, reason: str):
        with self.lock:
            self.servo.release()
            self.servo.attach(None, False)
            if self.source_state == "connected":
                self.event("error", f"Disconnected ({reason})")
            self.source_state = "connecting" if self.source is not None and self.store.get().auto_reconnect else "disconnected"

    def on_error(self, message: str):
        with self.lock:
            if message != self.last_error:
                self.event("error", message)
            self.last_error = message
            if self.source_state != "connected":
                self.source_state = "connecting" if self.store.get().auto_reconnect else "disconnected"

    def on_invalid(self, reason: str):
        with self.lock:
            self.malformed_count += 1

    def on_idle(self):
        now = time.time()
        with self.lock:
            s = self.store.get()
            if self.last_sample_time and not self.stale and now - self.last_sample_time > s.stale_timeout_ms / 1000:
                self.stale = True
                self.event("error", "Sensor data stopped - servo released")
            if self.stale or self.last_sample_time == 0:
                self.servo.update(False, "no data from sensors", now=now)

    def on_sample(self, sample: Sample):
        with self.lock:
            s = self.store.get()
            now = sample.timestamp
            if self.stale:
                self.stale = False
                self.processor.configure(s)
                self.detector.reset()
                self.event("warning", "Sensor data resumed - buffers reset")
            self.last_sample_time = time.time()
            self.sample_times.append(self.last_sample_time)
            self.sample_index += 1
            if sample.gx is not None:
                self.has_gyro = True

            # --- validation / health
            reason = validate_sample(sample)
            valid = reason is None
            if valid:
                self.valid_count += 1
                mpu_key = (sample.ax, sample.ay, sample.az)
                self._same_mpu = self._same_mpu + 1 if mpu_key == self._prev_mpu else 0
                self._same_emg = self._same_emg + 1 if sample.emg == self._prev_emg else 0
                self._low_gravity = self._low_gravity + 1 if sample.magnitude < 0.3 else 0
                self._prev_mpu, self._prev_emg = mpu_key, sample.emg
            else:
                self.invalid_count += 1
                if self.last_invalid is None or now - self.last_invalid[0] > 5:
                    self.event("warning", f"Invalid sample: {reason}")
                self.last_invalid = (now, reason)

            # --- processing + detection (only valid samples enter the buffers)
            if valid:
                self.processor.push(sample.emg, sample.az)
                if self.processor.real_samples % s.detection_every_n == 0 or self.features is None:
                    self.features = self.processor.mpu_features()
                    self.emg_avg = self.processor.emg_average()
                    self.detector.step(self.emg_avg, self.features)
            det = self.detector.last
            f = self.features

            # --- servo
            health = self._sensor_health(now)
            engaged = self.servo.update(det.tremor_detected, self._inhibit(now, health),
                                        f.peak_frequency if f else None, now=now)

            # --- record + ring buffer
            row = {
                "timestamp": now, "sample_index": self.sample_index,
                "emg": sample.emg, "ax": sample.ax, "ay": sample.ay, "az": sample.az,
                "gx": sample.gx, "gy": sample.gy, "gz": sample.gz, "magnitude": sample.magnitude,
                "filtered_az": float(f.filtered[-1]) if f else None,
                "emg_avg": self.emg_avg,
                "rms": f.rms if f else None,
                "peak_frequency": f.peak_frequency if f else None,
                "peak_power": f.peak_power if f else None,
                "emg_counter": det.emg_counter, "mpu_counter": det.tremor_counter,
                "emg_active": det.emg_active, "mpu_active": det.mpu_active,
                "tremor_detected": det.tremor_detected,
                "servo_engaged": engaged, "actuation_enabled": s.actuation_enabled,
                "data_valid": valid, "source": "simulated" if isinstance(self.source, SimulatedSource) else "hardware",
            }
            self.recorder.write(row)
            self.last_row = row
            self.seq += 1
            self.ring.append({
                "seq": self.seq,
                "timestamp": round(now, 3),
                "sensors": {
                    "emg": sample.emg, "ax": sample.ax, "ay": sample.ay, "az": sample.az,
                    "gx": sample.gx, "gy": sample.gy, "gz": sample.gz, "magnitude": sample.magnitude,
                },
                "processing": {
                    "filtered_az": _r(row["filtered_az"], 5), "emg_avg": _r(self.emg_avg, 1),
                    "rms": _r(row["rms"], 5), "peak_frequency": _r(row["peak_frequency"], 3),
                    "peak_power": _r(row["peak_power"], 4),
                    "emg_counter": det.emg_counter, "tremor_counter": det.tremor_counter,
                },
                "detection": {"emg_active": det.emg_active, "mpu_active": det.mpu_active,
                              "tremor_detected": det.tremor_detected},
                "actuation": {"servo_engaged": engaged},
                "valid": valid,
            })

    # ================================================================ snapshots
    def status(self) -> dict:
        now = time.time()
        with self.lock:
            s = self.store.get()
            health = self._sensor_health(now)
            det = self.detector.last
            while self.sample_times and now - self.sample_times[0] > 2.0:
                self.sample_times.popleft()
            rate = len(self.sample_times) / 2.0 if self.source_state == "connected" else 0.0

            if self.source_state != "connected":
                system, detail = "DISCONNECTED", self.last_error or "No data source connected"
            elif self.last_sample_time == 0:
                system, detail = "SENSOR ERROR", "Connected, waiting for sensor data"
            elif self.stale:
                system, detail = "SENSOR ERROR", f"No data for {now - self.last_sample_time:.1f} s"
            elif health["mpu"]["state"] == "error":
                system, detail = "SENSOR ERROR", f"MPU6050: {health['mpu']['detail']}"
            elif health["emg"]["state"] == "error":
                system, detail = "SENSOR ERROR", f"sEMG: {health['emg']['detail']}"
            elif not self.processor.warmed_up:
                system, detail = "INITIALIZING", f"Filling buffers ({self.processor.real_samples}/{self.processor.buffer_size})"
            elif det.tremor_detected:
                f = self.features
                system, detail = "TREMOR DETECTED", f"EMG and MPU confirmed at {f.peak_frequency:.1f} Hz" if f else ""
            else:
                system, detail = "NORMAL", "No tremor detected"

            f = self.features
            return {
                "server_time": now,
                "system": {"state": system, "detail": detail},
                "source": {
                    "kind": s.source, "state": self.source_state, "info": self.source_info,
                    "simulated": s.source == "simulator", "scenario": self.sim_scenario if s.source == "simulator" else None,
                    "active_scenario": self.source.active_scenario() if isinstance(self.source, SimulatedSource) else None,
                    "error": self.last_error, "sample_rate": rate,
                    "last_sample_age": (now - self.last_sample_time) if self.last_sample_time else None,
                    "samples_received": self.sample_index, "invalid_samples": self.invalid_count,
                    "malformed_lines": self.malformed_count, "gyro_available": self.has_gyro,
                },
                "sensors": health,
                "processing": {
                    "warmed_up": self.processor.warmed_up,
                    "emg_avg": _r(self.emg_avg, 1),
                    "rms": _r(f.rms, 5) if f else None,
                    "peak_frequency": _r(f.peak_frequency, 3) if f else None,
                    "peak_power": _r(f.peak_power, 4) if f else None,
                    "amplitude": _r(float(np.ptp(f.filtered)), 5) if f else None,
                },
                "detection": {**asdict(det)},
                "servo": self.servo.status(now),
                "recording": self.recorder.status(),
                "ml": {"available": self.ml.available, "prediction": self.ml.last_prediction},
                "events": list(self.events)[:30],
            }

    def analysis(self) -> Optional[dict]:
        with self.lock:
            f = self.features
            if f is None:
                return None
            return {
                "raw_z": np.round(self.processor.raw_z(), 5).tolist(),
                "filtered_z": np.round(f.filtered, 5).tolist(),
                "freqs": np.round(self.processor.freqs, 4).tolist(),
                "spectrum": np.round(f.spectrum, 5).tolist(),
                "fs": self.processor.fs,
            }

    def samples_since(self, seq: int, limit: int) -> list[dict]:
        with self.lock:
            if not self.ring or self.ring[-1]["seq"] <= seq:
                return []
            out = [r for r in self.ring if r["seq"] > seq] if seq else list(self.ring)
            return out[-limit:]

    def latest_seq(self) -> int:
        return self.seq
