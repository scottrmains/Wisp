using Wisp.Core.Cleanup;
using Wisp.Core.Tracks;

namespace Wisp.Core.Tests;

public class CleanupSuggestionServiceTests
{
    private readonly CleanupSuggestionService _svc = new();

    private static Track T(string filePath, string fileName, string? artist = null, string? title = null,
        string? version = null) => new()
    {
        Id = Guid.NewGuid(),
        FilePath = filePath,
        FileName = fileName,
        FileHash = "h",
        Artist = artist,
        Title = title,
        Version = version,
    };

    [Fact]
    public void Clean_track_yields_no_changes()
    {
        var t = T("C:/music/MK - Burning.mp3", "MK - Burning.mp3", "MK", "Burning");
        var s = _svc.Suggest(t);
        Assert.False(s.HasChanges);
        Assert.Empty(s.Changes);
        Assert.Equal(t.FileName, s.After.FileName);
    }

    [Fact]
    public void Strips_junk_from_artist_and_title()
    {
        var t = T("C:/music/x.mp3", "x.mp3",
            artist: "kim english 320kbps",
            title: "Nite Life [FREE DL]");
        var s = _svc.Suggest(t);

        Assert.True(s.HasChanges);
        Assert.Equal("Kim English", s.After.Artist);
        Assert.Equal("Nite Life", s.After.Title);
    }

    [Fact]
    public void Extracts_version_from_title_when_version_is_empty()
    {
        var t = T("C:/music/x.mp3", "x.mp3", "Kim English", "Nite Life (Bump Classic Mix)", version: null);
        var s = _svc.Suggest(t);

        Assert.Equal("Nite Life", s.After.Title);
        Assert.Equal("Bump Classic Mix", s.After.Version);
        Assert.Contains(s.Changes, c => c.Kind == CleanupChangeKind.ExtractVersion);
    }

    [Fact]
    public void Does_not_extract_version_when_already_set()
    {
        var t = T("C:/music/x.mp3", "x.mp3", "Kim English", "Nite Life (Bump Classic Mix)", version: "Manual Mix");
        var s = _svc.Suggest(t);
        Assert.Equal("Nite Life (Bump Classic Mix)", s.After.Title);
        Assert.Equal("Manual Mix", s.After.Version);
    }

    [Fact]
    public void Suggests_filename_rename_to_match_cleaned_metadata()
    {
        var t = T("C:/music/old name.mp3", "old name.mp3",
            artist: "Kim English",
            title: "Nite Life",
            version: "Bump Classic Mix");
        var s = _svc.Suggest(t);

        Assert.Equal("Kim English - Nite Life (Bump Classic Mix).mp3", s.After.FileName);
        Assert.EndsWith(s.After.FileName, s.After.FilePath);
        Assert.Contains(s.Changes, c => c.Kind == CleanupChangeKind.RenameFile);
    }

    [Fact]
    public void Idempotent_on_already_cleaned_input()
    {
        var t = T("C:/music/Kim English - Nite Life (Bump Classic Mix).mp3",
            "Kim English - Nite Life (Bump Classic Mix).mp3",
            artist: "Kim English",
            title: "Nite Life",
            version: "Bump Classic Mix");

        var first = _svc.Suggest(t);
        var sep = " | ";
        Assert.False(first.HasChanges, $"unexpected changes: {string.Join(sep, first.Changes.Select(c => c.Description))}");
    }
}
