using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations;

/// <summary>Explicit player-ready Memory Cue and loop records.</summary>
[DbContext(typeof(WispDbContext))]
[Migration("20260728150000_AddDeviceCues")]
public partial class AddDeviceCues : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "DeviceCues",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "TEXT", nullable: false),
                TrackId = table.Column<Guid>(type: "TEXT", nullable: false),
                Kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                StartSeconds = table.Column<double>(type: "REAL", nullable: false),
                EndSeconds = table.Column<double>(type: "REAL", nullable: true),
                Comment = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                SourceCuePointId = table.Column<Guid>(type: "TEXT", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_DeviceCues", x => x.Id);
                table.ForeignKey("FK_DeviceCues_CuePoints_SourceCuePointId", x => x.SourceCuePointId, "CuePoints", "Id", onDelete: ReferentialAction.SetNull);
                table.ForeignKey("FK_DeviceCues_Tracks_TrackId", x => x.TrackId, "Tracks", "Id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(name: "IX_DeviceCues_SourceCuePointId", table: "DeviceCues", column: "SourceCuePointId");
        migrationBuilder.CreateIndex(name: "IX_DeviceCues_TrackId_StartSeconds", table: "DeviceCues", columns: new[] { "TrackId", "StartSeconds" });
    }

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "DeviceCues");
}
