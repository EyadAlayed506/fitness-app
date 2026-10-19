"""Shared pieces: the dataset as tf.data, image preprocessing and augmentation, and the MobileNet models.

ImageNet weights come from Keras (storage.googleapis.com), so no other download is needed.
"""

import os

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import json
import random
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow import keras

HERE = Path(__file__).parent
DATA = HERE / "data" / "processed"
RUNS = HERE / "runs"

BACKBONES = ("mobilenet_v2", "mobilenet_v3_small", "mobilenet_v3_large")


def seed_everything(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)
    keras.utils.set_random_seed(seed)


def classes() -> list[str]:
    return sorted(p.name for p in (DATA / "train").iterdir() if p.is_dir())


def files(split: str, root: Path = DATA) -> tuple[list[str], list[int]]:
    names = classes()
    paths, labels = [], []
    for k, c in enumerate(names):
        for p in sorted((root / split / c).glob("*.jpg")):
            paths.append(str(p))
            labels.append(k)
    return paths, labels


# ---------- images ----------

def _decode(path):
    return tf.image.decode_jpeg(tf.io.read_file(path), channels=3)


def eval_image(img, size: int):
    """Resize the short side to size/0.875, then crop the centre (the standard ImageNet evaluation)."""
    shape = tf.cast(tf.shape(img)[:2], tf.float32)
    scale = (size / 0.875) / tf.reduce_min(shape)
    img = tf.image.resize(img, tf.cast(tf.round(shape * scale), tf.int32), antialias=True)
    img = tf.image.resize_with_crop_or_pad(img, size, size)
    return tf.clip_by_value(img, 0.0, 255.0)


AUG = {
    # min crop area, colour jitter, rotation (radians)
    "light": (0.60, 0.10, 0.0),
    "medium": (0.35, 0.20, 0.10),
    "strong": (0.20, 0.30, 0.20),
}


def train_image(img, size: int, aug: str):
    """Random crop (part of the photo, any aspect 3:4-4:3), flip, small rotation, colour changes."""
    min_area, jitter, max_rot = AUG[aug]
    img = tf.cast(img, tf.float32)
    begin, crop_size, _ = tf.image.sample_distorted_bounding_box(
        tf.shape(img), bounding_boxes=tf.constant([[[0.0, 0.0, 1.0, 1.0]]]), min_object_covered=0.0,
        aspect_ratio_range=(0.75, 1.33), area_range=(min_area, 1.0), max_attempts=20, use_image_if_no_bounding_boxes=True,
    )
    img = tf.slice(img, begin, crop_size)
    img = tf.image.resize(img, (size, size), antialias=True)
    img = tf.image.random_flip_left_right(img)
    if max_rot:
        angle = tf.random.uniform([], -max_rot, max_rot)
        img = rotate(img, angle)
    if jitter:
        img = tf.image.random_brightness(img, 255 * jitter)
        img = tf.image.random_contrast(img, 1 - jitter, 1 + jitter)
        img = tf.image.random_saturation(img, 1 - jitter, 1 + jitter)
    return tf.clip_by_value(img, 0.0, 255.0)


def rotate(img, angle):
    """Rotate about the centre, filling with the nearest edge pixels."""
    size = tf.cast(tf.shape(img)[0], tf.float32)
    c, s = tf.cos(angle), tf.sin(angle)
    cx = size / 2
    # projective transform [a0, a1, a2, b0, b1, b2, c0, c1] mapping output to input points
    t = [c, -s, cx - c * cx + s * cx, s, c, cx - s * cx - c * cx, 0.0, 0.0]
    out = tf.raw_ops.ImageProjectiveTransformV3(
        images=img[None], transforms=tf.cast([t], tf.float32), output_shape=tf.shape(img)[:2],
        fill_value=0.0, interpolation="BILINEAR", fill_mode="NEAREST",
    )
    return out[0]


def dataset(split: str, size: int, batch: int, aug: str | None = None, shuffle: bool = False, root: Path = DATA, repeat_views: int = 1):
    paths, labels = files(split, root)
    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if shuffle:
        ds = ds.shuffle(len(paths), reshuffle_each_iteration=True)
    if repeat_views > 1:
        ds = ds.repeat(repeat_views)
    fn = (lambda p, y: (train_image(_decode(p), size, aug), y)) if aug else (lambda p, y: (eval_image(_decode(p), size), y))
    return ds.map(fn, num_parallel_calls=tf.data.AUTOTUNE).batch(batch).prefetch(tf.data.AUTOTUNE)


# ---------- models ----------

def backbone(name: str, size: int) -> keras.Model:
    """ImageNet-pretrained MobileNet without its classifier. Input: RGB pixels 0-255 (scaling is inside)."""
    inp = keras.Input((size, size, 3))
    if name == "mobilenet_v2":
        x = keras.layers.Rescaling(1 / 127.5, offset=-1)(inp)
        base = keras.applications.MobileNetV2(input_shape=(size, size, 3), include_top=False, weights="imagenet", pooling="avg")
    elif name == "mobilenet_v3_small":
        x = inp
        base = keras.applications.MobileNetV3Small(input_shape=(size, size, 3), include_top=False, weights="imagenet", pooling="avg", include_preprocessing=True)
    elif name == "mobilenet_v3_large":
        x = inp
        base = keras.applications.MobileNetV3Large(input_shape=(size, size, 3), include_top=False, weights="imagenet", pooling="avg", include_preprocessing=True)
    else:
        raise ValueError(name)
    # training=False keeps batch-norm statistics frozen, also while the layers are fine-tuned (small dataset)
    return keras.Model(inp, base(x, training=False), name=f"{name}_{size}")


def head(features: int, n_classes: int, hidden: int, dropout: float, l2: float) -> keras.Model:
    reg = keras.regularizers.l2(l2) if l2 else None
    inp = keras.Input((features,))
    x = keras.layers.Dropout(dropout)(inp) if dropout else inp
    if hidden:
        x = keras.layers.Dense(hidden, activation="relu", kernel_regularizer=reg)(x)
        x = keras.layers.Dropout(dropout)(x) if dropout else x
    out = keras.layers.Dense(n_classes, activation="softmax", kernel_regularizer=reg)(x)
    return keras.Model(inp, out, name="head")


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=float))


def macro_f1(y_true, y_pred, n: int) -> float:
    f1s = []
    for c in range(n):
        tp = np.sum((y_pred == c) & (y_true == c))
        fp = np.sum((y_pred == c) & (y_true != c))
        fn = np.sum((y_pred != c) & (y_true == c))
        f1s.append(0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn))
    return float(np.mean(f1s))
