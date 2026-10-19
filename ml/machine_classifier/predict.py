"""Try the exported model on your own photos.

    python predict.py photo.jpg [more.jpg ...]   # top 3 guesses per photo
    python predict.py some_folder                # every .jpg/.jpeg/.png in the folder
    python predict.py --model model photo.jpg    # a different export folder (default: model/merged, else model)
"""

import argparse
import os
import sys
import warnings
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
warnings.filterwarnings("ignore")

import numpy as np
from PIL import Image, ImageOps

HERE = Path(__file__).parent
SIZE = 224


def default_model_dir() -> Path:
    merged = HERE / "model" / "merged"
    return merged if (merged / "gym_machines_float16.tflite").exists() else HERE / "model"


def load(path) -> np.ndarray:
    """Short side to 256 px, centre crop 224x224, RGB 0-255 (the same as the evaluation)."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    s = round(SIZE / 0.875) / min(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.BILINEAR)
    left, top = (im.width - SIZE) // 2, (im.height - SIZE) // 2
    return np.asarray(im.crop((left, top, left + SIZE, top + SIZE)), np.float32)[None]


class Classifier:
    def __init__(self, model_dir: Path):
        try:
            from ai_edge_litert.interpreter import Interpreter
        except ImportError:
            from tensorflow.lite import Interpreter
        self.it = Interpreter(model_path=str(model_dir / "gym_machines_float16.tflite"))
        self.it.allocate_tensors()
        self.inp, self.out = self.it.get_input_details()[0]["index"], self.it.get_output_details()[0]["index"]
        self.labels = (model_dir / "labels.txt").read_text().split()

    def __call__(self, path) -> np.ndarray:
        self.it.set_tensor(self.inp, load(path))
        self.it.invoke()
        return self.it.get_tensor(self.out)[0]


def main():
    ap = argparse.ArgumentParser(usage=__doc__)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--model", type=Path, default=default_model_dir())
    a = ap.parse_args()
    paths = []
    for arg in a.paths:
        p = Path(arg)
        if not p.exists():
            print(f"Not found: {arg}  (a path with spaces needs one pair of quotes around all of it)")
            continue
        paths += sorted(q for q in p.iterdir() if q.suffix.lower() in {".jpg", ".jpeg", ".png"}) if p.is_dir() else [p]
    if not paths:
        sys.exit(__doc__)
    clf = Classifier(a.model)
    for path in paths:
        p = clf(path)
        top = p.argsort()[::-1][:3]
        guess = clf.labels[top[0]] if p[top[0]] >= 0.5 else f"not sure ({clf.labels[top[0]]}?)"
        print(f"{path.name}: {guess}   " + ", ".join(f"{clf.labels[k]} {p[k]:.0%}" for k in top))


if __name__ == "__main__":
    main()
