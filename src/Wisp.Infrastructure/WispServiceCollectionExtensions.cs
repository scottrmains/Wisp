using Microsoft.Extensions.DependencyInjection;
using Wisp.Core.Cleanup;
using Wisp.Core.Recommendations;
using Wisp.Infrastructure.ArtistRefresh;
using Wisp.Infrastructure.Cleanup;
using Wisp.Infrastructure.ExternalCatalog.Spotify;
using Wisp.Infrastructure.FileSystem;
using Wisp.Infrastructure.Library;
using Wisp.Infrastructure.Tagging;

namespace Wisp.Infrastructure;

public static class WispServiceCollectionExtensions
{
    public static IServiceCollection AddWispLibrary(this IServiceCollection services)
    {
        services.AddSingleton<IFileScanner, FileScanner>();
        services.AddSingleton<IFileFingerprint, FileFingerprint>();
        services.AddSingleton<IMetadataReader, MetadataReader>();

        services.AddSingleton<ScanQueue>();
        services.AddSingleton<ScanProgressBus>();

        services.AddScoped<LibraryScanner>();
        services.AddHostedService<ScanWorker>();

        services.AddSingleton<RecommendationService>();

        services.AddScoped<CleanupSuggestionService>();
        services.AddScoped<CleanupApplier>();

        services.AddHttpClient("Wisp.Spotify");
        services.AddHttpClient("Wisp.Spotify.Auth");
        services.AddSingleton<SpotifyOptions>();
        services.AddSingleton<SpotifyCatalogClient>();
        services.AddScoped<ArtistRefreshService>();

        return services;
    }
}
