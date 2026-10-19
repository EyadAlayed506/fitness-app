"""The real-world test set: everyday photos from Open Images, for 3 of the 6 classes.

The training photos are mostly product shots; these are photos taken in gyms and homes, so they show how the model
does outside the style it was trained on. realworld/realworld.json lists the photos (chosen as described there) and
this downloads them from Open Images' public S3 copy.

    python prepare_realworld.py   # -> data/realworld/{treadmill,bicycle,rowing}/*.jpg
"""

import concurrent.futures as cf
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "data" / "realworld"
SHORT_SIDE = 256


def fetch(cls: str, item: dict) -> bool:
    dst = OUT / cls / f"{item['open_images_id']}.jpg"
    if dst.exists():
        return True
    url = f"https://open-images-dataset.s3.amazonaws.com/{item['split']}/{item['open_images_id']}.jpg"
    try:
        im = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=30).read())).convert("RGB")
    except Exception:
        return False
    scale = SHORT_SIDE / min(im.size)
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=92)
    return True


def main():
    spec = json.loads((HERE / "realworld" / "realworld.json").read_text())
    jobs = [(cls, item) for cls, items in spec["images"].items() for item in items]
    with cf.ThreadPoolExecutor(16) as ex:
        ok = list(ex.map(lambda j: fetch(*j), jobs))
    print(f"{sum(ok)} of {len(jobs)} photos ready in {OUT}")


if __name__ == "__main__":
    main()
