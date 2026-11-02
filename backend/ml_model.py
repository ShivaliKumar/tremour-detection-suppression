"""
ML model integration.

The dashboard never fabricates ML results. Nothing is shown until both files exist:

    models/trained_model.pkl      a fitted scikit-learn-compatible estimator
    models/model_metadata.json    written by train_model.py (or by hand), e.g.
        {
          "name": "RandomForest tremor classifier",
          "version": "1.0",
          "trained_at": "2026-11-02T14:00:00",
          "features": ["emg_avg", "rms", "peak_frequency", "peak_power", "magnitude"],
          "classes": ["Normal", "Tremor", ...],
          "calibrated": false,            # confidence is shown only when true
          "split": "session-level hold-out",
          "metrics": {                    # computed on held-out data
            "accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0,
            "average": "macro",
            "confusion_matrix": [[...]],  # rows = actual, cols = predicted, order = classes
            "n_train": 0, "n_test": 0
          },
          "feature_importance": {"rms": 0.0, ...}   # optional
        }

Features are taken by name from the latest processed sample (see PROCESSED_COLUMNS).
"""

from __future__ import annotations

import json
import pickle
import threading
import time
from typing import Optional

from config import MODELS_DIR

MODEL_FILE = MODELS_DIR / "trained_model.pkl"
META_FILE = MODELS_DIR / "model_metadata.json"


class MLModel:
    def __init__(self):
        self._lock = threading.Lock()
        self.model = None
        self.meta: Optional[dict] = None
        self.error: Optional[str] = None
        self.loaded_at: Optional[float] = None
        self.last_prediction: Optional[dict] = None
        self.load()

    def load(self):
        with self._lock:
            self.model, self.meta, self.error, self.last_prediction = None, None, None, None
            if not MODEL_FILE.exists() or not META_FILE.exists():
                return
            try:
                self.meta = json.loads(META_FILE.read_text())
                try:
                    import joblib
                    self.model = joblib.load(MODEL_FILE)
                except ImportError:
                    with open(MODEL_FILE, "rb") as f:
                        self.model = pickle.load(f)
                if not self.meta.get("features"):
                    raise ValueError("model_metadata.json has no 'features' list")
                self.loaded_at = time.time()
            except Exception as e:
                self.model, self.error = None, f"Failed to load model: {e}"

    @property
    def available(self) -> bool:
        return self.model is not None

    def predict(self, row: dict) -> Optional[dict]:
        if self.model is None or row is None:
            return None
        with self._lock:
            feats = self.meta["features"]
            try:
                x = [[float(row[f]) for f in feats]]
                label = str(self.model.predict(x)[0])
                confidence = None
                if self.meta.get("calibrated") and hasattr(self.model, "predict_proba"):
                    confidence = float(max(self.model.predict_proba(x)[0]))
                self.last_prediction = {"label": label, "confidence": confidence, "timestamp": row["timestamp"]}
            except Exception as e:
                self.error = f"Prediction failed: {e}"
                self.last_prediction = None
            return self.last_prediction

    def status(self) -> dict:
        return {
            "available": self.available,
            "model_file": MODEL_FILE.name,
            "metadata_file": META_FILE.name,
            "error": self.error,
            "metadata": self.meta if self.available else None,
            "prediction": self.last_prediction,
        }
