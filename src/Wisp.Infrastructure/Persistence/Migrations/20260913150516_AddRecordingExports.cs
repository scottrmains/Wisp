using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingExports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingExports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    RecordingId = table.Column<Guid>(type: "TEXT", nullable: false),
                    RequestJson = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Format = table.Column<string>(type: "TEXT", nullable: false),
                    DirectoryPath = table.Column<string>(type: "TEXT", nullable: false),
                    State = table.Column<string>(type: "TEXT", nullable: false),
                    Error = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    SourceHash = table.Column<string>(type: "TEXT", nullable: false),
                    OutputHash = table.Column<string>(type: "TEXT", nullable: true),
                    OutputBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    OutputWriteTicks = table.Column<long>(type: "INTEGER", nullable: false),
                    TracklistText = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingExports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingExports_RecordingId",
                table: "RecordingExports",
                column: "RecordingId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE TEMP TABLE WispExportRollbackGuard (Count INTEGER CHECK (Count = 0));");
            migrationBuilder.Sql("INSERT INTO WispExportRollbackGuard SELECT COUNT(*) FROM RecordingExports;");
            migrationBuilder.Sql("DROP TABLE WispExportRollbackGuard;");
            migrationBuilder.DropTable(
                name: "RecordingExports");
        }
    }
}
