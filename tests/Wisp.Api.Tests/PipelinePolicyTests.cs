using YamlDotNet.RepresentationModel;

namespace Wisp.Api.Tests;

public class PipelinePolicyTests
{
    [Fact]
    public void Integration_branches_and_their_prs_receive_validation()
    {
        var triggers = Map(Workflow(), "on");
        Assert.Equal(new[] { "develop", "main" }, Strings(Map(triggers, "push"), "branches"));
        Assert.Equal(new[] { "develop", "main" }, Strings(Map(triggers, "pull_request"), "branches"));
        Assert.True(triggers.Children.ContainsKey(new YamlScalarNode("workflow_dispatch")));
        Assert.Equal(3, triggers.Children.Count);
    }

    [Fact]
    public void Packaging_requires_validated_main_push_not_pr_or_manual_dispatch()
    {
        var installer = Map(Map(Workflow(), "jobs"), "installer");
        Assert.Equal("validate", Scalar(installer, "needs"));
        // Both checks are essential: branch alone permits manual releases, while
        // event alone permits packaging develop. The default success() condition
        // also prevents packaging if the validation dependency fails.
        Assert.Equal("${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
            Scalar(installer, "if"));
        var steps = Steps(installer);
        Assert.Contains(steps, s => Scalar(s, "run").Contains("./tools/build-installer.ps1"));
        Assert.Contains(steps, s => Scalar(s, "run").Contains("./tools/test-installer.ps1"));
        Assert.Contains(steps, s => Scalar(s, "uses").StartsWith("actions/upload-artifact@"));
    }

    [Fact]
    public void Validation_tests_and_builds_without_publishing_or_uploading_executables()
    {
        var jobs = Map(Workflow(), "jobs");
        Assert.Equal(new[] { "installer", "validate" }, jobs.Children.Keys
            .Select(k => ((YamlScalarNode)k).Value!).Order().ToArray());
        var validate = Map(jobs, "validate");
        Assert.False(validate.Children.ContainsKey(new YamlScalarNode("if")));
        var steps = Steps(validate);
        var commands = string.Join('\n', steps.Select(s => Scalar(s, "run")));
        Assert.Contains("dotnet test Wisp.slnx -c Release", commands);
        Assert.Contains("npm --prefix src/Wisp.Client test", commands);
        Assert.Contains("npm --prefix src/Wisp.Client run lint", commands);
        Assert.Contains("npm --prefix src/Wisp.Client run build", commands);
        Assert.DoesNotContain("publish", commands, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("installer.ps1", commands, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(steps, s => Scalar(s, "uses").StartsWith("actions/upload-artifact@"));
    }

    private static YamlMappingNode Workflow()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var path = Path.Combine(directory.FullName, ".github", "workflows", "windows-installer.yml");
            if (File.Exists(path))
            {
                using var reader = File.OpenText(path);
                var yaml = new YamlStream();
                yaml.Load(reader);
                return (YamlMappingNode)yaml.Documents.Single().RootNode;
            }
            directory = directory.Parent;
        }
        throw new FileNotFoundException("Cannot locate the checked-out Windows workflow.");
    }

    private static YamlMappingNode Map(YamlMappingNode node, string key) =>
        (YamlMappingNode)node.Children[new YamlScalarNode(key)];

    private static string Scalar(YamlMappingNode node, string key) =>
        node.Children.TryGetValue(new YamlScalarNode(key), out var value)
            ? ((YamlScalarNode)value).Value ?? "" : "";

    private static string[] Strings(YamlMappingNode node, string key) =>
        ((YamlSequenceNode)node.Children[new YamlScalarNode(key)]).Children
            .Select(n => ((YamlScalarNode)n).Value!).ToArray();

    private static YamlMappingNode[] Steps(YamlMappingNode node) =>
        ((YamlSequenceNode)node.Children[new YamlScalarNode("steps")]).Children
            .Cast<YamlMappingNode>().ToArray();
}
