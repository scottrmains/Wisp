using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wisp.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrackAudioVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LoudnessAnalysisJson",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizationJson",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedFilePath",
                table: "Tracks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OriginalFilePath",
                table: "Tracks",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Don't discard the route back to originals while copies are active.
            migrationBuilder.Sql("CREATE TEMP TABLE WispAudioRollbackGuard (ActiveCopies INTEGER CHECK (ActiveCopies = 0));");
            migrationBuilder.Sql("INSERT INTO WispAudioRollbackGuard SELECT COUNT(*) FROM Tracks WHERE NormalizedFilePath IS NOT NULL AND FilePath = NormalizedFilePath COLLATE NOCASE;");
            migrationBuilder.Sql("DROP TABLE WispAudioRollbackGuard;");
            migrationBuilder.DropColumn(
                name: "LoudnessAnalysisJson",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "NormalizationJson",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "NormalizedFilePath",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "OriginalFilePath",
                table: "Tracks");
        }
    }
}
