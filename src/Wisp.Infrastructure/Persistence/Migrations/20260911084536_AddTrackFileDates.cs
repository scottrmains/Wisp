using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrackFileDates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "FileModifiedAt",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tracks_AddedAt",
                table: "Tracks",
                column: "AddedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Tracks_FileModifiedAt",
                table: "Tracks",
                column: "FileModifiedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tracks_AddedAt",
                table: "Tracks");

            migrationBuilder.DropIndex(
                name: "IX_Tracks_FileModifiedAt",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "FileModifiedAt",
                table: "Tracks");
        }
    }
}
