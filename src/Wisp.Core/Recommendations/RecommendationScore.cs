namespace Wisp.Core.Recommendations;

public sealed record RecommendationScore(
    int Total,
    int KeyScore,
    int BpmScore,
    int EnergyScore,
    int GenreScore,
    int Penalties,
    IReadOnlyList<string> Reasons);
