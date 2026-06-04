import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(t: str) -> str:
    return t.upper().replace(".", "").replace("-", "").replace(" ", "")


cls = json.loads((ROOT / "data" / "finviz-classification.json").read_text(encoding="utf-8"))
classified = {}
dupes = []
for sector, inds in cls.items():
    for ind, tickers in inds.items():
        for t in tickers:
            n = norm(t)
            if n in classified:
                dupes.append((t, classified[n]))
            classified[n] = t

hm = json.loads((ROOT / "data" / "spx-heatmap.json").read_text(encoding="utf-8"))
universe = {norm(tile["symbol"]): tile["symbol"] for tile in hm["tiles"]}
names = {norm(tile["symbol"]): tile.get("name", "") for tile in hm["tiles"]}

cset, uset = set(classified), set(universe)
missing = sorted(uset - cset, key=lambda n: universe[n])
extra = sorted(classified[n] for n in cset - uset)

print(f"classified entries (unique): {len(cset)}")
print(f"S&P 500 universe (heatmap tiles): {len(uset)}")
print(f"duplicates in classification: {len(dupes)} {dupes if dupes else ''}")
print(f"\nMISSING — in index, not yet placed ({len(missing)}):")
for n in missing:
    print(f"  {universe[n]:8s} {names[n]}")
print(f"\nEXTRA — placed but not in our index ({len(extra)}):")
print(", ".join(extra) if extra else "  (none)")
