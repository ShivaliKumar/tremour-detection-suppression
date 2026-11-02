"""
Servo command logic, ported from the original detector (Final paper edits/combine.py).

- Combined tremor -> hold_until = now + HOLD_SECONDS
- Engaged while now < hold_until
- Send b'1' / b'0' on state change AND every HEARTBEAT_SECONDS, so the ESP32
  failsafe (3 s) does not release during a tremor.

Added safety (dashboard): when data is stale, the source is disconnected, the
buffers are still warming up, or actuation is disabled by the operator, the hold
is cancelled and '0' is sent instead. The servo is never engaged from stale or
missing data.

What is reported is the *commanded* state. There is no position feedback from the
servo, so the physical position is never claimed as verified.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Callable, Optional

from config import Settings

Writer = Callable[[bytes], None]


class ServoController:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.writer: Optional[Writer] = None
        self.hardware = False

        self.hold_until = 0.0
        self.commanded: Optional[bool] = None
        self.last_send_time = 0.0
        self.last_command: Optional[str] = None
        self.commands_sent = 0
        self.write_errors = 0
        self.last_write_error: Optional[str] = None

        self.requested = False           # what the detector asks for, before gating
        self.inhibit_reason: Optional[str] = None
        self.last_activation: Optional[float] = None
        self.last_release: Optional[float] = None
        self.history: deque[dict] = deque(maxlen=50)
        self._current: Optional[dict] = None

    def configure(self, settings: Settings):
        self.settings = settings

    def attach(self, writer: Optional[Writer], hardware: bool):
        self.writer = writer
        self.hardware = hardware
        self.commanded = None   # force a fresh command on the new link
        self.last_send_time = 0.0

    def update(self, tremor_detected: bool, inhibit: Optional[str], peak_frequency: float | None = None,
               now: float | None = None) -> bool:
        """Run one control step. `inhibit` is a reason string when actuation must not happen."""
        now = time.time() if now is None else now
        s = self.settings

        if inhibit is None and tremor_detected:
            self.hold_until = now + s.hold_seconds
        if inhibit is not None:
            self.hold_until = 0.0

        self.requested = now < self.hold_until
        if not s.actuation_enabled and inhibit is None:
            inhibit = "actuation disabled by operator"
        self.inhibit_reason = inhibit

        engaged = self.requested and inhibit is None
        self._track(engaged, now, peak_frequency)
        self._send(engaged, now)
        return engaged

    def release(self):
        """Unconditional release, used on shutdown and disconnect."""
        self.hold_until = 0.0
        self.requested = False
        self._track(False, time.time(), None)
        self._send(False, time.time(), force=True)

    def _send(self, state: bool, now: float, force: bool = False):
        if not force and state == self.commanded and (now - self.last_send_time) < self.settings.heartbeat_seconds:
            return
        cmd = b"1" if state else b"0"
        if self.writer is not None:
            try:
                self.writer(cmd)
            except Exception as e:     # serial write failures must never crash acquisition
                self.write_errors += 1
                self.last_write_error = str(e)
                return
        self.commanded = state
        self.last_send_time = now
        self.last_command = cmd.decode()
        self.commands_sent += 1

    def _track(self, engaged: bool, now: float, peak_frequency: float | None):
        was = self._current is not None
        if engaged and not was:
            self.last_activation = now
            self._current = {"start": now, "end": None, "duration": None, "peak_frequency": peak_frequency}
            self.history.appendleft(self._current)
        elif not engaged and was:
            self.last_release = now
            self._current["end"] = now
            self._current["duration"] = now - self._current["start"]
            self._current = None

    def status(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        s = self.settings
        since = now - self.last_send_time if self.last_send_time else None
        return {
            "engaged": bool(self.commanded),
            "requested": self.requested,
            "inhibit_reason": self.inhibit_reason,
            "actuation_enabled": s.actuation_enabled,
            "hardware_link": self.hardware,
            "position_verified": False,
            "hold_remaining": max(0.0, self.hold_until - now) if self.commanded else 0.0,
            "hold_seconds": s.hold_seconds,
            "last_activation": self.last_activation,
            "last_release": self.last_release,
            "heartbeat": {
                "interval": s.heartbeat_seconds,
                "last_sent": self.last_send_time or None,
                "seconds_since": since,
                "last_command": self.last_command,
                "commands_sent": self.commands_sent,
                "write_errors": self.write_errors,
                "last_error": self.last_write_error,
                "ok": since is not None and since <= s.heartbeat_seconds * 1.5 and self.writer is not None,
            },
            "history": list(self.history)[:20],
        }
