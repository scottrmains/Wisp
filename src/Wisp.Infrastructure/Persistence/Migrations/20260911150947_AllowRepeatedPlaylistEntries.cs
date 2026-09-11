using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowRepeatedPlaylistEntries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlaylistTracks_PlaylistId_TrackId",
                table: "PlaylistTracks");

            migrationBuilder.CreateIndex(
                name: "IX_PlaylistTracks_PlaylistId_TrackId",
                table: "PlaylistTracks",
                columns: new[] { "PlaylistId", "TrackId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlaylistTracks_PlaylistId_TrackId",
                table: "PlaylistTracks");

            migrationBuilder.CreateIndex(
                name: "IX_PlaylistTracks_PlaylistId_TrackId",
                table: "PlaylistTracks",
                columns: new[] { "PlaylistId", "TrackId" },
                unique: true);
        }
    }
}
