"""Phase C: the validation split is small (218 photos), so one run can be lucky. Re-run the top settings from
Phase B with 3 more seeds each, and rank them by the average.

    python confirm_top.py --top 3   # -> runs/confirm.json
"""

import argparse
import json
import statistics

from common import RUNS, save_json
from finetune import train

SEEDS = (1, 2, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=3)
    a = ap.parse_args()
    search = json.loads((RUNS / "finetune_search.json").read_text())
    top = sorted(search, key=lambda r: (r["val_macro_f1"], r["val_acc"]), reverse=True)[: a.top]
    log = RUNS / "confirm.json"
    out = json.loads(log.read_text()) if log.exists() else []
    for r in top:
        runs = [{"seed": r["config"]["seed"], "val_acc": r["val_acc"], "val_macro_f1": r["val_macro_f1"]}]
        for s in SEEDS:
            name = f"{r['name']}_seed{s}"
            res = train({**r["config"], "seed": s}, name)
            runs.append({"seed": s, "val_acc": res["val"]["acc"], "val_macro_f1": res["val"]["macro_f1"]})
        f1s, accs = [x["val_macro_f1"] for x in runs], [x["val_acc"] for x in runs]
        out = [x for x in out if x["name"] != r["name"]] + [{
            "name": r["name"], "config": r["config"], "runs": runs,
            "mean_val_macro_f1": statistics.mean(f1s), "sd_val_macro_f1": statistics.stdev(f1s),
            "mean_val_acc": statistics.mean(accs), "sd_val_acc": statistics.stdev(accs),
        }]
        save_json(log, out)
    for x in sorted(out, key=lambda x: -x["mean_val_macro_f1"]):
        print(f"{x['name']}: macro-F1 {x['mean_val_macro_f1']:.3f} ± {x['sd_val_macro_f1']:.3f}, acc {x['mean_val_acc']:.3f} ± {x['sd_val_acc']:.3f}")


if __name__ == "__main__":
    main()
