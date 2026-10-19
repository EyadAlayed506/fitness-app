"""Phase A: which MobileNet, at which input size, and which classifier head? The backbone stays frozen.

Each backbone turns the photos into feature vectors once (training photos: the original plus 4 augmented
versions), then many small heads are trained on those vectors. Scores are on the validation split.

    python search_frozen.py   # -> runs/frozen_search.json
"""

import itertools
import time

import numpy as np
from tensorflow import keras

from common import BACKBONES, RUNS, backbone, classes, dataset, head, macro_f1, save_json, seed_everything

SIZES = (160, 224)
VIEWS = 4  # augmented versions of each training photo (plus the original)
GRID = {
    "hidden": (0, 256),
    "dropout": (0.2, 0.5),
    "lr": (1e-3, 3e-3),
    "label_smoothing": (0.0, 0.1),
}


def features(model, ds):
    xs, ys = [], []
    for x, y in ds:
        xs.append(model(x, training=False).numpy())
        ys.append(y.numpy())
    return np.concatenate(xs), np.concatenate(ys)


def main():
    seed_everything(42)
    n = len(classes())
    results = []
    for name, size in itertools.product(BACKBONES, SIZES):
        model = backbone(name, size)
        t0 = time.time()
        xa, ya = features(model, dataset("train", size, 64, aug="medium", repeat_views=VIEWS))
        xc, yc = features(model, dataset("train", size, 64))
        xv, yv = features(model, dataset("val", size, 64))
        seconds = time.time() - t0
        n_images = len(xa) + len(xc) + len(xv)
        x_train, y_train = np.concatenate([xa, xc]), np.concatenate([ya, yc])
        print(f"{name}@{size}: {x_train.shape[1]} features, {1000 * seconds / n_images:.1f} ms/photo to extract", flush=True)
        for hidden, dropout, lr, ls in itertools.product(*GRID.values()):
            seed_everything(42)
            h = head(x_train.shape[1], n, hidden, dropout, 1e-4)
            h.compile(optimizer=keras.optimizers.Adam(lr), loss=keras.losses.CategoricalCrossentropy(label_smoothing=ls), metrics=["accuracy"])
            stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True)
            h.fit(x_train, keras.utils.to_categorical(y_train, n), validation_data=(xv, keras.utils.to_categorical(yv, n)),
                  epochs=150, batch_size=64, callbacks=[stop], verbose=0)
            pred = h.predict(xv, verbose=0).argmax(1)
            r = {"backbone": name, "size": size, "hidden": hidden, "dropout": dropout, "lr": lr, "label_smoothing": ls,
                 "val_acc": float((pred == yv).mean()), "val_macro_f1": macro_f1(yv, pred, n), "epochs": stop.stopped_epoch or 150,
                 "params_backbone": model.count_params(), "extract_ms_per_photo": 1000 * seconds / n_images}
            results.append(r)
        best = max((r for r in results if r["backbone"] == name and r["size"] == size), key=lambda r: (r["val_macro_f1"], r["val_acc"]))
        print(f"   best head: {best['val_acc']:.3f} acc, {best['val_macro_f1']:.3f} macro-F1 "
              f"(hidden {best['hidden']}, dropout {best['dropout']}, lr {best['lr']}, ls {best['label_smoothing']})", flush=True)
        save_json(RUNS / "frozen_search.json", results)


if __name__ == "__main__":
    main()
