"""A small window to try the model: pick a photo, see the photo and the model's guess.

    python try_model.py [--model model/merged]
"""

import argparse
import tkinter as tk
from pathlib import Path
from tkinter import filedialog

from PIL import Image, ImageOps, ImageTk

from predict import Classifier, default_model_dir

ap = argparse.ArgumentParser()
ap.add_argument("--model", type=Path, default=default_model_dir())
clf = Classifier(ap.parse_args().model)


def pick():
    name = filedialog.askopenfilename(filetypes=[("Photos", "*.jpg *.jpeg *.png *.webp *.bmp"), ("All files", "*.*")])
    if not name:
        return
    p = clf(name)
    top = p.argsort()[::-1][:3]
    best = clf.labels[top[0]].replace("_", " ")
    title.config(text=best if p[top[0]] >= 0.5 else f"Not sure (maybe {best})")
    scores.config(text="\n".join(f"{clf.labels[k].replace('_', ' ')}: {p[k]:.0%}" for k in top))
    im = ImageOps.exif_transpose(Image.open(name)).convert("RGB")
    im.thumbnail((420, 420))
    photo.image = ImageTk.PhotoImage(im)
    photo.config(image=photo.image)


root = tk.Tk()
root.title("Gym machine classifier")
tk.Button(root, text="Choose a photo...", command=pick, font=("Segoe UI", 12)).pack(pady=10)
photo = tk.Label(root)
photo.pack(padx=10)
known = ", ".join(label.replace("_", " ") for label in clf.labels)
title = tk.Label(root, text=f"Knows {len(clf.labels)} machines", font=("Segoe UI", 16, "bold"))
title.pack(pady=(10, 0))
scores = tk.Label(root, text=known, font=("Segoe UI", 10), justify="left", wraplength=420)
scores.pack(pady=(0, 10))
root.mainloop()
