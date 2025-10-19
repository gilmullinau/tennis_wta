import pandas as pd
import numpy as np
import re
from pathlib import Path
import kagglehub
from collections import defaultdict

# === 1. Load dataset ===
DATA_DIR = Path(kagglehub.dataset_download("dissfya/wta-tennis-2007-2023-daily-update"))
candidates = list(DATA_DIR.rglob("*.csv"))
preferred = [p for p in candidates if re.search(r"^wta.*\.csv$", p.name, re.I)] or candidates
matches_path = max(preferred, key=lambda p: p.stat().st_size)

df = pd.read_csv(matches_path, low_memory=False)
print(f"Loaded: {matches_path.name}, shape: {df.shape}")

# === 2. Type conversion ===
df["Date"] = pd.to_datetime(df["Date"], errors="coerce")


for c in ["Best of", "Rank_1", "Rank_2", "Pts_1", "Pts_2", "Odd_1", "Odd_2"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

# === 3. Remove rows with invalid data ===
df = df[df["Date"].notna()].copy()
df = df[~((df["Pts_1"] < 0) | (df["Pts_2"] < 0))]
df = df[df["Winner"].isin(df[["Player_1", "Player_2"]].values.flatten())]

# === 4. Initial target variable ===
df["y"] = (df["Winner"].astype(str).str.strip() == df["Player_1"].astype(str).str.strip()).astype("int8")

# === 5. Remove duplicates / mirrors ===
df = df.drop_duplicates(subset=["Date", "Tournament", "Round", "Player_1", "Player_2"], keep="first")

# === 6. Normalize orientation (Player_1 = favorite) ===
mask = (
    (df["Rank_1"] > df["Rank_2"]) |
    ((df["Rank_1"].isna()) & (df["Rank_2"].notna())) |
    ((df["Rank_1"] == df["Rank_2"]) & (df["Odd_1"] > df["Odd_2"]))
)
cols_to_swap = ["Player_1","Player_2","Rank_1","Rank_2","Pts_1","Pts_2","Odd_1","Odd_2"]
df.loc[mask, cols_to_swap] = df.loc[mask, cols_to_swap].apply(np.flip, axis=1)

# переопределяем целевую переменную после swap
df["y"] = (df["Winner"].astype(str) == df["Player_1"].astype(str)).astype("int8")

# === 7. Temporal features ===
df["year"] = df["Date"].dt.year.astype("Int16")

# === 8. Feature engineering ===
df["rank_diff"] = df["Rank_2"] - df["Rank_1"]   # >0 → фаворит сильнее
df["pts_diff"]  = df["Pts_1"]  - df["Pts_2"]   # >0 → фаворит имеет больше очков
df["odd_diff"]  = df["Odd_2"]  - df["Odd_1"]   # >0 → букмекеры дают меньший коэффициент фавориту

# === 9. H2H advantage ===
print("Computing head-to-head (H2H) stats...")
df = df.sort_values("Date")

h2h_wins = defaultdict(lambda: [0, 0])  # (player1, player2): [wins_p1, wins_p2]
h2h_adv = []

for _, row in df.iterrows():
    p1, p2 = row["Player_1"], row["Player_2"]
    key = tuple(sorted([p1, p2]))
    wins_p1, wins_p2 = h2h_wins[key]

    # Before current match
    if p1 == key[0]:
        adv = wins_p1 - wins_p2
    else:
        adv = wins_p2 - wins_p1
    h2h_adv.append(adv)

    # After current match: update winner
    if row["y"] == 1:
        if p1 == key[0]:
            h2h_wins[key][0] += 1
        else:
            h2h_wins[key][1] += 1
    else:
        if p1 == key[0]:
            h2h_wins[key][1] += 1
        else:
            h2h_wins[key][0] += 1

df["h2h_advantage"] = h2h_adv

# === 10. Last winner ===
print("Computing last head-to-head winner...")
last_winner_map = {}
last_winner = []

for _, row in df.iterrows():
    p1, p2 = row["Player_1"], row["Player_2"]
    key = tuple(sorted([p1, p2]))
    last_win = last_winner_map.get(key, np.nan)

    if last_win == p1:
        last_winner.append(1)
    elif last_win == p2:
        last_winner.append(0)
    else:
        last_winner.append(np.nan)

    # Update last winner after this match
    last_winner_map[key] = row["Winner"]

df["last_winner"] = last_winner

# === 11. Surface winrate advantage ===
print("Computing surface winrate advantage...")
surface_wins = defaultdict(lambda: [0, 0])  # (player, surface): [wins, total]
surface_adv = []

for _, row in df.iterrows():
    p1, p2, surf = row["Player_1"], row["Player_2"], row["Surface"]

    w1, t1 = surface_wins[(p1, surf)]
    w2, t2 = surface_wins[(p2, surf)]

    winrate1 = w1 / t1 if t1 > 0 else np.nan
    winrate2 = w2 / t2 if t2 > 0 else np.nan

    surface_adv.append(winrate1 - winrate2 if not np.isnan(winrate1 - winrate2) else 0)

    # Update records
    surface_wins[(p1, surf)][1] += 1
    surface_wins[(p2, surf)][1] += 1
    if row["y"] == 1:
        surface_wins[(p1, surf)][0] += 1
    else:
        surface_wins[(p2, surf)][0] += 1

df["surface_winrate_adv"] = surface_adv

# === 12. Sanity checks ===
print("Player_1 stronger (Rank_1 <= Rank_2):", (df["Rank_1"] <= df["Rank_2"]).mean())
print("Win rate (favorites):", df["y"].mean().round(3))
print("Final shape:", df.shape)

# === 13. Save cleaned data ===
cols = [
    "Tournament","Date","Court","Surface","Round","Best of",
    "Player_1","Player_2","Winner","Rank_1","Rank_2","Pts_1","Pts_2",
    "Odd_1","Odd_2","Score","y","year",
    "rank_diff","pts_diff","odd_diff","h2h_advantage","last_winner","surface_winrate_adv"
]
df = df[[c for c in cols if c in df.columns]]

df.to_csv("wta_data.csv", index=False)
