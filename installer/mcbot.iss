; mcbot 安装包。由 scripts/package.mjs 调用：ISCC /DAppVersion=0.0.1 /DStageDir=<摆好的程序目录> /O<输出目录> installer\mcbot.iss
; 按用户安装到 %LOCALAPPDATA%\Programs\mcbot，不要管理员权限。用户数据在 %LOCALAPPDATA%\mcbot（程序目录里的 install.json 让 WebUI 认出是安装版），
; 覆盖安装只换程序文件；卸载时问一句是否删数据，默认不删，静默卸载一律不删。游戏目录（mods、config、mcbot-backups）安装和卸载都不碰。
; 本文件要保存为带 BOM 的 UTF-8，Inno Setup 才按 UTF-8 读中文。

#ifndef AppVersion
  #error 缺少 /DAppVersion
#endif
#ifndef StageDir
  #error 缺少 /DStageDir
#endif

#define AppExe "{app}\node\node.exe"
; 直接放进下面的 Parameters:（Inno 的参数值里双引号要写两遍）
#define AppParams '"""{app}\scripts\webui.mjs"" --open"'

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
; 程序目录里的 node.exe 还开着（WebUI、托管）就提示关闭；装完由下面的 [Run] 重新打开 WebUI
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

[Icons]
Name: "{autoprograms}\mcbot"; Filename: "{#AppExe}"; Parameters: {#AppParams}; WorkingDir: "{app}"; Comment: "打开 mcbot 的 WebUI"
Name: "{autodesktop}\mcbot"; Filename: "{#AppExe}"; Parameters: {#AppParams}; WorkingDir: "{app}"; Comment: "打开 mcbot 的 WebUI"

[Run]
; 有界面时是“完成”页上默认勾选的“打开 mcbot”；静默安装（WebUI 的自动更新用 /SILENT）时照勾选执行，装完自动重新打开 WebUI
Filename: "{#AppExe}"; Parameters: {#AppParams}; WorkingDir: "{app}"; Description: "打开 mcbot"; Flags: nowait postinstall

[Code]
function DataDir(): String;
begin
  Result := ExpandConstant('{localappdata}\mcbot');
end;

// 从程序目录的 node.exe 跑起来的进程（WebUI、托管）。卸载程序不像安装时那样自动关它们，不关的话 node.exe 删不掉。
// Kill 为 True 时结束它们；返回找到的个数。查不了（WMI 不可用）就当没有。
function AppProcesses(Kill: Boolean): Integer;
var
  Locator, Service, Procs, P: Variant;
  I: Integer;
  Exe: String;
begin
  Result := 0;
  Exe := ExpandConstant('{app}\node\node.exe');
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Procs := Service.ExecQuery('SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = ''node.exe''');
    for I := 0 to Procs.Count - 1 do
    begin
      P := Procs.ItemIndex(I);
      if (not VarIsNull(P.ExecutablePath)) and (CompareText(P.ExecutablePath, Exe) = 0) then
      begin
        Result := Result + 1;
        if Kill then P.Terminate();
      end;
    end;
  except
    Log('查找运行中的 mcbot 失败：' + GetExceptionMessage);
  end;
end;

var
  KillApps: Boolean;

// 这里只问，不结束进程：之后 Inno 自己还会问“确定要删除吗”，选否时 WebUI 和托管不该已经被关掉
function InitializeUninstall(): Boolean;
begin
  Result := True;
  KillApps := AppProcesses(False) > 0;
  if KillApps and (not UninstallSilent) and (MsgBox('mcbot 还在运行（WebUI 或正在托管的 Bot）。继续卸载会结束它们。' + #13#10 + '要继续吗？', mbConfirmation, MB_YESNO) <> IDYES) then
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
