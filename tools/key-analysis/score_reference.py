"""Score manifest-aligned predictions. Null, failed and missing predictions count as incorrect.

MIREX weighting since 2017: both fifth directions, relative/parallel minor; not accuracy.
Specification: https://mir-evaluation.github.io/mir_eval/#mir_eval.key.weighted_score
"""
import argparse
import collections
import json
from pathlib import Path

MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]
NOTES = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def parse(value):
    if value is None:
        return None
    if value.upper() in MAJOR:
        return MAJOR.index(value.upper()), "major"
    if value.upper() in MINOR:
        return MINOR.index(value.upper()), "minor"
    parts = value.lower().replace("♯", "#").replace("♭", "b").split()
    if len(parts) != 2 or parts[1] not in ("major", "minor") or parts[0][0] not in NOTES:
        raise ValueError("Invalid key: " + value)
    root = parts[0]
    accidentals = root[1:]
    if any(c not in "#b" for c in accidentals):
        raise ValueError("Invalid note: " + root)
    return (NOTES[root[0]] + accidentals.count("#") - accidentals.count("b")) % 12, parts[1]


def relation(reference, estimated):
    if estimated is None:
        return "missing", 0.0
    if reference == estimated:
        return "exact", 1.0
    interval = (estimated[0] - reference[0]) % 12
    if reference[1] == estimated[1] and interval in (5, 7):
        return "fifth", 0.5
    if reference[1] != estimated[1]:
        if interval == (9 if reference[1] == "major" else 3):
            return "relative", 0.3
        if interval == 0:
            return "parallel", 0.2
    return "other", 0.0


def score(manifest, rows, split):
    by_id = {}
    for row in rows:
        if row["id"] in by_id:
            raise ValueError("Duplicate prediction: " + row["id"])
        by_id[row["id"]] = row
    samples = [s for s in manifest["samples"] if s["split"] == split]
    if set(by_id) - {s["id"] for s in samples}:
        raise ValueError("Unexpected predictions outside selected split")
    counts = collections.Counter()
    total = 0.0
    for sample in samples:
        row = by_id.get(sample["id"], {})
        if row and row["referenceKey"] != sample["referenceKey"]:
            raise ValueError("Reference changed: " + sample["id"])
        name, value = relation(parse(sample["referenceKey"]), None if row.get("error") else parse(row.get("key")))
        counts[name] += 1
        total += value
    return {"split": split, "samples": len(samples), "relations": dict(sorted(counts.items())),
            "exactAccuracy": counts["exact"] / len(samples), "mirexWeightedScore": total / len(samples),
            "errors": sum(bool(r.get("error")) for r in rows),
            "meanSeconds": sum(r["elapsedSeconds"] for r in rows) / len(rows) if rows else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--split", choices=["development", "holdout"], required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in args.results.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(json.dumps(score(manifest, rows, args.split), indent=2))


if __name__ == "__main__":
    main()
