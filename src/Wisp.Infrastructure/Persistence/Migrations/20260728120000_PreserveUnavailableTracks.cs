using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations;

/// <summary>
/// Retains records for files that disappear from a scanned root. This protects
/// cue points, playlists, tags and mix plans from destructive rescans.
/// </summary>
[DbContext(typeof(WispDbContext))]
[Migration("20260728120000_PreserveUnavailableTracks")]
public partial class PreserveUnavailableTracks : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "IsUnavailable",
            table: "Tracks",
            type: "INTEGER",
            nullable: false,
            defaultValue: false);

        migrationBuilder.AddColumn<DateTime>(
            name: "UnavailableSince",
            table: "Tracks",
            type: "TEXT",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_Tracks_IsUnavailable",
            table: "Tracks",
            column: "IsUnavailable");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_Tracks_IsUnavailable", table: "Tracks");
        migrationBuilder.DropColumn(name: "IsUnavailable", table: "Tracks");
        migrationBuilder.DropColumn(name: "UnavailableSince", table: "Tracks");
    }
}
