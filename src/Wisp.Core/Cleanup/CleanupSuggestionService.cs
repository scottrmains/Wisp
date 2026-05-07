using Wisp.Core.Tracks;

namespace Wisp.Core.Cleanup;

public class CleanupSuggestionService
{
    public CleanupSuggestion Suggest(Track track)
    {
        var before = SnapshotOf(track);
        var changes = new List<CleanupChange>();

        var artist = TrimOrNull(track.Artist);
        var title = TrimOrNull(track.Title);
        var version = TrimOrNull(track.Version);
        var album = TrimOrNull(track.Album);
        var genre = TrimOrNull(track.Genre);

        // 1) Strip junk + trim whitespace per field.
        artist = CleanField(artist, before.Artist, "artist", changes);
        title = CleanField(title, before.Title, "title", changes);
        version = CleanField(version, before.Version, "version", changes);
        album = CleanField(album, before.Album, "album", changes);
        genre = CleanField(genre, before.Genre, "genre", changes);

        // 2) Extract version from title if track has no Version yet and title looks like "X (Extended Mix)".
        if (string.IsNullOrEmpty(version) && !string.IsNullOrEmpty(title))
        {
            var (cleanedTitle, extracted) = NameNormalizer.ExtractVersion(title);
            if (extracted is not null && cleanedTitle != title)
            {
                changes.Add(new CleanupChange(
                    CleanupChangeKind.ExtractVersion,
                    "title",
                    $"Extract version “{extracted}” from title",
                    title,
                    cleanedTitle));
                changes.Add(new CleanupChange(
                    CleanupChangeKind.ExtractVersion,
                    "version",
                    $"Set version to “{extracted}”",
                    "",
                    extracted));
                title = cleanedTitle;
                version = extracted;
            }
        }

        // 3) Title-case each field.
        artist = TitleCaseField(artist, "artist", changes);
        title = TitleCaseField(title, "title", changes);
        version = TitleCaseField(version, "version", changes);
        album = TitleCaseField(album, "album", changes);
        genre = TitleCaseField(genre, "genre", changes);

        // 4) Compute target filename.
        var ext = Path.GetExtension(track.FilePath);
        var targetFileName = NameNormalizer.BuildFileName(artist, title, version, ext);
        if (!string.Equals(targetFileName, track.FileName, StringComparison.Ordinal))
        {
            changes.Add(new CleanupChange(
                CleanupChangeKind.RenameFile,
                "filename",
                "Rename file to match cleaned metadata",
                track.FileName,
                targetFileName));
        }

        var newPath = Path.Combine(Path.GetDirectoryName(track.FilePath) ?? "", targetFileName);
        var after = new TrackSnapshot(
            FilePath: newPath,
            FileName: targetFileName,
            Artist: artist,
            Title: title,
            Version: version,
            Album: album,
            Genre: genre);

        return new CleanupSuggestion(track.Id, before, after, changes);
    }

    public TrackSnapshot SnapshotOf(Track t) => new(
        t.FilePath,
        t.FileName,
        t.Artist,
        t.Title,
        t.Version,
        t.Album,
        t.Genre);

    // ─────────────────────────────────────────────────────────────────────

    private static string? CleanField(string? value, string? originalReference, string field, List<CleanupChange> changes)
    {
        if (string.IsNullOrEmpty(value)) return value;
        var stripped = NameNormalizer.StripJunk(value);
        if (string.Equals(stripped, value, StringComparison.Ordinal)) return value;

        // Differentiate "trim only" from "real strip".
        var kind = stripped.Length < value.Trim().Length
            ? CleanupChangeKind.StripJunk
            : CleanupChangeKind.TrimWhitespace;

        changes.Add(new CleanupChange(
            kind,
            field,
            kind == CleanupChangeKind.StripJunk
                ? $"Strip junk tokens from {field}"
                : $"Trim whitespace in {field}",
            originalReference ?? value,
            stripped));
        return stripped;
    }

    private static string? TitleCaseField(string? value, string field, List<CleanupChange> changes)
    {
        if (string.IsNullOrEmpty(value)) return value;
        var cased = NameNormalizer.TitleCase(value);
        if (string.Equals(cased, value, StringComparison.Ordinal)) return value;

        changes.Add(new CleanupChange(
            CleanupChangeKind.TitleCase,
            field,
            $"Title-case {field}",
            value,
            cased));
        return cased;
    }

    private static string? TrimOrNull(string? s)
    {
        if (s is null) return null;
        var t = s.Trim();
        return t.Length == 0 ? null : t;
    }
}
