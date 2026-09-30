using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSoulseekImportReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SoulseekImportReceipts",
                columns: table => new
                {
                    Source = table.Column<string>(type: "TEXT", nullable: false),
                    TransferId = table.Column<string>(type: "TEXT", nullable: false),
                    ScanId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SoulseekImportReceipts", x => new { x.Source, x.TransferId });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SoulseekImportReceipts");
        }
    }
}
