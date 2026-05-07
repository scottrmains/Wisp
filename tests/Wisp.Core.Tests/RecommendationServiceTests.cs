using Wisp.Core.Recommendations;
using Wisp.Core.Tracks;

namespace Wisp.Core.Tests;

public class RecommendationServiceTests
{
    private static Track T(string artist, string title, decimal? bpm = null, string? key = null,
        int? energy = null, string? genre = null) => new()
    {
        Id = Guid.NewGuid(),
        FilePath = $"C:/{artist} - {title}.mp3",
        FileName = $"{artist} - {title}.mp3",
        FileHash = Guid.NewGuid().ToString(),
        Artist = artist,
        Title = title,
        Bpm = bpm,
        MusicalKey = key,
        Energy = energy,
        Genre = genre,
    };

    private readonly RecommendationService _svc = new();

    [Fact]
    public void Same_track_attributes_score_max_in_each_dimension()
    {
        var seed = T("MK", "Burning", 126m, "8A", 7, "House");
        var same = T("MK", "Always", 126m, "8A", 7, "House");

        var s = _svc.Score(seed, same, RecommendationMode.Safe);

        Assert.Equal(30, s.KeyScore);
        Assert.Equal(30, s.BpmScore);
        Assert.Equal(20, s.EnergyScore);
        Assert.True(s.GenreScore > 0);
        Assert.Equal(10, s.Penalties); // same artist
    }

    [Fact]
    public void Adjacent_key_scores_25()
    {
        var seed = T("A", "x", key: "8A");
        var cand = T("B", "y", key: "9A");
        var s = _svc.Score(seed, cand, RecommendationMode.Safe);
        Assert.Equal(25, s.KeyScore);
    }

    [Fact]
    public void Missing_key_scores_zero_for_key()
    {
        var seed = T("A", "x", key: "8A");
        var cand = T("B", "y");
        var s = _svc.Score(seed, cand, RecommendationMode.Safe);
        Assert.Equal(0, s.KeyScore);
    }

    [Fact]
    public void EnergyUp_mode_ranks_plus_one_above_minus_two()
    {
        var seed = T("S", "x", 126m, "8A", 5);
        var up = T("U", "u", 126m, "8A", 7);   // +2
        var down = T("D", "d", 126m, "8A", 3); // -2

        var ranked = _svc.Rank(seed, [up, down], RecommendationMode.EnergyUp, limit: 10).ToList();

        Assert.Equal(2, ranked.Count);
        Assert.Equal(up.Id, ranked[0].Track.Id);
    }

    [Fact]
    public void EnergyDown_mode_inverts_preference()
    {
        var seed = T("S", "x", 126m, "8A", 7);
        var up = T("U", "u", 126m, "8A", 9);   // +2
        var down = T("D", "d", 126m, "8A", 5); // -2

        var ranked = _svc.Rank(seed, [up, down], RecommendationMode.EnergyDown, limit: 10).ToList();
        Assert.Equal(down.Id, ranked[0].Track.Id);
    }

    [Fact]
    public void Same_artist_penalty_applies()
    {
        var seed = T("Solomun", "x", 124m, "8A", 6);
        var sameArtist = T("Solomun", "y", 124m, "8A", 6);
        var differentArtist = T("Tale Of Us", "z", 124m, "8A", 6);

        var sScore = _svc.Score(seed, sameArtist, RecommendationMode.Safe);
        var dScore = _svc.Score(seed, differentArtist, RecommendationMode.Safe);

        Assert.True(sScore.Penalties > 0);
        Assert.Equal(0, dScore.Penalties);
        Assert.True(dScore.Total > sScore.Total);
    }

    [Fact]
    public void SameVibe_doubles_genre_weight()
    {
        var seed = T("A", "x", 124m, "8A", 6, "House");
        var cand = T("B", "y", 124m, "8A", 6, "House");

        var safeScore = _svc.Score(seed, cand, RecommendationMode.Safe).GenreScore;
        var vibeScore = _svc.Score(seed, cand, RecommendationMode.SameVibe).GenreScore;

        Assert.Equal(safeScore * 2, vibeScore);
    }

    [Fact]
    public void Rank_skips_seed_and_zero_score_candidates()
    {
        var seed = T("A", "x", 126m, "8A", 6);
        var unscoreable = T("Z", "z");           // no metadata → 0
        var distantKey = T("B", "y", 175m, "2A", 1);

        var ranked = _svc.Rank(seed, [seed, unscoreable, distantKey], RecommendationMode.Safe, limit: 10).ToList();
        Assert.DoesNotContain(ranked, x => x.Track.Id == seed.Id);
        Assert.DoesNotContain(ranked, x => x.Track.Id == unscoreable.Id);
    }

    [Fact]
    public void Reasons_describe_each_match()
    {
        var seed = T("MK", "Burning", 126m, "8A", 7, "House");
        var cand = T("Solomun", "Tales", 127m, "9A", 8, "House");

        var s = _svc.Score(seed, cand, RecommendationMode.Safe);

        Assert.Contains(s.Reasons, r => r.Contains("Adjacent key", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(s.Reasons, r => r.Contains("BPM diff", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(s.Reasons, r => r.Contains("Energy +1", StringComparison.OrdinalIgnoreCase));
    }
}
