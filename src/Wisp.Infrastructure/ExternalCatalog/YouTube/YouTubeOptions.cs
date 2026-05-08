namespace Wisp.Infrastructure.ExternalCatalog.YouTube;

public sealed class YouTubeOptions
{
    public string? ApiKey { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
