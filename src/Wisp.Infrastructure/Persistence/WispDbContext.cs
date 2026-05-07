using Microsoft.EntityFrameworkCore;

namespace Wisp.Infrastructure.Persistence;

public class WispDbContext(DbContextOptions<WispDbContext> options) : DbContext(options)
{
}
