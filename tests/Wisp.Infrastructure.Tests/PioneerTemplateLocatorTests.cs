using System.Buffers.Binary;
using Wisp.Infrastructure.Usb;

namespace Wisp.Infrastructure.Tests;

public sealed class PioneerTemplateLocatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wisp-reference-" + Guid.NewGuid().ToString("N"));

    private string Reference(string name)
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, name);
        var bytes = new byte[4096];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), 4096);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8), 20);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    [Fact]
    public void Saved_reference_supports_formatted_target_without_second_usb()
    {
        var saved = Reference("saved.pdb");
        var before = File.ReadAllBytes(saved);
        Assert.Equal(saved, PioneerTemplateLocator.Resolve(Path.Combine(_root, "empty-usb"), null, saved, []));
        Assert.Equal(before, File.ReadAllBytes(saved));
    }

    [Fact]
    public void Explicit_reference_wins_and_invalid_override_does_not_silently_fall_back()
    {
        var saved = Reference("saved.pdb");
        var configured = Reference("configured.pdb");
        var target = Path.Combine(_root, "usb");
        Assert.Equal(configured, PioneerTemplateLocator.Resolve(target, configured, saved, []));
        Assert.Throws<PioneerTemplateRequiredException>(() => PioneerTemplateLocator.Resolve(target, configured + ".missing", saved, []));
        File.WriteAllBytes(configured, new byte[4096]);
        Assert.Throws<PioneerTemplateRequiredException>(() => PioneerTemplateLocator.Resolve(target, configured, saved, []));
    }

    [Fact]
    public void Target_reference_is_never_used_and_multiple_candidates_require_choice()
    {
        var first = Reference("first.pdb");
        var second = Reference("second.pdb");
        var missing = Path.Combine(_root, "missing.pdb");
        Assert.Throws<PioneerTemplateRequiredException>(() => PioneerTemplateLocator.Resolve(_root, first, missing, []));
        Assert.Throws<PioneerTemplateRequiredException>(() => PioneerTemplateLocator.Resolve(_root, null, missing, [first]));
        Assert.Throws<PioneerTemplateRequiredException>(() => PioneerTemplateLocator.Resolve(Path.Combine(_root, "usb"), null, missing, [first, second]));
        Assert.Equal(first, PioneerTemplateLocator.Resolve(Path.Combine(_root, "usb"), null, missing, [first]));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
