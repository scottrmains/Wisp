using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    DirectoryPath = table.Column<string>(type: "TEXT", nullable: false),
                    EndpointId = table.Column<string>(type: "TEXT", nullable: false),
                    DeviceName = table.Column<string>(type: "TEXT", nullable: false),
                    SampleRate = table.Column<int>(type: "INTEGER", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    State = table.Column<string>(type: "TEXT", nullable: false),
                    AudioBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    Issue = table.Column<string>(type: "TEXT", nullable: true),
                    PreviousTakeId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Hidden = table.Column<bool>(type: "INTEGER", nullable: false),
                    RelinkedPath = table.Column<string>(type: "TEXT", nullable: true),
                    AudioHash = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingSessions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingSessions_StartedAt",
                table: "RecordingSessions",
                column: "StartedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE TEMP TABLE WispRecordingRollbackGuard (Recordings INTEGER CHECK (Recordings = 0));");
            migrationBuilder.Sql("INSERT INTO WispRecordingRollbackGuard SELECT COUNT(*) FROM RecordingSessions;");
            migrationBuilder.Sql("DROP TABLE WispRecordingRollbackGuard;");
            migrationBuilder.DropTable(
                name: "RecordingSessions");
        }
    }
}
