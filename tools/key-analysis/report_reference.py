"""Generate the auditable, path/audio-free committed report from local benchmark results."""
import argparse
import json
from pathlib import Path
from score_reference import score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.evaluation / "manifest.json").read_text(encoding="utf-8"))
    report = {"formatVersion": 1, "dataset": manifest["dataset"], "datasetCommit": manifest["datasetCommit"],
              "seed": manifest["seed"], "baselineCommit": "9cde4e7", "engine": "wisp-multiband-dsk-v3",
              "scoring": "MIREX since 2017, both fifth directions; failures/abstentions count as zero",
              "developmentUsedForSelection": True, "holdoutUsedForSelection": False,
              "summaries": {}, "samples": []}
    aligned = {}
    for name in ["wisp-v2", "wisp-v3", "skey"]:
        report["summaries"][name] = []
        aligned[name] = {}
        for split in ["development", "holdout"]:
            path = args.evaluation / f"{name}-{split}.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            report["summaries"][name].append(score(manifest, rows, split))
            aligned[name].update({row["id"]: row for row in rows})
    for sample in manifest["samples"]:
        report["samples"].append({"id": sample["id"], "split": sample["split"], "sha256": sample["sha256"],
                                 "referenceKey": sample["referenceKey"],
                                 "predictions": {name: rows[sample["id"]]["key"] for name, rows in aligned.items()}})
    reference = next(iter(aligned["skey"].values()))
    report["skeyCommit"] = reference["commit"]
    report["skeyCheckpointSha256"] = reference["checkpointSha256"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
