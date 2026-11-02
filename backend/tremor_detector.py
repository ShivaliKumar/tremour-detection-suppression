"""
Tremor detection, ported from the original detector (Final paper edits/combine.py).

EMG counter:  avg > high -> +1, avg < low -> -1, otherwise unchanged; clamped 0..10.
MPU counter:  RMS > 0.02 and 4 <= f_peak <= 12 and peak power > 0.5 -> +1, else -1; clamped 0..10.
Combined:     emg_counter >= 2 AND tremor_counter >= 2   (AND gate)
"""

from __future__ import annotations

from dataclasses import dataclass

from config import Settings
from sensor_processor import MpuFeatures


@dataclass
class DetectionResult:
    emg_counter: int
    tremor_counter: int
    mpu_condition: bool     # this step's raw MPU tremor condition
    emg_active: bool
    mpu_active: bool
    tremor_detected: bool


class TremorDetector:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.reset()

    def configure(self, settings: Settings):
        self.settings = settings
        self.emg_counter = min(self.emg_counter, settings.emg_counter_max)
        self.tremor_counter = min(self.tremor_counter, settings.mpu_counter_max)

    def reset(self):
        self.emg_counter = 0
        self.tremor_counter = 0
        self.last = DetectionResult(0, 0, False, False, False, False)

    def step(self, emg_avg: float, mpu: MpuFeatures) -> DetectionResult:
        s = self.settings

        # EMG PROCESSING
        if emg_avg > s.emg_threshold_high:
            self.emg_counter = min(self.emg_counter + 1, s.emg_counter_max)
        elif emg_avg < s.emg_threshold_low:
            self.emg_counter = max(self.emg_counter - 1, 0)

        # MPU TREMOR CONDITION
        is_tremor = (
            mpu.rms > s.min_movement_rms
            and s.lowcut <= mpu.peak_frequency <= s.highcut
            and mpu.peak_power > s.min_peak_power
        )
        if is_tremor:
            self.tremor_counter = min(self.tremor_counter + 1, s.mpu_counter_max)
        else:
            self.tremor_counter = max(self.tremor_counter - 1, 0)

        # FINAL AND-GATE LOGIC
        emg_active = self.emg_counter >= s.emg_confirmation
        mpu_active = self.tremor_counter >= s.confirmation_threshold
        self.last = DetectionResult(
            emg_counter=self.emg_counter,
            tremor_counter=self.tremor_counter,
            mpu_condition=is_tremor,
            emg_active=emg_active,
            mpu_active=mpu_active,
            tremor_detected=emg_active and mpu_active,
        )
        return self.last
