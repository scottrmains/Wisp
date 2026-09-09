# Bundled tools

Wisp's Windows installer includes these separately maintained tools:

- slskd 0.25.1: https://github.com/slskd/slskd/releases/tag/0.25.1
  Source and license: https://github.com/slskd/slskd/tree/0.25.1
  The release's license is included under `slskd/LICENSE`.
- FFmpeg 8.0.1, Gyan essentials build:
  https://github.com/GyanD/codexffmpeg/releases/tag/8.0.1
  Build information: https://www.gyan.dev/ffmpeg/builds/
  Upstream source: https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz
  The build's license and README are included in this directory's `ffmpeg` folder.
- Microsoft WebView2 Evergreen bootstrapper:
  https://developer.microsoft.com/en-us/microsoft-edge/webview2/
  Setup runs it only when the WebView2 Runtime is missing.

Dependency archives are pinned and SHA-256 checked by the packaging script.
The WebView2 bootstrapper follows Microsoft's Evergreen channel and is checked
for a valid Microsoft Authenticode signature. Wisp remains a personal project;
this packaging pipeline does not change its redistribution terms.
