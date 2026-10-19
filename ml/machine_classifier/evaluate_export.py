"""Final step: score the chosen model once on the test split and the real-world photos, then export it.

Exports TFLite (float32, float16 and dynamic-range int8, for phones) and ONNX (for the backend's onnxruntime), checks
every export gives the same predictions as the Keras model on the test photos, and measures size and CPU speed.

    python evaluate_export.py runs/finetune/<name>/model.keras
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image, ImageDraw
from tensorflow import keras

from common import HERE, classes, dataset, macro_f1, save_json

OUT = HERE / "model"
RESULTS = HERE / "results"


def images(split, size, root=None):
    xs, ys = [], []
    for x, y in dataset(split, size, 64, **({"root": root} if root else {})):
        xs.append(x.numpy())
        ys.append(y.numpy())
    return np.concatenate(xs), np.concatenate(ys)


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
    cell, left, top = 64, 120, 70
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


def tflite(model, mode, rep=None):
    conv = tf.lite.TFLiteConverter.from_keras_model(model)
    if mode == "float16":
        conv.optimizations = [tf.lite.Optimize.DEFAULT]
        conv.target_spec.supported_types = [tf.float16]
    elif mode == "int8":
        conv.optimizations = [tf.lite.Optimize.DEFAULT]  # dynamic-range: int8 weights, float activations
    return conv.convert()


def run_tflite(blob, x):
    it = tf.lite.Interpreter(model_content=blob, num_threads=4)
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    it.resize_tensor_input(inp["index"], [1, *x.shape[1:]])
    it.allocate_tensors()
    preds, times = [], []
    for k in range(len(x)):
        t = time.perf_counter()
        it.set_tensor(inp["index"], x[k : k + 1].astype(np.float32))
        it.invoke()
        times.append(time.perf_counter() - t)
        preds.append(it.get_tensor(out["index"])[0])
    return np.array(preds), float(np.median(times) * 1000)


def main():
    path = Path(sys.argv[1])
    result = json.loads((path.parent / "result.json").read_text())
    cfg, names = result["config"], classes()
    size = cfg["size"]
    model = keras.models.load_model(path, compile=False, safe_mode=False)

    x_test, y_test = images("test", size)
    x_real, y_real = images("realworld", size, root=HERE / "data")
    p_test = model.predict(x_test, batch_size=64, verbose=0)
    p_real = model.predict(x_real, batch_size=64, verbose=0)
    # CPU speed of the Keras model, one photo at a time
    times = []
    for k in range(40):
        t = time.perf_counter()
        model(x_test[k : k + 1], training=False)
        times.append(time.perf_counter() - t)

    test = report(y_test, p_test.argmax(1), names)
    real = report(y_real, p_real.argmax(1), names)
    RESULTS.mkdir(exist_ok=True)
    draw_confusion(test["confusion"], names, RESULTS / "confusion_test.png", f"Test split ({test['n']} photos): rows = true class")
    real_names = [n for n in names if real["per_class"].get(n)]
    # all 6 rows, so each row keeps its own label; classes without real-world photos stay empty
    draw_confusion(real["confusion"], names, RESULTS / "confusion_realworld.png",
                   f"Real-world photos ({real['n']}): rows = true class (only {', '.join(real_names)})")

    OUT.mkdir(exist_ok=True)
    exports = {}
    for mode in ("float32", "float16", "int8"):
        blob = tflite(model, mode)
        fname = f"gym_machines_{mode}.tflite"
        (OUT / fname).write_bytes(blob)
        p, ms = run_tflite(blob, x_test)
        exports[fname] = {"mb": round(len(blob) / 1e6, 2), "test_acc": float((p.argmax(1) == y_test).mean()),
                          "same_predictions_as_keras": float((p.argmax(1) == p_test.argmax(1)).mean()), "cpu_ms_per_photo": round(ms, 1)}

    import onnxruntime as ort
    import tf2onnx

    spec = (tf.TensorSpec((None, size, size, 3), tf.float32, name="image"),)
    onnx_model, _ = tf2onnx.convert.from_keras(model, input_signature=spec, opset=17)
    onnx_path = OUT / "gym_machines.onnx"
    onnx_path.write_bytes(onnx_model.SerializeToString())
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    name_in = sess.get_inputs()[0].name
    p = sess.run(None, {name_in: x_test.astype(np.float32)})[0]
    t = []
    for k in range(40):
        s = time.perf_counter()
        sess.run(None, {name_in: x_test[k : k + 1].astype(np.float32)})
        t.append(time.perf_counter() - s)
    exports["gym_machines.onnx"] = {"mb": round(onnx_path.stat().st_size / 1e6, 2), "test_acc": float((p.argmax(1) == y_test).mean()),
                                    "same_predictions_as_keras": float((p.argmax(1) == p_test.argmax(1)).mean()),
                                    "cpu_ms_per_photo": round(float(np.median(t)) * 1000, 1)}
    (OUT / "labels.txt").write_text("\n".join(names) + "\n")
    save_json(OUT / "model_card.json", {
        "input": f"RGB photo, {size}x{size}, pixel values 0-255 (float32), NHWC; scaling to the network's range is inside the model",
        "preprocessing": f"resize the short side to {round(size / 0.875)} px, then crop the centre {size}x{size}",
        "output": "softmax probabilities, one per class in labels.txt order",
        "classes": names,
        "backbone": cfg["backbone"],
        "config": cfg,
    })

    final = {"model": str(path), "config": cfg, "test": test, "realworld": real, "keras_cpu_ms_per_photo": round(float(np.median(times)) * 1000, 1),
             "exports": exports, "val": {"acc": result["val"]["acc"], "macro_f1": result["val"]["macro_f1"]}}
    save_json(RESULTS / "final_metrics.json", final)
    print(json.dumps({k: final[k] for k in ("val", "keras_cpu_ms_per_photo", "exports")}, indent=1))
    print("test:", round(test["acc"], 4), round(test["macro_f1"], 4), "| real-world:", round(real["acc"], 4), round(real["macro_f1"], 4))


if __name__ == "__main__":
    main()
