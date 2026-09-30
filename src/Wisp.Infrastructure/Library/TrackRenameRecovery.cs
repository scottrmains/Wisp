using System.Text;
using System.Text.RegularExpressions;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure.Library;

public sealed record RecoveryFile(string Path, string Hash, TrackMetadata Metadata);
public sealed record TrackRenameMatch(Track Track, RecoveryFile File, string Reason);
public sealed record TrackRenamePlan(IReadOnlyList<TrackRenameMatch> Matches, IReadOnlySet<string> AmbiguousPaths);

/// Conservative, one-to-one matching only. Never merge library rows or delete missing tracks.
/// Whole-file fingerprints change when DJ software writes tags, so recognise the specific
/// key/BPM filename suffix too, backed by duration and non-conflicting track metadata.
public static partial class TrackRenameRecovery
{
    [GeneratedRegex(@"(?: - (?:[1-9]|1[0-2])[AB] - \d+(?:\.\d+)?)+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AnalysisSuffix();

    [GeneratedRegex(@" - (?:[1-9]|1[0-2])[AB] - \d+(?:\.\d+)?(?=\s|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AnalysisInTitle();
    [GeneratedRegex(@"^\d{1,3}\s*[-.]\s+")]
    private static partial Regex TrackNumber();

    public static TrackRenamePlan Plan(IEnumerable<Track> missingTracks, IEnumerable<RecoveryFile> files)
    {
        var missing = missingTracks.ToArray();
        var edges = new List<TrackRenameMatch>();
        foreach (var file in files)
        foreach (var track in missing)
        {
            var reason = MatchReason(track, file);
            if (reason is not null) edges.Add(new(track, file, reason));
        }
        // Check BOTH directions before changing anything. Enumeration order must not
        // decide which of two copies or remixes inherits a track's prep.
        var byTrack = edges.GroupBy(e => e.Track.Id).ToDictionary(g => g.Key, g => g.Count());
        var byPath = edges.GroupBy(e => e.File.Path, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);
        var matches = edges.Where(e => byTrack[e.Track.Id] == 1 && byPath[e.File.Path] == 1).ToArray();
        var ambiguous = edges.Except(matches).Select(e => e.File.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return new(matches, ambiguous);
    }

    private static string? MatchReason(Track track, RecoveryFile file)
    {
        if (!string.Equals(Path.GetExtension(track.FilePath), Path.GetExtension(file.Path), StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.IsNullOrEmpty(track.FileHash) && track.FileHash == file.Hash) return "unchanged-file-fingerprint";
        // Retagged matches are confined to the original directory and require valid,
        // essentially identical durations. No fuzzy title matching across the library.
        if (!string.Equals(Path.GetDirectoryName(track.FilePath), Path.GetDirectoryName(file.Path), StringComparison.OrdinalIgnoreCase)
            || track.Duration <= TimeSpan.Zero || file.Metadata.Duration <= TimeSpan.Zero
            || Math.Abs((track.Duration - file.Metadata.Duration).TotalSeconds) > 0.15) return null;
        var oldName = Path.GetFileNameWithoutExtension(track.FilePath);
        var newName = Path.GetFileNameWithoutExtension(file.Path);
        var oldStem = AnalysisSuffix().Replace(oldName, "");
        var newStem = AnalysisSuffix().Replace(newName, "");
        var hasSuffix = oldStem != oldName || newStem != newName;
        var meta = file.Metadata;
        if (hasSuffix && Equal(oldStem, newStem)
            && Compatible(track.Artist, meta.Artist) && Compatible(Title(track.Title, track.Artist, track.Version), Title(meta.Title, meta.Artist, meta.Version))
            && Equal(track.Version, meta.Version)) return "analysis-suffix-and-duration";
        // Some MiK names are rebuilt from tags rather than the original filename.
        // Require full artist/title/version/album agreement, not just a similar title.
        if (hasSuffix && !string.IsNullOrWhiteSpace(track.Artist) && !string.IsNullOrWhiteSpace(track.Title)
            && Equal(track.Artist, meta.Artist) && Equal(Title(track.Title, track.Artist, track.Version), Title(meta.Title, meta.Artist, meta.Version))
            && Equal(track.Version, meta.Version) && Equal(track.Album, meta.Album))
            return "analysis-name-and-exact-metadata-duration";
        return null;
    }

    private static bool Equal(string? a, string? b) => string.Equals(
        a?.Trim().Normalize(NormalizationForm.FormC) ?? "", b?.Trim().Normalize(NormalizationForm.FormC) ?? "", StringComparison.OrdinalIgnoreCase);
    private static bool Compatible(string? a, string? b) => string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b) || Equal(a, b);

    private static string? Title(string? title, string? artist, string? version)
    {
        if (title is null) return null;
        var result = TrackNumber().Replace(AnalysisInTitle().Replace(title.Trim(), ""), "");
        if (!string.IsNullOrWhiteSpace(artist) && result.StartsWith(artist + " - ", StringComparison.OrdinalIgnoreCase))
            result = result[(artist.Length + 3)..];
        // Strip only the explicit, separately compared version, never arbitrary
        // brackets (which might distinguish a remix from the original).
        if (!string.IsNullOrWhiteSpace(version))
            while (result.EndsWith(" (" + version + ")", StringComparison.OrdinalIgnoreCase))
                result = result[..^(version.Length + 3)].TrimEnd();
        return result;
    }

    public static void Apply(TrackRenameMatch match)
    {
        var track = match.Track;
        var oldPath = track.FilePath;
        track.FilePath = match.File.Path;
        track.FileName = Path.GetFileName(match.File.Path);
        track.FileHash = match.File.Hash;
        track.FileModifiedAt = File.GetLastWriteTimeUtc(match.File.Path);
        track.LastScannedAt = DateTime.UtcNow;
        track.IsUnavailable = false;
        track.UnavailableSince = null;
        if (string.Equals(track.OriginalFilePath, oldPath, StringComparison.OrdinalIgnoreCase)) track.OriginalFilePath = track.FilePath;
        if (string.Equals(track.NormalizedFilePath, oldPath, StringComparison.OrdinalIgnoreCase)) track.NormalizedFilePath = track.FilePath;
        // Preserve curated text, notes, identity, dates and all dependent preparation.
        // Analysis metadata is the intended output of tools such as Mixed In Key.
        track.Bpm = match.File.Metadata.Bpm ?? track.Bpm;
        track.MusicalKey = match.File.Metadata.MusicalKey ?? track.MusicalKey;
        track.Energy = match.File.Metadata.Energy ?? track.Energy;
    }
}
