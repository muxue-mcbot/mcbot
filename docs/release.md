# 打包和发布

安装包、版本号、发布和上传的做法；设计和理由见[更新方式设计](update_design.md)，总规则见[开发与验证](dev.md)。

```pwsh
node scripts/package.mjs                  # 输出到 output/package：程序目录 mcbot-<版本>-win-x64 和安装包 mcbot-setup-<版本>.exe
node scripts/package.mjs --no-installer   # 只摆程序目录；--skip-build 不重新编译运行端和桌面窗口；--node 指定要打进去的 node.exe；--iscc 指定 ISCC.exe
node scripts/set-version.mjs app 0.0.2    # 改主程序版本（运行端 package.json 和 lock、核心 mod_version、compat.json 核心 jar 名）
node scripts/set-version.mjs iron_furnaces 0.0.3 --core-min 0.0.2   # 只改一个插件；--core-min 同时改它要求的核心最低版本
node scripts/release.mjs --notes <更新说明.json>   # 在 output/release 摆出 app/、core/、plugins/、index.json 和网站首页 index.html，不上传
node scripts/publish.mjs --ssh <主机> --dir <站点目录> --github --dry-run   # 列出要传到服务器和 GitHub 的东西；去掉 --dry-run 才上传（先问用户）
```

- 版本号（见[更新方式设计](update_design.md)第二节）：主程序和核心同一个版本，以 `client-runtime/package.json` 为准；每个插件有自己的版本，`compat.json` 里写 `coreMin`，插件的 `gradle.properties` 里 `core_min` 同值，构建时写进 `neoforge.mods.toml` 对核心的要求；插件 `build.gradle` 按核心的 `mod_version` 找核心 jar。比较按段比较数字（`scripts/version.mjs`）。`check-compat.mjs` 核对这几处，改版本后要重新 gradle 构建（核心先）。
- 桌面窗口（10-15，`shell/`，Tauri 2）：`mcbot.exe` 后台隐藏启动 `node\node.exe scripts\webui.mjs --shell`，从标准输出读到地址后在自己的窗口（WebView2）里打开，页面不变。`--shell` 时 WebUI 不开浏览器，标准输入断了（窗口关了、壳崩了）就退出，8770 被占时换空闲端口。WebUI 以 0 退出（自动更新启动安装包后）窗口跟着关；别的退出回到加载页（`shell/loading/`）显示输出的最后几行。只开一个窗口，再打开时把已有的提到前面；外部链接交给默认浏览器；WebView2 的数据放在数据目录的 `runtime/webview`，窗口大小、位置、是否最大化在关窗口时记进 `runtime/window.json`，下次恢复（位置已不在任何屏幕上时用默认位置）。编进 mcbot.exe 的第三方 crate 由 `scripts/shell-notices.mjs` 按 `cargo metadata` 列出许可证和源码地址、附上各自的许可证文件，打包时写进程序目录的 `THIRD-PARTY-NOTICES.txt`。本机没有 WebView2 时退回 `--open`（浏览器）。编译要 Rust 的 MSVC 工具链，`package.mjs` 跑 `cargo build --release --locked`（依赖版本锁在 `shell/Cargo.lock`）。开发时可用环境变量 `MCBOT_PROGRAM_DIR` 指定程序目录；从中转目录试窗口时设 `MCBOT_HOME` 到别处，不然中转目录里会生成 `runtime/`，下次打包被拒绝。
- 程序目录里有：桌面窗口 `mcbot.exe` 和它的 `THIRD-PARTY-NOTICES.txt`、便携 Node（`node/`，带 Node 的 LICENSE）、运行端（`client-runtime/` 的 dist 和运行依赖，加上 `scripts/` 也按文件读的 `tool-registry.json`、`player-stop.json`、`memory-limits.json`、`host-timing.json`，清单是 `package.mjs` 的 `RUNTIME_FILES`，新加共用的 JSON 要写进去）、WebUI 和托管脚本（`scripts/`，从 `webui.mjs`、`start-server-play.mjs`、`companion.mjs` 按 import 自动找）、`compat.json`、`LICENSE`、`NOTICE`、`CLAUDE.md`、`使用说明.txt`。安装标记 `install.json`（`{"app":"mcbot","version":…}`；有它就是安装版，数据放 `%LOCALAPPDATA%\mcbot`）只在打安装包时单独传给 Inno Setup，中转目录里没有，从中转目录启动 WebUI 仍按开发环境处理。不带模组 jar（核心也不带，插件页联网下载，jar 由发布脚本摆出）、用户数据、旧的 `mcp-server`、源码和测试。
- 打包前会清空 `output/package/mcbot-<版本>-win-x64`；这个目录里有 `runtime/` 或 `memory/`（像是用户数据），或者它是仓库本身、仓库的上级，就拒绝打包。
- 安装包用 Inno Setup 6（`installer/mcbot.iss`，带 BOM 的 UTF-8；本机装在 `C:\Program Files (x86)\Inno Setup 6`）：按用户装到 `%LOCALAPPDATA%\Programs\mcbot`，不要管理员权限；开始菜单和桌面放「mcbot」快捷方式（`mcbot.exe`）；覆盖安装先删掉旧的 `scripts`、`client-runtime`、`node`；装完可勾选马上打开，`/SILENT` 时自动重新打开 mcbot；装完检查 WebView2（注册表 `EdgeUpdate\Clients\{F3017226-…}` 的 `pv`），没有就下载微软的引导安装器静默安装，失败不拦安装。安装和卸载前都结束 mcbot 自己的进程（有界面时先问）：程序目录的 `mcbot.exe` 和 `node\node.exe`，以及用 WebUI 配置里的「Node 路径」跑程序目录脚本的（按命令行里的程序目录认）；卸载时问是否同时删除 `%LOCALAPPDATA%\mcbot`，默认不删，静默卸载一律不删；游戏目录都不碰。
- 发布（[更新方式设计](update_design.md)第四、五节）：`release.mjs` 先跑 `check-compat`，读打好的安装包和 gradle 构建出的 jar，和 `output/release/index.json`（上一份）比：版本没变的部分整段沿用、不复制文件（这次构建的大小和已发布的不同会提醒先提版本）；版本变了的要比上一份新，要在 `--notes` 的 JSON（`{"app":[…],"plugins":{"<id>":[…]},"notices":[…]}`）里写更新说明；`plugins` 从 `compat.json` 生成（去掉 `project`、`jar`、`kind`），`sources` 用 `webui-update.mjs` 的 `DEFAULT_SOURCES`（服务器和 GitHub 仓库 `muxue-mcbot/mcbot` 只写在那里）。网站首页 `site/index.html` 按 `compat.json` 填好 MC、NeoForge、Java 版本后每次都换，页面自己读 `index.json` 显示下载、更新说明、公告和插件。先复制新文件，最后写 `index.json`；发布目录里同名文件大小不同就停下。只生成，上传前要先问用户。
- 上传（`publish.mjs`）：顺序是 GitHub → 下载服务器 → 站点服务器，清单换掉时文件都已就位。`--github` 传 GitHub Releases（tag 打在当前提交上，提交要先推送；每个 tag 一个 Release，已有的只补缺的文件，`index` Release 每次覆盖 `index.json`）；`--files-ssh`、`--files-dir`（可选，对方是 Linux）把安装包和 jar 另传到下载服务器，每个文件先传成 `.part` 再改名；`--ssh`、`--dir`（对方是 Windows 的 OpenSSH）传网站首页和 `index.json`，不另放下载文件时 `app/`、`core/`、`plugins/` 也传到这里，这些文件直接传到最终文件名，只有 `index.json` 先传成 `.tmp` 再改名。两边都是同名同大小跳过、大小不同就停下。服务器的 ssh 别名和目录不写进仓库，跑的时候用参数给；以后不再另放下载文件时去掉 `--files-ssh`、`--files-dir` 即可（先把只在下载服务器上的文件放回站点服务器）。在 Git Bash 里运行时 `/` 开头的 Linux 路径会被改写成 Windows 路径，用 pwsh 运行或加 `MSYS_NO_PATHCONV=1`：

  ```
  node scripts/publish.mjs --github --files-ssh <下载服务器别名> --files-dir <下载目录> --ssh <站点服务器别名> --dir <站点目录>
  ```
- Node 用官方 zip 版：解压到 `runtime/node-dist/node-v<版本>-win-x64`（被 git 忽略），脚本默认用版本最新的那个；安装版 Node 没有 LICENSE，会拒绝。
- 不联网：运行依赖复制 `client-runtime/node_modules` 再 `npm prune --omit=dev`；打包前先跑 `compat.json` 核对。
- 安装和卸载演练过（10-14 静默安装、覆盖安装、静默卸载；10-15 桌面窗口版的静默和有界面卸载），还没测：有界面的安装对话框、干净 Windows 上安装、未签名时 SmartScreen 的提示。测试安装目录不要放在很深的路径下：运行端依赖里最深的文件会超过 260 字符，Inno 报 MoveFile 错误代码 3。试安装时用改过 AppId、名称、快捷方式、数据目录的安装脚本副本，不碰已装的 mcbot。
