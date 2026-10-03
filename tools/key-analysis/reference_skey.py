"""Read-only benchmark of the pinned official S-KEY checkpoint; never writes beside music."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

SKEY_COMMIT = "918b83d273568d5041569bb8068843d19a335726"
CHECKPOINT_SHA256 = "78DFD0AD4FA9434BF7CEC70A25934B7C575BDA9C80E994700140770AD3A5EAD4"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", choices=["development", "holdout"], required=True)
    args = parser.parse_args()
    commit = subprocess.check_output(["git", "-C", str(args.repository), "rev-parse", "HEAD"], text=True).strip()
    if commit != SKEY_COMMIT:
        raise ValueError("Unexpected S-KEY revision")
    subprocess.run(["git", "-C", str(args.repository), "diff", "--exit-code", "HEAD"], check=True)
    sys.path.insert(0, str(args.repository.resolve()))
    import torch
    import numpy as np
    from skey.key_detection import load_model_components, load_audio, infer_key
    torch.set_num_threads(4)
    checkpoint = args.repository / "skey" / "models" / "skey.pt"
    checkpoint_hash = hashlib.sha256(checkpoint.read_bytes()).hexdigest().upper()
    if checkpoint_hash != CHECKPOINT_SHA256:
        raise ValueError("Official checkpoint checksum changed")
    # Only the NumPy scalar types present in the pinned official checkpoint are allowlisted.
    # Never fall back to arbitrary pickle execution for an untrusted model.
    with torch.serialization.safe_globals([
        (np._core.multiarray.scalar, "numpy.core.multiarray.scalar"), np.dtype, np.dtypes.Float64DType
    ]):
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    device = torch.device("cpu")
    hcqt, chromanet, crop = load_model_components(state, device)
    sanity = args.repository / "tests" / "nocturne_n02_in_e-flat_major.mp3"
    if infer_key(hcqt, chromanet, crop, load_audio(str(sanity), state["audio"]["sr"]), device) != "D# Major":
        raise ValueError("Official checkpoint sanity fixture did not reproduce its expected key")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        for sample in manifest["samples"]:
            if sample["split"] != args.split:
                continue
            started = time.monotonic()
            row = {"id": sample["id"], "split": sample["split"], "referenceKey": sample["referenceKey"],
                   "engine": "official-skey", "commit": commit, "checkpointSha256": checkpoint_hash}
            try:
                path = Path(sample["path"])
                if hashlib.sha256(path.read_bytes()).hexdigest().upper() != sample["sha256"]:
                    raise ValueError("Source checksum changed")
                # The exact official decoder/resampler/normalizer and inference, not a chunk approximation.
                audio = load_audio(str(path), state["audio"]["sr"])
                row["key"] = infer_key(hcqt, chromanet, crop, audio, device)
                if row["key"] == "error":
                    raise ValueError("Official inference failed")
                if hashlib.sha256(path.read_bytes()).hexdigest().upper() != sample["sha256"]:
                    raise ValueError("Source checksum changed after inference")
            except Exception as error:
                row["error"] = str(error)
                row["key"] = None
            row["elapsedSeconds"] = time.monotonic() - started
            output.write(json.dumps(row) + "\n")
            output.flush()
            print(f"{row['id']}: {row.get('key')} ({row['elapsedSeconds']:.2f}s)", flush=True)


if __name__ == "__main__":
    main()
