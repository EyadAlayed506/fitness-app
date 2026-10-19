"""Shared pieces (PyTorch): the dataset, image preprocessing and augmentation, and the MobileNet models.

Which prepared dataset to use comes from the DATASET environment variable: "processed" (the 6-class
Gym-Equipment-Classifier set, the default) or "merged" (see prepare_roboflow.py). Runs go to runs/<DATASET>/.
ImageNet weights come from torchvision (download.pytorch.org), so no other download is needed.
"""

import json
import math
import os
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from torch import nn
from torchvision import models
from torchvision.transforms import v2

HERE = Path(__file__).parent
DATASET = os.environ.get("DATASET", "processed")
DATA = HERE / "data" / DATASET
RUNS = HERE / "runs" / DATASET
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
# loader processes; 0 = in the main process (the stored photos are small, and worker processes hung on Windows)
WORKERS = int(os.environ.get("WORKERS", "0"))

BACKBONES = ("mobilenet_v3_small", "mobilenet_v3_large")
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)

torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True


def seed_everything(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


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

def open_rgb(path) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def eval_image(im: Image.Image, size: int) -> np.ndarray:
    """Resize the short side to size/0.875, then crop the centre (the standard ImageNet evaluation). HWC uint8."""
    short = round(size / 0.875)
    s = short / min(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.BILINEAR, reducing_gap=None)
    left, top = (im.width - size) // 2, (im.height - size) // 2
    return np.asarray(im.crop((left, top, left + size, top + size)))


AUG = {
    # min crop area, colour jitter, rotation (radians)
    "light": (0.60, 0.10, 0.0),
    "medium": (0.35, 0.20, 0.10),
    "strong": (0.20, 0.30, 0.20),
}


class Photos(torch.utils.data.Dataset):
    """Photos as uint8 CHW tensors. With aug: random crop (any aspect 3:4-4:3) and flip here, in the loader workers;
    rotation and colour changes run on the GPU in augment_batch."""

    def __init__(self, paths, labels, size, aug=None):
        self.paths, self.labels, self.size = paths, labels, size
        self.crop = v2.Compose([
            v2.RandomResizedCrop(size, scale=(AUG[aug][0], 1.0), ratio=(0.75, 1.33), antialias=True),
            v2.RandomHorizontalFlip(),
        ]) if aug else None

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, k):
        im = open_rgb(self.paths[k])
        if self.crop:
            x = self.crop(v2.functional.pil_to_tensor(im))
        else:
            x = torch.from_numpy(eval_image(im, self.size).copy()).permute(2, 0, 1)
        return x, self.labels[k]


def _seed_worker(_):
    s = torch.initial_seed() % 2**32
    np.random.seed(s)
    random.seed(s)


def loader(split: str, size: int, batch: int, aug: str | None = None, shuffle: bool = False, root: Path = DATA, seed: int = 0):
    paths, labels = files(split, root)
    g = torch.Generator()
    g.manual_seed(seed)
    return torch.utils.data.DataLoader(
        Photos(paths, labels, size, aug), batch_size=batch, shuffle=shuffle, num_workers=WORKERS, pin_memory=True,
        persistent_workers=WORKERS > 0, worker_init_fn=_seed_worker, generator=g, drop_last=False,
    )


def augment_batch(x: torch.Tensor, aug: str) -> torch.Tensor:
    """x: uint8 NCHW on the GPU -> float 0-255. Small rotation (edges repeated), then brightness, contrast, saturation."""
    _, jitter, max_rot = AUG[aug]
    x = x.float()
    n = x.shape[0]
    if max_rot:
        a = (torch.rand(n, device=x.device) * 2 - 1) * max_rot
        c, s, z = torch.cos(a), torch.sin(a), torch.zeros_like(a)
        theta = torch.stack([torch.stack([c, -s, z], 1), torch.stack([s, c, z], 1)], 1)
        grid = F.affine_grid(theta, list(x.shape), align_corners=False)
        x = F.grid_sample(x, grid, mode="bilinear", padding_mode="border", align_corners=False)
    if jitter:
        r = lambda: torch.rand(n, 1, 1, 1, device=x.device) * 2 - 1  # noqa: E731
        x = x + r() * 255 * jitter
        mean = x.mean((2, 3), keepdim=True)
        x = (x - mean) * (1 + r() * jitter) + mean
        gray = (0.299 * x[:, 0:1] + 0.587 * x[:, 1:2] + 0.114 * x[:, 2:3])
        x = (x - gray) * (1 + r() * jitter) + gray
    return x.clamp(0, 255)


# ---------- models ----------

class Head(nn.Sequential):
    def __init__(self, features: int, n_classes: int, hidden: int, dropout: float):
        layers = [nn.Dropout(dropout)] if dropout else []
        if hidden:
            layers += [nn.Linear(features, hidden), nn.ReLU()] + ([nn.Dropout(dropout)] if dropout else [])
            features = hidden
        super().__init__(*layers, nn.Linear(features, n_classes))


class Net(nn.Module):
    """ImageNet-pretrained MobileNetV3 plus a new classifier head. Input: RGB pixels 0-255, NCHW (scaling is inside).
    Output: logits. Batch-norm layers always use their ImageNet statistics (small dataset)."""

    def __init__(self, name: str, n_classes: int, hidden: int = 0, dropout: float = 0.2, pretrained: bool = True):
        super().__init__()
        if name == "mobilenet_v3_small":
            net = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None)
        elif name == "mobilenet_v3_large":
            net = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V2 if pretrained else None)
        else:
            raise ValueError(name)
        self.features = net.features
        self.n_features = net.features[-1].out_channels
        self.head = Head(self.n_features, n_classes, hidden, dropout)
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1) * 255)
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1) * 255)

    def embed(self, x):
        x = (x - self.mean) / self.std
        return self.features(x).mean((2, 3))

    def forward(self, x):
        return self.head(self.embed(x))

    def train(self, mode: bool = True):
        super().train(mode)
        for m in self.features.modules():
            if isinstance(m, nn.BatchNorm2d):
                m.eval()
        return self

    def set_trainable(self, unfreeze: float):
        """Head always; plus the top `unfreeze` share of the backbone's layers (batch norm stays frozen)."""
        leaves = [m for m in self.features.modules() if not list(m.children())]
        first = math.floor(len(leaves) * (1 - unfreeze)) if unfreeze > 0 else len(leaves)
        for k, m in enumerate(leaves):
            for p in m.parameters(recurse=False):
                p.requires_grad = k >= first and not isinstance(m, nn.BatchNorm2d)
        for p in self.head.parameters():
            p.requires_grad = True


class Exported(nn.Module):
    """What the app gets: NHWC float 0-255 in, softmax probabilities out."""

    def __init__(self, net: Net):
        super().__init__()
        self.net = net

    def forward(self, x):
        return torch.softmax(self.net(x.permute(0, 3, 1, 2)), dim=-1)


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=float))


def macro_f1(y_true, y_pred, n: int) -> float:
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    f1s = []
    for c in range(n):
        tp = np.sum((y_pred == c) & (y_true == c))
        fp = np.sum((y_pred == c) & (y_true != c))
        fn = np.sum((y_pred != c) & (y_true == c))
        f1s.append(0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn))
    return float(np.mean(f1s))
