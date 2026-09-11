#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef PublishDir
  #error PublishDir must point to the self-contained publish folder.
#endif

[Setup]
AppId={{A7D7188B-902B-48CF-A729-2C759B95E1E9}
AppName=Wisp
AppVersion={#AppVersion}
AppPublisher=Wisp
DefaultDirName={localappdata}\Programs\Wisp
DefaultGroupName=Wisp
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#InstallerOutput}
OutputBaseFilename=Wisp-Setup-{#AppVersion}-win-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Wisp.exe
SetupIconFile={#PublishDir}\Assets\wisp.ico
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewInstaller}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Wisp"; Filename: "{app}\Wisp.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Wisp"; Filename: "{app}\Wisp.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Wisp.exe"; Description: "Launch Wisp"; Flags: nowait postinstall skipifsilent

; Deliberately no UninstallDelete: library, cues and settings in
; %LOCALAPPDATA%\Wisp survive both upgrades and uninstall.
[Code]
function HasWebView2: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKLM32, Key, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0'));
  if not Result then
    Result := (RegQueryStringValue(HKCU, Key, 'pv', Version) and
      (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then exit;
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'),
      '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
  begin
    Result := 'Could not start the Microsoft WebView2 installer. Please retry setup.';
    exit;
  end;
  if not HasWebView2 then
    Result := 'Wisp needs Microsoft WebView2. Connect to the internet and retry setup, or install the Evergreen WebView2 Runtime from Microsoft first.';
end;
