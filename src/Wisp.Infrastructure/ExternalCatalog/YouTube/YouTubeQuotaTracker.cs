using System.Collections.Concurrent;

namespace Wisp.Infrastructure.ExternalCatalog.YouTube;

/// In-memory daily quota counter + search-result cache for the Discover
/// search flow. Combined into one class because the cache exists to *save*
/// quota, so they share state (a cache hit doesn't consume the budget).
///
/// This is a local process budget, not authoritative Google-project usage.
/// It resets on restart/UTC midnight; Google's own quota reset is independent.
///
/// **Why singleton:** the counter must be process-global, and we only
/// ever construct one of these.
public sealed class YouTubeQuotaTracker
{
    /// Conservative local cap on Discover search.list calls. Other features
    /// and other clients using the API project are not included in this counter.
    public const int DailyBudget = 90;

    /// Cache TTL. Realistically YouTube results don't drift much within
    /// 24h — mostly relevant for a returning user typing the same query
    /// twice in a session. We expire on the same UTC day boundary as the
    /// quota counter so the cache + budget reset together.
    private DateOnly _currentDay = DateOnly.FromDateTime(DateTime.UtcNow);
    private int _searchesToday;

    private readonly object _lock = new();
    private readonly ConcurrentDictionary<string, IReadOnlyList<YouTubeVideoHit>> _cache = new(StringComparer.Ordinal);

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
