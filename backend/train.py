import json
import joblib
import pandas as pd
import tensorflow as tf
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, f1_score, accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from simulate import build_dataset

def train_and_evaluate():
    df = build_dataset(samples_per_class=1500, seed=42)
    df.to_csv("fault_data.csv", index=False)

    X = df[["voltage", "current", "leakage_ma", "power_factor"]].values
    le = LabelEncoder()
    y = le.fit_transform(df["label"].values)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )

    # 1. Baseline: Random Forest
    rf = RandomForestClassifier(n_estimators=200, random_state=42)
    rf.fit(X_train, y_train)
    rf_preds = rf.predict(X_test)
    rf_f1 = float(f1_score(y_test, rf_preds, average="macro"))
    rf_acc = float(accuracy_score(y_test, rf_preds))

    # 2. Challenger: Compact Neural Network
    scaler = StandardScaler().fit(X_train)
    X_train_sc = scaler.transform(X_train)
    X_test_sc = scaler.transform(X_test)

    tf.random.set_seed(42)
    nn = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(4,)),
        tf.keras.layers.Dense(16, activation="relu"),
        tf.keras.layers.Dense(8, activation="relu"),
        tf.keras.layers.Dense(len(le.classes_), activation="softmax")
    ])
    nn.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    nn.fit(X_train_sc, y_train, epochs=35, batch_size=32, verbose=0)

    nn_preds = nn.predict(X_test_sc, verbose=0).argmax(axis=1)
    nn_f1 = float(f1_score(y_test, nn_preds, average="macro"))
    nn_acc = float(accuracy_score(y_test, nn_preds))

    winner = "nn" if nn_f1 > rf_f1 else "rf"

    print(f"Random Forest -> Accuracy: {rf_acc:.4f} | Macro F1: {rf_f1:.4f}")
    print(f"Neural Net    -> Accuracy: {nn_acc:.4f} | Macro F1: {nn_f1:.4f}")
    print(f"Selected Winner: {winner.upper()}")
    print("\nClassification Report (Winner):")
    win_preds = nn_preds if winner == "nn" else rf_preds
    print(classification_report(y_test, win_preds, target_names=le.classes_))

    # Export artifacts
    joblib.dump(rf, "model_rf.joblib")
    nn.save("model_nn.keras")
    joblib.dump(scaler, "scaler.joblib")
    joblib.dump(le, "labels.joblib")
    joblib.dump(winner, "winner.joblib")

    with open("metrics.json", "w") as f:
        json.dump({
            "winner": winner,
            "rf_macro_f1": round(rf_f1, 4),
            "rf_accuracy": round(rf_acc, 4),
            "nn_macro_f1": round(nn_f1, 4),
            "nn_accuracy": round(nn_acc, 4),
            "classes": list(le.classes_),
            "test_samples": len(y_test)
        }, f, indent=2)

if __name__ == "__main__":
    train_and_evaluate()