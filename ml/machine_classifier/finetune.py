"""Phase B: fine-tune a MobileNet end to end (two stages), for one set of hyperparameters.

Stage 1 trains only the new classifier head on the frozen backbone; stage 2 unfreezes the top part of the backbone
(or all of it) and trains on with a small, decaying learning rate. Batch-norm statistics stay frozen. The weights with
the best validation loss are kept. Scores are on the validation split unless --test is given.

    python finetune.py '{"backbone": "mobilenet_v3_large", "size": 224, ...}' [--name NAME] [--test]
"""

import argparse
import json
import time

import numpy as np
from tensorflow import keras

from common import RUNS, backbone, classes, dataset, head, macro_f1, save_json, seed_everything

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


def build(cfg, n):
    base = backbone(cfg["backbone"], cfg["size"])
    h = head(base.output_shape[-1], n, cfg["hidden"], cfg["dropout"], 0.0)
    model = keras.Model(base.input, h(base.output))
    inner = next(layer for layer in base.layers if isinstance(layer, keras.Model))  # the pretrained MobileNet
    return model, inner


def evaluate(model, split, size, n, root=None):
    kwargs = {"root": root} if root else {}
    ys, ps = [], []
    for x, y in dataset(split, size, 64, **kwargs):
        ps.append(model(x, training=False).numpy())
        ys.append(y.numpy())
    y, p = np.concatenate(ys), np.concatenate(ps)
    pred = p.argmax(1)
    return {"acc": float((pred == y).mean()), "macro_f1": macro_f1(y, pred, n), "n": int(len(y)), "y": y.tolist(), "pred": pred.tolist(),
            "confidence": p.max(1).round(4).tolist()}


def train(cfg: dict, name: str, test: bool = False) -> dict:
    cfg = {**DEFAULTS, **cfg}
    seed_everything(cfg["seed"])
    names = classes()
    n = len(names)
    out = RUNS / "finetune" / name
    model, base = build(cfg, n)
    loss = keras.losses.SparseCategoricalCrossentropy() if not cfg["label_smoothing"] else None
    if cfg["label_smoothing"]:
        def loss(y, p, ls=cfg["label_smoothing"]):
            return keras.losses.categorical_crossentropy(keras.ops.one_hot(keras.ops.cast(keras.ops.reshape(y, [-1]), "int32"), n), p, label_smoothing=ls)
    train_ds = dataset("train", cfg["size"], cfg["batch"], aug=cfg["aug"], shuffle=True)
    val_ds = dataset("val", cfg["size"], 64)
    t0 = time.time()
    history = {}

    # stage 1: the head only
    base.trainable = False
    model.compile(optimizer=keras.optimizers.AdamW(cfg["head_lr"], weight_decay=cfg["weight_decay"]), loss=loss, metrics=["accuracy"])
    h1 = model.fit(train_ds, validation_data=val_ds, epochs=cfg["head_epochs"], verbose=2)
    history["head"] = h1.history

    # stage 2: the top part of the backbone too (batch-norm layers stay frozen). With unfreeze 0 the head alone
    # trains on for the same number of epochs (at the head's learning rate), so every trial gets the same budget.
    if cfg["ft_epochs"] > 0:
        base.trainable = cfg["unfreeze"] > 0
        layers = base.layers
        first = int(len(layers) * (1 - cfg["unfreeze"]))
        for k, layer in enumerate(layers):
            layer.trainable = cfg["unfreeze"] > 0 and k >= first and not isinstance(layer, keras.layers.BatchNormalization)
        steps = cfg["ft_epochs"] * len(train_ds)
        lr = keras.optimizers.schedules.CosineDecay(cfg["ft_lr"] if cfg["unfreeze"] > 0 else cfg["head_lr"], steps, alpha=0.01)
        model.compile(optimizer=keras.optimizers.AdamW(lr, weight_decay=cfg["weight_decay"]), loss=loss, metrics=["accuracy"])
        stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=cfg["patience"], restore_best_weights=True)
        h2 = model.fit(train_ds, validation_data=val_ds, epochs=cfg["ft_epochs"], callbacks=[stop], verbose=2)
        history["finetune"] = h2.history

    result = {"name": name, "config": cfg, "minutes": round((time.time() - t0) / 60, 1),
              "trainable_params": int(sum(np.prod(w.shape) for w in model.trainable_weights)), "params": model.count_params(),
              "val": evaluate(model, "val", cfg["size"], n), "classes": names, "history": history}
    if test:
        result["test"] = evaluate(model, "test", cfg["size"], n)
    out.mkdir(parents=True, exist_ok=True)
    model.save(out / "model.keras")
    save_json(out / "result.json", result)
    print(f"{name}: val acc {result['val']['acc']:.3f}, macro-F1 {result['val']['macro_f1']:.3f} ({result['minutes']} min)", flush=True)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("config", nargs="?", default="{}")
    ap.add_argument("--name", default="manual")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    train(json.loads(a.config), a.name, a.test)
