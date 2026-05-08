using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMixPlanRecommendationScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RecommendationScopePlaylistId",
                table: "MixPlans",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_MixPlans_RecommendationScopePlaylistId",
                table: "MixPlans",
                column: "RecommendationScopePlaylistId");

            migrationBuilder.AddForeignKey(
                name: "FK_MixPlans_Playlists_RecommendationScopePlaylistId",
                table: "MixPlans",
                column: "RecommendationScopePlaylistId",
                principalTable: "Playlists",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MixPlans_Playlists_RecommendationScopePlaylistId",
                table: "MixPlans");

            migrationBuilder.DropIndex(
                name: "IX_MixPlans_RecommendationScopePlaylistId",
                table: "MixPlans");

            migrationBuilder.DropColumn(
                name: "RecommendationScopePlaylistId",
                table: "MixPlans");
        }
    }
}
