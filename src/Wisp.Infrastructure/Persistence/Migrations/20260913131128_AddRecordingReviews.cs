using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingReviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingReviews",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Rating = table.Column<int>(type: "INTEGER", nullable: true),
                    MarkersJson = table.Column<string>(type: "TEXT", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    SourceHash = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingReviews", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE TEMP TABLE WispReviewRollbackGuard (Reviews INTEGER CHECK (Reviews = 0));");
            migrationBuilder.Sql("INSERT INTO WispReviewRollbackGuard SELECT COUNT(*) FROM RecordingReviews;");
            migrationBuilder.Sql("DROP TABLE WispReviewRollbackGuard;");
            migrationBuilder.DropTable(
                name: "RecordingReviews");
        }
    }
}
