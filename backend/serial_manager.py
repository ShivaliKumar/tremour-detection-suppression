"""
Data sources. Exactly one background thread owns the active source.

SerialSource     - owns the ESP32 COM port: reads lines, parses, writes servo
                   commands, reconnects after errors.
SimulatedSource  - synthetic signals for demos without hardware. Every sample it
                   produces is flagged source="simulated" and the UI shows a banner.

Line format from the firmware (MPU6050.ino):
    EMG,AX,AY,AZ,MAG                   (5 fields, current firmware)
    EMG,AX,AY,AZ,MAG,GX,GY,GZ          (8 fields, firmware/esp32_code.ino with SEND_GYRO)
"""

from __future__ import annotations

import math
import random
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import serial
import serial.tools.list_ports


@dataclass
class Sample:
    timestamp: float
    emg: float
    ax: float
    ay: float
    az: float
    magnitude: float
    gx: Optional[float] = None
    gy: Optional[float] = None
    gz: Optional[float] = None


def parse_line(line: str, timestamp: float) -> Optional[Sample]:
    """Parse one firmware line. Returns None for non-data lines (e.g. 'SYSTEM READY')."""
    parts = line.strip().split(",")
    if len(parts) not in (5, 8):
        return None
    try:
        emg = int(parts[0])
        ax, ay, az, mag = (float(p) for p in parts[1:5])
        gyro = [float(p) for p in parts[5:8]] if len(parts) == 8 else [None, None, None]
    except ValueError:
        return None
    vals = [ax, ay, az, mag] + [g for g in gyro if g is not None]
    if not all(math.isfinite(v) for v in vals):
        return None
    return Sample(timestamp, emg, ax, ay, az, mag, *gyro)


def validate_sample(s: Sample) -> Optional[str]:
    """Range check. Returns a reason string if the sample is physically implausible."""
    if not 0 <= s.emg <= 4095:
        return "EMG outside 12-bit ADC range"
    if max(abs(s.ax), abs(s.ay), abs(s.az)) > 2.1:      # firmware runs the MPU at +/-2 g
        return "acceleration outside +/-2 g range"
    if s.gx is not None and max(abs(s.gx), abs(s.gy), abs(s.gz)) > 260:   # +/-250 deg/s
        return "angular rate outside +/-250 deg/s range"
    return None


def list_ports() -> list[dict]:
    return [
        {"device": p.device, "description": p.description, "hwid": p.hwid}
        for p in sorted(serial.tools.list_ports.comports(), key=lambda p: p.device)
    ]


class SourceCallbacks:
    """Interface the engine implements."""

    def on_connect(self, writer: Optional[Callable[[bytes], None]], hardware: bool, info: str): ...
    def on_disconnect(self, reason: str): ...
    def on_sample(self, sample: Sample): ...
    def on_invalid(self, reason: str): ...
    def on_idle(self): ...
    def on_error(self, message: str): ...


class SerialSource:
    kind = "serial"

    def __init__(self, port: str, baud: int, auto_reconnect: bool, cb: SourceCallbacks):
        self.port, self.baud, self.auto_reconnect, self.cb = port, baud, auto_reconnect, cb
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="serial-reader", daemon=True)
        self._ser: Optional[serial.Serial] = None
        self._write_lock = threading.Lock()
        self.connected = False

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=3)

    def _write(self, data: bytes):
        with self._write_lock:
            if self._ser is None:
                raise serial.SerialException("port not open")
            self._ser.write(data)

    def _run(self):
        while not self._stop.is_set():
            try:
                self._ser = serial.Serial(self.port, self.baud, timeout=0.05)
                self._ser.reset_input_buffer()
            except (serial.SerialException, OSError) as e:
                self._ser = None
                self.cb.on_error(f"Cannot open {self.port}: {e}")
                if not self.auto_reconnect:
                    return
                self._stop.wait(2.0)
                continue

            self.connected = True
            self.cb.on_connect(self._write, True, f"{self.port} @ {self.baud}")
            buf = b""
            try:
                while not self._stop.is_set():
                    chunk = self._ser.read(self._ser.in_waiting or 1)
                    now = time.time()
                    if chunk:
                        buf += chunk
                        *lines, buf = buf.split(b"\n")
                        for raw in lines:
                            line = raw.decode(errors="ignore").strip()
                            if not line:
                                continue
                            sample = parse_line(line, now)
                            if sample is None:
                                if line[0].isdigit() or line[0] == "-":
                                    self.cb.on_invalid("malformed line")
                                continue
                            self.cb.on_sample(sample)
                        if len(buf) > 4096:     # no newline for a long time: garbage
                            buf = b""
                    self.cb.on_idle()
            except (serial.SerialException, OSError) as e:
                self.cb.on_error(f"Serial connection lost: {e}")
            finally:
                self.connected = False
                self.cb.on_disconnect("serial closed")
                with self._write_lock:
                    try:
                        if self._stop.is_set():
                            self._ser.write(b"0")   # release servo before closing (as original)
                    except Exception:
                        pass
                    try:
                        self._ser.close()
                    except Exception:
                        pass
                    self._ser = None
            if not self.auto_reconnect:
                return
            self._stop.wait(1.0)


SCENARIOS = ("rest", "voluntary", "tremor", "cycle")


class SimulatedSource:
    """
    Synthetic ESP32 stream at `fs` Hz. Clearly simulated - never written to hardware.

    rest       ~1 g on Z, sensor noise, low EMG
    voluntary  slow (0.5-1.5 Hz) large movement + EMG bursts  -> EMG active, MPU not
    tremor     ~6 Hz oscillation on all axes + high EMG        -> both active
    cycle      rest -> voluntary -> tremor, 10 s each
    When the (virtual) servo is engaged, tremor amplitude is halved to mimic suppression.
    """

    kind = "simulator"

    def __init__(self, fs: float, cb: SourceCallbacks, scenario: str = "cycle",
                 servo_state: Callable[[], bool] = lambda: False):
        self.fs, self.cb, self.scenario, self.servo_state = fs, cb, scenario, servo_state
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="simulator", daemon=True)
        self.connected = False
        self._t = 0.0
        self._rng = random.Random(7)
        self._emg_env = 200.0
        self._tremor_f = 6.2
        self._phase = 0.0
        self._suppression = 1.0

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=3)

    def active_scenario(self) -> str:
        if self.scenario != "cycle":
            return self.scenario
        return ("rest", "voluntary", "tremor")[int(self._t // 10) % 3]

    def _next(self, ts: float) -> Sample:
        t, rng = self._t, self._rng
        sc = self.active_scenario()
        n = lambda s: rng.gauss(0, s)

        ax, ay, az = 0.02 + n(0.004), -0.03 + n(0.004), 0.99 + n(0.004)
        gx, gy, gz = n(0.6), n(0.6), n(0.6)
        emg_target = 180

        if sc == "voluntary":
            ax += 0.35 * math.sin(2 * math.pi * 0.6 * t)
            ay += 0.20 * math.sin(2 * math.pi * 1.1 * t + 1)
            az += 0.10 * math.sin(2 * math.pi * 0.8 * t)
            gx += 40 * math.cos(2 * math.pi * 0.6 * t)
            gy += 25 * math.cos(2 * math.pi * 1.1 * t + 1)
            emg_target = 1700 if math.sin(2 * math.pi * 0.4 * t) > 0 else 900
        elif sc == "tremor":
            target = 0.5 if self.servo_state() else 1.0
            self._suppression += (target - self._suppression) * 0.02
            self._tremor_f += n(0.002)
            self._tremor_f = min(max(self._tremor_f, 5.0), 7.5)
            a = 0.09 * self._suppression * (1 + 0.15 * math.sin(2 * math.pi * 0.3 * t))
            self._phase = (self._phase + 2 * math.pi * self._tremor_f / self.fs) % (2 * math.pi)
            ph = self._phase
            ax += 0.6 * a * math.sin(ph + 0.4)
            ay += 0.4 * a * math.sin(ph + 1.1)
            az += a * math.sin(ph)
            gx += 55 * a / 0.09 * math.cos(ph)
            gy += 30 * a / 0.09 * math.cos(ph + 0.7)
            gz += 15 * a / 0.09 * math.cos(ph + 1.3)
            emg_target = 1900 + 500 * max(0.0, math.sin(ph))

        if sc != "tremor":
            self._suppression += (1.0 - self._suppression) * 0.02

        self._emg_env += (emg_target - self._emg_env) * 0.08
        emg = int(min(4095, max(0, self._emg_env + n(60 if sc == "rest" else 140))))
        mag = math.sqrt(ax * ax + ay * ay + az * az)
        r4 = lambda v: round(v, 4)
        return Sample(ts, emg, r4(ax), r4(ay), r4(az), r4(mag), round(gx, 2), round(gy, 2), round(gz, 2))

    def _run(self):
        self.connected = True
        self.cb.on_connect(None, False, "simulator")
        dt = 1.0 / self.fs
        start = time.time()
        produced = 0
        while not self._stop.is_set():
            due = int((time.time() - start) * self.fs)
            while produced < due:
                self.cb.on_sample(self._next(start + produced * dt))
                self._t += dt
                produced += 1
            self.cb.on_idle()
            self._stop.wait(0.01)
        self.connected = False
        self.cb.on_disconnect("simulator stopped")
