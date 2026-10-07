"""Retiming and WebP encoding only; keeps the supplied loader's transparent pixels.
Usage: python3 scripts/optimize-loader.py SOURCE.webp DEST.webp [--speed 2]
Requires Pillow with animated WebP support. Source and destination must differ.
"""
import argparse
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--speed", type=float, default=2)
args = parser.parse_args()
if args.source.resolve() == args.destination.resolve() or args.speed <= 0:
    parser.error("Use a separate destination and a positive speed.")
source = Image.open(args.source)
frames, durations = [], []
step = max(1, round(args.speed))
source_duration = 0
for index in range(source.n_frames):
    source.seek(index)
    source.load()
    duration = source.info.get("duration", 42)
    source_duration += duration
    if index % step == 0:
        frames.append(source.convert("RGBA").resize((480, 240), Image.Resampling.LANCZOS))
        durations.append(0)
    durations[-1] += duration / args.speed
# Allocate rounding across the whole timeline to preserve the requested speed.
rounded, timeline = [], 0
for duration in durations:
    target = round(timeline + duration)
    rounded.append(max(1, target - round(timeline)))
    timeline += duration
frames[0].save(args.destination, format="WEBP", save_all=True, append_images=frames[1:], duration=rounded, loop=0, quality=55, method=4, minimize_size=False, allow_mixed=False)
result = Image.open(args.destination)
actual_duration = 0
for index in range(result.n_frames):
    result.seek(index)
    result.load()
    actual_duration += result.info["duration"]
assert result.mode == "RGBA" and result.getextrema()[3][0] == 0
print(json.dumps({"originalBytes": args.source.stat().st_size, "optimizedBytes": args.destination.stat().st_size, "originalDurationMs": source_duration, "durationMs": actual_duration, "speed": source_duration / actual_duration, "frames": result.n_frames, "size": result.size, "transparent": True}))
