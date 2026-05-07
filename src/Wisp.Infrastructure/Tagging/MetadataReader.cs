using System.Globalization;
using TagLib;
using TagLib.Id3v2;
using File = TagLib.File;
using Tag = TagLib.Tag;

namespace Wisp.Infrastructure.Tagging;

public interface IMetadataReader
{
    TrackMetadata Read(string filePath);
}

/// Reads embedded tags (TagLibSharp) with Mixed in Key compatibility:
///   - Camelot key from `INITIALKEY` (TKEY) — MiK writes "8A", "12B" etc.
///   - BPM from `TBPM`
///   - Energy from custom TXXX frames ("EnergyLevel", "ENERGY", "Mixed In Key - Energy")
///     or from comment field if formatted "Energy N"
/// Falls back to filename parsing for missing artist/title/version/year.
public class MetadataReader : IMetadataReader
{
    private static readonly string[] EnergyTxxxKeys =
    {
        "EnergyLevel",
        "ENERGY",
        "Mixed In Key - Energy",
        "Energy",
    };

    public TrackMetadata Read(string filePath)
    {
        File? file = null;
        try
        {
            file = File.Create(filePath);
        }
        catch (Exception)
        {
            return FromFilenameOnly(filePath, missing: true);
        }

        try
        {
            var tag = file.Tag;
            var props = file.Properties;

            string? artist = FirstNonEmpty(tag.JoinedPerformers, tag.FirstAlbumArtist);
            string? title = NullIfEmpty(tag.Title);
            string? album = NullIfEmpty(tag.Album);
            string? genre = NullIfEmpty(tag.FirstGenre);
            decimal? bpm = tag.BeatsPerMinute > 0 ? tag.BeatsPerMinute : null;
            string? key = NullIfEmpty(tag.InitialKey);
            int? year = tag.Year > 0 ? (int)tag.Year : null;
            int? energy = ReadEnergy(file);

            var parsed = FilenameParser.Parse(filePath);
            artist ??= parsed.Artist;
            title ??= parsed.Title;
            string? version = parsed.Version;
            year ??= parsed.Year;

            var missing = string.IsNullOrEmpty(artist) || string.IsNullOrEmpty(title);

            return new TrackMetadata
            {
                Artist = artist,
                Title = title,
                Version = version,
                Album = album,
                Genre = genre,
                Bpm = bpm,
                MusicalKey = key,
                Energy = energy,
                ReleaseYear = year,
                Duration = props?.Duration ?? TimeSpan.Zero,
                IsMissingMetadata = missing,
            };
        }
        finally
        {
            file.Dispose();
        }
    }

    private static int? ReadEnergy(File file)
    {
        // Mixed in Key: TXXX with description "EnergyLevel" (or several variants)
        if (file.GetTag(TagTypes.Id3v2, create: false) is TagLib.Id3v2.Tag id3)
        {
            foreach (var frame in id3.GetFrames<UserTextInformationFrame>())
            {
                if (!EnergyTxxxKeys.Contains(frame.Description, StringComparer.OrdinalIgnoreCase))
                    continue;
                var first = frame.Text.FirstOrDefault();
                if (TryParseEnergy(first, out var value))
                    return value;
            }
        }

        // Some tools write "Energy 7" into the comment field.
        var comment = file.Tag.Comment;
        if (!string.IsNullOrWhiteSpace(comment))
        {
            var idx = comment.IndexOf("Energy", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0 && TryParseEnergy(comment[(idx + 6)..], out var value))
                return value;
        }

        return null;
    }

    private static bool TryParseEnergy(string? raw, out int value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var trimmed = new string(raw.SkipWhile(c => !char.IsDigit(c)).TakeWhile(char.IsDigit).ToArray());
        if (!int.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return false;
        if (n is < 1 or > 10) return false;
        value = n;
        return true;
    }

    private static TrackMetadata FromFilenameOnly(string filePath, bool missing)
    {
        var parsed = FilenameParser.Parse(filePath);
        return new TrackMetadata
        {
            Artist = parsed.Artist,
            Title = parsed.Title,
            Version = parsed.Version,
            ReleaseYear = parsed.Year,
            IsMissingMetadata = missing || parsed.IsLowConfidence,
        };
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string? FirstNonEmpty(params string?[] candidates)
        => candidates.Select(NullIfEmpty).FirstOrDefault(s => s is not null);
}
