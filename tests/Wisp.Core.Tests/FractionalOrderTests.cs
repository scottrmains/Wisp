using Wisp.Core.MixPlans;

namespace Wisp.Core.Tests;

public class FractionalOrderTests
{
    [Fact]
    public void Empty_list_returns_default_step()
    {
        Assert.Equal(1024, FractionalOrder.Between(null, null));
    }

    [Fact]
    public void Inserting_at_head_subtracts_step()
    {
        Assert.Equal(1024 - 1024, FractionalOrder.Between(null, 1024));
    }

    [Fact]
    public void Inserting_at_tail_adds_step()
    {
        Assert.Equal(1024 + 1024, FractionalOrder.Between(1024, null));
    }

    [Fact]
    public void Inserting_between_takes_midpoint()
    {
        Assert.Equal(1536, FractionalOrder.Between(1024, 2048));
    }

    [Fact]
    public void Repeated_left_inserts_dont_collapse_in_normal_use()
    {
        // Always insert immediately to the right of the head, narrowing the gap each time.
        // Should sustain at least 50 iterations before doubles run out of precision.
        double left = 0;
        double right = 1024;

        for (var i = 0; i < 50; i++)
        {
            var mid = FractionalOrder.Between(left, right);
            Assert.True(mid > left && mid < right, $"collapsed at iteration {i}");
            right = mid;
        }
    }

    [Fact]
    public void Throws_when_neighbours_are_adjacent_doubles()
    {
        var a = 1.0;
        var b = Math.BitIncrement(a); // next representable double after a
        Assert.Throws<InvalidOperationException>(() => FractionalOrder.Between(a, b));
    }
}
