# TREMORGUARD – Hand Tremor Monitoring Dashboard

Real-time dashboard for the TREMORGUARD wearable (ESP32 + MPU6050 + sEMG + servo).
The backend runs the **same detection algorithm as `Final paper edits/combine.py`**: filtering, FFT,
counters, AND gate, 2 s servo hold and 1 s heartbeat. The dashboard adds live visualisation, labelled
dataset recording, signal analysis, session history and a slot for an ML model.

```
ESP32 ──USB serial (COM7, 115200)──▶ FastAPI backend ──WebSocket──▶ React dashboard
          EMG,AX,AY,AZ,MAG             (owns the port)                (browser)
          ◀────── '1' / '0' ───────    detection + servo + recording
```

## Quick start (Windows)

You need Python 3.10+ and Node 18+.

```powershell
# 1. Backend
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# 2. Frontend (build once)
cd ..\frontend
npm install
npm run build

# 3. Run: the backend serves the built dashboard
cd ..\backend
.\.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. After the first setup, `run_dashboard.bat` does step 3.

**Before connecting:** close `combine.py`, the Arduino Serial Monitor and anything else using COM7.
Only one program can own the port, and the backend must be the only one.

### Developing the UI (hot reload)

Run the backend as above, then in a second terminal:

```powershell
cd frontend
npm run dev        # http://localhost:5173, proxies /api and /ws to :8000
```

### No hardware? Use the simulator

Settings → Data source → **Simulator** → Validate & apply. A banner marks every page as SIMULATED.
You can pick a scenario (rest, voluntary, tremor, auto cycle). Simulated sessions are flagged
`source=simulated` in metadata and in every CSV row. No servo commands are sent to hardware.

## How it maps to the original code

| `combine.py` | Backend module | Notes |
|---|---|---|
| `EMG_*`, `MPU_*`, `FS`, `LOWCUT`… constants | `config.py` (defaults) | Editable in Settings, validated |
| `emg_buffer`, `z_raw`, `butter_bandpass_filter`, Hann, `rfft` | `sensor_processor.py` | Identical maths (`sosfiltfilt`, zero-initialised deques) |
| `emg_counter`, `tremor_counter`, `combined_tremor` | `tremor_detector.py` | Identical thresholds and AND gate |
| `hold_until`, `send_state()` | `servo_controller.py` | Identical hold and heartbeat, plus the safety rules below |
| `ser.readline()` loop | `serial_manager.py` | Background thread, auto-reconnect |
| matplotlib plots | React frontend | Charts update at the graph refresh rate |

The port was checked against `combine.py` by running both on the same 60 s input. Counters,
detections and features matched exactly, at 1 and at 3 samples per detection step.

**One timing difference.** `combine.py` ran one detection step per matplotlib frame (`interval=10`
ms, but in practice whenever the PC finished drawing, so the samples per step varied). The backend
runs one step per sample by default (*Settings → Detection step every N samples = 1*), which is the
10 ms interval the script asked for. Set N = 3–5 to imitate a slower plot loop.

### Safety additions (not in the original)

- **Stale data releases the servo.** If no samples arrive for 500 ms (configurable), the status
  becomes SENSOR ERROR and the backend sends `'0'`. The original kept sending heartbeats from the old
  buffers, so the servo could stay engaged with no live data.
- **Warm-up.** After connecting, the servo stays released until the 64-sample MPU buffer holds real
  data. The zero-initialised buffer otherwise causes a filter transient.
- **Sensor validation.** EMG outside 0–4095, acceleration beyond ±2 g, a frozen MPU signal or ~0 g
  magnitude are reported as SENSOR ERROR and block actuation. A disconnected sensor never counts as
  "no tremor".
- **No manual engage.** The only operator control is *Auto suppression on/off*. Off sends `'0'`,
  which is useful for recording unsuppressed tremor.
- The UI always shows the **commanded** servo state. There is no position feedback, so the physical
  position is labelled as not verified. The ESP32's own 3 s failsafe is unchanged.

## Pages

| Page | What it shows |
|---|---|
| Overview | System status (NORMAL / TREMOR DETECTED / SENSOR ERROR / DISCONNECTED), connections, key metrics, events, recent sessions |
| Live Monitoring | sEMG (raw + moving average + 500/1500 thresholds), accelerometer X/Y/Z (Z highlighted), raw vs filtered Z, gyroscope, magnitude, detection pipeline, servo monitor |
| Data Acquisition | Start / pause / resume / stop, manual labels (plus custom), per-segment relabelling while paused, CSV download, export of all sessions |
| Signal Analysis | The exact 64-sample window: raw vs Butterworth-filtered, FFT spectrum with the 4–12 Hz band and thresholds, pass/fail of each condition, comparison of sessions |
| ML Analytics | Empty state until a real model exists, then metrics, confusion matrix, feature importance and live prediction |
| Session History | Search and filter, review charts, download processed/raw CSV, delete |
| Settings | COM port, baud, all detection parameters, servo hold and heartbeat, refresh rate, restore defaults |

## Recorded data

Each session writes two files:

- `datasets/raw/session_XXX_raw.csv`: timestamp, sample index, segment, EMG, AX–GZ, magnitude, label
- `datasets/processed/session_XXX.csv`: the raw values plus `filtered_az, emg_avg, rms,
  peak_frequency, peak_power, emg_counter, mpu_counter, emg_active, mpu_active, tremor_detected,
  servo_engaged, actuation_enabled, data_valid, label, source`

Metadata lives in `datasets/sessions.json`. *Export all as one CSV* writes `datasets/exported/…`.

- `timestamp` is the host receive time. The ESP32 sends no clock, and USB delivers lines in small
  bursts, so use `sample_index` for exact ordering and spacing (10 ms at 100 Hz).
- `label` is the **manual ground truth** chosen in Data Acquisition. The detector's opinion is in
  `tremor_detected` and is never copied into `label`.
- Recording happens in the acquisition thread, so a slow or closed browser does not drop samples.

## Gyroscope (optional)

The current firmware reads the gyro but does not send it. `firmware/esp32_code/esp32_code.ino` is your
sketch with one opt-in change: uncomment `#define SEND_GYRO` to send `EMG,AX,AY,AZ,MAG,GX,GY,GZ`.
The dashboard detects the 8-field format automatically and fills the gyroscope chart and CSV
columns. Keep it off if you still want to run the original `combine.py`, which expects 5 fields.

## ML model

```powershell
cd backend
.\.venv\Scripts\pip install scikit-learn pandas joblib
.\.venv\Scripts\python train_model.py            # add --include-simulated to use simulator sessions
```

This trains a RandomForest on `emg_avg, rms, peak_frequency, peak_power, magnitude` using your
manual labels. It holds out **whole sessions** for testing, because neighbouring samples are
near-duplicates and a random split would inflate accuracy. It writes
`models/trained_model.pkl` and `models/model_metadata.json`. Press **Reload model** on the ML page.
To use your own model, write the same two files (format documented at the top of `ml_model.py`).
Confidence is shown only when the metadata says `"calibrated": true`.

## Project layout

```
backend/    main.py (API + WebSocket), engine.py (acquisition pipeline), serial_manager.py,
            sensor_processor.py, tremor_detector.py, servo_controller.py, data_recorder.py,
            websocket_manager.py, ml_model.py, config.py, train_model.py
frontend/   React + TypeScript + Vite + Tailwind + Recharts (src/pages, src/components, src/hooks)
datasets/   raw/, processed/, exported/, sessions.json, labels.json
models/     trained_model.pkl + model_metadata.json (after training)
firmware/   esp32_code/esp32_code.ino
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot open COM7: Access is denied" | Another program holds the port. Close combine.py, the Serial Monitor or the Arduino IDE plotter |
| "Cannot open COM7: could not find port" | Check Device Manager for the ESP32's port and pick it in Settings |
| SENSOR ERROR "Connected, waiting for sensor data" | ESP32 is resetting (opening the port toggles DTR), or the I2C read is failing so the firmware skips output |
| Rate shows well below 100 Hz | USB or cable issue, or the MPU read is failing on some samples |
| Dashboard says "Backend offline" | Start uvicorn (step 3). The UI reconnects automatically |
