; mcbot 安装包。由 scripts/package.mjs 调用：ISCC /DAppVersion=0.0.1 /DStageDir=<摆好的程序目录> /DMarkerFile=<安装标记> /O<输出目录> installer\mcbot.iss
; 按用户安装到 %LOCALAPPDATA%\Programs\mcbot，不要管理员权限。用户数据在 %LOCALAPPDATA%\mcbot（程序目录里的 install.json 让 WebUI 认出是安装版；
; 它不放在摆好的程序目录里，单独传进来，免得从中转目录启动 WebUI 也被当成安装版），
; 覆盖安装只换程序文件；卸载时问一句是否删数据，默认不删，静默卸载一律不删。游戏目录（mods、config、mcbot-backups）安装和卸载都不碰。
; 本文件要保存为带 BOM 的 UTF-8，Inno Setup 才按 UTF-8 读中文。

#ifndef AppVersion
  #error 缺少 /DAppVersion
#endif
#ifndef StageDir
  #error 缺少 /DStageDir
#endif
#ifndef MarkerFile
  #error 缺少 /DMarkerFile
#endif

; 桌面窗口（shell/ 编译的 mcbot.exe）：它在后台启动 node\node.exe scripts\webui.mjs --shell；本机没有 WebView2 时它改用浏览器打开
#define AppExe "{app}\mcbot.exe"

[Setup]
; AppId 不能改：升级和卸载都靠它认出已装的 mcbot
AppId={{58B28313-1A73-47BF-9807-48493D50A53E}
AppName=mcbot
AppVersion={#AppVersion}
AppVerName=mcbot {#AppVersion}
AppPublisher=muxue
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\mcbot
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=mcbot-setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; mcbot 自己的 node 进程由 [Code] 的 PrepareToInstall 先问再结束；其余占用程序文件的进程交给 Restart Manager 提示关闭。装完由 [Run] 重新打开 mcbot
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=mcbot
UninstallDisplayIcon={#AppExe}

[Languages]
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[InstallDelete]
; 覆盖安装前删掉旧版的程序文件，免得新版已删掉的脚本或依赖留下来；这几个目录里没有用户数据
Type: filesandordirs; Name: "{app}\scripts"
Type: filesandordirs; Name: "{app}\client-runtime"
Type: filesandordirs; Name: "{app}\node"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#MarkerFile}"; DestDir: "{app}"; DestName: "install.json"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\mcbot"; Filename: "{#AppExe}"; WorkingDir: "{app}"; Comment: "打开 mcbot"
Name: "{autodesktop}\mcbot"; Filename: "{#AppExe}"; WorkingDir: "{app}"; Comment: "打开 mcbot"

[Run]
; 有界面时是“完成”页上默认勾选的“打开 mcbot”；静默安装（WebUI 的自动更新用 /SILENT）时照勾选执行，装完自动重新打开 mcbot
Filename: "{#AppExe}"; WorkingDir: "{app}"; Description: "打开 mcbot"; Flags: nowait postinstall

[Code]
function DataDir(): String;
begin
  Result := ExpandConstant('{localappdata}\mcbot');
end;

// 属于这份 mcbot 的进程：桌面窗口 mcbot.exe，以及 node 进程（WebUI、托管的驱动器和运行端）——用程序目录的 node\node.exe 跑的，
// 或者用别的 Node（WebUI 配置里的「Node 路径」）跑程序目录里脚本的（命令行里有程序目录）。
// 卸载程序不像安装时那样自动关进程，自定义 Node 的进程安装时 Restart Manager 也看不到；不关的话旧代码继续跑，文件和目录删不掉。
// Kill 为 True 时结束它们；返回找到的个数。查不了（WMI 不可用）就当没有。
function AppProcesses(Kill: Boolean): Integer;
var
  Locator, Service, Procs, P: Variant;
  I: Integer;
  Exe, Dir, Cmd: String;
  Mine: Boolean;
begin
  Result := 0;
  Exe := ExpandConstant('{app}\node\node.exe');
  Dir := Lowercase(AddBackslash(ExpandConstant('{app}')));
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Procs := Service.ExecQuery('SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE Name = ''node.exe'' OR Name = ''mcbot.exe''');
    for I := 0 to Procs.Count - 1 do
    begin
      P := Procs.ItemIndex(I);
      Mine := False;
      if not VarIsNull(P.ExecutablePath) then Mine := CompareText(P.ExecutablePath, Exe) = 0;
      if (not Mine) and (not VarIsNull(P.CommandLine)) then
      begin
        Cmd := P.CommandLine;
        Mine := Pos(Dir, Lowercase(Cmd)) > 0;
      end;
      if Mine then
      begin
        Result := Result + 1;
        if Kill then P.Terminate();
      end;
    end;
  except
    Log('查找运行中的 mcbot 失败：' + GetExceptionMessage);
  end;
end;

// 覆盖安装前：程序目录还有进程在跑就先问（静默安装直接结束；WebUI 自动更新前已确认没有托管、自己也退出了）
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if AppProcesses(False) = 0 then Exit;
  if (not WizardSilent) and (MsgBox('mcbot 还在运行（窗口、WebUI 或正在托管的 Bot）。继续安装会结束它们。' + #13#10 + '要继续吗？', mbConfirmation, MB_YESNO) <> IDYES) then
  begin
    Result := '已取消：mcbot 还在运行。请先停止托管、关闭 WebUI 后再安装。';
    Exit;
  end;
  AppProcesses(True);
  Sleep(1500);
end;

// 桌面窗口要用 WebView2 运行库（Win11 自带，Win10 绝大多数经 Windows 更新装过）。注册表里的 pv 是版本号，没有或 0.0.0.0 就是没装
const
  WebView2Key = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Bootstrapper = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasWebView2(): Boolean;
var
  V: String;
begin
  Result := (RegQueryStringValue(HKLM32, 'SOFTWARE\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'))
    or (RegQueryStringValue(HKCU, 'Software\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

// 没装就下载微软的引导安装器（约 2MB，它再联网装运行库）静默安装；失败也不拦安装：mcbot.exe 找不到 WebView2 时改用浏览器打开
procedure InstallWebView2();
var
  Code: Integer;
begin
  if HasWebView2() then Exit;
  WizardForm.StatusLabel.Caption := '正在安装 WebView2 运行库（需要联网，可能要几分钟）…';
  try
    DownloadTemporaryFile(WebView2Bootstrapper, 'MicrosoftEdgeWebview2Setup.exe', '', nil);
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
      Log('无法运行 WebView2 引导安装器')
    else
      Log('WebView2 引导安装器退出码 ' + IntToStr(Code));
  except
    Log('安装 WebView2 失败：' + GetExceptionMessage);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then InstallWebView2();
end;

var
  KillApps: Boolean;

// 这里只问，不结束进程：之后 Inno 自己还会问“确定要删除吗”，选否时 WebUI 和托管不该已经被关掉
function InitializeUninstall(): Boolean;
begin
  Result := True;
  KillApps := AppProcesses(False) > 0;
  if KillApps and (not UninstallSilent) and (MsgBox('mcbot 还在运行（窗口、WebUI 或正在托管的 Bot）。继续卸载会结束它们。' + #13#10 + '要继续吗？', mbConfirmation, MB_YESNO) <> IDYES) then
    Result := False;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // 确认卸载之后、删文件之前
  if (CurUninstallStep = usUninstall) and KillApps then
  begin
    AppProcesses(True);
    Sleep(1500);
  end;
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) and DirExists(DataDir()) then
  begin
    if MsgBox('同时删除 mcbot 的数据（人设、记忆、配置、下载缓存）？' + #13#10#13#10 +
      '数据目录：' + DataDir() + #13#10 +
      '删除后无法恢复。选“否”则保留，以后重新安装还能接着用。' + #13#10#13#10 +
      '游戏目录里的文件不会动：游戏 mods 里的 mcbot 模组、config\mcbot-server-control\、插件页的备份 mcbot-backups\ 都会留在游戏里（世界里可能有相关的方块和物品）。需要移除时，请在卸载前到 WebUI 的插件页操作。',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      if not DelTree(DataDir(), True, True, True) then
        MsgBox('数据目录没有删干净，可能有文件正被占用：' + #13#10 + DataDir(), mbError, MB_OK);
    end;
  end;
end;
