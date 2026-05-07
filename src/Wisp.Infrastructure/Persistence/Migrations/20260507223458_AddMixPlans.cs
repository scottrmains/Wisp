using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMixPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MixPlans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MixPlans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MixPlanTracks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    MixPlanId = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Order = table.Column<double>(type: "REAL", nullable: false),
                    CueInSeconds = table.Column<double>(type: "REAL", nullable: true),
                    CueOutSeconds = table.Column<double>(type: "REAL", nullable: true),
                    TransitionNotes = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MixPlanTracks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MixPlanTracks_MixPlans_MixPlanId",
                        column: x => x.MixPlanId,
                        principalTable: "MixPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MixPlanTracks_Tracks_TrackId",
                        column: x => x.TrackId,
                        principalTable: "Tracks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MixPlanTracks_MixPlanId_Order",
                table: "MixPlanTracks",
                columns: new[] { "MixPlanId", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_MixPlanTracks_TrackId",
                table: "MixPlanTracks",
                column: "TrackId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MixPlanTracks");

            migrationBuilder.DropTable(
                name: "MixPlans");
        }
    }
}
