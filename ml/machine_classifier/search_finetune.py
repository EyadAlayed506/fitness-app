"""Phase B: random search over the fine-tuning hyperparameters, for the backbone(s) Phase A picked.

Each trial is a full fine-tuning run (finetune.py) scored on the validation split. Results are appended to
runs/finetune_search.json, so the search can be stopped and resumed.

    python search_finetune.py --backbone mobilenet_v3_large --size 224 --trials 8
"""

import argparse
import json
import random

from common import RUNS, save_json
from finetune import train

SPACE = {
    "aug": ["light", "medium", "strong"],
    "unfreeze": [0.0, 0.3, 0.6, 1.0],
    "ft_lr": [1e-4, 3e-4, 1e-3],
    "label_smoothing": [0.0, 0.1],
    "dropout": [0.2, 0.4],
    "hidden": [0, 256],
    "weight_decay": [1e-5, 1e-4],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", required=True)
    ap.add_argument("--size", type=int, required=True)
    ap.add_argument("--trials", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--first", default="{}", help="a config to try first (e.g. Phase A's best head)")
    ap.add_argument("--grid", default="", help='instead of random trials: every combination of these values on top of --first, e.g. {"unfreeze": [0.3, 1.0]}')
    a = ap.parse_args()
    log = RUNS / "finetune_search.json"
    done = json.loads(log.read_text()) if log.exists() else []
    rng = random.Random(a.seed)
    if a.grid:
        import itertools

        grid = json.loads(a.grid)
        trials = [{**json.loads(a.first), **dict(zip(grid, combo))} for combo in itertools.product(*grid.values())]
        prefix = "g"
    else:
        trials = [json.loads(a.first)] + [{k: rng.choice(v) for k, v in SPACE.items()} for _ in range(a.trials - 1)]
        prefix = "t"
    for k, t in enumerate(trials):
        cfg = {"backbone": a.backbone, "size": a.size, **t}
        name = f"{a.backbone}_{a.size}_{prefix}{k}"
        if any(r["name"] == name for r in done):
            continue
        r = train(cfg, name)
        done.append({"name": name, "config": r["config"], "val_acc": r["val"]["acc"], "val_macro_f1": r["val"]["macro_f1"],
                     "minutes": r["minutes"], "trainable_params": r["trainable_params"]})
        save_json(log, done)
    best = max(done, key=lambda r: (r["val_macro_f1"], r["val_acc"]))
    print("best:", json.dumps(best, indent=1))


if __name__ == "__main__":
    main()
