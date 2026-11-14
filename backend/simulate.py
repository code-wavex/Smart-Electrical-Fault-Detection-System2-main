import numpy as np
import pandas as pd

def generate_sample(label: str, rng: np.random.Generator) -> list[float]:
    # Simulate time-of-day grid load factor (peak evening sag vs off-peak)
    is_peak_hour = rng.random() < 0.45

    if label == "normal":
        v = rng.uniform(208, 226) if is_peak_hour else rng.uniform(222, 242)
        i = rng.uniform(2.0, 18.5)
        leak = rng.uniform(0.2, 11.0)
        pf = rng.uniform(0.78, 0.98)

    elif label == "overload":
        # High sustained current with mild voltage sag; overlaps upper normal range
        v = rng.uniform(192, 224)
        i = rng.uniform(16.5, 42.0)
        leak = rng.uniform(0.5, 13.0)
        pf = rng.uniform(0.62, 0.89)

    elif label == "earth_fault":
        # Elevated earth-leakage current (> 30mA RCD trip zone, with borderline overlap)
        v = rng.uniform(200, 238)
        i = rng.uniform(3.0, 26.0)
        leak = rng.uniform(24.0, 165.0)
        pf = rng.uniform(0.55, 0.92)

    elif label == "short_circuit":
        # Severe voltage collapse and massive fault current surge
        v = rng.uniform(45, 145)
        i = rng.uniform(55.0, 180.0)
        leak = rng.uniform(2.0, 35.0)
        pf = rng.uniform(0.15, 0.52)

    else:  # open_circuit
        # Line break: near-zero current, floating/unloaded voltage
        v = rng.uniform(220, 250)
        i = rng.uniform(0.0, 1.6)
        leak = rng.uniform(0.0, 2.5)
        pf = rng.uniform(0.0, 0.45)

    # Add realistic sensor measurement noise (ZMPT101B / ACS712 tolerances)
    v += rng.normal(0, 2.8)
    i = max(0.0, i * (1 + rng.normal(0, 0.045)))
    leak = max(0.0, leak + rng.normal(0, 1.4))
    pf = float(np.clip(pf + rng.normal(0, 0.025), 0.0, 1.0))

    return [round(float(v), 2), round(float(i), 2), round(float(leak), 2), round(pf, 3)]


def build_dataset(samples_per_class: int = 1500, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    classes = ["normal", "overload", "earth_fault", "short_circuit", "open_circuit"]
    rows = []

    for label in classes:
        for _ in range(samples_per_class):
            v, i, leak, pf = generate_sample(label, rng)
            rows.append({
                "voltage": v,
                "current": i,
                "leakage_ma": leak,
                "power_factor": pf,
                "label": label
            })

    df = pd.DataFrame(rows).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return df


if __name__ == "__main__":
    df = build_dataset(1500)
    df.to_csv("fault_data.csv", index=False)
    print(f"Generated {len(df)} balanced readings across 5 classes.")