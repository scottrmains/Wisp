using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlendRatingAndTrackNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BlendRatings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrackAId = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrackBId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Rating = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    ContextNotes = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    RatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlendRatings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BlendRatings_TrackAId_TrackBId",
                table: "BlendRatings",
                columns: new[] { "TrackAId", "TrackBId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BlendRatings");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Tracks");
        }
    }
}
