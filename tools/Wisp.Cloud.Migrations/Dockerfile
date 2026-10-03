# Explicit approved development operator job, not a desktop/installer build.
FROM mcr.microsoft.com/dotnet/sdk:10.0
WORKDIR /source
COPY src/Wisp.Cloud.Persistence/ src/Wisp.Cloud.Persistence/
COPY tools/Wisp.Cloud.Migrations/ tools/Wisp.Cloud.Migrations/
RUN dotnet build tools/Wisp.Cloud.Migrations/Wisp.Cloud.Migrations.csproj -c Release
USER $APP_UID
ENTRYPOINT ["dotnet", "/source/tools/Wisp.Cloud.Migrations/bin/Release/net10.0/Wisp.Cloud.Migrations.dll", "--approved-development-bootstrap"]
