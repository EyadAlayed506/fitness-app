"""Build the gym-machine image dataset: download, check, remove duplicates, split, resize.

Source: Gym-Equipment-Classifier (github.com/siddharthkhincha/Gym-Equipment-Classifier, MIT licence), 6 classes of
web-scraped photos. Its own train/test split has copies of the same photo on both sides, so the images are pooled,
exact and near-duplicates are grouped (a perceptual hash), and the groups are split 70/15/15 per class with a fixed
seed: no photo (or a near copy of it) is in two splits.

    python prepare_data.py            # -> data/processed/{train,val,test}/<class>/*.jpg and data/report.json
"""

import hashlib
import json
import random
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw" / "gec"
OUT = HERE / "data" / "processed"
REPO = "https://github.com/siddharthkhincha/Gym-Equipment-Classifier.git"
SEED = 42
SPLIT = {"train": 0.70, "val": 0.15, "test": 0.15}
SHORT_SIDE = 256  # stored size; training crops 224 (or less) from it
NEAR_DUP_BITS = 4  # perceptual hashes this close are the same photo (resized, recompressed, small edits)


def dhash(im: Image.Image, size: int = 8) -> int:
    """Difference hash: 64 bits that barely change when a photo is resized or recompressed."""
    g = im.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            bits = (bits << 1) | (px[row * (size + 1) + col] > px[row * (size + 1) + col + 1])
    return bits


def main():
    if not RAW.exists():
        RAW.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", REPO, str(RAW)], check=True)

    items, broken = [], []
    for p in sorted((RAW / "data").glob("*/*/*")):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}:
            continue
        try:
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im.convert("RGB"))
                items.append({"path": p, "cls": p.parent.name, "md5": hashlib.md5(p.read_bytes()).hexdigest(),
                              "dhash": dhash(im), "size": im.size})
        except Exception:
            broken.append(str(p))
    classes = sorted({i["cls"] for i in items})

    # group exact and near-duplicates (union-find over pairs within NEAR_DUP_BITS)
    parent = list(range(len(items)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            if items[a]["md5"] == items[b]["md5"] or bin(items[a]["dhash"] ^ items[b]["dhash"]).count("1") <= NEAR_DUP_BITS:
                parent[find(a)] = find(b)
    groups = defaultdict(list)
    for k, it in enumerate(items):
        groups[find(k)].append(it)
    conflicting = [g for g in groups.values() if len({i["cls"] for i in g}) > 1]
    # one photo per group (the largest); groups with conflicting labels are dropped
    kept = [max(g, key=lambda i: i["size"][0] * i["size"][1]) for g in groups.values() if len({i["cls"] for i in g}) == 1]

    rng = random.Random(SEED)
    split_of = {}
    for c in classes:
        mine = sorted((i for i in kept if i["cls"] == c), key=lambda i: i["md5"])
        rng.shuffle(mine)
        n = len(mine)
        n_train, n_val = round(n * SPLIT["train"]), round(n * SPLIT["val"])
        for k, it in enumerate(mine):
            split_of[it["md5"]] = "train" if k < n_train else "val" if k < n_train + n_val else "test"

    counts = Counter()
    for it in kept:
        split = split_of[it["md5"]]
        dst = OUT / split / it["cls"] / f"{it['md5'][:16]}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(it["path"]) as im:
            im = ImageOps.exif_transpose(im.convert("RGB"))
            scale = SHORT_SIDE / min(im.size)
            if scale < 1:
                im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
            im.save(dst, quality=92)
        counts[(split, it["cls"])] += 1

    report = {
        "source": REPO,
        "licence": "MIT",
        "classes": classes,
        "images_found": len(items) + len(broken),
        "broken": len(broken),
        "duplicate_groups_removed": sum(len(g) - 1 for g in groups.values() if len(g) > 1),
        "groups_with_conflicting_labels_dropped": len(conflicting),
        "images_kept": len(kept),
        "split": {s: {c: counts[(s, c)] for c in classes} for s in SPLIT},
        "seed": SEED,
    }
    (HERE / "data" / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
