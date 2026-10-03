# Key detection: independent evaluation

WISP's production detector is `wisp-multiband-dsk-v3`. It uses an independently
implemented [published direct spectral kernel](https://www.ibrahimshaath.co.uk/keyfinder/KeyFinder.pdf)
and Sha'ath's empirical major/minor profiles, with square-root note compression
and equal-level frame aggregation selected on the development sample. It does
not incorporate the GPL KeyFinder/AGPL Essentia implementations or their source.
This is a practical DSP detector, not a claimed reproduction of all KeyFinder
behaviour or a commercial-quality guarantee. The existing NAudio FFT is reused;
there are no new runtime packages, Python installation, network calls or models.

The end-to-end reference is the official [S-KEY implementation/checkpoint](https://github.com/deezer/skey),
not a hand-written approximation. Its upstream E-flat fixture must pass before
evaluation. The reference uses upstream decoding, resampling, peak normalisation
and whole-song inference on CPU. WISP uses its existing streaming FFmpeg decoder.
The MIT code and the weights' proprietary-app redistribution question are tracked
separately; [upstream issue #5](https://github.com/deezer/skey/issues/5) was unanswered
on 2026-10-03. No S-KEY code/checkpoint is bundled with the app or copied into Git.
Do not redistribute a checkpoint until permission is settled. Evaluation is local
and optional; it is not part of CI, installer creation or the customer's workflow.

## Frozen sample and results

The labels are from the [GiantSteps key annotations](https://github.com/GiantSteps/giantsteps-key-dataset),
not Mixed In Key, WISP metadata or filenames. Dataset revision and audio MD5s are
pinned; downloads are also SHA-256 checked before and after each analysis.
Python's deterministic seed `20261003` shuffles the sorted annotations: first
48 development, next 48 holdout. No sample is substituted because of a poor
prediction or decoder failure. Development was used to select the candidate;
holdout was opened only after production decision logic was fixed. Subsequent
work must treat BOTH splits as regression data and allocate a new unseen holdout.

| Split | Previous WISP exact | New WISP exact | Official S-KEY exact |
| --- | --- | --- | --- |
| Development | 19/48 (39.6%) | 29/48 (60.4%) | 32/48 (66.7%) |
| Unseen holdout | 21/48 (43.8%) | 31/48 (64.6%) | 34/48 (70.8%) |

The [auditable report](results/2026-10-03-giantsteps.json) includes IDs, labels,
checksums, predictions and relation counts, without audio or private paths.
Held-out MIREX weighted scores are 0.5146 / 0.7292 / 0.7500 respectively. MIREX
awards partial credit to related keys; it is NOT exact accuracy. Scoring follows
[mir_eval's post-2017 specification](https://mir-evaluation.github.io/mir_eval/#mir_eval.key.weighted_score):
exact 1, either-direction fifth 0.5, relative 0.3, parallel 0.2, other 0.
Null, failed and missing predictions remain in the denominator. No decoder errors
occurred in this sample; previous WISP abstained on one development track.

Local mean key-only end-to-end times on the held-out two-minute previews:
previous WISP 0.120s, new WISP 0.448s, S-KEY 1.303s. These are this machine's
measurements, not a portable performance promise. The sample is small and covers
EDM previews rather than full old vinyl rips, ambiguous modes or long mixes;
these results do not establish parity with Mixed In Key/rekordbox. All WISP keys
remain explicitly reviewed suggestions. Profile similarity/section agreement
are not probabilities of correctness. Existing metadata/cues are preserved.

## Reproduce (PowerShell, repository root)

All audio, cloned reference code, virtual environments and raw results belong
under ignored `artifacts/key-reference`, never in Git or the music library.
The archive is downloaded only when you explicitly run the preparation command.

```powershell
git clone https://github.com/GiantSteps/giantsteps-key-dataset artifacts/key-reference/giantsteps
git -C artifacts/key-reference/giantsteps checkout 6bcd492c825ac9b8597bc650a5f6fd18b6c43d2b
python tools/key-analysis/prepare_reference.py --dataset artifacts/key-reference/giantsteps --output artifacts/key-reference/evaluation

dotnet run --project tools/Wisp.MusicAnalysisBenchmark -- --manifest artifacts/key-reference/evaluation/manifest.json --ffmpeg tools/ffmpeg/ffmpeg.exe --split development --output artifacts/key-reference/evaluation/wisp-v3-development.jsonl
# Only after freezing decisions, run --split holdout with a new output filename.
python tools/key-analysis/score_reference.py --manifest artifacts/key-reference/evaluation/manifest.json --results artifacts/key-reference/evaluation/wisp-v3-development.jsonl --split development
```

Reference environment used: Python 3.13, torch/torchaudio 2.7.1+cpu, numpy 2.2.6,
scipy 1.15.3, einops 0.8.1, nnAudio 0.3.3, soundfile 0.13.1, tqdm 4.67.1.

```powershell
git clone https://github.com/deezer/skey artifacts/key-reference/skey
git -C artifacts/key-reference/skey checkout 918b83d273568d5041569bb8068843d19a335726
python -m venv artifacts/key-reference/venv
$keyPython = 'artifacts/key-reference/venv/Scripts/python.exe'
& $keyPython -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cpu
& $keyPython -m pip install numpy==2.2.6 scipy==1.15.3 einops==0.8.1 nnAudio==0.3.3 soundfile==0.13.1 tqdm==4.67.1
& $keyPython tools/key-analysis/reference_skey.py --repository artifacts/key-reference/skey --manifest artifacts/key-reference/evaluation/manifest.json --split development --output artifacts/key-reference/evaluation/skey-development.jsonl
```

The reference loader restricts checkpoint deserialisation to tensors and the
specific NumPy scalar types used upstream. It verifies the commit, clean source,
checkpoint SHA-256 and sanity fixture, rather than running arbitrary pickle code.
It calls the upstream single-file functions; do NOT call upstream `detect_key`
on your music directory, as its batch command writes predictions beside audio.
Raw output files use create-new semantics to prevent accidental replacement.

For a previous-WISP comparison, run the same `ReferenceBenchmark.cs` against the
Infrastructure project in a separate clean checkout of `9cde4e7`; never revert
your active feature work or mutate the library. Outputs explicitly identify the
engine. The committed report was generated with `report_reference.py` from those
six JSONL runs. `prototype_dsk.py` is a research aid, NOT the production detector:
NumPy/NAudio float FFTs and end-frame handling can yield different close decisions.
Development experiments: raw Krumhansl 22/48, raw Sha'ath 22/48, normalised Sha'ath
25/48, overtone-adjusted profiles 16/48 (rejected), compressed/normalised Sha'ath
30/48 in NumPy, 29/48 in final C#. No holdout tuning was performed.

CI only builds the read-only C# tool and runs the dependency-free scoring tests:

```powershell
python -m unittest discover -s tools/key-analysis -p 'test_*.py'
```

## Read-only reported-track checks (not accuracy labels)

Take Me Away (Pin-Up Girls remix): previous 9B → new 11A, alternative 8A,
21% section agreement, explicit disagreement. Official S-KEY returns A minor
(8A), matching the owner's tag/Mixed In Key comparison. WISP does not yet agree
on its primary key; this individual discrepancy is NOT declared solved.

Keep On: previous 9A → new 1A, S-KEY B minor (10A), owner's reference 9A.
This is an unresolved disagreement, not evidence that the tag is wrong. Its
125.00 BPM is unchanged. Pasion: WISP and S-KEY F minor (4A); 128.00 BPM and
the existing recoverable-packet warning are unchanged. SHA-256s on all three
source files are unchanged. No labels were applied to the owner's database.
