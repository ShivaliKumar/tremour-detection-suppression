// Shapes of the data sent by the FastAPI backend (backend/engine.py, backend/main.py).

export interface Sample {
  seq: number;
  timestamp: number;
  sensors: {
    emg: number;
    ax: number;
    ay: number;
    az: number;
    gx: number | null;
    gy: number | null;
    gz: number | null;
    magnitude: number;
  };
  processing: {
    filtered_az: number | null;
    emg_avg: number | null;
    rms: number | null;
    peak_frequency: number | null;
    peak_power: number | null;
    emg_counter: number;
    tremor_counter: number;
  };
  detection: { emg_active: boolean; mpu_active: boolean; tremor_detected: boolean };
  actuation: { servo_engaged: boolean };
  valid: boolean;
}

export type SystemState = "NORMAL" | "TREMOR DETECTED" | "SENSOR ERROR" | "DISCONNECTED" | "INITIALIZING";
export type SensorState = "ok" | "warning" | "error" | "no_data";

export interface ActivationRecord {
  start: number;
  end: number | null;
  duration: number | null;
  peak_frequency: number | null;
}

export interface ServoStatus {
  engaged: boolean;
  requested: boolean;
  inhibit_reason: string | null;
  actuation_enabled: boolean;
  hardware_link: boolean;
  position_verified: boolean;
  hold_remaining: number;
  hold_seconds: number;
  last_activation: number | null;
  last_release: number | null;
  heartbeat: {
    interval: number;
    last_sent: number | null;
    seconds_since: number | null;
    last_command: string | null;
    commands_sent: number;
    write_errors: number;
    last_error: string | null;
    ok: boolean;
  };
  history: ActivationRecord[];
}

export interface RecordingStatus {
  state: "idle" | "recording" | "paused";
  total_samples: number;
  session_id?: string;
  file?: string;
  label?: string;
  labels?: string[];
  description?: string;
  segment?: number;
  samples?: number;
  invalid_samples?: number;
  duration?: number;
  started_at?: number;
  source?: string;
}

export interface SystemEvent {
  time: number;
  level: "ok" | "info" | "warning" | "error";
  message: string;
}

export interface Status {
  server_time: number;
  system: { state: SystemState; detail: string };
  source: {
    kind: "serial" | "simulator";
    state: "disconnected" | "connecting" | "connected";
    info: string;
    simulated: boolean;
    scenario: string | null;
    active_scenario: string | null;
    error: string | null;
    sample_rate: number;
    last_sample_age: number | null;
    samples_received: number;
    invalid_samples: number;
    malformed_lines: number;
    gyro_available: boolean;
  };
  sensors: { mpu: { state: SensorState; detail: string }; emg: { state: SensorState; detail: string } };
  processing: {
    warmed_up: boolean;
    emg_avg: number | null;
    rms: number | null;
    peak_frequency: number | null;
    peak_power: number | null;
    amplitude: number | null;
  };
  detection: {
    emg_counter: number;
    tremor_counter: number;
    mpu_condition: boolean;
    emg_active: boolean;
    mpu_active: boolean;
    tremor_detected: boolean;
  };
  servo: ServoStatus;
  recording: RecordingStatus;
  ml: { available: boolean; prediction: MLPrediction | null };
  events: SystemEvent[];
}

export interface Analysis {
  raw_z: number[];
  filtered_z: number[];
  freqs: number[];
  spectrum: number[];
  fs: number;
}

export interface Settings {
  source: "serial" | "simulator";
  port: string;
  baud: number;
  auto_reconnect: boolean;
  fs: number;
  emg_window: number;
  emg_avg_samples: number;
  emg_threshold_high: number;
  emg_threshold_low: number;
  emg_counter_max: number;
  emg_confirmation: number;
  lowcut: number;
  highcut: number;
  filter_order: number;
  mpu_buffer_size: number;
  min_movement_rms: number;
  min_peak_power: number;
  confirmation_threshold: number;
  mpu_counter_max: number;
  detection_every_n: number;
  hold_seconds: number;
  heartbeat_seconds: number;
  actuation_enabled: boolean;
  stale_timeout_ms: number;
  graph_refresh_ms: number;
  graph_window_s: number;
}

export interface SettingsPayload {
  settings: Settings;
  defaults: Settings;
  limits: Record<string, [number, number]>;
  baud_rates: number[];
  esp32_failsafe_s: number;
}

export interface Label {
  name: string;
  description: string;
  builtin: boolean;
}

export interface Segment {
  index: number;
  label: string;
  start: number;
  end: number | null;
  samples: number;
}

export interface Session {
  id: string;
  file: string;
  raw_file: string;
  created: string;
  started_at: number;
  ended_at: number | null;
  duration: number;
  samples: number;
  invalid_samples: number;
  label: string;
  labels: string[];
  segments: Segment[];
  description: string;
  source: "hardware" | "simulated";
  tremor_samples: number;
  servo_samples: number;
  settings?: Partial<Settings>; // only in /api/sessions/{id}
}

export interface SessionStats {
  mean_emg: number | null;
  mean_emg_avg: number | null;
  mean_rms: number | null;
  median_peak_frequency: number | null;
  mean_peak_power: number | null;
  az_std: number | null;
  tremor_pct: number;
  servo_pct: number;
  emg_active_pct: number;
  mpu_active_pct: number;
}

export interface SessionDetail {
  session: Session;
  stats: SessionStats | null;
  step: number;
  series: Record<string, (number | null)[]>;
}

export interface SessionComparison {
  id: string;
  label: string;
  source: string;
  samples: number;
  stats: SessionStats;
  freqs: number[];
  spectrum: number[];
}

export interface MLPrediction {
  label: string;
  confidence: number | null;
  timestamp: number;
}

export interface MLStatus {
  available: boolean;
  model_file: string;
  metadata_file: string;
  error: string | null;
  prediction: MLPrediction | null;
  trainer?: { available: boolean; algorithms: Record<string, string> };
  metadata: null | {
    algorithm?: string;
    includes_simulated?: boolean;
    warnings?: string[];
    name: string;
    version: string;
    trained_at: string;
    features: string[];
    classes: string[];
    calibrated: boolean;
    split?: string;
    train_sessions?: string[];
    test_sessions?: string[];
    metrics?: {
      accuracy: number;
      precision: number;
      recall: number;
      f1: number;
      average?: string;
      confusion_matrix: number[][];
      n_train?: number;
      n_test?: number;
    };
    feature_importance?: Record<string, number>;
  };
}
