using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddArchiveTagsAndAnchors : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArchiveReason",
                table: "Tracks",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ArchivedAt",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsArchived",
                table: "Tracks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsAnchor",
                table: "MixPlanTracks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "TrackTags",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    Type = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrackTags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TrackTags_Tracks_TrackId",
                        column: x => x.TrackId,
                        principalTable: "Tracks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tracks_IsArchived",
                table: "Tracks",
                column: "IsArchived");

            migrationBuilder.CreateIndex(
                name: "IX_TrackTags_Name",
                table: "TrackTags",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_TrackTags_TrackId_Name",
                table: "TrackTags",
                columns: new[] { "TrackId", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TrackTags");

            migrationBuilder.DropIndex(
                name: "IX_Tracks_IsArchived",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "ArchiveReason",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "IsArchived",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "IsAnchor",
                table: "MixPlanTracks");
        }
    }
}
