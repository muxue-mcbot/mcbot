// mcbot 的桌面窗口（mcbot.exe，放在程序目录根上）：后台隐藏启动 `node\node.exe scripts\webui.mjs --shell`，
// 从它的标准输出读到地址后在自己的窗口（WebView2）里打开；页面还是 scripts/webui-page.html，这里不改页面。
// - 关窗口：关掉给 WebUI 的标准输入，WebUI 自己退出（壳崩了管道也会断）；等不到就结束它。托管的 Bot 是单独的进程，不受影响。
// - WebUI 退出码 0（自动更新：启动安装包后退出）时窗口跟着关，安装包好替换 mcbot.exe；别的退出回到加载页显示输出的最后几行。
// - 本机没有 WebView2 时退回旧做法：用 `--open` 启动 WebUI，在默认浏览器里打开。
// - 只开一个窗口：再打开 mcbot 时把已有的窗口提到前面。
// - 外部链接（下载地址、模组主页）交给默认浏览器，窗口里只留本机的 WebUI 和加载页。
// - WebView2 的数据（Cookie、主题选择）放在数据目录的 runtime/webview：数据目录的规则和 scripts/paths.mjs 一样。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// 错误页上留 WebUI 输出的最后几行。
const LOG_LINES: usize = 40;
/// 关窗口后等 WebUI 自己退出多久，超过就结束它。
const STOP_WAIT: Duration = Duration::from_secs(3);
const URL_PREFIX: &str = "http://127.0.0.1:";

struct Webui {
    child: Mutex<Option<Child>>,
}

/// 程序目录：mcbot.exe 所在的目录；开发时可用环境变量 MCBOT_PROGRAM_DIR 指到仓库。
fn program_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MCBOT_PROGRAM_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_else(|| PathBuf::from("."))
}

/// 数据目录，和 scripts/paths.mjs 的 dataDir 一样：MCBOT_HOME > 有安装标记时 %LOCALAPPDATA%\mcbot > 程序目录。
fn data_dir(program: &Path) -> PathBuf {
    if let Some(home) = std::env::var_os("MCBOT_HOME").filter(|d| !d.is_empty()) {
        return PathBuf::from(home);
    }
    if program.join("install.json").exists() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").filter(|d| !d.is_empty()) {
            return PathBuf::from(local).join("mcbot");
        }
    }
    program.to_path_buf()
}

fn node_command(program: &Path, flag: &str) -> Command {
    let mut cmd = Command::new(program.join("node").join("node.exe"));
    cmd.arg(program.join("scripts").join("webui.mjs")).arg(flag).current_dir(program);
    cmd
}

/// 窗口里只留本机的 WebUI 和加载页。
fn is_local(url: &Url) -> bool {
    matches!(url.scheme(), "tauri") || matches!(url.host_str(), Some("127.0.0.1") | Some("tauri.localhost"))
}

fn open_outside(url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

fn push_line(log: &Mutex<VecDeque<String>>, line: String) {
    let mut log = log.lock().unwrap();
    if log.len() == LOG_LINES {
        log.pop_front();
    }
    log.push_back(line);
}

/// 按行读子进程的输出（按 UTF-8 读，读不了的字节换掉）。
fn read_lines(src: impl Read + Send + 'static, mut each: impl FnMut(String) + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(src);
        let mut buf = Vec::new();
        while matches!(reader.read_until(b'\n', &mut buf), Ok(n) if n > 0) {
            each(String::from_utf8_lossy(&buf).trim_end().to_string());
            buf.clear();
        }
    });
}

/// 回到加载页显示错误。
fn show_error(app: &AppHandle, base: &Url, text: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let mut url = base.clone();
        url.query_pairs_mut().clear().append_pair("error", text);
        let _ = window.navigate(url);
    }
}

/// 关窗口、退出时：先关标准输入让 WebUI 自己退出，等不到再结束。
fn stop_webui(app: &AppHandle) {
    let Some(mut child) = app.state::<Webui>().child.lock().unwrap().take() else { return };
    drop(child.stdin.take());
    let start = Instant::now();
    while start.elapsed() < STOP_WAIT {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn start_webui(app: &AppHandle, program: &Path, base: Url) -> Result<(), String> {
    let mut child = node_command(program, "--shell")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("无法启动 {}：{e}", program.join("node").join("node.exe").display()))?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    let ready = Arc::new(Mutex::new(false));

    let (out, err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let (handle, out_log, out_ready) = (app.clone(), log.clone(), ready.clone());
    read_lines(out, move |line| {
        // webui.mjs 打出的第一行：「mcbot WebUI：http://127.0.0.1:<端口>/?t=<令牌>」
        if let Some(at) = line.find(URL_PREFIX) {
            if let (Ok(url), Some(window)) = (Url::parse(&line[at..]), handle.get_webview_window("main")) {
                *out_ready.lock().unwrap() = true;
                let _ = window.navigate(url);
                return;
            }
        }
        push_line(&out_log, line);
    });
    let err_log = log.clone();
    read_lines(err, move |line| push_line(&err_log, line));
    app.state::<Webui>().child.lock().unwrap().replace(child);

    // WebUI 自己退出时：退出码 0 且已经打开过（自动更新）就关窗口，否则显示原因
    let handle = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(300));
        let state = handle.state::<Webui>();
        let status = {
            let mut guard = state.child.lock().unwrap();
            let Some(child) = guard.as_mut() else { return };
            match child.try_wait() {
                Ok(Some(status)) => { guard.take(); status }
                Ok(None) => continue,
                Err(_) => return,
            }
        };
        if status.success() && *ready.lock().unwrap() {
            handle.exit(0);
            return;
        }
        let tail = log.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
        let code = status.code().map_or_else(|| "未知".to_string(), |c| c.to_string());
        show_error(&handle, &base, &format!("退出码 {code}\n{tail}"));
        return;
    });
    Ok(())
}

fn main() {
    let program = program_dir();
    // 没有 WebView2（精简系统、手动卸载过）：照旧在浏览器里打开
    if tauri::webview_version().is_err() {
        let _ = node_command(&program, "--open").spawn();
        return;
    }
    let webview_data = data_dir(&program).join("runtime").join("webview");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Webui { child: Mutex::new(None) })
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("mcbot")
                .inner_size(1280.0, 820.0)
                .min_inner_size(800.0, 560.0)
                .data_directory(webview_data.clone())
                .on_navigation(|url| {
                    if is_local(url) {
                        return true;
                    }
                    open_outside(url);
                    false
                })
                .on_new_window(|url, _features| {
                    open_outside(&url);
                    NewWindowResponse::Deny
                })
                .build()?;
            let base = window.url()?;
            let handle = app.handle().clone();
            if let Err(e) = start_webui(&handle, &program, base.clone()) {
                show_error(&handle, &base, &e);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法创建 mcbot 窗口");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_webui(app);
        }
    });
}
