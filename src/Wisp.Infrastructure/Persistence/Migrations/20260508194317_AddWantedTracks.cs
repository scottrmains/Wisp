using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWantedTracks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WantedTracks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    SourceVideoId = table.Column<string>(type: "TEXT", maxLength: 40, nullable: true),
                    SourceUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Artist = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false),
                    ThumbnailUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", nullable: true),
                    MatchedLocalTrackId = table.Column<Guid>(type: "TEXT", nullable: true),
                    MatchedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    AddedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WantedTracks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WantedTracks_Tracks_MatchedLocalTrackId",
                        column: x => x.MatchedLocalTrackId,
                        principalTable: "Tracks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WantedTracks_Artist_Title",
                table: "WantedTracks",
                columns: new[] { "Artist", "Title" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WantedTracks_MatchedLocalTrackId",
                table: "WantedTracks",
                column: "MatchedLocalTrackId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WantedTracks");
        }
    }
}
