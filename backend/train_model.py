"""
Train a tremor classifier from recorded sessions and write the files the ML
Analytics page reads:

    models/trained_model.pkl
    models/model_metadata.json

Run from the dashboard (ML Analytics -> Train a baseline model) or from a shell:

    pip install scikit-learn pandas joblib
    python train_model.py [--algorithm random_forest] [--include-simulated]

Labels come from the manually assigned ground-truth `label` column, never from
the detector output. The split is by session (whole sessions are held out), so
highly correlated neighbouring samples never sit on both sides of the split.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime

from config import MODELS_DIR, PROCESSED_DIR, SESSIONS_FILE

FEATURES = ["emg_avg", "rms", "peak_frequency", "peak_power", "magnitude"]

ALGORITHMS = {
    "random_forest": "Random forest",
    "decision_tree": "Decision tree",
    "logistic_regression": "Logistic regression",
    "knn": "k-nearest neighbours",
}


class TrainingError(Exception):
    """User-fixable problem (not enough data, missing dependency, ...)."""


def sklearn_available() -> bool:
    try:
        import joblib, pandas, sklearn  # noqa: F401, E401
        return True
    except ImportError:
        return False


def _make_estimator(algorithm: str):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.tree import DecisionTreeClassifier

    if algorithm == "random_forest":
        return RandomForestClassifier(n_estimators=200, max_depth=12, random_state=0, n_jobs=-1)
    if algorithm == "decision_tree":
        return DecisionTreeClassifier(max_depth=8, random_state=0)
    if algorithm == "logistic_regression":
        return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    if algorithm == "knn":
        return make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=15))
    raise TrainingError(f"Unknown algorithm '{algorithm}'")


def _importance(model, test_x, test_y):
    """Native importances for tree models, permutation importance for the rest."""
    import numpy as np

    if hasattr(model, "feature_importances_"):
        return dict(zip(FEATURES, np.round(model.feature_importances_, 4).tolist()))
    from sklearn.inspection import permutation_importance

    r = permutation_importance(model, test_x, test_y, n_repeats=5, random_state=0)
    vals = np.clip(r.importances_mean, 0, None)
    total = vals.sum() or 1.0
    return dict(zip(FEATURES, np.round(vals / total, 4).tolist()))


def train(algorithm: str = "random_forest", include_simulated: bool = False, test_size: float = 0.3) -> dict:
    """Train, evaluate on held-out sessions, write the model files. Returns the metadata."""
    if not sklearn_available():
        raise TrainingError("scikit-learn is not installed. Run: pip install scikit-learn pandas joblib")

    import joblib
    import pandas as pd
    from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
    from sklearn.model_selection import GroupShuffleSplit

    sessions = json.loads(SESSIONS_FILE.read_text()) if SESSIONS_FILE.exists() else []
    frames = []
    for s in sessions:
        if s.get("source") == "simulated" and not include_simulated:
            continue
        path = PROCESSED_DIR / s["file"]
        if not path.exists():
            continue
        df = pd.read_csv(path)
        df["session_id"] = s["id"]
        frames.append(df)
    if not frames:
        raise TrainingError(
            "No sessions to train on. Record labelled hardware sessions first"
            + ("." if include_simulated else " (or tick 'Include simulated sessions' for a demo)."))

    data = pd.concat(frames, ignore_index=True)
    data = data[(data["data_valid"] == 1)].dropna(subset=FEATURES + ["label"])
    data = data[data["label"].astype(str).str.len() > 0]
    classes = sorted(data["label"].unique().tolist())
    if len(classes) < 2:
        raise TrainingError(f"Need at least 2 labels to train a classifier; found {classes or 'none'}.")
    n_sessions = data["session_id"].nunique()
    if n_sessions < 3:
        raise TrainingError(f"Need at least 3 sessions so some can be held out for testing; found {n_sessions}.")

    per_label = data.groupby("label")["session_id"].nunique()
    warnings = []
    if (per_label < 2).any():
        warnings.append("Labels with fewer than 2 sessions make held-out metrics unreliable: "
                        + ", ".join(per_label[per_label < 2].index))

    split = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=0)
    train_idx, test_idx = next(split.split(data, groups=data["session_id"]))
    tr, te = data.iloc[train_idx], data.iloc[test_idx]
    if tr["label"].nunique() < 2:
        raise TrainingError("The random session hold-out left only one label in the training set. Record more sessions per label.")

    model = _make_estimator(algorithm)
    model.fit(tr[FEATURES].values, tr["label"].values)
    pred = model.predict(te[FEATURES].values)

    p, r, f1, _ = precision_recall_fscore_support(te["label"], pred, labels=classes, average="macro", zero_division=0)
    meta = {
        "name": f"{ALGORITHMS[algorithm]} tremor classifier",
        "algorithm": algorithm,
        "version": datetime.now().strftime("%Y.%m.%d-%H%M"),
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "features": FEATURES,
        "classes": classes,
        "calibrated": False,
        "includes_simulated": include_simulated,
        "split": f"session-level hold-out ({test_size:.0%} of sessions)",
        "train_sessions": sorted(tr["session_id"].unique().tolist()),
        "test_sessions": sorted(te["session_id"].unique().tolist()),
        "warnings": warnings,
        "metrics": {
            "accuracy": float(accuracy_score(te["label"], pred)),
            "precision": float(p), "recall": float(r), "f1": float(f1), "average": "macro",
            "confusion_matrix": confusion_matrix(te["label"], pred, labels=classes).tolist(),
            "n_train": int(len(tr)), "n_test": int(len(te)),
        },
        "feature_importance": _importance(model, te[FEATURES].values, te["label"].values),
    }
    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(model, MODELS_DIR / "trained_model.pkl")
    (MODELS_DIR / "model_metadata.json").write_text(json.dumps(meta, indent=2))
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--algorithm", choices=list(ALGORITHMS), default="random_forest")
    ap.add_argument("--include-simulated", action="store_true", help="also train on simulator sessions")
    ap.add_argument("--test-size", type=float, default=0.3)
    args = ap.parse_args()
    try:
        meta = train(args.algorithm, args.include_simulated, args.test_size)
    except TrainingError as e:
        raise SystemExit(str(e))
    for w in meta["warnings"]:
        print("WARNING:", w)
    print(json.dumps(meta["metrics"], indent=2))
    print("Saved model to", MODELS_DIR)


if __name__ == "__main__":
    main()
