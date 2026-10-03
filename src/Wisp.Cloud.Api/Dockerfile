# Template only: no image is built/pushed by desktop or cloud validation jobs.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY src/Wisp.Cloud.Persistence/ src/Wisp.Cloud.Persistence/
COPY src/Wisp.Cloud.Api/ src/Wisp.Cloud.Api/
RUN dotnet publish src/Wisp.Cloud.Api/Wisp.Cloud.Api.csproj -c Release -o /out --no-self-contained

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out/ ./
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Wisp.Cloud.Api.dll"]
