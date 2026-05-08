using System.Collections.Concurrent;

namespace Wisp.Infrastructure.ExternalCatalog.YouTube;

/// In-memory daily quota counter + search-result cache for the Discover
/// search flow. Combined into one class because the cache exists to *save*
/// quota, so they share state (a cache hit doesn't consume the budget).
///
/// **Why no DB persistence:** YouTube's quota itself resets at midnight
/// Pacific. A process restart between sessions losing the counter is
/// strictly safer than the user thinking they have budget that's already
/// burned. Cache loss on restart costs at most one re-search per query.
///
/// **Why singleton:** the counter must be process-global, and we only
/// ever construct one of these.
public sealed class YouTubeQuotaTracker
{
    /// 100 quota units per `search.list`, 10,000 default daily quota
    /// = 100 search.list calls / day worst case. Conservatively cap a
    /// little below that (90) so concurrent non-search calls (channel
    /// resolves, playlistItems pages) still have headroom.
    public const int DailyBudget = 90;

    /// Cache TTL. Realistically YouTube results don't drift much within
    /// 24h — mostly relevant for a returning user typing the same query
    /// twice in a session. We expire on the same UTC day boundary as the
    /// quota counter so the cache + budget reset together.
    private DateOnly _currentDay = DateOnly.FromDateTime(DateTime.UtcNow);
    private int _searchesToday;

    private readonly object _lock = new();
    private readonly ConcurrentDictionary<string, IReadOnlyList<YouTubeVideoHit>> _cache = new(StringComparer.OrdinalIgnoreCase);

    /// Returns a cached result for this query if we have one for today.
    public IReadOnlyList<YouTubeVideoHit>? TryGetCached(string query)
    {
        ResetIfNewDay();
        return _cache.TryGetValue(query.Trim(), out var hits) ? hits : null;
    }

    /// Try to consume one quota unit (= one search.list call).
    /// Returns false when the daily budget is exhausted.
    public bool TryConsume()
    {
        lock (_lock)
        {
            ResetIfNewDay();
            if (_searchesToday >= DailyBudget) return false;
            _searchesToday++;
            return true;
        }
    }

    /// Cache a result. Called after a successful API hit.
    public void Cache(string query, IReadOnlyList<YouTubeVideoHit> hits)
    {
        ResetIfNewDay();
        _cache[query.Trim()] = hits;
    }

    public YouTubeQuotaSnapshot Snapshot()
    {
        lock (_lock)
        {
            ResetIfNewDay();
            return new YouTubeQuotaSnapshot(
                SearchesToday: _searchesToday,
                DailyBudget: DailyBudget,
                ResetUtc: NextResetUtc());
        }
    }

    private void ResetIfNewDay()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (today == _currentDay) return;
        lock (_lock)
        {
            if (today == _currentDay) return;
            _currentDay = today;
            _searchesToday = 0;
            _cache.Clear();
        }
    }

    private DateTimeOffset NextResetUtc()
    {
        var nextDay = _currentDay.AddDays(1);
        return new DateTimeOffset(nextDay.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
    }
}

public sealed record YouTubeQuotaSnapshot(
    int SearchesToday,
    int DailyBudget,
    DateTimeOffset ResetUtc);
