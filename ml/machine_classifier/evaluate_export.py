"""Final step: score the chosen model once on the test split and the real-world photos, then export it.

Exports ONNX (for the backend's onnxruntime) and TFLite (float32, float16 and dynamic-range int8, for phones; made
from the ONNX file with onnx2tf), checks every export gives the same predictions as the PyTorch model on the test
photos, and measures size and CPU speed.

    python evaluate_export.py runs/<dataset>/finetune/<name>/model.pt
"""

import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch import nn

from common import DATASET, HERE, Exported, files, eval_image, open_rgb, save_json
from finetune import load

OUT = HERE / "model" if DATASET == "processed" else HERE / "model" / DATASET
RESULTS = HERE / "results" if DATASET == "processed" else HERE / "results" / DATASET


def images(split, size, root=None):
    paths, labels = files(split, *([root] if root else []))
    return np.stack([eval_image(open_rgb(p), size) for p in paths]).astype(np.float32), np.array(labels)


def report(y, pred, names):
    n = len(names)
    cm = np.zeros((n, n), int)
    for a, b in zip(y, pred):
        cm[a, b] += 1
    per = {}
    for c, name in enumerate(names):
        tp, fp, fn = cm[c, c], cm[:, c].sum() - cm[c, c], cm[c, :].sum() - cm[c, c]
        if cm[c, :].sum() == 0:
            continue
        per[name] = {"n": int(cm[c, :].sum()), "precision": float(tp / max(tp + fp, 1)), "recall": float(tp / max(tp + fn, 1)),
                     "f1": float(2 * tp / max(2 * tp + fp + fn, 1))}
    present = [c for c in range(n) if cm[c, :].sum()]
    return {"acc": float((y == pred).mean()), "macro_f1": float(np.mean([per[names[c]]["f1"] for c in present])),
            "n": int(len(y)), "per_class": per, "confusion": cm.tolist()}


def draw_confusion(cm, names, path, title):
    cm = np.array(cm)
    cell, left, top = 64, 150, 70
    n = len(names)
    im = Image.new("RGB", (left + cell * n + 10, top + cell * n + 10), "white")
    d = ImageDraw.Draw(im)
    d.text((10, 10), title, fill="black")
    d.text((left, top - 30), "predicted ->", fill="#555555")
    for j, name in enumerate(names):
        d.text((left + j * cell + 4, top - 14), name[:9], fill="black")
    for i, name in enumerate(names):
        d.text((8, top + i * cell + cell // 2 - 6), name, fill="black")
        total = max(cm[i].sum(), 1)
        for j in range(n):
            share = cm[i, j] / total
            shade = int(255 - 200 * share)
            color = (shade, shade, 255) if i == j else (255, shade, shade)
            x, y = left + j * cell, top + i * cell
            d.rectangle([x, y, x + cell - 2, y + cell - 2], fill=color)
            d.text((x + cell // 2 - 8, y + cell // 2 - 6), str(cm[i, j]), fill="black")
    im.save(path)


def timed(fn, x, k=40):
    times = []
    for i in range(k):
        t = time.perf_counter()
        fn(x[i : i + 1])
        times.append(time.perf_counter() - t)
    return round(float(np.median(times)) * 1000, 1)


def to_tflite(onnx_nchw: Path, work: Path) -> dict[str, bytes]:
    """ONNX (NCHW) -> TensorFlow SavedModel with NHWC input (onnx2tf) -> TFLite float32, float16 (float16 weights,
    float32 maths) and int8 (dynamic range: int8 weights, float activations) with TensorFlow's own converter."""
    import onnx2tf
    import tensorflow as tf

    onnx2tf.convert(input_onnx_file_path=str(onnx_nchw), output_folder_path=str(work), non_verbose=True, tflite_backend="tf_converter")
    out = {}
    for mode in ("float32", "float16", "int8"):
        conv = tf.lite.TFLiteConverter.from_saved_model(str(work))
        if mode == "float16":
            conv.optimizations = [tf.lite.Optimize.DEFAULT]
            conv.target_spec.supported_types = [tf.float16]
        elif mode == "int8":
            conv.optimizations = [tf.lite.Optimize.DEFAULT]
        out[mode] = conv.convert()
    return out


def run_tflite(blob, x):
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        from tensorflow.lite import Interpreter
    it = Interpreter(model_content=blob, num_threads=4)
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    it.allocate_tensors()
    preds, times = [], []
    for k in range(len(x)):
        t = time.perf_counter()
        it.set_tensor(inp["index"], x[k : k + 1])
        it.invoke()
        times.append(time.perf_counter() - t)
        preds.append(it.get_tensor(out["index"])[0])
    return np.array(preds), round(float(np.median(times) * 1000), 1)


class SoftmaxNCHW(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        return torch.softmax(self.net(x), dim=-1)


def main():
    path = Path(sys.argv[1])
    result = json.loads((path.parent / "result.json").read_text())
    model, cfg, names = load(path, "cpu")
    size = cfg["size"]
    torch.set_num_threads(4)

    x_test, y_test = images("test", size)
    x_real, y_real = images("realworld", size, root=HERE / "data")
    exported = Exported(model).eval()
    with torch.no_grad():
        p_test = torch.cat([exported(torch.from_numpy(b)) for b in np.array_split(x_test, max(1, len(x_test) // 64))]).numpy()
        p_real = torch.cat([exported(torch.from_numpy(b)) for b in np.array_split(x_real, max(1, len(x_real) // 64))]).numpy()
        torch_ms = timed(lambda x: exported(torch.from_numpy(x)), x_test)

    test = report(y_test, p_test.argmax(1), names)
    real = report(y_real, p_real.argmax(1), names)
    RESULTS.mkdir(parents=True, exist_ok=True)
    draw_confusion(test["confusion"], names, RESULTS / "confusion_test.png", f"Test split ({test['n']} photos): rows = true class")
    real_names = [n for n in names if real["per_class"].get(n)]
    # all rows, so each row keeps its own label; classes without real-world photos stay empty
    draw_confusion(real["confusion"], names, RESULTS / "confusion_realworld.png",
                   f"Real-world photos ({real['n']}): rows = true class (only {', '.join(real_names)})")

    OUT.mkdir(parents=True, exist_ok=True)
    exports = {}
    import onnxruntime as ort

    onnx_path = OUT / "gym_machines.onnx"
    torch.onnx.export(exported, (torch.zeros(1, size, size, 3),), str(onnx_path), input_names=["image"], output_names=["probabilities"],
                      dynamic_axes={"image": {0: "batch"}, "probabilities": {0: "batch"}}, opset_version=17, dynamo=False)
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    p = sess.run(None, {"image": x_test})[0]
    exports["gym_machines.onnx"] = {"mb": round(onnx_path.stat().st_size / 1e6, 2), "test_acc": float((p.argmax(1) == y_test).mean()),
                                    "same_predictions_as_pytorch": float((p.argmax(1) == p_test.argmax(1)).mean()),
                                    "max_prob_difference": float(np.abs(p - p_test).max()),
                                    "cpu_ms_per_photo": timed(lambda x: sess.run(None, {"image": x}), x_test)}

    work = Path(tempfile.mkdtemp())
    try:
        nchw = work / "nchw.onnx"
        torch.onnx.export(SoftmaxNCHW(model).eval(), (torch.zeros(1, 3, size, size),), str(nchw), input_names=["image"],
                          output_names=["probabilities"], opset_version=17, dynamo=False)
        for mode, blob in to_tflite(nchw, work / "tf").items():
            fname = f"gym_machines_{mode}.tflite"
            (OUT / fname).write_bytes(blob)
            p, ms = run_tflite(blob, x_test)
            exports[fname] = {"mb": round(len(blob) / 1e6, 2), "test_acc": float((p.argmax(1) == y_test).mean()),
                              "same_predictions_as_pytorch": float((p.argmax(1) == p_test.argmax(1)).mean()),
                              "max_prob_difference": float(np.abs(p - p_test).max()), "cpu_ms_per_photo": ms}
    finally:
        shutil.rmtree(work, ignore_errors=True)

    (OUT / "labels.txt").write_text("\n".join(names) + "\n")
    save_json(OUT / "model_card.json", {
        "input": f"RGB photo, {size}x{size}, pixel values 0-255 (float32), NHWC; scaling to the network's range is inside the model",
        "preprocessing": f"resize the short side to {round(size / 0.875)} px, then crop the centre {size}x{size}",
        "output": "softmax probabilities, one per class in labels.txt order",
        "classes": names,
        "backbone": cfg["backbone"],
        "framework": f"PyTorch {torch.__version__}",
        "config": cfg,
    })

    final = {"model": str(path), "dataset": DATASET, "config": cfg, "test": test, "realworld": real, "pytorch_cpu_ms_per_photo": torch_ms,
             "exports": exports, "val": {"acc": result["val"]["acc"], "macro_f1": result["val"]["macro_f1"]}}
    save_json(RESULTS / "final_metrics.json", final)
    print(json.dumps({k: final[k] for k in ("val", "pytorch_cpu_ms_per_photo", "exports")}, indent=1))
    print("test:", round(test["acc"], 4), round(test["macro_f1"], 4), "| real-world:", round(real["acc"], 4), round(real["macro_f1"], 4))


if __name__ == "__main__":
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    main()
