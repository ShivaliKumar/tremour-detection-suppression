"""
TREMORGUARD configuration.

Defaults mirror the constants in the original detector script
(Final paper edits/combine.py) and firmware (Final paper edits/MPU6050/MPU6050.ino).
Every runtime change goes through `validate()` before it is applied.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, fields
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
SETTINGS_FILE = BACKEND_DIR / "settings.json"

DATASETS_DIR = PROJECT_DIR / "datasets"
RAW_DIR = DATASETS_DIR / "raw"
PROCESSED_DIR = DATASETS_DIR / "processed"
EXPORTED_DIR = DATASETS_DIR / "exported"
SESSIONS_FILE = DATASETS_DIR / "sessions.json"
LABELS_FILE = DATASETS_DIR / "labels.json"
MODELS_DIR = PROJECT_DIR / "models"
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"

for _d in (RAW_DIR, PROCESSED_DIR, EXPORTED_DIR, MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ESP32 firmware failsafe (FAILSAFE_MS in MPU6050.ino). Not configurable here:
# it lives in the firmware. The heartbeat interval must stay below it.
ESP32_FAILSAFE_S = 3.0

ALLOWED_BAUD_RATES = (9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600)
SOURCES = ("serial", "simulator")


@dataclass
class Settings:
    # --- Serial ---------------------------------------------------------
    source: str = "serial"             # "serial" | "simulator"
    port: str = "COM7"
    baud: int = 115200
    auto_reconnect: bool = True

    # --- Sampling -------------------------------------------------------
    fs: float = 100.0                  # must match firmware SAMPLE_RATE

    # --- sEMG -----------------------------------------------------------
    emg_window: int = 200
    emg_avg_samples: int = 10
    emg_threshold_high: float = 1500.0
    emg_threshold_low: float = 500.0
    emg_counter_max: int = 10
    emg_confirmation: int = 2

    # --- MPU6050 --------------------------------------------------------
    lowcut: float = 4.0
    highcut: float = 12.0
    filter_order: int = 2
    mpu_buffer_size: int = 64
    min_movement_rms: float = 0.02
    min_peak_power: float = 0.5
    confirmation_threshold: int = 2
    mpu_counter_max: int = 10

    # How often the detection step runs, in samples. The original script ran one
    # step per matplotlib frame (interval=10 ms, i.e. once per sample at 100 Hz
    # if the PC kept up). 1 = every sample.
    detection_every_n: int = 1

    # --- Servo ----------------------------------------------------------
    hold_seconds: float = 2.0
    heartbeat_seconds: float = 1.0
    actuation_enabled: bool = True

    # --- Safety / UI ----------------------------------------------------
    stale_timeout_ms: int = 500        # no samples for this long => sensor error
    graph_refresh_ms: int = 100        # websocket broadcast interval
    graph_window_s: int = 8            # seconds of history shown in live charts


DEFAULTS = Settings()

# (min, max) for numeric fields. Used by the backend and sent to the frontend.
LIMITS: dict[str, tuple[float, float]] = {
    "fs": (10, 1000),
    "emg_window": (20, 2000),
    "emg_avg_samples": (1, 200),
    "emg_threshold_high": (0, 4095),
    "emg_threshold_low": (0, 4095),
    "emg_counter_max": (2, 100),
    "emg_confirmation": (1, 100),
    "lowcut": (0.5, 200),
    "highcut": (0.5, 499),
    "filter_order": (1, 6),
    "mpu_buffer_size": (32, 1024),
    "min_movement_rms": (0.0, 2.0),
    "min_peak_power": (0.0, 1000.0),
    "confirmation_threshold": (1, 100),
    "mpu_counter_max": (2, 100),
    "detection_every_n": (1, 50),
    "hold_seconds": (0.5, 10.0),
    "heartbeat_seconds": (0.2, ESP32_FAILSAFE_S - 0.5),
    "stale_timeout_ms": (100, 5000),
    "graph_refresh_ms": (33, 1000),
    "graph_window_s": (2, 30),
}


class SettingsError(ValueError):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


def _coerce(name: str, value, current):
    t = type(current)
    if t is bool:
        if isinstance(value, bool):
            return value
        raise ValueError("must be true or false")
    if t is int:
        if isinstance(value, bool) or not float(value).is_integer():
            raise ValueError("must be a whole number")
        return int(value)
    if t is float:
        if isinstance(value, bool):
            raise ValueError("must be a number")
        return float(value)
    if not isinstance(value, str):
        raise ValueError("must be text")
    return value.strip()


def validate(base: Settings, patch: dict) -> Settings:
    """Return a new Settings with `patch` applied, or raise SettingsError."""
    known = {f.name for f in fields(Settings)}
    errors: dict[str, str] = {}
    data = asdict(base)

    for key, value in patch.items():
        if key not in known:
            errors[key] = "unknown setting"
            continue
        try:
            data[key] = _coerce(key, value, getattr(base, key))
        except (TypeError, ValueError) as e:
            errors[key] = str(e)

    for key, (lo, hi) in LIMITS.items():
        if key in errors:
            continue
        v = data[key]
        if not (lo <= v <= hi):
            errors[key] = f"must be between {lo:g} and {hi:g}"

    if data["source"] not in SOURCES:
        errors["source"] = f"must be one of {', '.join(SOURCES)}"
    if data["source"] == "serial" and not data["port"]:
        errors["port"] = "required"
    if data["baud"] not in ALLOWED_BAUD_RATES:
        errors["baud"] = "unsupported baud rate"

    if "emg_threshold_low" not in errors and data["emg_threshold_low"] >= data["emg_threshold_high"]:
        errors["emg_threshold_low"] = "must be below the high threshold"
    if "emg_confirmation" not in errors and data["emg_confirmation"] > data["emg_counter_max"]:
        errors["emg_confirmation"] = "cannot exceed the counter maximum"
    if "confirmation_threshold" not in errors and data["confirmation_threshold"] > data["mpu_counter_max"]:
        errors["confirmation_threshold"] = "cannot exceed the counter maximum"
    if "emg_avg_samples" not in errors and data["emg_avg_samples"] > data["emg_window"]:
        errors["emg_avg_samples"] = "cannot exceed the EMG buffer size"

    nyq = data["fs"] / 2
    if "lowcut" not in errors and data["lowcut"] >= data["highcut"]:
        errors["lowcut"] = "must be below the upper cutoff"
    if "highcut" not in errors and data["highcut"] >= nyq:
        errors["highcut"] = f"must be below Nyquist ({nyq:g} Hz)"
    # sosfiltfilt needs the buffer to be longer than its padding
    min_buf = 3 * (2 * data["filter_order"] + 1) + 1
    if "mpu_buffer_size" not in errors and data["mpu_buffer_size"] <= min_buf:
        errors["mpu_buffer_size"] = f"must be greater than {min_buf} for this filter order"

    if errors:
        raise SettingsError(errors)
    return Settings(**data)


class SettingsStore:
    """Thread-safe holder for the active settings, persisted to settings.json."""

    def __init__(self):
        self._lock = threading.Lock()
        self._settings = self._load()

    def _load(self) -> Settings:
        if SETTINGS_FILE.exists():
            try:
                stored = json.loads(SETTINGS_FILE.read_text())
                known = {f.name for f in fields(Settings)}
                return validate(DEFAULTS, {k: v for k, v in stored.items() if k in known})
            except (ValueError, OSError) as e:
                print(f"[config] ignoring invalid settings.json: {e}")
        return Settings()

    def get(self) -> Settings:
        with self._lock:
            return self._settings

    def update(self, patch: dict) -> tuple[Settings, Settings]:
        with self._lock:
            old = self._settings
            new = validate(old, patch)
            self._settings = new
            SETTINGS_FILE.write_text(json.dumps(asdict(new), indent=2))
            return old, new

    def reset(self) -> tuple[Settings, Settings]:
        with self._lock:
            old = self._settings
            self._settings = Settings()
            SETTINGS_FILE.write_text(json.dumps(asdict(self._settings), indent=2))
            return old, self._settings
