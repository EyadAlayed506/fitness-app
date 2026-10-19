"""Try the exported model on your own photos.

    python predict.py photo.jpg [more.jpg ...]   # top 3 guesses per photo
    python predict.py some_folder                # every .jpg/.jpeg/.png in the folder
"""

import os
import sys
import warnings
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
warnings.filterwarnings("ignore")

import numpy as np
import tensorflow as tf
from PIL import Image, ImageOps

HERE = Path(__file__).parent
SIZE = 224


def load(path: Path) -> np.ndarray:
    """Short side to 256 px, centre crop 224x224, RGB 0-255 (the same as the evaluation)."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    s = round(SIZE / 0.875) / min(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS)
    left, top = (im.width - SIZE) // 2, (im.height - SIZE) // 2
    return np.asarray(im.crop((left, top, left + SIZE, top + SIZE)), np.float32)[None]


def main():
    paths = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            print(f"Not found: {arg}  (a path with spaces needs one pair of quotes around all of it)")
            continue
        paths += sorted(q for q in p.iterdir() if q.suffix.lower() in {".jpg", ".jpeg", ".png"}) if p.is_dir() else [p]
    if not paths:
        sys.exit(__doc__)
    it = tf.lite.Interpreter(model_path=str(HERE / "model" / "gym_machines_float16.tflite"))
    it.allocate_tensors()
    inp, out = it.get_input_details()[0]["index"], it.get_output_details()[0]["index"]
    labels = (HERE / "model" / "labels.txt").read_text().split()
    for path in paths:
        it.set_tensor(inp, load(path))
        it.invoke()
        p = it.get_tensor(out)[0]
        top = p.argsort()[::-1][:3]
        guess = labels[top[0]] if p[top[0]] >= 0.5 else f"not sure ({labels[top[0]]}?)"
        print(f"{path.name}: {guess}   " + ", ".join(f"{labels[k]} {p[k]:.0%}" for k in top))


if __name__ == "__main__":
    main()
