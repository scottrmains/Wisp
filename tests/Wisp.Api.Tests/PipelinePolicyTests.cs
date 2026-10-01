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
        Assert.Equal(new[] { "validate", "validate-marketing" }, Strings(installer, "needs"));
        // Both checks are essential: branch alone permits manual releases, while
        // event alone permits packaging develop. The default success() condition
        // also prevents packaging if the validation dependency fails.
        Assert.Equal("${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
            Scalar(installer, "if"));
        var steps = Steps(installer);
        Assert.Contains(steps, s => Scalar(s, "run").Contains("./tools/build-installer.ps1"));
        Assert.Contains(steps, s => Scalar(s, "run").Contains("./tools/test-installer.ps1"));
        Assert.Contains(steps, s => Scalar(s, "run").Contains("playwright install chromium"));
        Assert.Contains(steps, s => Scalar(s, "uses").StartsWith("actions/upload-artifact@"));
    }

    [Fact]
    public void Validation_tests_and_builds_without_publishing_or_uploading_executables()
    {
        var jobs = Map(Workflow(), "jobs");
        Assert.Equal(new[] { "deploy-marketing", "installer", "release", "validate", "validate-marketing" }, jobs.Children.Keys
            .Select(k => ((YamlScalarNode)k).Value!).Order().ToArray());
        var validate = Map(jobs, "validate");
        Assert.False(validate.Children.ContainsKey(new YamlScalarNode("if")));
        var steps = Steps(validate);
        var commands = string.Join('\n', steps.Select(s => Scalar(s, "run")));
        Assert.Contains("dotnet test Wisp.slnx -c Release", commands);
        Assert.Contains("npm --prefix src/Wisp.Client test", commands);
        Assert.Contains("npm --prefix src/Wisp.Client run lint", commands);
        Assert.Contains("npm --prefix src/Wisp.Client run build", commands);
        Assert.Contains("node tools/test-ui-upgrade-cache.mjs --app src/Wisp.Api/bin/Release/net10.0/Wisp.dll", commands);
        Assert.DoesNotContain("publish", commands, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("installer.ps1", commands, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(steps, s => Scalar(s, "uses").StartsWith("actions/upload-artifact@"));
        var marketing = Map(jobs, "validate-marketing");
        Assert.False(marketing.Children.ContainsKey(new YamlScalarNode("if")));
        var marketingSteps = Steps(marketing);
        Assert.Contains(marketingSteps, s => Scalar(s, "run") == "npm run test:browser");
        Assert.DoesNotContain(marketingSteps, s => Scalar(s, "uses").StartsWith("actions/upload-artifact@"));
        Assert.DoesNotContain(marketingSteps, s => Scalar(s, "run").Contains("deploy", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Public_release_and_deployment_are_main_only_and_depend_on_smoke_tested_installer()
    {
        var workflow = Workflow();
        Assert.Equal("read", Scalar(Map(workflow, "permissions"), "contents"));
        Assert.Equal("${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}",
            Scalar(Map(workflow, "concurrency"), "cancel-in-progress"));
        var jobs = Map(workflow, "jobs");
        var release = Map(jobs, "release");
        var deploy = Map(jobs, "deploy-marketing");
        Assert.Equal("installer", Scalar(release, "needs"));
        Assert.Equal("release", Scalar(deploy, "needs"));
        foreach (var job in new[] { release, deploy })
            Assert.Equal("${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}", Scalar(job, "if"));
        Assert.Equal("write", Scalar(Map(release, "permissions"), "contents"));
        Assert.Equal("read", Scalar(Map(deploy, "permissions"), "contents"));
        Assert.Equal("write", Scalar(Map(deploy, "permissions"), "id-token"));
        Assert.Equal("production", Scalar(Map(deploy, "environment"), "name"));
        var releaseSteps = Steps(release);
        Assert.Contains(releaseSteps, s => Scalar(s, "run").Contains("publish-release.mjs"));
        Assert.Contains(releaseSteps, s => Scalar(s, "run").Contains("verify-production.mjs"));
        var deploySteps = Steps(deploy);
        Assert.Contains(deploySteps, s => Scalar(s, "run").Contains("assertCurrentMain"));
        Assert.Contains(deploySteps, s => Scalar(s, "run").Contains("--env production"));
        Assert.Contains(deploySteps, s => Scalar(s, "run").Contains("verify-production.mjs"));
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
