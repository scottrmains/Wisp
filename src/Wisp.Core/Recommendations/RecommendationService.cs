using Wisp.Core.Music;
using Wisp.Core.Tracks;

namespace Wisp.Core.Recommendations;

public class RecommendationService
{
    public RecommendationScore Score(Track seed, Track candidate, RecommendationMode mode)
    {
        var reasons = new List<string>();

        var keyScore = ScoreKey(seed, candidate, reasons);
        var bpmScore = ScoreBpm(seed, candidate, reasons);
        var energyScore = ScoreEnergy(seed, candidate, mode, reasons);
        var genreScore = ScoreGenre(seed, candidate, mode, reasons);
        var penalties = Penalties(seed, candidate, reasons);

        var total = keyScore + bpmScore + energyScore + genreScore - penalties;
        return new RecommendationScore(total, keyScore, bpmScore, energyScore, genreScore, penalties, reasons);
    }

    /// Score every candidate against the seed, drop the seed itself,
    /// drop unscoreable rows (no key + no BPM), sort high → low, take N.
    public IEnumerable<(Track Track, RecommendationScore Score)> Rank(
        Track seed,
        IEnumerable<Track> candidates,
        RecommendationMode mode,
        int limit)
    {
        return candidates
            .Where(c => c.Id != seed.Id)
            .Select(c => (Track: c, Score: Score(seed, c, mode)))
            .Where(x => x.Score.Total > 0)
            .OrderByDescending(x => x.Score.Total)
            .Take(limit);
    }

    // --- key ---

    private static int ScoreKey(Track seed, Track candidate, List<string> reasons)
    {
        if (!Camelot.TryParse(seed.MusicalKey, out var s) || !Camelot.TryParse(candidate.MusicalKey, out var c))
            return 0;

        var rel = s.RelationTo(c);
        var (points, reason) = rel switch
        {
            KeyRelation.SameKey => (30, $"Same key ({s.Code})"),
            KeyRelation.Adjacent => (25, $"Adjacent key ({s.Code} → {c.Code})"),
            KeyRelation.RelativeMajorMinor => (20, $"Relative major/minor ({s.Code} ↔ {c.Code})"),
            KeyRelation.Creative => (10, $"Creative key change ({s.Code} → {c.Code})"),
            _ => (0, ""),
        };

        if (points > 0) reasons.Add(reason);
        return points;
    }

    // --- bpm ---

    private static int ScoreBpm(Track seed, Track candidate, List<string> reasons)
    {
        if (seed.Bpm is not { } sBpm || candidate.Bpm is not { } cBpm) return 0;

        var bpmScore = BpmCompatibility.Score(sBpm, cBpm);
        if (bpmScore.Points == 0) return 0;

        var reason = bpmScore.Relation switch
        {
            BpmRelation.Same when bpmScore.EffectiveDistance < 0.5m => $"Same BPM ({sBpm:0.#})",
            BpmRelation.Same => $"BPM diff {bpmScore.EffectiveDistance:0.#} ({sBpm:0.#} ↔ {cBpm:0.#})",
            BpmRelation.Half => $"Half-time ({sBpm:0.#} vs {cBpm:0.#})",
            BpmRelation.Double => $"Double-time ({sBpm:0.#} vs {cBpm:0.#})",
            _ => "",
        };

        reasons.Add(reason);
        return bpmScore.Points;
    }

    // --- energy ---

    private static int ScoreEnergy(Track seed, Track candidate, RecommendationMode mode, List<string> reasons)
    {
        if (seed.Energy is not { } se || candidate.Energy is not { } ce) return 0;
        var delta = ce - se;

        var points = mode switch
        {
            RecommendationMode.Safe => delta switch
            {
                0 => 20,
                1 or -1 => 15,
                2 or -2 => 8,
                _ => 0,
            },
            RecommendationMode.EnergyUp => delta switch
            {
                1 or 2 => 20,
                3 => 12,
                0 => 8,
                _ => 0,
            },
            RecommendationMode.EnergyDown => delta switch
            {
                -1 or -2 => 20,
                -3 => 12,
                0 => 8,
                _ => 0,
            },
            RecommendationMode.SameVibe => delta switch
            {
                0 => 20,
                1 or -1 => 15,
                2 or -2 => 8,
                _ => 0,
            },
            RecommendationMode.Creative => Math.Abs(delta) switch
            {
                <= 1 => 12,
                <= 3 => 10,
                _ => 4,
            },
            RecommendationMode.Wildcard => 5,
            _ => 0,
        };

        if (points > 0)
        {
            var label = delta switch
            {
                0 => $"Same energy ({se})",
                > 0 => $"Energy +{delta} ({se} → {ce})",
                _ => $"Energy {delta} ({se} → {ce})",
            };
            reasons.Add(label);
        }
        return points;
    }

    // --- genre ---

    private static int ScoreGenre(Track seed, Track candidate, RecommendationMode mode, List<string> reasons)
    {
        var weight = mode == RecommendationMode.SameVibe ? 2 : 1;

        var sTokens = TokenizeGenre(seed.Genre);
        var cTokens = TokenizeGenre(candidate.Genre);
        if (sTokens.Count == 0 || cTokens.Count == 0) return 0;

        var overlap = sTokens.Intersect(cTokens, StringComparer.OrdinalIgnoreCase).Count();
        if (overlap == 0) return 0;

        var ratio = (double)overlap / Math.Max(sTokens.Count, cTokens.Count);
        var basePoints = ratio switch
        {
            >= 1.0 => 10,
            >= 0.5 => 7,
            _ => 4,
        };

        var points = basePoints * weight;
        reasons.Add($"Genre match ({string.Join(", ", sTokens.Intersect(cTokens, StringComparer.OrdinalIgnoreCase))})");
        return points;
    }

    private static IReadOnlyCollection<string> TokenizeGenre(string? genre)
    {
        if (string.IsNullOrWhiteSpace(genre)) return [];
        return genre
            .Split([' ', ',', ';', '/', '|', '\\'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(t => t.Length > 1)
            .Select(t => t.ToLowerInvariant())
            .Distinct()
            .ToArray();
    }

    // --- penalties ---

    private static int Penalties(Track seed, Track candidate, List<string> reasons)
    {
        var penalty = 0;
        if (!string.IsNullOrWhiteSpace(seed.Artist) &&
            string.Equals(seed.Artist, candidate.Artist, StringComparison.OrdinalIgnoreCase))
        {
            penalty += 10;
            reasons.Add($"Same artist ({seed.Artist})");
        }
        return penalty;
    }
}
