using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCrateDigger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DiscoverySources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    SourceType = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    SourceUrl = table.Column<string>(type: "TEXT", nullable: false),
                    ExternalSourceId = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    UploadsPlaylistId = table.Column<string>(type: "TEXT", nullable: true),
                    AddedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LastScannedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ImportedCount = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DiscoverySources", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DiscoveredTracks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    DiscoverySourceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceVideoId = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    SourceUrl = table.Column<string>(type: "TEXT", nullable: false),
                    RawTitle = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: true),
                    ThumbnailUrl = table.Column<string>(type: "TEXT", nullable: true),
                    ParsedArtist = table.Column<string>(type: "TEXT", nullable: true),
                    ParsedTitle = table.Column<string>(type: "TEXT", nullable: true),
                    MixVersion = table.Column<string>(type: "TEXT", nullable: true),
                    ReleaseYear = table.Column<int>(type: "INTEGER", nullable: true),
                    Status = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    IsAlreadyInLibrary = table.Column<bool>(type: "INTEGER", nullable: false),
                    MatchedLocalTrackId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ImportedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LastMatchedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DiscoveredTracks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DiscoveredTracks_DiscoverySources_DiscoverySourceId",
                        column: x => x.DiscoverySourceId,
                        principalTable: "DiscoverySources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DigitalMatches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    DiscoveredTrackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ExternalId = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Url = table.Column<string>(type: "TEXT", nullable: false),
                    Artist = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Version = table.Column<string>(type: "TEXT", nullable: true),
                    Label = table.Column<string>(type: "TEXT", nullable: true),
                    Year = table.Column<int>(type: "INTEGER", nullable: true),
                    Availability = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    ConfidenceScore = table.Column<int>(type: "INTEGER", nullable: false),
                    MatchedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitalMatches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DigitalMatches_DiscoveredTracks_DiscoveredTrackId",
                        column: x => x.DiscoveredTrackId,
                        principalTable: "DiscoveredTracks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DigitalMatches_DiscoveredTrackId",
                table: "DigitalMatches",
                column: "DiscoveredTrackId");

            migrationBuilder.CreateIndex(
                name: "IX_DigitalMatches_DiscoveredTrackId_Source_ExternalId",
                table: "DigitalMatches",
                columns: new[] { "DiscoveredTrackId", "Source", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DiscoveredTracks_DiscoverySourceId",
                table: "DiscoveredTracks",
                column: "DiscoverySourceId");

            migrationBuilder.CreateIndex(
                name: "IX_DiscoveredTracks_DiscoverySourceId_SourceVideoId",
                table: "DiscoveredTracks",
                columns: new[] { "DiscoverySourceId", "SourceVideoId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DiscoverySources_ExternalSourceId",
                table: "DiscoverySources",
                column: "ExternalSourceId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DigitalMatches");

            migrationBuilder.DropTable(
                name: "DiscoveredTracks");

            migrationBuilder.DropTable(
                name: "DiscoverySources");
        }
    }
}
