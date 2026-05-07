using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Wisp.Infrastructure.Persistence;

public class WispDbContextDesignTimeFactory : IDesignTimeDbContextFactory<WispDbContext>
{
    public WispDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<WispDbContext>()
            .UseSqlite("Data Source=wisp.design.db")
            .Options;
        return new WispDbContext(options);
    }
}
