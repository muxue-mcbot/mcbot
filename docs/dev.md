# 开发与验证

修改前读取根目录 `AGENT.md`。本仓库是独立整理的源码快照，原个人备份仓库、Git历史、玩家记忆、存档和运行凭据未迁入。

## 当前路径

- `client-runtime/`：共享Body契约、ServerBody／ClientBody实现、MCP工具、任务与陪伴状态。
- `mods/mcbot-server-control/`：当前主线核心模组，MC1.21.1／NeoForge21.1.217服务端身体与原生交互。共用代码在 `src/main/java`（Java 17 写法、只用原版类），1.21.1 NeoForge 的入口、事件桥和版本垫片在 `src/neoforge-1.21.1`。`mods/mcbot-server-control-forge1201/` 是 1.20.1 Forge 的构建工程，编同一份共用代码加 `src/forge-1.20.1`；1.20.1 层还没写，现在编不过，不在下面的离线验证里（见 [1.20.1 Forge 移植](forge_1201_port.md)）。
- 适配附属模组（各自用自己的 `gradlew` 构建，编译时要用核心的 jar）：`mods/mcbot-kaleidoscope-cookery/`（森罗厨房）、`mods/mcbot-sophisticated-backpacks/`（精致背包）、`mods/mcbot-iron-furnaces/`（铁炉）、`mods/mcbot-yes-steve-model/`（Yes Steve Model 外观）、`mods/mcbot-farmers-delight/`（农夫乐事）。锁的版本和证据见 `compat.json`，接口见 [Mod 适配](mod_adapters.md)。
- `scripts/companion.mjs`、`scripts/driver/`、`scripts/agents/`：Claude／Codex会话驱动和事件调度。`companion.mjs` 是入口，实现按职责分在 `scripts/driver/`（各模块管什么见[状态归属](state_ownership.md)最后一节）；驱动器只能 import `scripts/` 里的模块，打安装包时按 import 收集。
- 程序目录和数据目录分开（`scripts/paths.mjs`，见[更新方式设计](update_design.md)第一节）：本文说的 `runtime/`、`memory/` 都在数据目录里。开发时数据目录就是仓库根目录；安装版（程序目录里有安装标记 `install.json`）用 `%LOCALAPPDATA%\mcbot`；环境变量 `MCBOT_HOME` 可以另指。Agent 的工作目录始终是程序目录（Claude Code 从这里读 `CLAUDE.md`）。
- 服务端、运行端、驱动器三层各管哪些状态，`runtime/` 里的文件谁写谁读，见[状态归属](state_ownership.md)。
- 托管的两个时长（心跳多久算新鲜、叫停多久没确认就兜底撤销）只写在 `client-runtime/host-timing.json`，驱动器、WebUI（经 `scripts/host-timing.mjs`）和运行端、旧 `mcp-server` 的 `presence.ts` 都读它；见[状态归属](state_ownership.md)第 4、6 条。
- 长期记忆：运行端 `client-runtime/src/memory.ts`、`memory-tools.ts`（字数上限在 `client-runtime/memory-limits.json`），驱动器 `scripts/driver/memory.mjs`、`consolidation.mjs`，WebUI `scripts/webui-memory.mjs`；见[记忆方案](memory_plan.md)。
- WebUI（`scripts/webui*.mjs`）见[本地 WebUI](webui.md)；打包、版本号和发布脚本见[打包和发布](release.md)。
- `mcp-server/`：保留的Mineflayer实现及宿主回归；真实验证用的协议测试玩家也依赖其依赖包。它不是新ServerBody的产品依赖。
- `mods/mcbot-control/`、`mods/mcbot-server-spike/`：保留的ClientBody与早期服务端实验，不作为默认主线继续扩大。

## 离线验证

Node.js版本要求以两个包的`package.json`为准；当前验收使用Node24，Java模块使用JDK21。首次安装需要访问包源。

```pwsh
Set-Location client-runtime
npm ci
npm test
Set-Location ../mcp-server
npm ci
npm test
Set-Location ../mods/mcbot-server-control
./gradlew.bat build
# 附属模组编译时要用核心的 jar，先构建核心
foreach ($m in 'kaleidoscope-cookery', 'sophisticated-backpacks', 'iron-furnaces', 'yes-steve-model', 'farmers-delight') { Set-Location ../mcbot-$m; ./gradlew.bat build }
```

`mcp-server`的不少测试直接加载`dist/`：`npm test`会先构建，单独用`node --test tests/xxx.test.mjs`跑某个文件前要先`npm run build`，否则报找不到模块，那是没构建，不是测试原本就失败。

新加 MCP 游戏工具时，要在`client-runtime/tool-registry.json`里写一条：`kind`、`needsIdle`、`moves`、`resumable`（工具在服务端用别的操作名跑时写`runsAs`，比如`go-to`远路是`travel-to`），说明见文件开头；`clientOnly`的是只给旧 ClientBody 的工具（10-11 合并工具后留下的旧名字，见[工具整理方案](tool_consolidation_plan.md)）。`mcp.ts`只注册表里有的工具，开始前的“忙不忙”统一按表检查，处理函数里不要再写`assertIdle`；Codex 白名单就是这张表。`mcp-server`的`tool-allowlist.test.mjs`核对表和实际注册的工具是否一致。

支持范围的清单是根目录的`compat.json`（网站、README、WebUI模组页都读它）；改了模组里锁的版本或jar版本号，要同步改清单，`node scripts/check-compat.mjs`核对，`mcp-server`的`npm test`也会跑。

Linux 上跑 Gradle 要用 UTF-8 locale（`LC_ALL=C.UTF-8 bash ./gradlew build`），否则 `HostingRulesTest` 里带中文的存档路径会报 `InvalidPathException`（10-10 云端复验时遇到，Windows 不受影响）。

Java检查由`controlTest`接入`check`，标准Gradle `test`任务关闭；`check`还包括`loaderNeutralCheck`：共用的`src/main/java`里不准出现`net.neoforged`、`net.minecraftforge`，加载器和版本专有的代码放版本目录，为1.20.1 Forge和以后的Fabric版留边界（见[工作站设计](workstation_design.md)）；应查看实际检查输出，不能仅凭`test SKIPPED`断言没有检查。Windows原生窗口截图、进程控制等用例不能外推为云端通过。

## 新加附属模组的步骤

1. 照现有的附属模组（比如 `mods/mcbot-farmers-delight`）建 `mods/mcbot-<x>`：`settings.gradle` 的项目名、包名、`src/main/templates/META-INF/neoforge.mods.toml` 的 mod id；`build.gradle` 按核心 `gradle.properties` 的 `mod_version` 拼核心 jar 名，不写死；mods.toml 对核心的要求写 `[${core_min},)`，NeoForge 下限和 `compat.json` 的 `loaderMin` 一致。代码里写被适配模组的 mod id 和确切版本，登记给 MCBOT 的 id 用被适配模组的命名空间。接口见 [Mod 适配](mod_adapters.md#java-附属模组)。
2. `compat.json` 的 `adapters` 加一条：`kind: "addon"`、`project`、`jar`、`coreMin`、`what`、`evidence`，`requires` 里写被适配模组的 mod id、确切版本、许可证和 Modrinth 的 url、文件名、大小。
3. `gradle.properties` 的 `core_min` 和清单的 `coreMin` 同值。用到核心新接口时，先 `node scripts/set-version.mjs app <新版本>` 提核心版本，再 `node scripts/set-version.mjs <插件 id> <版本> --core-min <新核心版本>`（清单里要先有这一条）；`check-compat` 不许 `coreMin` 高于核心版本。
4. `node scripts/check-compat.mjs` 核对 jar 名、版本锁、`coreMin`、mods.toml 和登记的 id；先构建核心再构建它，离线验证的循环里加上它。
5. 发布顺序：gradle 构建（核心先）→ `package.mjs` 打安装包（不带 jar，但 `release.mjs` 每次都要读它）→ `release.mjs --notes`（按清单收它的 jar，要写 `plugins.<插件 id>` 的更新说明）→ `publish.mjs`（上传前先问用户），见[打包和发布](release.md)。

## 接入游戏

先由服主准备获授权的MC1.21.1／NeoForge21.1.217隔离服务器，备份后安装自行构建的控制Mod；配置见模块README。控制Mod生成的`connection.json`只留本地。

日常用法是在[本地 WebUI](webui.md)的「配置」页保存配置、点「保存并启动托管」；下面的脚本是同一件事的命令行版本。逻辑在只要 Node 的 `scripts/start-server-play.mjs`（参数是 `--connection-file`、`--agent`、`--prepare-only` 这种写法，WebUI 和安装版都直接用它），`start-server-play.ps1` 只是把同名参数转过去：

```pwsh
node scripts/start-server-play.mjs --connection-file '<server>/config/mcbot-server-control/connection.json' --agent claude --prepare-only
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent codex -Effort low
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent claude -PrepareOnly
```

当前仅支持loopback。目前只支持生存模式：单人游戏开局域网时，游戏模式请选「生存」；Bot 第一次接管（世界里还没有它的玩家存档）时服务端把它设成生存；已有存档又不是生存模式时拒绝接管（`FORBIDDEN`），不会自动切换。不要安装spike和正式控制Mod到同一实例。

Agent账号由使用者在本机配置；每轮真实模型测试前先问用户用哪个账号，不自动切换、回退或复制凭据，`-ConfigDir "$env:USERPROFILE/.claude-b"`这类参数只选本机已有的登录环境。启动入口可选`-NodePath '<本机Node可执行文件>'`，同时用于宿主与MCP，不改变全局PATH。

`scripts/server-*-smoke.mjs`和`*-agent-trial.mjs`是专用隔离服夹具脚本，依赖本地备份记录、端口和存档；干净clone不具备这些条件，不要直接对日常存档运行。RCON只用于夹具和独立核对，ServerBody产品路径不需要它。`MC_SERVER_DIR`可指定RCON所读的本地服务器目录。

## dsh（DeepSeek Harness）

dsh 锁定在 `0.2.0-rc.2`，装在 `runtime/dsh`，也可以用 DeepSeek Harness 桌面版自带的；启动用 `./start-server-play.ps1 -Agent dsh -ConnectionFile <connection.json>`。安装、找 dsh 的顺序和补丁见 [dsh](dsh.md)。

## 本地 WebUI

`node scripts/webui.mjs --open`（默认端口 8770）。界面文字按[界面文案规范](ui_text.md)写，改了运行 `node scripts/check-ui-text.mjs`；只监听 `127.0.0.1`、带一次性令牌。各页的做法见[本地 WebUI](webui.md)。

## 打包安装包

`node scripts/package.mjs` 打程序目录和安装包，`scripts/set-version.mjs` 改版本号，`scripts/release.mjs` 摆发布目录，`scripts/publish.mjs` 上传（公开操作，先问用户）。见[打包和发布](release.md)。

## 单人模式实测

模组自带开发客户端，游戏目录在 `mods/mcbot-server-control/run/client`（被 git 忽略），不动启动器实例。先在 `run/client/saves/<存档>` 放一份测试世界，`run/client/options.txt` 里写 `pauseOnLostFocus:false`，然后：

```pwsh
./gradlew.bat runClient -PquickPlay=<存档> "-PcommandFixture=<run/client的绝对路径>/mcbot-fixture"
node scripts/singleplayer-smoke.mjs --game-dir '<run/client的绝对路径>' --player Dev --world <存档> [--cheats]
```

`-PcommandFixture` 打开只用于验收的命令文件夹具（内置服务器没有 RCON），独立服务器上不生效。运行时桌面会弹出游戏窗口。

## 进度与证据

当前进度和每一步的验证记录看[交付计划](delivery_plan.md)，第一次看这个仓库先读[评审入口](review_guide.md)。已完成的批次验收、旧计划和 10-03 的旧评审入口在 `archive/`。

报告证据时把三类分开：离线测试、隔离服实测（脚本驱动真实服务器，不用模型）、真实模型试玩。隔离服实测脚本是 `scripts/server-*-smoke.mjs`，要用本机的隔离服、存档备份和端口；原始日志、存档和 `output/` 不随仓库分发。已知偶发：Node 24.15 原生退出 0xC0000409（重跑通过，原因没查到，可用 `-NodePath` 换 24.19）、mcp-server 的 vision 浏览器清理测试、导航与防卫里的高处拾取那项。

隔离服实测要原版协议测试玩家时（陪挖、保护、导航与防卫等），先把核心以外的模组临时挪出 `mods`，测完放回；装着客户端模组时原版协议客户端进不了服。
