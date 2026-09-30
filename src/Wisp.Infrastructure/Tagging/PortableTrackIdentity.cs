using System.Text.Json;
using TagLib.Id3v2;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.FileSystem;
using File = System.IO.File;

namespace Wisp.Infrastructure.Tagging;

public sealed record PortableIdentity(Guid? TrackId, string AudioHash, bool Conflict = false);

/// Embedded IDs locate a logical track; the independently calculated audio fingerprint
/// verifies it. Sidecars are an alternative locator, never proof by filename alone.
public sealed class PortableTrackIdentity(AudioContentFingerprint audio, IFileFingerprint bytes)
{
    public const string Field = "WISP_TRACK_ID";
    public const string SidecarSuffix = ".wisp-id.json";
    public bool IsAvailable => audio.IsAvailable;
    private sealed record Sidecar(int Version, Guid TrackId, string AudioHash);

    public async Task<PortableIdentity> ReadAsync(string path, CancellationToken ct)
    {
        var hash = await audio.ComputeAsync(path, ct);
        var raw = ReadTag(path);
        var invalid = raw is not null && (!Guid.TryParse(raw, out var parsed) || parsed == Guid.Empty);
        Guid? embedded = Guid.TryParse(raw, out var id) && id != Guid.Empty ? id : null;
        Guid? sidecarId = null;
        if (File.Exists(path + SidecarSuffix))
        {
            try
            {
                var info = new FileInfo(path + SidecarSuffix);
                if (info.Length > 4096) return new(embedded, hash, true);
                var record = JsonSerializer.Deserialize<Sidecar>(await File.ReadAllTextAsync(info.FullName, ct));
                if (record is null || record.Version != 1 || record.TrackId == Guid.Empty || record.AudioHash != hash) invalid = true;
                else sidecarId = record.TrackId;
            }
            catch (JsonException) { invalid = true; }
        }
        return new(embedded ?? sidecarId, hash, invalid || (embedded.HasValue && sidecarId.HasValue && embedded != sidecarId));
    }

    public async Task EnsureAsync(Track track, CancellationToken ct)
    {
        var path = track.FilePath;
        var currentBytes = await bytes.ComputeAsync(path, ct);
        var unchanged = track.IdentityFileHash == currentBytes && track.FileModifiedAt == File.GetLastWriteTimeUtc(path);
        if (unchanged && track.AudioContentHash is not null
            && track.IdentityStorage == "embedded" && !File.Exists(path + SidecarSuffix)) return;
        if (unchanged && track.IdentityStorage == "sidecar" && File.Exists(path + SidecarSuffix))
        {
            var info = new FileInfo(path + SidecarSuffix);
            if (info.Length <= 4096)
            {
                try
                {
                    var cached = JsonSerializer.Deserialize<Sidecar>(await File.ReadAllTextAsync(info.FullName, ct));
                    if (cached?.Version == 1 && cached.TrackId == track.Id && cached.AudioHash == track.AudioContentHash) return;
                }
                catch (JsonException) { /* Full verification below reports a conflicting sidecar. */ }
            }
        }
        var identity = await ReadAsync(path, ct);
        if (identity.Conflict || identity.TrackId is { } owner && owner != track.Id
            || track.AudioContentHash is { } expected && expected != identity.AudioHash)
            throw new IOException("Track identity conflicts with the audio or another WISP track. Use explicit relink after reviewing the file.");
        var storage = "embedded";
        if (ReadTag(path) != track.Id.ToString("D"))
        {
            // Existing normalisation hashes refer to source bytes. Use a sidecar to
            // preserve those validators, and for formats not tested for safe tag writes.
            var embed = CanEmbed(path) && track.NormalizedFilePath is null && track.LoudnessAnalysisJson is null
                && (File.GetAttributes(path) & (FileAttributes.ReadOnly | FileAttributes.ReparsePoint)) == 0;
            if (embed)
            {
                try { await EmbedAsync(path, track.Id, currentBytes, identity.AudioHash, ct); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or TagLib.UnsupportedFormatException or TagLib.CorruptFileException)
                {
                    if (await bytes.ComputeAsync(path, ct) != currentBytes) throw new IOException("Source changed during identity initialisation.", ex);
                    storage = "sidecar";
                }
            }
            else storage = "sidecar";
            if (storage == "sidecar")
            {
                try { await WriteSidecarAsync(path, track.Id, identity.AudioHash, ct); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                { storage = "database"; } // A read-only library still retains its audio fingerprint.
            }
        }
        track.AudioContentHash = identity.AudioHash;
        track.Duration = new MetadataReader().Read(path).Duration;
        track.IdentityStorage = storage;
        track.IdentityFileHash = track.FileHash = await bytes.ComputeAsync(path, ct);
        track.FileModifiedAt = File.GetLastWriteTimeUtc(path);
    }

    private static bool CanEmbed(string path) => Path.GetExtension(path).ToLowerInvariant() is ".mp3" or ".flac" or ".m4a" or ".aiff" or ".aif";

    private static string? ReadTag(string path)
    {
        using var file = TagLib.File.Create(path);
        return TagValue(file, false);
    }

    private static string? TagValue(TagLib.File file, bool create, string? value = null)
    {
        var ext = Path.GetExtension(file.Name).ToLowerInvariant();
        if (ext == ".flac" && file.GetTag(TagLib.TagTypes.Xiph, create) is TagLib.Ogg.XiphComment xiph)
        {
            if (value is not null) xiph.SetField(Field, new[] { value });
            var values = xiph.GetField(Field);
            return values.Length > 1 ? "invalid-multiple-ids" : values.SingleOrDefault();
        }
        if (ext == ".m4a" && file.GetTag(TagLib.TagTypes.Apple, create) is TagLib.Mpeg4.AppleTag apple)
        {
            if (value is not null) apple.SetDashBox("com.wisp", Field, value);
            var values = apple.GetDashBoxes("com.wisp", Field) ?? [];
            return values.Length > 1 ? "invalid-multiple-ids" : values.SingleOrDefault();
        }
        if (ext is ".mp3" or ".aiff" or ".aif" && file.GetTag(TagLib.TagTypes.Id3v2, create) is TagLib.Id3v2.Tag id3)
        {
            var frames = id3.GetFrames<UserTextInformationFrame>().Where(f => f.Description == Field).ToArray();
            if (frames.Length > 1) return "invalid-multiple-ids";
            var frame = UserTextInformationFrame.Get(id3, Field, create);
            if (value is not null && frame is not null) frame.Text = [value];
            return frame?.Text.Length > 1 ? "invalid-multiple-ids" : frame?.Text.SingleOrDefault();
        }
        return null;
    }

    private async Task EmbedAsync(string path, Guid id, string expectedBytes, string expectedAudio, CancellationToken ct)
    {
        var folder = Path.Combine(Path.GetDirectoryName(path)!, ".wisp-identity-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var staged = Path.Combine(folder, Path.GetFileName(path));
        try
        {
            await using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            await using (var target = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                await source.CopyToAsync(target, ct);
            var before = new MetadataReader().Read(staged);
            var standardTags = TagSnapshot(staged);
            using (var file = TagLib.File.Create(staged))
            {
                if (TagValue(file, true, id.ToString("D")) != id.ToString("D")) throw new IOException("Format cannot store a WISP identity.");
                file.Save();
            }
            if (ReadTag(staged) != id.ToString("D") || new MetadataReader().Read(staged) != before || TagSnapshot(staged) != standardTags
                || await audio.ComputeAsync(staged, ct) != expectedAudio)
                throw new IOException("Identity tag verification failed; original file retained.");
            if (await bytes.ComputeAsync(path, ct) != expectedBytes) throw new IOException("Source changed during identity tagging.");
            ct.ThrowIfCancellationRequested();
            File.Replace(staged, path, null);
        }
        finally
        {
            if (File.Exists(staged)) File.Delete(staged);
            Directory.Delete(folder);
        }
    }

    private static string TagSnapshot(string path)
    {
        using var file = TagLib.File.Create(path);
        // Includes comments, replay gain, lyrics, performers and other typed tags.
        var values = typeof(TagLib.Tag).GetProperties().Where(p => p.CanRead && p.Name != nameof(TagLib.Tag.IsEmpty) && p.GetIndexParameters().Length == 0
            && (p.PropertyType.IsPrimitive || p.PropertyType == typeof(string) || p.PropertyType == typeof(string[])))
            .OrderBy(p => p.Name).ToDictionary(p => p.Name, p => p.GetValue(file.Tag));
        values["Pictures"] = file.Tag.Pictures.Select(p => new { p.MimeType, p.Description, p.Type,
            Hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(p.Data.Data)) }).ToArray();
        return JsonSerializer.Serialize(values, new JsonSerializerOptions
        { NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals });
    }

    private static async Task WriteSidecarAsync(string path, Guid id, string hash, CancellationToken ct)
    {
        var destination = path + SidecarSuffix;
        if (File.Exists(destination)) return; // ReadAsync has already verified existing sidecars.
        var temp = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(new Sidecar(1, id, hash)), ct);
            File.Move(temp, destination, overwrite: false);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
