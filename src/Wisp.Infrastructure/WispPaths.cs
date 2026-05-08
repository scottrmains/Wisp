namespace Wisp.Infrastructure;

public static class WispPaths
{
    public static string AppDataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Wisp");

    public static string DatabasePath { get; } = Path.Combine(AppDataDir, "wisp.db");
    public static string ConfigPath { get; } = Path.Combine(AppDataDir, "config.json");
    public static string LogsDir { get; } = Path.Combine(AppDataDir, "logs");
    /// Cached browser-playable copies of source files the embedded WebView2 can't decode
    /// natively (currently AIFF). Throwaway — safe to wipe; regenerated on next play.
    public static string TranscodeDir { get; } = Path.Combine(AppDataDir, "transcode");

    /// Working directory for the slskd sidecar when Wisp manages it: holds the generated
    /// slskd.yml and slskd's own runtime data (db, downloads, scripts). Separate from any
    /// existing %LOCALAPPDATA%\slskd config so a manually-run slskd remains unaffected.
    public static string SlskdDir { get; } = Path.Combine(AppDataDir, "slskd");
    public static string SlskdConfigPath { get; } = Path.Combine(SlskdDir, "slskd.yml");

    public static string DatabaseConnectionString =>
        $"Data Source={DatabasePath};Cache=Shared";

    public static void EnsureCreated()
    {
        Directory.CreateDirectory(AppDataDir);
        Directory.CreateDirectory(LogsDir);
        Directory.CreateDirectory(TranscodeDir);
        Directory.CreateDirectory(SlskdDir);
    }
}
