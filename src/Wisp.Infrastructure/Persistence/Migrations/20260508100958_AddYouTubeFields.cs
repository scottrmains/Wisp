using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddYouTubeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "YouTubeUrl",
                table: "ExternalReleases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "YouTubeVideoId",
                table: "ExternalReleases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "YouTubeChannelId",
                table: "ArtistProfiles",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "YouTubeUrl",
                table: "ExternalReleases");

            migrationBuilder.DropColumn(
                name: "YouTubeVideoId",
                table: "ExternalReleases");

            migrationBuilder.DropColumn(
                name: "YouTubeChannelId",
                table: "ArtistProfiles");
        }
    }
}
