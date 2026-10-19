"""Phase B: fine-tune a MobileNet end to end (two stages), for one set of hyperparameters.

Stage 1 trains only the new classifier head on the frozen backbone; stage 2 unfreezes the top part of the backbone
(or all of it) and trains on with a small, decaying learning rate. Batch-norm statistics stay frozen. The weights with
the best validation loss are kept. Scores are on the validation split unless --test is given.

    python finetune.py '{"backbone": "mobilenet_v3_large", "size": 224, ...}' [--name NAME] [--test]
    python finetune.py '{...}' --init runs/<dataset>/finetune/<name>/model.pt   # start from a trained model
"""

import argparse
import copy
import json
import math
import time

import numpy as np
import torch
from torch import nn

from common import DEVICE, RUNS, Net, augment_batch, classes, loader, macro_f1, save_json, seed_everything

DEFAULTS = {
    "backbone": "mobilenet_v3_large",
    "size": 224,
    "aug": "medium",          # light / medium / strong (see common.AUG)
    "hidden": 0,              # 0: a single softmax layer on the pooled features
    "dropout": 0.2,
    "label_smoothing": 0.1,
    "weight_decay": 1e-4,
    "batch": 32,
    "head_epochs": 5,
    "head_lr": 1e-3,
    "unfreeze": 0.3,          # share of the backbone's layers (from the top) trained in stage 2; 0 = none, 1 = all
    "ft_epochs": 15,
    "ft_lr": 3e-4,
    "patience": 4,
    "seed": 42,
}


@torch.no_grad()
def predict(model, dl):
    model.eval()
    ys, ps = [], []
    for x, y in dl:
        ps.append(torch.softmax(model(x.to(DEVICE, non_blocking=True).float()), -1).cpu())
        ys.append(y)
    return torch.cat(ys).numpy(), torch.cat(ps).numpy()


def evaluate(model, dl, n):
    y, p = predict(model, dl)
    pred = p.argmax(1)
    return {"acc": float((pred == y).mean()), "macro_f1": macro_f1(y, pred, n), "n": int(len(y)), "y": y.tolist(), "pred": pred.tolist(),
            "confidence": p.max(1).round(4).tolist()}


def run_epochs(model, train_dl, val_dl, cfg, params, lr_at, epochs, loss_fn, stop=None):
    """Train for `epochs`; lr_at(step) gives the learning rate. With stop (patience), keep the best val-loss weights."""
    opt = torch.optim.AdamW(params, lr=lr_at(0), weight_decay=cfg["weight_decay"])
    history = {"loss": [], "accuracy": [], "val_loss": [], "val_accuracy": []}
    best, best_state, waited, step = math.inf, None, 0, 0
    for epoch in range(epochs):
        model.train()
        t, total, correct, count = time.time(), 0.0, 0, 0
        for x, y in train_dl:
            for g in opt.param_groups:
                g["lr"] = lr_at(step)
            x, y = augment_batch(x.to(DEVICE, non_blocking=True), cfg["aug"]), y.to(DEVICE, non_blocking=True)
            out = model(x)
            loss = loss_fn(out, y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            step += 1
            total += loss.item() * len(y)
            correct += (out.argmax(1) == y).sum().item()
            count += len(y)
        yv, pv = predict(model, val_dl)
        val_loss = float(loss_fn(torch.log(torch.from_numpy(pv).clamp_min(1e-12)), torch.from_numpy(yv)))
        for k, v in zip(history, (total / count, correct / count, val_loss, float((pv.argmax(1) == yv).mean()))):
            history[k].append(v)
        print(f"  epoch {epoch + 1}/{epochs} - {time.time() - t:.0f}s - loss {history['loss'][-1]:.4f} acc {history['accuracy'][-1]:.4f}"
              f" - val_loss {val_loss:.4f} val_acc {history['val_accuracy'][-1]:.4f}", flush=True)
        if stop:
            if val_loss < best:
                best, best_state, waited = val_loss, copy.deepcopy(model.state_dict()), 0
            else:
                waited += 1
                if waited >= stop:
                    break
    if best_state is not None:
        model.load_state_dict(best_state)
    return history


def train(cfg: dict, name: str, test: bool = False, init: str | None = None) -> dict:
    cfg = {**DEFAULTS, **cfg}
    seed_everything(cfg["seed"])
    names = classes()
    n = len(names)
    out = RUNS / "finetune" / name
    model = Net(cfg["backbone"], n, cfg["hidden"], cfg["dropout"]).to(DEVICE).to(memory_format=torch.channels_last)
    if init:
        start = torch.load(init, map_location=DEVICE)
        if start["classes"] != names:
            raise SystemExit(f"{init} was trained on other classes: {start['classes']}")
        model.load_state_dict(start["state_dict"])
    loss_fn = nn.CrossEntropyLoss(label_smoothing=cfg["label_smoothing"])
    train_dl = loader("train", cfg["size"], cfg["batch"], aug=cfg["aug"], shuffle=True, seed=cfg["seed"])
    val_dl = loader("val", cfg["size"], 64)
    t0 = time.time()
    history = {}

    # stage 1: the head only
    model.set_trainable(0)
    params = [p for p in model.parameters() if p.requires_grad]
    history["head"] = run_epochs(model, train_dl, val_dl, cfg, params, lambda s: cfg["head_lr"], cfg["head_epochs"], loss_fn)

    # stage 2: the top part of the backbone too (batch-norm layers stay frozen). With unfreeze 0 the head alone
    # trains on for the same number of epochs (at the head's learning rate), so every trial gets the same budget.
    if cfg["ft_epochs"] > 0:
        model.set_trainable(cfg["unfreeze"])
        params = [p for p in model.parameters() if p.requires_grad]
        lr0 = cfg["ft_lr"] if cfg["unfreeze"] > 0 else cfg["head_lr"]
        steps = cfg["ft_epochs"] * len(train_dl)

        def cosine(s, alpha=0.01):
            return lr0 * ((1 - alpha) * 0.5 * (1 + math.cos(math.pi * min(s, steps) / steps)) + alpha)

        history["finetune"] = run_epochs(model, train_dl, val_dl, cfg, params, cosine, cfg["ft_epochs"], loss_fn, stop=cfg["patience"])

    result = {"name": name, "config": cfg, "minutes": round((time.time() - t0) / 60, 1),
              "trainable_params": int(sum(p.numel() for p in model.parameters() if p.requires_grad)),
              "params": int(sum(p.numel() for p in model.parameters())),
              "val": evaluate(model, val_dl, n), "classes": names, "history": history, "init": init}
    if test:
        result["test"] = evaluate(model, loader("test", cfg["size"], 64), n)
    out.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "config": cfg, "classes": names}, out / "model.pt")
    save_json(out / "result.json", result)
    print(f"{name}: val acc {result['val']['acc']:.3f}, macro-F1 {result['val']['macro_f1']:.3f} ({result['minutes']} min)", flush=True)
    return result


def load(path, device=DEVICE) -> tuple[Net, dict, list[str]]:
    ck = torch.load(path, map_location=device)
    cfg = ck["config"]
    model = Net(cfg["backbone"], len(ck["classes"]), cfg["hidden"], cfg["dropout"], pretrained=False)
    model.load_state_dict(ck["state_dict"])
    return model.to(device).eval(), cfg, ck["classes"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("config", nargs="?", default="{}")
    ap.add_argument("--name", default="manual")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--init", help="a model.pt to start from (same classes), e.g. to train on with your own photos")
    a = ap.parse_args()
    train(json.loads(a.config), a.name, a.test, a.init)
