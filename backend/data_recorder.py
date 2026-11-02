"""
Dataset recording.

Recording runs inside the acquisition thread, independent of the WebSocket /
graph pipeline, so a slow browser can never drop recorded samples.

Each session writes two files:
    datasets/raw/session_XXX_raw.csv     raw sensor values only
    datasets/processed/session_XXX.csv   raw + processed features + detection + servo + label

Ground-truth labels are assigned manually by the operator per recording segment.
The detector output is stored in its own columns (tremor_detected) and is never
used as the label.
"""

from __future__ import annotations

import csv
import json
import re
import threading
import time
from datetime import datetime
from typing import Optional

import numpy as np

from config import EXPORTED_DIR, LABELS_FILE, PROCESSED_DIR, RAW_DIR, SESSIONS_FILE

DEFAULT_LABELS = [
    {"name": "Normal", "description": "Hand at rest", "builtin": True},
    {"name": "Voluntary Movement", "description": "Intentional hand movement", "builtin": True},
    {"name": "Tremor", "description": "Tremor activity", "builtin": True},
    {"name": "Tremor Suppressed", "description": "Tremor with suppression active", "builtin": True},
]

RAW_COLUMNS = ["timestamp", "sample_index", "segment", "emg", "ax", "ay", "az", "gx", "gy", "gz", "magnitude", "label"]
PROCESSED_COLUMNS = [
    "timestamp", "sample_index", "segment",
    "emg", "ax", "ay", "az", "gx", "gy", "gz", "magnitude",
    "filtered_az", "emg_avg", "rms", "peak_frequency", "peak_power",
    "emg_counter", "mpu_counter", "emg_active", "mpu_active", "tremor_detected",
    "servo_engaged", "actuation_enabled", "data_valid", "label", "source",
]

_LABEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _\-]{0,39}$")


def _fmt(v, col=""):
    if v is None:
        return ""
    if isinstance(v, bool):
        return int(v)
    if col == "timestamp":
        return f"{v:.4f}"       # full Unix time with 0.1 ms resolution
    if isinstance(v, float):
        return f"{v:.6g}"
    return v


class DataRecorder:
    def __init__(self):
        self._lock = threading.RLock()
        self.sessions: list[dict] = self._load_json(SESSIONS_FILE, [])
        self.labels: list[dict] = self._load_json(LABELS_FILE, DEFAULT_LABELS)
        self.total_samples = sum(s.get("samples", 0) for s in self.sessions)
        self._reset_state()

    # ----------------------------------------------------------- persistence
    @staticmethod
    def _load_json(path, default):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return [dict(d) for d in default]

    def _save_sessions(self):
        SESSIONS_FILE.write_text(json.dumps(self.sessions, indent=2))

    def _save_labels(self):
        LABELS_FILE.write_text(json.dumps(self.labels, indent=2))

    def _reset_state(self):
        self.state = "idle"           # idle | recording | paused
        self.session: Optional[dict] = None
        self._raw_f = self._proc_f = None
        self._raw_w = self._proc_w = None
        self._segment = 0
        self._label = None
        self._started_at = 0.0
        self._active_time = 0.0
        self._resumed_at = 0.0
        self._last_flush = 0.0

    # ----------------------------------------------------------- labels
    def add_label(self, name: str, description: str = "") -> dict:
        name = name.strip()
        if not _LABEL_RE.match(name):
            raise ValueError("Label must be 1-40 characters: letters, numbers, spaces, - or _")
        with self._lock:
            if any(l["name"].lower() == name.lower() for l in self.labels):
                raise ValueError("Label already exists")
            label = {"name": name, "description": description.strip()[:120], "builtin": False}
            self.labels.append(label)
            self._save_labels()
            return label

    def delete_label(self, name: str):
        with self._lock:
            match = next((l for l in self.labels if l["name"] == name), None)
            if match is None:
                raise KeyError(name)
            if match.get("builtin"):
                raise ValueError("Built-in labels cannot be removed")
            self.labels.remove(match)
            self._save_labels()

    def _check_label(self, label: str):
        if not any(l["name"] == label for l in self.labels):
            raise ValueError(f"Unknown label '{label}'")

    # ----------------------------------------------------------- control
    def _next_id(self) -> tuple[str, str]:
        nums = [int(m.group(1)) for s in self.sessions if (m := re.match(r"SESSION_(\d+)$", s["id"]))]
        n = max(nums, default=0) + 1
        return f"SESSION_{n:03d}", f"session_{n:03d}"

    def start(self, label: str, description: str, source: str, settings: dict) -> dict:
        with self._lock:
            if self.state != "idle":
                raise RuntimeError("A recording is already in progress")
            self._check_label(label)
            sid, stem = self._next_id()
            now = time.time()
            self._raw_f = open(RAW_DIR / f"{stem}_raw.csv", "w", newline="", buffering=1 << 16)
            self._proc_f = open(PROCESSED_DIR / f"{stem}.csv", "w", newline="", buffering=1 << 16)
            self._raw_w = csv.writer(self._raw_f)
            self._proc_w = csv.writer(self._proc_f)
            self._raw_w.writerow(RAW_COLUMNS)
            self._proc_w.writerow(PROCESSED_COLUMNS)
            self._segment, self._label = 0, label
            self._started_at = self._resumed_at = self._last_flush = now
            self._active_time = 0.0
            self.session = {
                "id": sid,
                "file": f"{stem}.csv",
                "raw_file": f"{stem}_raw.csv",
                "created": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
                "started_at": now,
                "ended_at": None,
                "duration": 0.0,
                "samples": 0,
                "invalid_samples": 0,
                "label": label,
                "labels": [label],
                "segments": [{"index": 0, "label": label, "start": now, "end": None, "samples": 0}],
                "description": description.strip()[:500],
                "source": source,
                "tremor_samples": 0,
                "servo_samples": 0,
                "settings": settings,
            }
            self.state = "recording"
            return self.status()

    def pause(self):
        with self._lock:
            if self.state != "recording":
                raise RuntimeError("Not recording")
            now = time.time()
            self._active_time += now - self._resumed_at
            self.session["segments"][-1]["end"] = now
            self._flush()
            self.state = "paused"
            return self.status()

    def resume(self, label: Optional[str] = None):
        """Resume as a new segment. The label may be changed while paused."""
        with self._lock:
            if self.state != "paused":
                raise RuntimeError("Not paused")
            if label:
                self._check_label(label)
                self._label = label
                if label not in self.session["labels"]:
                    self.session["labels"].append(label)
            now = time.time()
            self._segment += 1
            self.session["segments"].append(
                {"index": self._segment, "label": self._label, "start": now, "end": None, "samples": 0})
            self._resumed_at = now
            self.state = "recording"
            return self.status()

    def stop(self) -> dict:
        with self._lock:
            if self.state == "idle":
                raise RuntimeError("Not recording")
            now = time.time()
            if self.state == "recording":
                self._active_time += now - self._resumed_at
                self.session["segments"][-1]["end"] = now
            s = self.session
            s["ended_at"] = now
            s["duration"] = round(self._active_time, 2)
            s["segments"] = [seg for seg in s["segments"] if seg["samples"] > 0] or s["segments"][:1]
            s["label"] = s["labels"][0] if len(s["labels"]) == 1 else "Mixed"
            self._close_files()
            self.sessions.insert(0, s)
            self.total_samples += s["samples"]
            self._save_sessions()
            self._reset_state()
            return s

    def discard(self):
        with self._lock:
            if self.state == "idle":
                raise RuntimeError("Not recording")
            s = self.session
            self._close_files()
            for p in (PROCESSED_DIR / s["file"], RAW_DIR / s["raw_file"]):
                p.unlink(missing_ok=True)
            self._reset_state()

    def _close_files(self):
        for f in (self._raw_f, self._proc_f):
            if f:
                f.flush()
                f.close()

    def _flush(self):
        self._raw_f.flush()
        self._proc_f.flush()
        self._last_flush = time.time()

    # ----------------------------------------------------------- data path
    def write(self, row: dict):
        """Called from the acquisition thread for every sample."""
        if self.state != "recording":
            return
        with self._lock:
            if self.state != "recording":
                return
            s = self.session
            row["segment"] = self._segment
            row["label"] = self._label
            self._raw_w.writerow([_fmt(row.get(c), c) for c in RAW_COLUMNS])
            self._proc_w.writerow([_fmt(row.get(c), c) for c in PROCESSED_COLUMNS])
            s["samples"] += 1
            s["segments"][-1]["samples"] += 1
            s["tremor_samples"] += bool(row["tremor_detected"])
            s["servo_samples"] += bool(row["servo_engaged"])
            if not row["data_valid"]:
                s["invalid_samples"] += 1
            if row["timestamp"] - self._last_flush > 1.0:
                self._flush()

    def status(self) -> dict:
        with self._lock:
            if self.session is None:
                return {"state": "idle", "total_samples": self.total_samples}
            dur = self._active_time + (time.time() - self._resumed_at if self.state == "recording" else 0)
            s = self.session
            return {
                "state": self.state,
                "session_id": s["id"],
                "file": s["file"],
                "label": self._label,
                "labels": s["labels"],
                "description": s["description"],
                "segment": self._segment,
                "samples": s["samples"],
                "invalid_samples": s["invalid_samples"],
                "duration": dur,
                "started_at": s["started_at"],
                "source": s["source"],
                "total_samples": self.total_samples + s["samples"],
            }

    # ----------------------------------------------------------- sessions
    def get_session(self, sid: str) -> dict:
        s = next((s for s in self.sessions if s["id"] == sid), None)
        if s is None:
            raise KeyError(sid)
        return s

    def delete_session(self, sid: str):
        with self._lock:
            s = self.get_session(sid)
            for p in (PROCESSED_DIR / s["file"], RAW_DIR / s["raw_file"]):
                p.unlink(missing_ok=True)
            self.sessions.remove(s)
            self.total_samples -= s.get("samples", 0)
            self._save_sessions()

    def load_session(self, sid: str) -> dict[str, np.ndarray]:
        s = self.get_session(sid)
        path = PROCESSED_DIR / s["file"]
        with open(path, newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            rows = list(reader)
        cols: dict[str, np.ndarray] = {}
        for i, name in enumerate(header):
            col = [r[i] if i < len(r) else "" for r in rows]
            if name in ("label", "source"):
                cols[name] = np.array(col, dtype=object)
            else:
                cols[name] = np.array([float(v) if v != "" else np.nan for v in col])
        return cols

    def export_all(self) -> str:
        """Concatenate every processed session into one dataset CSV (for ML training)."""
        name = f"tremorguard_dataset_{datetime.now():%Y%m%d_%H%M%S}.csv"
        with open(EXPORTED_DIR / name, "w", newline="") as out:
            w = csv.writer(out)
            w.writerow(["session_id"] + PROCESSED_COLUMNS)
            for s in reversed(self.sessions):
                path = PROCESSED_DIR / s["file"]
                if not path.exists():
                    continue
                with open(path, newline="") as f:
                    r = csv.reader(f)
                    next(r, None)
                    for row in r:
                        w.writerow([s["id"]] + row)
        return name
