using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingTracklists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingPlanSnapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    RecordingId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourcePlanId = table.Column<Guid>(type: "TEXT", nullable: false),
                    PlanName = table.Column<string>(type: "TEXT", nullable: false),
                    SourceUpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    TakenAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Timing = table.Column<string>(type: "TEXT", nullable: false),
                    BlueprintJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingPlanSnapshots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RecordingTracklists",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ActiveSnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    EntriesJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingTracklists", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingPlanSnapshots_RecordingId",
                table: "RecordingPlanSnapshots",
                column: "RecordingId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingPlanSnapshots_SourcePlanId",
                table: "RecordingPlanSnapshots",
                column: "SourcePlanId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuse to silently discard recording history on downgrade.
            migrationBuilder.Sql("CREATE TEMP TABLE recording_history_guard (Count INTEGER CHECK (Count = 0));");
            migrationBuilder.Sql("INSERT INTO recording_history_guard SELECT (SELECT COUNT(*) FROM RecordingPlanSnapshots) + (SELECT COUNT(*) FROM RecordingTracklists);");
            migrationBuilder.Sql("DROP TABLE recording_history_guard;");
            migrationBuilder.DropTable(
                name: "RecordingPlanSnapshots");

            migrationBuilder.DropTable(
                name: "RecordingTracklists");
        }
    }
}
