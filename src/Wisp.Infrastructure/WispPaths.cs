namespace Wisp.Infrastructure;

public static class WispPaths
{
    public static string AppDataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Wisp");

    public static string DatabasePath { get; } = Path.Combine(AppDataDir, "wisp.db");
    public static string ConfigPath { get; } = Path.Combine(AppDataDir, "config.json");
    public static string LogsDir { get; } = Path.Combine(AppDataDir, "logs");

    public static string DatabaseConnectionString =>
        $"Data Source={DatabasePath};Cache=Shared";

    public static void EnsureCreated()
    {
        Directory.CreateDirectory(AppDataDir);
        Directory.CreateDirectory(LogsDir);
    }
}
