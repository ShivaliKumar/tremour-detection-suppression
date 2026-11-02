"""
Signal processing, ported from the original detector (Final paper edits/combine.py).

EMG:  rolling buffer (200), mean of the latest 10 samples.
MPU:  rolling Z-axis buffer (64) -> zero-phase Butterworth bandpass (order 2, 4-12 Hz)
      -> Hann window -> rFFT -> dominant frequency, peak magnitude, RMS of filtered signal.

Both buffers start filled with zeros, exactly like the original deques.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, get_window, sosfiltfilt

from config import Settings


@dataclass
class MpuFeatures:
    filtered: np.ndarray       # filtered Z buffer (len = mpu_buffer_size)
    spectrum: np.ndarray       # |rFFT| of the windowed filtered buffer
    peak_frequency: float
    peak_power: float
    rms: float


class SensorProcessor:
    def __init__(self, settings: Settings):
        self.configure(settings)

    def configure(self, s: Settings):
        """(Re)build filter, window and buffers. Resets buffer contents."""
        self.fs = s.fs
        self.emg_avg_samples = s.emg_avg_samples
        self.buffer_size = s.mpu_buffer_size

        nyq = 0.5 * s.fs
        self.sos = butter(s.filter_order, [s.lowcut / nyq, s.highcut / nyq], btype="band", output="sos")
        self.window = get_window("hann", s.mpu_buffer_size)
        self.freqs = np.fft.rfftfreq(s.mpu_buffer_size, 1 / s.fs)

        self.emg_buffer: deque[float] = deque([0] * s.emg_window, maxlen=s.emg_window)
        self.z_raw: deque[float] = deque([0.0] * s.mpu_buffer_size, maxlen=s.mpu_buffer_size)
        self.real_samples = 0   # samples received since the last reset (for warm-up)

    def push(self, emg: float, az: float):
        self.emg_buffer.append(emg)
        self.z_raw.append(az)
        self.real_samples += 1

    @property
    def warmed_up(self) -> bool:
        return self.real_samples >= self.buffer_size

    def emg_average(self) -> float:
        # np.mean(list(emg_buffer)[-10:]) in the original
        n = self.emg_avg_samples
        buf = self.emg_buffer
        return float(sum(buf[i] for i in range(len(buf) - n, len(buf))) / n)

    def mpu_features(self) -> MpuFeatures:
        filtered = sosfiltfilt(self.sos, np.fromiter(self.z_raw, float, self.buffer_size))
        fft_res = np.abs(np.fft.rfft(filtered * self.window))
        idx_max = int(np.argmax(fft_res))
        return MpuFeatures(
            filtered=filtered,
            spectrum=fft_res,
            peak_frequency=float(self.freqs[idx_max]),
            peak_power=float(fft_res[idx_max]),
            rms=float(np.sqrt(np.mean(filtered ** 2))),
        )

    def raw_z(self) -> np.ndarray:
        return np.fromiter(self.z_raw, float, self.buffer_size)
