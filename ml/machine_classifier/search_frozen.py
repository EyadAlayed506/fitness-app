"""Phase A: which MobileNet, at which input size, and which classifier head? The backbone stays frozen.

Each backbone turns the photos into feature vectors once (training photos: the original plus 4 augmented
versions), then many small heads are trained on those vectors. Scores are on the validation split.

    python search_frozen.py   # -> runs/<dataset>/frozen_search.json
"""

import itertools
import math
import time

import numpy as np
import torch
import torch.nn.functional as F

from common import BACKBONES, DEVICE, RUNS, Head, Net, augment_batch, classes, loader, macro_f1, save_json, seed_everything

SIZES = (160, 224)
VIEWS = 4  # augmented versions of each training photo (plus the original)
GRID = {
    "hidden": (0, 256),
    "dropout": (0.2, 0.5),
    "lr": (1e-3, 3e-3),
    "label_smoothing": (0.0, 0.1),
}


@torch.no_grad()
def features(model, dl, aug=None, views=1):
    xs, ys = [], []
    for _ in range(views):
        for x, y in dl:
            x = x.to(DEVICE)
            x = augment_batch(x, aug) if aug else x.float()
            xs.append(model.embed(x).cpu())
            ys.append(y)
    return torch.cat(xs), torch.cat(ys)


def fit_head(x, y, xv, yv, n, hidden, dropout, lr, ls, l2=1e-4, batch=64, epochs=150, patience=8):
    """Adam on the features, early stopping on val loss (best weights kept)."""
    h = Head(x.shape[1], n, hidden, dropout).to(DEVICE)
    opt = torch.optim.Adam(h.parameters(), lr=lr)
    x, y, xv, yv = x.to(DEVICE), y.to(DEVICE), xv.to(DEVICE), yv.to(DEVICE)
    best, best_state, waited, epoch = math.inf, None, 0, 0
    for epoch in range(epochs):
        h.train()
        for idx in torch.randperm(len(x), device=DEVICE).split(batch):
            loss = F.cross_entropy(h(x[idx]), y[idx], label_smoothing=ls)
            loss = loss + l2 * sum((w ** 2).sum() for name, w in h.named_parameters() if name.endswith("weight"))
            opt.zero_grad()
            loss.backward()
            opt.step()
        h.eval()
        with torch.no_grad():
            val_loss = F.cross_entropy(h(xv), yv, label_smoothing=ls).item()
        if val_loss < best:
            best, best_state, waited = val_loss, {k: v.clone() for k, v in h.state_dict().items()}, 0
        else:
            waited += 1
            if waited >= patience:
                break
    h.load_state_dict(best_state)
    with torch.no_grad():
        return h(xv).argmax(1).cpu().numpy(), epoch + 1


def main():
    seed_everything(42)
    n = len(classes())
    results = []
    for name, size in itertools.product(BACKBONES, SIZES):
        model = Net(name, n).to(DEVICE).eval()
        t0 = time.time()
        xa, ya = features(model, loader("train", size, 64, aug="medium", shuffle=True), aug="medium", views=VIEWS)
        xc, yc = features(model, loader("train", size, 64))
        xv, yv = features(model, loader("val", size, 64))
        seconds = time.time() - t0
        n_images = len(xa) + len(xc) + len(xv)
        x_train, y_train = torch.cat([xa, xc]), torch.cat([ya, yc])
        print(f"{name}@{size}: {x_train.shape[1]} features, {1000 * seconds / n_images:.1f} ms/photo to extract", flush=True)
        for hidden, dropout, lr, ls in itertools.product(*GRID.values()):
            seed_everything(42)
            pred, epochs = fit_head(x_train, y_train, xv, yv, n, hidden, dropout, lr, ls)
            yvn = yv.numpy()
            results.append({"backbone": name, "size": size, "hidden": hidden, "dropout": dropout, "lr": lr, "label_smoothing": ls,
                            "val_acc": float((pred == yvn).mean()), "val_macro_f1": macro_f1(yvn, pred, n), "epochs": epochs,
                            "params_backbone": int(sum(p.numel() for p in model.features.parameters())),
                            "extract_ms_per_photo": 1000 * seconds / n_images})
        best = max((r for r in results if r["backbone"] == name and r["size"] == size), key=lambda r: (r["val_macro_f1"], r["val_acc"]))
        print(f"   best head: {best['val_acc']:.3f} acc, {best['val_macro_f1']:.3f} macro-F1 "
              f"(hidden {best['hidden']}, dropout {best['dropout']}, lr {best['lr']}, ls {best['label_smoothing']})", flush=True)
        save_json(RUNS / "frozen_search.json", results)


if __name__ == "__main__":
    main()
