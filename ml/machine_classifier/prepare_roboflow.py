"""Build the merged gym-machine dataset: the 6-class set from prepare_data.py plus two Roboflow Universe datasets.

    python prepare_roboflow.py   # -> data/merged/{train,val,test}/<class>/*.jpg and data/merged_report.json

Sources (both CC BY 4.0, object detection, exported from Roboflow in COCO format into data/raw/roboflow/):
- thestalkers.zip: "Gym Equipment" by TheStalkers project, universe.roboflow.com/thestalkers-project/gym-equipment-ersfc
- fitfuel.zip: "All Gym Equipment" by FitFuel, universe.roboflow.com/fitfuel/all-gym-equipment
Download them from those pages (Download Dataset -> COCO), or with your Roboflow API key in ~/.roboflow_key:

    python prepare_roboflow.py --download

How the photos are made into a classification set:
- Each labelled machine box is cropped out (with a 10 % margin), so photos showing several machines work too.
- Roboflow stretched every photo to 640x640 and stored each of its training photos only as 3 edited copies
  (TheStalkers: crop/rotation/shear/noise; FitFuel: random 90-degree turns). One copy in three is kept. For FitFuel,
  a small network trained here to recognise 90-degree turns (on photos known to be upright) picks the copies it is
  surest about and turns them upright.
- Labels are mapped onto one list (MAP); free weights and accessories are dropped, and so are machines with fewer
  than MIN_PHOTOS source photos.
- Exact and near-duplicates (difference hash, as in prepare_data.py) are grouped across all sources, and each group
  stays in one split, as do all copies that share a Roboflow file name. The 6-class photos keep their split from
  prepare_data.py, so the old test photos are still test photos. The rest is split 70/15/15 per class at random.
  Roboflow's own valid/test photos are unedited but cover only some machines, so val/test also hold edited copies.
"""

import argparse
import hashlib
import io
import json
import random
import re
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

from prepare_data import NEAR_DUP_BITS, SEED, SHORT_SIDE, SPLIT, dhash

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw" / "roboflow"
GEC = HERE / "data" / "processed"
OUT = HERE / "data" / "merged"
MARGIN = 0.10
MIN_BOX = 48  # px (in Roboflow's 640x640 frame); smaller boxes are skipped
MIN_PHOTOS = 40

SOURCES = {
    "thestalkers": ("thestalkers-project", "gym-equipment-ersfc", 1),
    "fitfuel": ("fitfuel", "all-gym-equipment", 2),
}

# source label -> merged class (None: not a machine, dropped)
MAP = {
    "thestalkers": {
        "Chest Press machine": "chest_press", "Lat Pull Down": "lat_pulldown", "Seated Cable Rows": "seated_row",
        "arm curl machine": "arm_curl", "chest fly machine": "pec_deck", "chinning dipping": "power_tower",
        "lateral raises machine": "lateral_raise", "leg extension": "leg_extension", "leg press": "leg_press",
        "reg curl machine": "leg_curl", "seated dip machine": "seated_dip", "shoulder press machine": "shoulder_press",
        "smith machine": "smith_machine", "objects": None,
    },
    "fitfuel": {
        "Ab Crunch Machine": "ab_crunch", "Ab Roller": None, "Abdominal Bench": "ab_bench", "Back Extension Machine": "back_extension",
        "Barbell": None, "Bench": "bench_press", "Chest Fly Machine": "pec_deck", "Chest Press Machine": "chest_press", "Dumbbell": None,
        "Elliptical": "elliptical", "Functional Trainer": "cable_crossover", "GHD Machine": "ghd", "Hack Squat Machine": "hack_squat",
        "Kettlebells": None, "Lat Pull Down Machine": "lat_pulldown", "Lateral Raises Machine": "lateral_raise",
        "Leg Curl Machine": "leg_curl", "Leg Extension Machine": "leg_extension", "Leg Press Machine": "leg_press",
        "Leg Raise Tower": "power_tower", "Preacher Curl": "arm_curl", "Seated Dip Machine": "seated_dip",
        "Seated Row Machine": "seated_row", "Shoulder Press Machine": "shoulder_press", "Smith Machine": "smith_machine",
        "Stability Ball": None, "Stepmill": "stepmill", "Treadmill": "treadmill", "Stationary Bike": "bicycle", "equipment": None,
    },
}


def download():
    key = (Path.home() / ".roboflow_key").read_text().strip()
    RAW.mkdir(parents=True, exist_ok=True)
    for name, (ws, project, version) in SOURCES.items():
        dst = RAW / f"{name}.zip"
        if dst.exists():
            continue
        for _ in range(30):  # Roboflow prepares the export first
            info = json.loads(urllib.request.urlopen(f"https://api.roboflow.com/{ws}/{project}/{version}/coco?api_key={key}", timeout=60).read())
            if info.get("export", {}).get("link"):
                break
            time.sleep(10)
        urllib.request.urlretrieve(info["export"]["link"], dst)
        print("downloaded", dst)


def source_key(file_name: str) -> str:
    """Roboflow names copies '<original>_<ext>.rf.<hash>.jpg'; the part before is the same for all copies."""
    return re.sub(r"_(jpe?g|png|webp|bmp)\.rf\.[0-9a-f]+\.\w+$", "", file_name, flags=re.I)


def read_coco(name):
    """Copies grouped by the photo they were made from. Roboflow keeps each photo in one of its splits, so a valid/test
    photo (unedited) is its own group. Training copies are grouped by file-name stem and labels; a stem is often shared
    by several photos ('images', 'naver_0006'), so a group can hold several photos (3 copies each)."""
    z = zipfile.ZipFile(RAW / f"{name}.zip")
    photos = defaultdict(list)
    for split in ("train", "valid", "test"):
        meta = json.loads(z.read(f"{split}/_annotations.coco.json"))
        cats = {c["id"]: c["name"] for c in meta["categories"]}
        boxes = defaultdict(list)
        for a in meta["annotations"]:
            boxes[a["image_id"]].append((cats[a["category_id"]], a["bbox"]))
        for im in meta["images"]:
            b = boxes[im["id"]]
            key = (name, source_key(im["file_name"]), tuple(sorted({label for label, _ in b}))) if split == "train" else (name, f"{split}/{im['file_name']}")
            photos[key].append({"zip": z, "path": f"{split}/{im['file_name']}", "clean": split != "train", "boxes": b})
    return photos


# ---------- turning FitFuel's training copies upright ----------

def orientation_model(upright: list[Image.Image]):
    """MobileNetV3-Small trained to tell which of 4 quarter turns was applied to a photo."""
    import torch
    import torch.nn.functional as F
    from torchvision import models

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(SEED)
    x_all = torch.from_numpy(np.stack([np.asarray(i.resize((224, 224))) for i in upright])).permute(0, 3, 1, 2).contiguous()
    mean = torch.tensor([0.485, 0.456, 0.406], device=dev).view(1, 3, 1, 1) * 255
    std = torch.tensor([0.229, 0.224, 0.225], device=dev).view(1, 3, 1, 1) * 255
    net = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    net.classifier[-1] = torch.nn.Linear(net.classifier[-1].in_features, 4)
    net = net.to(dev)
    epochs, batch = 15, 64
    opt = torch.optim.AdamW(net.parameters(), 1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=epochs * ((len(x_all) + batch - 1) // batch))
    for _ in range(epochs):
        net.train()
        for idx in torch.randperm(len(x_all)).split(batch):
            x = x_all[idx]
            x = torch.where(torch.rand(len(x), 1, 1, 1) < 0.5, x, x.flip(3))  # mirror before turning (a mirrored turn is the opposite turn)
            k = torch.randint(0, 4, (len(x),))
            x = torch.stack([torch.rot90(a, int(r), (1, 2)) for a, r in zip(x, k)]).to(dev).float()
            loss = F.cross_entropy(net((x - mean) / std), k.to(dev))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
    net.eval()

    def turns(images: list[Image.Image]) -> np.ndarray:
        """Probability of each quarter turn (counter-clockwise) having been applied, per photo."""
        x = torch.from_numpy(np.stack([np.asarray(i.resize((224, 224))) for i in images])).permute(0, 3, 1, 2).to(dev).float()
        with torch.no_grad():
            return torch.cat([torch.softmax(net((b - mean) / std), -1) for b in x.split(128)]).cpu().numpy()

    return turns


def load_image(copy) -> Image.Image:
    return Image.open(io.BytesIO(copy["zip"].read(copy["path"]))).convert("RGB")


def crops(im: Image.Image, boxes, mapping, turn: int = 0):
    """Crop each mapped box (with margin); turn the crop upright by `turn` quarter turns clockwise."""
    out = []
    for label, (x, y, w, h) in boxes:
        cls = mapping[label]
        if cls is None or min(w, h) < MIN_BOX:
            continue
        mx, my = w * MARGIN, h * MARGIN
        box = (max(0, x - mx), max(0, y - my), min(im.width, x + w + mx), min(im.height, y + h + my))
        c = im.crop(tuple(round(v) for v in box))
        if turn:
            c = c.rotate(-90 * turn, expand=True)
        out.append((cls, c))
    return out


def shrink(im: Image.Image) -> Image.Image:
    s = SHORT_SIDE / min(im.size)
    return im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS) if s < 1 else im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true", help="download the Roboflow exports with the key in ~/.roboflow_key")
    a = ap.parse_args()
    if a.download:
        download()

    # items: one crop (or a whole 6-class photo) each; group: the photo it came from
    items = []
    gec_split = {}
    for p in sorted(GEC.glob("*/*/*.jpg")):
        split, cls = p.parent.parent.name, p.parent.name
        with Image.open(p) as im:
            im = im.convert("RGB")
            items.append({"src": "gec", "photo": f"gec/{p.stem}", "group": f"gec/{p.stem}", "cls": cls, "image": im.copy(), "clean": True,
                          "dhash": dhash(im)})
        gec_split[f"gec/{p.stem}"] = split

    photos = {}
    for name in SOURCES:
        photos.update(read_coco(name))

    # orientation network: trained on upright photos (6-class training photos and TheStalkers' unedited photos);
    # checked on FitFuel's unedited photos, which it does not see in training
    upright = [it["image"] for it in items if gec_split[it["photo"]] == "train"]
    upright += [load_image(c) for key, copies in photos.items() if key[0] == "thestalkers" for c in copies if c["clean"]]
    turns = orientation_model(upright)
    ff_clean = [load_image(c) for key, copies in photos.items() if key[0] == "fitfuel" for c in copies if c["clean"]]
    rng = np.random.default_rng(SEED)
    applied = rng.integers(0, 4, len(ff_clean))
    guessed = turns([im.rotate(90 * int(k), expand=True) for im, k in zip(ff_clean, applied)]).argmax(1)
    orientation_check = float((guessed == applied).mean())
    print(f"orientation network: {orientation_check:.1%} of {len(ff_clean)} turned FitFuel photos recognised", flush=True)

    # one copy per photo: an unedited photo as it is; from edited copies, one in three (each photo has 3), for FitFuel
    # the ones the orientation network is surest about, turned upright
    edited_turns = Counter()
    for key, copies in sorted(photos.items(), key=lambda kv: str(kv[0])):
        src, clean = key[0], copies[0]["clean"]
        copies = sorted(copies, key=lambda c: c["path"])
        ims = [load_image(c) for c in copies]
        if clean:
            chosen = [(copies[0], ims[0], 0)]
        elif src == "fitfuel":
            p = turns(ims)
            m = max(1, round(len(copies) / 3))
            chosen = [(copies[k], ims[k], int(p[k].argmax())) for k in np.argsort(-p.max(1))[:m]]
            edited_turns.update(t for _, _, t in chosen)
        else:
            chosen = [(copies[k], ims[k], 0) for k in range(0, len(copies), 3)]
        group = "/".join(map(str, key))
        for j, (copy, im, turn) in enumerate(chosen):
            h = dhash(im.rotate(-90 * turn, expand=True) if turn else im)
            for k, (cls, c) in enumerate(crops(im, copy["boxes"], MAP[src], turn)):
                items.append({"src": src, "photo": f"{group}#{j}", "group": group, "cls": cls, "image": shrink(c), "clean": clean,
                              "dhash": h, "box": k})

    # drop machines with too few photos
    photos_per_class = defaultdict(set)
    for it in items:
        photos_per_class[it["cls"]].add(it["photo"])
    dropped = {c: len(v) for c, v in photos_per_class.items() if len(v) < MIN_PHOTOS}
    items = [it for it in items if it["cls"] not in dropped]

    by_photo = defaultdict(list)
    for it in items:
        by_photo[it["photo"]].append(it)
    photo_ids = sorted(by_photo)

    def union_find(n, pairs):
        parent = list(range(n))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for a, b in pairs:
            parent[find(a)] = find(b)
        return [find(a) for a in range(n)]

    # duplicates: near-identical photos (difference hash); one is kept, a 6-class photo first (it keeps its split),
    # then an unedited one
    hs = np.array([by_photo[p][0]["dhash"] for p in photo_ids], dtype=np.uint64)
    pairs = []
    for a in range(len(photo_ids)):
        bits = np.unpackbits(np.bitwise_xor(hs[a + 1 :], hs[a]).view(np.uint8).reshape(-1, 8), axis=1).sum(1)
        pairs += [(a, a + 1 + int(b)) for b in np.nonzero(bits <= NEAR_DUP_BITS)[0]]
    dup_groups = defaultdict(list)
    for p, root in zip(photo_ids, union_find(len(photo_ids), pairs)):
        dup_groups[root].append(p)
    kept, duplicates = [], 0
    for members in dup_groups.values():
        kept.append(min(members, key=lambda p: (not p.startswith("gec/"), not by_photo[p][0]["clean"], p)))
        duplicates += len(members) - 1

    # split units: photos from the same Roboflow file-name group (copies of the same photo can be in it) stay together
    units = defaultdict(list)
    for p in kept:
        units[by_photo[p][0]["group"]].append(p)

    # split: 6-class photos keep theirs; the rest 70/15/15 per class (by the unit's largest crop), at random
    split_of = {u: gec_split[u] for u in units if u in gec_split}
    rng = random.Random(SEED)
    main_cls = {u: max((it for p in ps for it in by_photo[p]), key=lambda it: it["image"].width * it["image"].height)["cls"]
                for u, ps in units.items()}
    for c in sorted(set(main_cls.values())):
        mine = sorted(u for u in units if main_cls[u] == c and u not in split_of)
        rng.shuffle(mine)
        n_all = sum(len(units[u]) for u in units if main_cls[u] == c)
        have = Counter()
        for u in units:
            if main_cls[u] == c and u in split_of:
                have[split_of[u]] += len(units[u])
        for u in mine:
            s = next((s for s in ("test", "val") if have[s] < round(n_all * SPLIT[s])), "train")
            split_of[u] = s
            have[s] += len(units[u])

    counts, edited_in = Counter(), Counter()
    for u, ps in units.items():
        for p in ps:
            for it in by_photo[p]:
                split = split_of[u]
                dst = OUT / split / it["cls"] / f"{it['src']}_{hashlib.md5((p + str(it.get('box', ''))).encode()).hexdigest()[:16]}.jpg"
                dst.parent.mkdir(parents=True, exist_ok=True)
                it["image"].save(dst, quality=92)
                counts[(split, it["cls"])] += 1
                edited_in[split] += not it["clean"]

    classes = sorted({c for _, c in counts})
    report = {
        "sources": {"gec": "data/processed (prepare_data.py), MIT",
                    **{n: f"https://universe.roboflow.com/{ws}/{pr} v{v}, CC BY 4.0" for n, (ws, pr, v) in SOURCES.items()}},
        "classes": classes,
        "orientation_check_fitfuel": orientation_check,
        "fitfuel_edited_photos_turned": {f"{90 * k} deg": n for k, n in sorted(edited_turns.items())},
        "dropped_too_few_photos": dropped,
        "duplicate_photos_removed": duplicates,
        "photos_kept": len(kept),
        "images": {s: sum(counts[(s, c)] for c in classes) for s in SPLIT},
        "edited_copies_in": dict(edited_in),
        "split": {s: {c: counts[(s, c)] for c in classes} for s in SPLIT},
        "seed": SEED,
    }
    (HERE / "data" / "merged_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
