using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Wisp.Api.Library;
using Wisp.Api.Playlists;
using Wisp.Core.Cues;
using Wisp.Core.MixPlans;
using Wisp.Core.Playlists;
using Wisp.Core.Recommendations;
using Wisp.Core.Tagging;
using Wisp.Core.Tracks;
using Wisp.Infrastructure.Audio;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Persistence;
using Wisp.Infrastructure.Usb;

namespace Wisp.Api.Tests;

public sealed class PlaylistMembershipTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-playlist-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _a = Guid.NewGuid(), _b = Guid.NewGuid(), _first = Guid.NewGuid(), _second = Guid.NewGuid();
    private readonly Guid _entryA = Guid.NewGuid(), _entryB = Guid.NewGuid();
    private WebApplication _app = null!;
    private HttpClient _client = null!;
    private string Audio => Path.Combine(_root, "original.aiff");

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        await File.WriteAllBytesAsync(Audio, [1, 2, 3, 4]);
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddDbContext<WispDbContext>(o => o.UseSqlite($"Data Source={Path.Combine(_root, "test.db")};Pooling=False;Default Timeout=10"));
        builder.Services.AddSingleton<ScanQueue>(); builder.Services.AddSingleton<ScanProgressBus>();
        builder.Services.AddSingleton<RecommendationService>(); builder.Services.AddSingleton<AiffTranscoder>();
        builder.Services.AddSingleton<PioneerUsbExportService>();
        _app = builder.Build(); _app.MapLibrary(); _app.MapPlaylists();
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        // Upgrade an existing pre-feature playlist, not only a fresh empty database.
        await db.GetService<IMigrator>().MigrateAsync("20260911092412_AddDiscoveryPublishedAt");
        db.Tracks.AddRange(
            new Track { Id = _first, FilePath = Audio, FileName = "original.aiff", Title = "A track", Artist = "Artist", Notes = "Keep notes", Bpm = 125, MusicalKey = "8A", Energy = 5 },
            new Track { Id = _second, FilePath = Path.Combine(_root, "second.mp3"), FileName = "second.mp3", Title = "B track", Artist = "Artist", Bpm = 130, MusicalKey = "9A", Energy = 6 });
        db.Playlists.AddRange(
            new Playlist { Id = _a, Name = "First playlist", Tracks = [new PlaylistTrack { Id = _entryA, TrackId = _first, AddedAt = DateTime.UtcNow }] },
            new Playlist { Id = _b, Name = "Other playlist", Tracks = [new PlaylistTrack { Id = _entryB, TrackId = _first }] });
        db.CuePoints.Add(new CuePoint { Id = Guid.NewGuid(), TrackId = _first, TimeSeconds = 12, Label = "Keep cue" });
        db.DeviceCues.Add(new DeviceCue { Id = Guid.NewGuid(), TrackId = _first, StartSeconds = 24 });
        db.TrackTags.Add(new TrackTag { Id = Guid.NewGuid(), TrackId = _first, Name = "Keep tag" });
        db.MixPlans.Add(new MixPlan { Id = Guid.NewGuid(), Name = "Keep mix", Tracks = [new MixPlanTrack { Id = Guid.NewGuid(), TrackId = _first }] });
        await db.SaveChangesAsync();
        await db.Database.MigrateAsync();
        Assert.Equal(2, await db.PlaylistTracks.CountAsync());
        await _app.StartAsync(); _client = _app.GetTestClient();
    }

    private Task<HttpResponseMessage> Add(Guid[] ids, string handling = "ask") =>
        _client.PostAsJsonAsync($"/api/playlists/{_a}/tracks/bulk", new { trackIds = ids, duplicateHandling = handling });
    private async Task<int> EntryCount(Guid? playlistId = null) => (await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{playlistId ?? _a}"))!.Tracks.Count;

    [Fact]
    public async Task Default_duplicate_check_blocks_the_entire_batch_without_partial_additions()
    {
        var response = await Add([_first, _second]);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("playlist_duplicates", body.GetProperty("code").GetString());
        Assert.Equal(1, body.GetProperty("duplicateCount").GetInt32());
        Assert.Equal(1, await EntryCount());
    }

    [Fact]
    public async Task Confirmed_repeats_are_visible_as_separate_entries_and_not_duplicate_library_tracks()
    {
        (await Add([_first, _second], "add")).EnsureSuccessStatusCode();
        Assert.Equal(3, await EntryCount());
        foreach (var sort in new[] { "artist", "-artist", "title", "-title", "bpm", "-bpm", "energy", "-energy", "key", "-key", "genre", "-genre", "year", "-year", "added", "-added", "modified", "-modified" })
        {
            var pages = new List<TrackDto>();
            for (var page = 1; page <= 3; page++)
            {
                var result = await _client.GetFromJsonAsync<TrackPageDto>($"/api/tracks?playlistId={_a}&sort={sort}&size=1&page={page}");
                Assert.Equal(3, result!.Total); pages.Add(Assert.Single(result.Items));
            }
            Assert.Equal(3, pages.Select(t => t.PlaylistEntryId).Distinct().Count());
            Assert.Equal(2, pages.Count(t => t.Id == _first));
        }
        var library = await _client.GetFromJsonAsync<TrackPageDto>("/api/tracks");
        Assert.Equal(2, library!.Total); Assert.All(library.Items, t => Assert.Null(t.PlaylistEntryId));
        var filtered = await _client.GetFromJsonAsync<TrackPageDto>($"/api/tracks?playlistId={_a}&search=A%20track&bpmMax=126");
        Assert.Equal(2, filtered!.Total);
    }

    [Fact]
    public async Task Skip_existing_and_repeated_request_ids_do_not_create_accidental_duplicates()
    {
        var response = await Add([_first, _second, _second], "skip");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("added").GetInt32()); Assert.Equal(1, body.GetProperty("skipped").GetInt32());
        (await Add([_first, _second], "skip")).EnsureSuccessStatusCode();
        Assert.Equal(2, await EntryCount());
    }

    [Fact]
    public async Task Single_track_endpoint_also_requires_explicit_duplicate_confirmation()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await _client.PostAsJsonAsync($"/api/playlists/{_a}/tracks", new { trackId = _first })).StatusCode);
        (await _client.PostAsJsonAsync($"/api/playlists/{_a}/tracks", new { trackId = _first, duplicateHandling = "add" })).EnsureSuccessStatusCode();
        Assert.Equal(2, await EntryCount());
    }

    [Fact]
    public async Task Remove_selected_occurrence_preserves_other_copies_playlists_library_cues_mix_and_audio()
    {
        (await Add([_first], "add")).EnsureSuccessStatusCode();
        var response = await _client.PostAsJsonAsync($"/api/playlists/{_a}/entries/remove", new { entryIds = new[] { _entryA, _entryB, Guid.NewGuid() } });
        response.EnsureSuccessStatusCode();
        Assert.Equal(1, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("removed").GetInt32());
        Assert.Equal(1, await EntryCount()); Assert.Equal(1, await EntryCount(_b));
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Equal(2, await db.Tracks.CountAsync());
        Assert.Equal("Keep notes", (await db.Tracks.FindAsync(_first))!.Notes);
        Assert.Equal(12, (await db.CuePoints.SingleAsync()).TimeSeconds);
        Assert.Equal(24, (await db.DeviceCues.SingleAsync()).StartSeconds);
        Assert.Equal("Keep tag", (await db.TrackTags.SingleAsync()).Name);
        Assert.Equal(_first, (await db.MixPlanTracks.SingleAsync()).TrackId);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, await File.ReadAllBytesAsync(Audio));
        var retry = await _client.PostAsJsonAsync($"/api/playlists/{_a}/entries/remove", new { entryIds = new[] { _entryA } });
        Assert.Equal(0, (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("removed").GetInt32());
    }

    [Fact]
    public async Task Bulk_remove_clears_only_that_playlist_and_legacy_track_removal_removes_all_occurrences()
    {
        (await Add([_first, _second], "add")).EnsureSuccessStatusCode();
        (await _client.DeleteAsync($"/api/playlists/{_a}/tracks/{_first}")).EnsureSuccessStatusCode();
        var playlist = await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{_a}");
        Assert.Equal(_second, Assert.Single(playlist!.Tracks).TrackId);
        (await _client.PostAsJsonAsync($"/api/playlists/{_a}/entries/remove", new { entryIds = playlist.Tracks.Select(t => t.Id) })).EnsureSuccessStatusCode();
        Assert.Equal(0, await EntryCount()); Assert.Equal(1, await EntryCount(_b));
    }

    [Fact]
    public async Task Invalid_batches_and_deleted_playlists_do_not_partially_modify_membership()
    {
        foreach (var ids in new[] { Array.Empty<Guid>(), new[] { _second, Guid.NewGuid() }, Enumerable.Repeat(_second, 20001).ToArray() })
            Assert.Equal(HttpStatusCode.BadRequest, (await Add(ids, "add")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Add([_second], "force")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsJsonAsync($"/api/playlists/{Guid.NewGuid()}/tracks/bulk", new { trackIds = new[] { _second } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsJsonAsync($"/api/playlists/{_a}/entries/remove", new { entryIds = Array.Empty<Guid>() })).StatusCode);
        Assert.Equal(1, await EntryCount());
    }

    [Fact]
    public async Task Concurrent_unconfirmed_adds_cannot_both_insert_the_same_track()
    {
        var responses = await Task.WhenAll(Add([_second]), Add([_second]));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(2, await EntryCount());
    }

    private async Task<PlaylistDuplicateScan> ScanDuplicates(Guid? id = null) =>
        (await _client.GetFromJsonAsync<PlaylistDuplicateScan>($"/api/playlists/{id ?? _a}/duplicates"))!;

    private Task<HttpResponseMessage> RemoveDuplicates(string snapshot, Guid? id = null) =>
        _client.PostAsJsonAsync($"/api/playlists/{id ?? _a}/duplicates/remove", new { snapshot });

    [Fact]
    public async Task Duplicate_scan_is_read_only_and_confirmation_keeps_oldest_entries_and_prep()
    {
        (await Add([_first, _second], "add")).EnsureSuccessStatusCode();
        (await Add([_first, _second], "add")).EnsureSuccessStatusCode();
        var before = await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{_a}");
        var scan = await ScanDuplicates();
        Assert.Equal(5, scan.TotalEntries); Assert.Equal(3, scan.DuplicateEntries);
        Assert.Equal(2, scan.Groups.Count);
        Assert.Equal("A track", scan.Groups.Single(g => g.TrackId == _first).Title);
        Assert.Equal(scan.Snapshot, (await ScanDuplicates()).Snapshot);
        Assert.Equal(5, await EntryCount()); // Scanning/cancelling makes no writes.
        var response = await RemoveDuplicates(scan.Snapshot);
        response.EnsureSuccessStatusCode();
        Assert.Equal(3, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("removed").GetInt32());
        var after = await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{_a}");
        Assert.Equal(2, after!.Tracks.Count);
        Assert.Equal(before!.Tracks.GroupBy(t => t.TrackId).Select(g => g.OrderBy(t => t.AddedAt).ThenBy(t => t.Id).First().Id).Order(),
            after.Tracks.Select(t => t.Id).Order());
        Assert.Contains(after.Tracks, t => t.Id == _entryA);
        Assert.Equal(1, await EntryCount(_b));
        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
        Assert.Equal(2, await db.Tracks.CountAsync());
        Assert.Equal("Keep notes", (await db.Tracks.FindAsync(_first))!.Notes);
        Assert.Equal(12, (await db.CuePoints.SingleAsync()).TimeSeconds);
        Assert.Equal(24, (await db.DeviceCues.SingleAsync()).StartSeconds);
        Assert.Equal("Keep tag", (await db.TrackTags.SingleAsync()).Name);
        Assert.Equal(_first, (await db.MixPlanTracks.SingleAsync()).TrackId);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, await File.ReadAllBytesAsync(Audio));
    }

    [Fact]
    public async Task Scan_covers_more_than_one_library_page_and_same_title_files_are_not_duplicates()
    {
        await using (var scope = _app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WispDbContext>();
            (await db.Tracks.FindAsync(_second))!.Title = "A track";
            db.PlaylistTracks.AddRange(Enumerable.Range(0, 1001).Select(_ => new PlaylistTrack
                { Id = Guid.NewGuid(), PlaylistId = _a, TrackId = _first, AddedAt = DateTime.UtcNow }));
            db.PlaylistTracks.Add(new PlaylistTrack { Id = Guid.NewGuid(), PlaylistId = _a, TrackId = _second });
            await db.SaveChangesAsync();
        }
        var scan = await ScanDuplicates();
        Assert.Equal(1003, scan.TotalEntries); Assert.Equal(1001, scan.DuplicateEntries);
        Assert.Equal(_first, Assert.Single(scan.Groups).TrackId);
        (await RemoveDuplicates(scan.Snapshot)).EnsureSuccessStatusCode();
        Assert.Equal(2, await EntryCount());
        Assert.Equal(0, (await ScanDuplicates()).DuplicateEntries);
    }

    [Fact]
    public async Task Stale_or_cross_playlist_scan_cannot_remove_unreviewed_entries_and_retry_is_safe()
    {
        (await Add([_first], "add")).EnsureSuccessStatusCode();
        var scan = await ScanDuplicates();
        (await Add([_first], "add")).EnsureSuccessStatusCode();
        var stale = await RemoveDuplicates(scan.Snapshot);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("playlist_scan_stale", (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(3, await EntryCount());
        Assert.Equal(HttpStatusCode.Conflict, (await RemoveDuplicates((await ScanDuplicates(_b)).Snapshot)).StatusCode);
        scan = await ScanDuplicates();
        (await RemoveDuplicates(scan.Snapshot)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await RemoveDuplicates(scan.Snapshot)).StatusCode);
        Assert.Equal(1, await EntryCount());
    }

    [Fact]
    public async Task Removing_kept_entry_after_scan_requires_new_confirmation_instead_of_removing_last_copy()
    {
        (await Add([_first], "add")).EnsureSuccessStatusCode();
        var scan = await ScanDuplicates();
        (await _client.PostAsJsonAsync($"/api/playlists/{_a}/entries/remove", new { entryIds = new[] { _entryA } })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await RemoveDuplicates(scan.Snapshot)).StatusCode);
        Assert.Equal(1, await EntryCount());
        Assert.Equal(0, (await ScanDuplicates()).DuplicateEntries);
    }

    [Fact]
    public async Task Empty_clean_missing_and_invalid_scans_have_safe_results()
    {
        var scan = await ScanDuplicates();
        Assert.Equal(1, scan.TotalEntries); Assert.Empty(scan.Groups); Assert.Equal(0, scan.DuplicateEntries);
        var updated = (await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{_a}"))!.UpdatedAt;
        var clean = await RemoveDuplicates(scan.Snapshot);
        Assert.Equal(0, (await clean.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("removed").GetInt32());
        Assert.Equal(updated, (await _client.GetFromJsonAsync<PlaylistDto>($"/api/playlists/{_a}"))!.UpdatedAt);
        (await _client.DeleteAsync($"/api/playlists/{_a}/tracks/{_first}")).EnsureSuccessStatusCode();
        Assert.Equal(0, (await ScanDuplicates()).TotalEntries);
        Assert.Equal(HttpStatusCode.BadRequest, (await RemoveDuplicates("")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/playlists/{Guid.NewGuid()}/duplicates")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RemoveDuplicates(scan.Snapshot, Guid.NewGuid())).StatusCode);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose(); await _app.DisposeAsync(); Directory.Delete(_root, true);
    }
}
