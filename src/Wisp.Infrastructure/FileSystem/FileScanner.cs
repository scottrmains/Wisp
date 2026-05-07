namespace Wisp.Infrastructure.FileSystem;

public interface IFileScanner
{
    IEnumerable<string> EnumerateAudioFiles(string root);
}

public class FileScanner : IFileScanner
{
    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".flac", ".wav", ".aiff", ".aif", ".m4a", ".ogg", ".opus"
    };

    public IEnumerable<string> EnumerateAudioFiles(string root)
    {
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException($"Folder not found: {root}");

        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
            ReturnSpecialDirectories = false,
        };

        foreach (var path in Directory.EnumerateFiles(root, "*", options))
        {
            if (AudioExtensions.Contains(Path.GetExtension(path)))
                yield return path;
        }
    }
}
