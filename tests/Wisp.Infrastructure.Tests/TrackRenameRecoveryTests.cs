using Wisp.Core.Tracks;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure.Tests;

public sealed class TrackRenameRecoveryTests
{
    private static string PathFor(string name, string folder = "music") => Path.Combine(Path.GetTempPath(), folder, name);
    private static Track Original() => new()
    {
        Id = Guid.NewGuid(), FilePath = PathFor("Artist - Track (Dub).mp3"), FileHash = "old-hash",
        Artist = "Artist", Title = "Track", Version = "Dub", Album = "Album", Duration = TimeSpan.FromSeconds(300),
        AddedAt = new DateTime(2020, 1, 1), Notes = "Keep", Bpm = 120, MusicalKey = "1A", IsUnavailable = true
    };
    private static RecoveryFile Renamed() => new(PathFor("Artist - Track (Dub) - 8A - 123.mp3"), "new-tags-hash", new()
    { Artist = "Artist", Title = "Track", Version = "Dub", Album = "Album", Duration = TimeSpan.FromSeconds(300), Bpm = 123, MusicalKey = "8A" });

    [Fact]
    public void Retagged_analysis_suffix_matches_and_preserves_curated_identity()
    {
        var track = Original(); var id = track.Id;
        track.OriginalFilePath = track.FilePath;
        track.NormalizedFilePath = PathFor("normalized.wav");
        var match = Assert.Single(TrackRenameRecovery.Plan([track], [Renamed()]).Matches);
        TrackRenameRecovery.Apply(match);
        Assert.Equal(id, track.Id); Assert.Equal("Keep", track.Notes); Assert.Equal(2020, track.AddedAt.Year);
        Assert.Equal("Track", track.Title); Assert.Equal("Dub", track.Version);
        Assert.Equal(123, track.Bpm); Assert.Equal("8A", track.MusicalKey);
        Assert.Equal(track.FilePath, track.OriginalFilePath); Assert.Equal(PathFor("normalized.wav"), track.NormalizedFilePath);
        Assert.False(track.IsUnavailable);
    }

    [Fact]
    public void Unchanged_hash_can_recover_a_move_without_metadata()
    {
        var file = Renamed() with { Path = PathFor("arbitrary.mp3", "elsewhere"), Hash = "old-hash", Metadata = new() };
        Assert.Single(TrackRenameRecovery.Plan([Original()], [file]).Matches);
    }

    [Fact]
    public void Two_possible_files_never_choose_by_enumeration_order()
    {
        var a = Renamed(); var b = a with { Path = PathFor("Artist - Track (Dub) - 9A - 123.mp3") };
        foreach (var files in new[] { new[] { a, b }, new[] { b, a } })
        {
            var plan = TrackRenameRecovery.Plan([Original()], files);
            Assert.Empty(plan.Matches); Assert.Equal(2, plan.AmbiguousPaths.Count);
        }
    }

    [Fact]
    public void Two_missing_rows_cannot_claim_the_same_file()
    {
        var plan = TrackRenameRecovery.Plan([Original(), Original()], [Renamed()]);
        Assert.Empty(plan.Matches); Assert.Single(plan.AmbiguousPaths);
    }

    [Theory]
    [InlineData("duration")]
    [InlineData("zero-duration")]
    [InlineData("version")]
    [InlineData("artist")]
    [InlineData("title")]
    [InlineData("folder")]
    [InlineData("extension")]
    [InlineData("no-analysis-suffix")]
    public void Does_not_guess_at_conflicting_or_insufficient_evidence(string conflict)
    {
        var file = Renamed();
        file = conflict switch
        {
            "duration" => file with { Metadata = file.Metadata with { Duration = TimeSpan.FromSeconds(301) } },
            "zero-duration" => file with { Metadata = file.Metadata with { Duration = TimeSpan.Zero } },
            "version" => file with { Metadata = file.Metadata with { Version = "Radio edit" } },
            "artist" => file with { Metadata = file.Metadata with { Artist = "Someone else" } },
            "title" => file with { Metadata = file.Metadata with { Title = "Another track" } },
            "folder" => file with { Path = PathFor(Path.GetFileName(file.Path), "elsewhere") },
            "extension" => file with { Path = Path.ChangeExtension(file.Path, ".flac") },
            _ => file with { Path = PathFor("Arbitrary new name.mp3") }
        };
        Assert.Empty(TrackRenameRecovery.Plan([Original()], [file]).Matches);
    }

    [Theory]
    [InlineData("Artist - Track (Dub)")]
    [InlineData("Track (Dub) (Dub)")]
    [InlineData("01 - Track")]
    [InlineData("Track - 1A - 120 (Dub)")]
    public void Recognises_explicit_title_decorations_without_fuzzy_remix_matching(string title)
    {
        var file = Renamed() with { Metadata = Renamed().Metadata with { Title = title } };
        Assert.Single(TrackRenameRecovery.Plan([Original()], [file]).Matches);
    }

    [Fact]
    public void Tag_rebuilt_filename_needs_album_agreement()
    {
        var file = Renamed() with { Path = PathFor("Rebuilt from tags - 8A - 123.mp3") };
        Assert.Single(TrackRenameRecovery.Plan([Original()], [file]).Matches);
        Assert.Empty(TrackRenameRecovery.Plan([Original()], [file with { Metadata = file.Metadata with { Album = "Different album" } }]).Matches);
    }
}
