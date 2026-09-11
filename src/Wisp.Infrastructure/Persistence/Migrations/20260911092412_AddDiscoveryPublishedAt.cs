using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDiscoveryPublishedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAt",
                table: "DiscoveredTracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DiscoveredTracks_DiscoverySourceId_PublishedAt",
                table: "DiscoveredTracks",
                columns: new[] { "DiscoverySourceId", "PublishedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_DiscoveredTracks_DiscoverySourceId_PublishedAt",
                table: "DiscoveredTracks");

            migrationBuilder.DropColumn(
                name: "PublishedAt",
                table: "DiscoveredTracks");
        }
    }
}
