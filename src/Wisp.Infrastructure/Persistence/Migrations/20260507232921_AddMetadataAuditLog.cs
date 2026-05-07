using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMetadataAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MetadataAuditLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Action = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    FailureReason = table.Column<string>(type: "TEXT", nullable: true),
                    BeforeJson = table.Column<string>(type: "TEXT", nullable: false),
                    AfterJson = table.Column<string>(type: "TEXT", nullable: false),
                    FilePathBefore = table.Column<string>(type: "TEXT", nullable: false),
                    FilePathAfter = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MetadataAuditLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MetadataAuditLogs_CreatedAt",
                table: "MetadataAuditLogs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataAuditLogs_TrackId",
                table: "MetadataAuditLogs",
                column: "TrackId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MetadataAuditLogs");
        }
    }
}
