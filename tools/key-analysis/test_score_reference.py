import unittest
import json
from pathlib import Path
from score_reference import MAJOR, MINOR, parse, relation, score


class KeyScoringTests(unittest.TestCase):
    def test_all_camelot_codes_and_enharmonics(self):
        for mode, codes in [("major", MAJOR), ("minor", MINOR)]:
            for root, code in enumerate(codes):
                self.assertEqual((root, mode), parse(code.lower()))
        self.assertEqual(parse("D# Major"), parse("Eb major"))
        self.assertEqual(parse("C# minor"), parse("Db minor"))
        self.assertEqual(parse("Cb major"), parse("B major"))

    def test_mirex_weights_and_both_fifth_directions(self):
        cases = [("C major", "C major", "exact", 1),
                 ("C major", "G major", "fifth", .5),
                 ("C major", "F major", "fifth", .5),
                 ("A minor", "E minor", "fifth", .5),
                 ("C major", "A minor", "relative", .3),
                 ("A minor", "C major", "relative", .3),
                 ("C major", "C minor", "parallel", .2),
                 ("C minor", "C major", "parallel", .2),
                 ("C major", "G minor", "other", 0)]
        for reference, estimated, name, value in cases:
            self.assertEqual((name, value), relation(parse(reference), parse(estimated)))
        self.assertEqual(("missing", 0), relation(parse("C major"), None))

    def test_missing_failed_and_abstaining_predictions_stay_in_denominator(self):
        manifest = {"samples": [
            {"id": str(i), "referenceKey": "C major", "split": "holdout"} for i in range(4)]}
        rows = [{"id": "0", "referenceKey": "C major", "key": "8B", "elapsedSeconds": 1},
                {"id": "1", "referenceKey": "C major", "key": "8B", "error": "checksum changed", "elapsedSeconds": 1},
                {"id": "2", "referenceKey": "C major", "key": None, "elapsedSeconds": 1}]
        result = score(manifest, rows, "holdout")
        self.assertEqual(4, result["samples"])
        self.assertEqual(.25, result["exactAccuracy"])
        self.assertEqual(.25, result["mirexWeightedScore"])
        self.assertEqual(1, result["errors"])
        self.assertEqual(3, result["relations"]["missing"])

    def test_bad_alignment_or_reference_changes_fail_instead_of_silent_scoring(self):
        manifest = {"samples": [{"id": "x", "referenceKey": "C major", "split": "holdout"}]}
        row = {"id": "x", "referenceKey": "C major", "key": "8B", "elapsedSeconds": 1}
        for rows in [[row, row], [dict(row, id="y")], [dict(row, referenceKey="A minor")]]:
            with self.assertRaises(ValueError):
                score(manifest, rows, "holdout")

    def test_invalid_prediction_is_not_counted_as_a_near_match(self):
        for invalid in ["", "C", "13A", "C dorian", "9B major", "C! minor"]:
            with self.assertRaises((ValueError, IndexError)):
                parse(invalid)

    def test_committed_report_matches_its_individual_predictions(self):
        report = json.loads((Path(__file__).parent / "results" / "2026-10-03-giantsteps.json").read_text(encoding="utf-8"))
        self.assertEqual(96, len(report["samples"]))
        self.assertEqual(96, len({s["id"] for s in report["samples"]}))
        for name, summaries in report["summaries"].items():
            for summary in summaries:
                rows = [{"id": s["id"], "referenceKey": s["referenceKey"], "key": s["predictions"][name], "elapsedSeconds": 0}
                        for s in report["samples"] if s["split"] == summary["split"]]
                actual = score(report, rows, summary["split"])
                self.assertEqual(summary["samples"], actual["samples"])
                self.assertEqual(summary["relations"], actual["relations"])
                self.assertAlmostEqual(summary["exactAccuracy"], actual["exactAccuracy"])
                self.assertAlmostEqual(summary["mirexWeightedScore"], actual["mirexWeightedScore"])


if __name__ == "__main__":
    unittest.main()
