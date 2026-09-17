using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingFeedback",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    Notes = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    AnnotationsJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingFeedback", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RecordingPlanRevisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    RecordingId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ParentPlanId = table.Column<Guid>(type: "TEXT", nullable: true),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    PlanName = table.Column<string>(type: "TEXT", nullable: false),
                    RecordingTitle = table.Column<string>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    RequestHash = table.Column<string>(type: "TEXT", nullable: false),
                    ContextJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingPlanRevisions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingPlanRevisions_RecordingId",
                table: "RecordingPlanRevisions",
                column: "RecordingId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE TEMP TABLE feedback_history_guard (Count INTEGER CHECK (Count = 0));");
            migrationBuilder.Sql("INSERT INTO feedback_history_guard SELECT (SELECT COUNT(*) FROM RecordingFeedback) + (SELECT COUNT(*) FROM RecordingPlanRevisions);");
            migrationBuilder.Sql("DROP TABLE feedback_history_guard;");
            migrationBuilder.DropTable(
                name: "RecordingFeedback");

            migrationBuilder.DropTable(
                name: "RecordingPlanRevisions");
        }
    }
}
