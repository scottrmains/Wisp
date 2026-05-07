using System.Diagnostics.CodeAnalysis;

namespace Wisp.Core.Music;

/// Camelot wheel position — Mixed in Key writes these as "8A", "12B" etc.
/// Letter A = minor key, B = major key. Numbers 1–12 form a circle around the wheel.
///
/// Mixing rules:
///   - Same code           → identical key
///   - Same number, flip   → relative major/minor (8A ↔ 8B)
///   - +/- 1 same letter   → adjacent on the wheel ("perfect fifth" relation)
public readonly record struct Camelot(int Number, bool IsMajor)
{
    public char Letter => IsMajor ? 'B' : 'A';
    public string Code => $"{Number}{Letter}";
    public override string ToString() => Code;

    public static bool TryParse(string? input, out Camelot result)
    {
        result = default;
        if (string.IsNullOrWhiteSpace(input)) return false;
        var s = input.Trim().ToUpperInvariant();
        if (s.Length is < 2 or > 3) return false;

        var letter = s[^1];
        if (letter is not 'A' and not 'B') return false;

        var numPart = s[..^1];
        if (!int.TryParse(numPart, out var n)) return false;
        if (n is < 1 or > 12) return false;

        result = new Camelot(n, IsMajor: letter == 'B');
        return true;
    }

    public static Camelot Parse(string input) =>
        TryParse(input, out var r) ? r : throw new FormatException($"Invalid Camelot key: '{input}'");

    /// Adjacent positions on the wheel: ±1 with same letter, both directions.
    public IEnumerable<Camelot> Adjacent
    {
        get
        {
            yield return new Camelot(Wrap(Number + 1), IsMajor);
            yield return new Camelot(Wrap(Number - 1), IsMajor);
        }
    }

    /// Same number, opposite letter (relative major ↔ minor).
    public Camelot RelativeMajorMinor => new(Number, !IsMajor);

    public Camelot PerfectFifthUp => new(Wrap(Number + 1), IsMajor);
    public Camelot PerfectFifthDown => new(Wrap(Number - 1), IsMajor);

    /// Compatibility relation between two keys, ordered most → least preferred.
    public KeyRelation RelationTo(Camelot other)
    {
        if (Number == other.Number && IsMajor == other.IsMajor) return KeyRelation.SameKey;
        if (Number == other.Number) return KeyRelation.RelativeMajorMinor;

        var diff = Math.Abs(NumberDiff(Number, other.Number));
        if (diff == 1 && IsMajor == other.IsMajor) return KeyRelation.Adjacent;

        // "Creative" jumps used by some DJs: ±2 same letter, or diagonal (±1 + flip).
        if (diff == 2 && IsMajor == other.IsMajor) return KeyRelation.Creative;
        if (diff == 1 && IsMajor != other.IsMajor) return KeyRelation.Creative;

        return KeyRelation.Distant;
    }

    private static int Wrap(int n) => ((n - 1 + 12) % 12) + 1;

    /// Shortest distance around the 12-position wheel.
    private static int NumberDiff(int a, int b)
    {
        var raw = Math.Abs(a - b);
        return Math.Min(raw, 12 - raw);
    }
}

public enum KeyRelation
{
    SameKey,            // 8A ↔ 8A
    Adjacent,           // 8A ↔ 9A or 8A ↔ 7A
    RelativeMajorMinor, // 8A ↔ 8B
    Creative,           // ±2 same letter, or diagonal moves
    Distant,            // anything else
}
