#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF (PIL, DejaVuSansMono).
The transcript is generated from real CLI runs (see build note); this script
only renders it, never edits the content."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 920, 760
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 13)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 13)
LINE_H = 18

lines = open("demo/transcript.txt").read().splitlines()

def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("+ ADDED"):
        return GREEN
    if line.startswith("~ CHANGED"):
        return YELLOW
    if line.startswith("- REMOVED"):
        return RED
    if line.startswith("DRIFT"):
        return RED
    if line.startswith("snapshot "):
        return CYAN
    if line.strip().startswith("version ") or line.strip().startswith("->"):
        return YELLOW
    if "change(s):" in line:
        return CYAN
    if line.startswith("exit:"):
        return RED
    return FG

frames = []
canvas: list[tuple[str, tuple]] = []

# Title card (3s): what the demo shows
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 200), "toolwatch — what did the update change?", font=bold, fill=GREEN)
d.text((14, 250), "1. snapshot before the Postman 12.33.4 update", font=font, fill=FG)
d.text((14, 280), "2. snapshot after (recorded fixture)", font=font, fill=FG)
d.text((14, 310), "3. diff names every silent change — exit 1", font=font, fill=FG)
d.text((14, 380), "zero-dep CLI · no network · no account", font=font, fill=DIM)
for _ in range(50):
    frames.append(title.copy())

def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp:
        f = bold if text.startswith(("$", "+ ADDED", "~ CHANGED", "- REMOVED", "DRIFT")) else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img

for line in lines:
    color = color_for(line)
    step = max(1, len(line) // 12)
    for i in range(0, len(line) + 1, step):
        frames.append(render(canvas + [(line[:i], color)]))
    canvas.append((line, color))
    if line.startswith(("DRIFT", "exit:")) or "change(s):" in line:
        for _ in range(14):
            frames.append(frames[-1].copy())

for _ in range(30):
    frames.append(frames[-1].copy())

frames[0].save(
    "demo/toolwatch-demo.gif",
    save_all=True,
    append_images=frames[1:],
    duration=60,
    loop=0,
)
print(f"frames={len(frames)} size={os.path.getsize('demo/toolwatch-demo.gif')} duration~{len(frames)*60/1000:.1f}s")
