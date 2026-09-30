namespace Wisp.Api.Tests;

// Playback recovery, explicit relink and normalisation share the process-wide
// LibraryFileGate. Separate isolated test hosts still share that gate, so these
// tests must not overlap other collections that exercise playback recovery.
[CollectionDefinition("Library file operations", DisableParallelization = true)]
public sealed class LibraryFileOperationCollection;
