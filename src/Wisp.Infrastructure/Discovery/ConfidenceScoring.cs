using Wisp.Infrastructure.ArtistRefresh;

namespace Wisp.Infrastructure.Discovery;

public sealed record ScoreInputs(
    string? DiscoveredArtist,
    string? DiscoveredTitle,
    string? DiscoveredVersion,
    int? DiscoveredYear,
    string CandidateArtist,
    string CandidateTitle,
    string? CandidateVersion,
    string? CandidateLabel,
    int? CandidateYear);

/// Score per spec §9 Phase 9c: artist 40, title 40, version 20, year 10, label 10,
/// duration 10 (skipped — we don't have durations on Discogs releases). Penalties for
/// different version (-20) and different artist (-40).
/// Bands: 90+ Strong, 70+ Possible, 50+ Weak, <50 Ignore.
public static class ConfidenceScoring
{
    public static int Score(ScoreInputs s)
    {
        var score = 0;

        var dArtist = ArtistNormalizer.Normalize(s.DiscoveredArtist ?? "");
        var cArtist = ArtistNormalizer.Normalize(s.CandidateArtist);
        if (!string.IsNullOrEmpty(dArtist) && !string.IsNullOrEmpty(cArtist))
        {
            if (dArtist == cArtist) score += 40;
            else score -= 40; // different artist penalty
        }

        var dTitle = TitleOverlap.Normalize(s.DiscoveredTitle ?? "");
        var cTitle = TitleOverlap.Normalize(s.CandidateTitle);
        if (!string.IsNullOrEmpty(dTitle) && !string.IsNullOrEmpty(cTitle))
        {
            if (dTitle == cTitle) score += 40;
            // Don't penalize partial title mismatch — different versions of the same track will have different title-with-bracket strings before normalization.
        }

        var dVer = TitleOverlap.Normalize(s.DiscoveredVersion ?? "");
        var cVer = TitleOverlap.Normalize(s.CandidateVersion ?? "");
        if (!string.IsNullOrEmpty(dVer) && !string.IsNullOrEmpty(cVer))
        {
            if (dVer == cVer) score += 20;
            else score -= 20; // different version penalty
        }
        else if (!string.IsNullOrEmpty(dVer) || !string.IsNullOrEmpty(cVer))
        {
            // One side has a version, the other doesn't — half-credit for ambiguity.
            score += 5;
        }

        if (s.DiscoveredYear.HasValue && s.CandidateYear.HasValue)
        {
            var diff = Math.Abs(s.DiscoveredYear.Value - s.CandidateYear.Value);
            if (diff == 0) score += 10;
            else if (diff == 1) score += 6;
            else if (diff <= 3) score += 3;
        }

        if (!string.IsNullOrEmpty(s.CandidateLabel) && !string.IsNullOrEmpty(s.DiscoveredTitle) &&
            s.DiscoveredTitle.Contains(s.CandidateLabel, StringComparison.OrdinalIgnoreCase))
        {
            score += 10;
        }

        return score;
    }
}
