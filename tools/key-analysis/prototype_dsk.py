"""Development-only independent implementation of Sha'ath's published DSK equations.

No KeyFinder source/library is used. Profiles are published Krumhansl-Kessler/Sha'ath values.
The production implementation is C#, streaming; this NumPy prototype evaluates the method.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import numpy as np
from scipy.signal import stft
from score_reference import MAJOR, MINOR

KRUMHANSL = np.array([
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]])
# Published empirical tone-profile parameters (Sha'ath, Fig. 2.8); these are data,
# not an implementation copied from KeyFinder or Essentia.
SHAATH = np.array([
    [6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4],
    [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2]])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", choices=["development", "holdout"], required=True)
    parser.add_argument("--profile", choices=["krumhansl", "shaath"], default="krumhansl")
    parser.add_argument("--compression", type=float, default=1.0)
    parser.add_argument("--normalize-frames", action="store_true")
    parser.add_argument("--harmonic-profile", action="store_true")
    args = parser.parse_args()
    sr, size = 11025, 65536
    frequencies = 440 * 2 ** ((np.arange(24, 96) - 69) / 12)
    bins = np.arange(size // 2 + 1)
    q = 0.8 * (2 ** (1 / 12) - 1)
    centers = frequencies * size / sr
    lower, upper = centers * (1 - q / 2), centers * (1 + q / 2)
    window = np.maximum(0, 1 - np.cos(2 * np.pi * (bins[None, :] - lower[:, None]) / (upper - lower)[:, None]))
    window *= (bins[None, :] >= lower[:, None]) & (bins[None, :] <= upper[:, None])
    filters = window * frequencies[:, None] / (np.maximum(bins[None, :], 1) * window.sum(axis=1)[:, None])
    selected_profiles = SHAATH if args.profile == "shaath" else KRUMHANSL
    if args.harmonic_profile:
        # Compare observed overtone-rich spectra with overtone-rich templates, rather
        # than treating every upper partial as a separately played note.
        selected_profiles = selected_profiles + 0.5 * np.roll(selected_profiles, 7, axis=1) + 0.25 * np.roll(selected_profiles, 4, axis=1)
    profiles = np.array([np.roll(selected_profiles[mode], root) for mode in range(2) for root in range(12)])
    profiles /= np.linalg.norm(profiles, axis=1, keepdims=True)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    with args.output.open("x", encoding="utf-8") as output:
        for sample in manifest["samples"]:
            if sample["split"] != args.split:
                continue
            started = time.monotonic()
            row = {"id": sample["id"], "split": sample["split"], "referenceKey": sample["referenceKey"],
                   "engine": "dsk-" + args.profile + "-cosine", "compression": args.compression,
                   "normalizeFrames": args.normalize_frames, "harmonicProfile": args.harmonic_profile}
            try:
                if hashlib.sha256(Path(sample["path"]).read_bytes()).hexdigest().upper() != sample["sha256"]:
                    raise ValueError("Checksum changed")
                decoded = subprocess.run([args.ffmpeg, "-nostdin", "-v", "error", "-threads", "1", "-i", sample["path"],
                    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120)
                audio = np.frombuffer(decoded.stdout, dtype="<f4")
                _, _, spectrum = stft(audio, fs=sr, window="blackman", nperseg=size, noverlap=3 * size // 4, boundary=None, padded=False)
                notes = filters @ np.abs(spectrum)
                notes = np.maximum(notes, 0) ** args.compression
                frames = notes.reshape(6, 12, -1).sum(axis=0)
                if args.normalize_frames:
                    frames /= np.maximum(frames.sum(axis=0, keepdims=True), 1e-12)
                chroma = frames.sum(axis=1)
                values = profiles @ (chroma / np.linalg.norm(chroma))
                best = values.argmax()
                row["key"] = (MAJOR + MINOR)[best]
                row["strength"] = float(values[best])
            except Exception as error:
                row["error"] = str(error)
                row["key"] = None
            row["elapsedSeconds"] = time.monotonic() - started
            output.write(json.dumps(row) + "\n")
            output.flush()
            print(f"{row['id']}: {row.get('key')}", flush=True)


if __name__ == "__main__":
    main()
