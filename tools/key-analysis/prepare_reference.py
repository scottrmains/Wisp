"""Download a reproducible, checksum-verified GiantSteps benchmark into an ignored folder.

Audio remains outside Git. Labels come from the pinned upstream annotations, not file tags.
Run only when explicitly evaluating the analyser; this is not a CI/download dependency.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import random
import subprocess
import urllib.request

DATASET_COMMIT = "6bcd492c825ac9b8597bc650a5f6fd18b6c43d2b"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=96)
    parser.add_argument("--seed", type=int, default=20261003)
    args = parser.parse_args()
    commit = subprocess.check_output(["git", "-C", str(args.dataset), "rev-parse", "HEAD"], text=True).strip()
    if commit != DATASET_COMMIT:
        raise ValueError("Unexpected dataset revision; review and pin it before evaluating")
    labels = sorted((args.dataset / "annotations" / "key").glob("*.key"))
    if not 2 <= args.count <= len(labels):
        raise ValueError("Invalid sample count")
    random.Random(args.seed).shuffle(labels)
    selected = labels[:args.count]
    audio_dir = args.output / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    def download(item):
        index, label = item
        track_id = label.stem
        path = audio_dir / (track_id + ".mp3")
        md5 = (args.dataset / "md5" / (track_id + ".md5")).read_text().strip().split()[0]
        if not path.exists() or hashlib.md5(path.read_bytes()).hexdigest() != md5:
            # Fail rather than silently replacing an unavailable sample after looking at its prediction.
            request = urllib.request.Request(
                "https://www.cp.jku.at/datasets/giantsteps/backup/" + track_id + ".mp3",
                headers={"User-Agent": "WISP-key-benchmark/1"})
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read(10 * 1024 * 1024 + 1)
            if len(data) > 10 * 1024 * 1024 or hashlib.md5(data).hexdigest() != md5:
                raise ValueError("Invalid audio checksum/size: " + track_id)
            path.write_bytes(data)
        print(f"[{index + 1}/{args.count}] verified {track_id}", flush=True)
        return {"id": track_id, "path": str(path.resolve()), "referenceKey": label.read_text().strip(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest().upper(),
                "split": "development" if index < args.count // 2 else "holdout"}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        samples = list(pool.map(download, enumerate(selected)))
    manifest = {"formatVersion": 1, "dataset": "GiantSteps key", "datasetCommit": commit,
                "seed": args.seed, "samples": samples}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
