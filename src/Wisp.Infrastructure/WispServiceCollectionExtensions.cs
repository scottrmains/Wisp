using Microsoft.Extensions.DependencyInjection;
using Wisp.Core.Cleanup;
using Wisp.Core.Recommendations;
using Wisp.Infrastructure.Cleanup;
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

        return services;
    }
}
