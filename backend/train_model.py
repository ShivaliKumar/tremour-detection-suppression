"""
Train a tremor classifier from recorded sessions and write the files the ML
Analytics page reads:

    models/trained_model.pkl
    models/model_metadata.json

    pip install scikit-learn pandas joblib
    python train_model.py [--include-simulated]

Labels come from the manually assigned ground-truth `label` column, never from
the detector output. The split is by session (whole sessions are held out), so
highly correlated neighbouring samples never sit on both sides of the split.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import GroupShuffleSplit

from config import MODELS_DIR, PROCESSED_DIR, SESSIONS_FILE

FEATURES = ["emg_avg", "rms", "peak_frequency", "peak_power", "magnitude"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-simulated", action="store_true", help="also train on simulator sessions")
    ap.add_argument("--test-size", type=float, default=0.3)
    args = ap.parse_args()

    sessions = json.loads(SESSIONS_FILE.read_text())
    frames = []
    for s in sessions:
        if s.get("source") == "simulated" and not args.include_simulated:
            continue
        df = pd.read_csv(PROCESSED_DIR / s["file"])
        df["session_id"] = s["id"]
        frames.append(df)
    if not frames:
        raise SystemExit("No sessions to train on. Record labelled hardware sessions first.")

    data = pd.concat(frames, ignore_index=True)
    data = data[(data["data_valid"] == 1)].dropna(subset=FEATURES + ["label"])
    per_label = data.groupby("label")["session_id"].nunique()
    if (per_label < 2).any():
        print("WARNING: these labels have fewer than 2 sessions, so the held-out "
              f"metrics will be unreliable: {per_label[per_label < 2].to_dict()}")

    split = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=0)
    train_idx, test_idx = next(split.split(data, groups=data["session_id"]))
    train, test = data.iloc[train_idx], data.iloc[test_idx]

    model = RandomForestClassifier(n_estimators=200, max_depth=12, random_state=0, n_jobs=-1)
    model.fit(train[FEATURES].values, train["label"].values)
    pred = model.predict(test[FEATURES].values)

    classes = sorted(data["label"].unique().tolist())
    p, r, f1, _ = precision_recall_fscore_support(test["label"], pred, labels=classes, average="macro", zero_division=0)
    meta = {
        "name": "RandomForest tremor classifier",
        "version": datetime.now().strftime("%Y.%m.%d-%H%M"),
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "features": FEATURES,
        "classes": classes,
        "calibrated": False,
        "split": f"session-level hold-out ({args.test_size:.0%} of sessions)",
        "train_sessions": sorted(train["session_id"].unique().tolist()),
        "test_sessions": sorted(test["session_id"].unique().tolist()),
        "metrics": {
            "accuracy": float(accuracy_score(test["label"], pred)),
            "precision": float(p), "recall": float(r), "f1": float(f1), "average": "macro",
            "confusion_matrix": confusion_matrix(test["label"], pred, labels=classes).tolist(),
            "n_train": int(len(train)), "n_test": int(len(test)),
        },
        "feature_importance": dict(zip(FEATURES, np.round(model.feature_importances_, 4).tolist())),
    }
    joblib.dump(model, MODELS_DIR / "trained_model.pkl")
    (MODELS_DIR / "model_metadata.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta["metrics"], indent=2))
    print("Saved model to", MODELS_DIR)


if __name__ == "__main__":
    main()
