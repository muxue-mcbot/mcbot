# 开发与验证

修改前读取根目录 `AGENT.md`。本仓库是独立整理的源码快照，原个人备份仓库、Git历史、玩家记忆、存档和运行凭据未迁入。

## 当前路径

- `client-runtime/`：共享Body契约、ServerBody／ClientBody实现、MCP工具、任务与陪伴状态。
- `mods/mcbot-server-control/`：当前主线，MC1.21.1／NeoForge21.1.217服务端身体与原生交互。
- `scripts/companion.mjs`、`scripts/driver/`、`scripts/agents/`：Claude／Codex会话驱动和事件调度。`companion.mjs` 是入口，实现按职责分在 `scripts/driver/`（各模块管什么见[状态归属](state_ownership.md)最后一节）；驱动器只能 import `scripts/` 里的模块，绿色版按 import 收集。
- 程序目录和数据目录分开（`scripts/paths.mjs`，见[更新方式设计](update_design.md)第一节）：本文说的 `runtime/`、`memory/` 都在数据目录里。开发时数据目录就是仓库根目录，和以前一样；安装版（程序目录里有安装标记 `install.json`）用 `%LOCALAPPDATA%\mcbot`；环境变量 `MCBOT_HOME` 可以另指。Agent 的工作目录始终是程序目录（Claude Code 从这里读 `CLAUDE.md`）。
- 服务端、运行端、驱动器三层各管哪些状态，`runtime/` 里的文件谁写谁读，见[状态归属](state_ownership.md)。
- 托管的两个时长（心跳多久算新鲜、叫停多久没确认就兜底撤销）只写在 `client-runtime/host-timing.json`，驱动器、WebUI（经 `scripts/host-timing.mjs`）和运行端、旧 `mcp-server` 的 `presence.ts` 都读它；见[状态归属](state_ownership.md)第 4、6 条。
- 长期记忆：运行端 `client-runtime/src/memory.ts`、`memory-tools.ts`（字数上限在 `client-runtime/memory-limits.json`），驱动器 `scripts/driver/memory.mjs`、`consolidation.mjs`，WebUI `scripts/webui-memory.mjs`；见[记忆方案](memory_plan.md)。
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
Set-Location ../mcbot-yes-steve-model   # 附属模组编译时要用核心的 jar，先构建核心
./gradlew.bat build
```

`mcp-server`的不少测试直接加载`dist/`：`npm test`会先构建，单独用`node --test tests/xxx.test.mjs`跑某个文件前要先`npm run build`，否则报找不到模块，那是没构建，不是测试原本就失败。

新加 MCP 游戏工具时，要在`client-runtime/tool-registry.json`里写一条：`kind`、`needsIdle`、`moves`、`resumable`（工具在服务端用别的操作名跑时写`runsAs`，比如`go-to`远路是`travel-to`），说明见文件开头；`clientOnly`的是只给旧 ClientBody 的工具（10-11 合并工具后留下的旧名字，见[工具整理方案](tool_consolidation_plan.md)）。`mcp.ts`只注册表里有的工具，开始前的“忙不忙”统一按表检查，处理函数里不要再写`assertIdle`；Codex 白名单就是这张表。`mcp-server`的`tool-allowlist.test.mjs`核对表和实际注册的工具是否一致。

支持范围的清单是根目录的`compat.json`（网站、README、WebUI模组页都读它）；改了模组里锁的版本或jar版本号，要同步改清单，`node scripts/check-compat.mjs`核对，`mcp-server`的`npm test`也会跑。

Linux 上跑 Gradle 要用 UTF-8 locale（`LC_ALL=C.UTF-8 bash ./gradlew build`），否则 `HostingRulesTest` 里带中文的存档路径会报 `InvalidPathException`（10-10 云端复验时遇到，Windows 不受影响）。

Java检查由`controlTest`接入`check`，标准Gradle `test`任务关闭；`check`还包括`loaderNeutralCheck`：只有`build.gradle`里登记的加载器文件能用`net.neoforged`，其余代码只用原版类，为以后的Fabric版留边界（见[工作站设计](workstation_design.md)）；应查看实际检查输出，不能仅凭`test SKIPPED`断言没有检查。Linux可用`bash ./gradlew build`，但本次整理版仅在Windows复验；Windows原生窗口截图、进程控制等用例不能直接外推为云端通过。

## 接入游戏

先由服主准备获授权的MC1.21.1／NeoForge21.1.217隔离服务器，备份后安装自行构建的控制Mod；配置见模块README。控制Mod生成的`connection.json`只留本地。

日常用法是在 [本地 WebUI](#本地-webui) 的「配置」页保存配置、点「保存并启动托管」（2026-10-08 起用户自己从 WebUI 启动托管）；下面的脚本是同一件事的命令行版本。逻辑在只要 Node 的 `scripts/start-server-play.mjs`（参数是 `--connection-file`、`--agent`、`--prepare-only` 这种写法，WebUI 和绿色版都直接用它），`start-server-play.ps1` 只是把同名参数转过去：

```pwsh
node scripts/start-server-play.mjs --connection-file '<server>/config/mcbot-server-control/connection.json' --agent claude --prepare-only
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent codex -Effort low -PrepareOnly
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent codex -Effort low
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent claude -PrepareOnly
./start-server-play.ps1 -ConnectionFile '<server>/config/mcbot-server-control/connection.json' -Agent claude
```

当前仅支持loopback。目前只支持生存模式：单人游戏开局域网时，游戏模式请选「生存」；Bot 第一次接管（世界里还没有它的玩家存档）时服务端把它设成生存；已有存档又不是生存模式时拒绝接管（`FORBIDDEN`），不会自动切换。Agent账号由使用者在本机配置；真实模型测试前确认使用的账号，不自动切换或复制凭据。Codex可用同一入口的`-Agent codex`。不要安装spike和正式控制Mod到同一实例。

2026-10-03用户指定Claude-b；该日之后每轮真实Claude测试先问账号，不擅自回退。`-ConfigDir "$env:USERPROFILE/.claude-b"`仅选本机已有登录环境。

启动入口可选`-NodePath '<本机Node可执行文件>'`，同时用于宿主与MCP，不改变全局PATH。本机Node24.15出现过0xC0000409原生退出；本批完整实服／模型／运行端回归使用已存在的独立Node24.19通过。原因尚未定论，不能把新运行时短测通过当作历史退出根因已解决，见[第一批验收](archive/server_survival_alpha_validation.md)。

`scripts/server-*-smoke.mjs`和`*-agent-trial.mjs`是专用隔离服夹具脚本，依赖本地备份记录、端口和存档；干净clone不具备这些条件，不要直接对日常存档运行。RCON只用于夹具和独立核对，ServerBody产品路径不需要它。`MC_SERVER_DIR`可指定RCON所读的本地服务器目录。

## dsh（DeepSeek Harness）

dsh 锁定在 `0.2.0-rc.2`，装在仓库的 `runtime/dsh`（被 git 忽略，依赖约 500MB），不全局安装：

```pwsh
cd runtime/dsh
npm install --save-exact @deepseek-ai/dsh@0.2.0-rc.2
```

托管时驱动器用 `dsh --profile acp` 加生成的补丁启动它（只留游戏工具；ACP 发不了 `/compact`，补丁把 dsh 自己的自动压缩设成在 `--rotate-tokens` 触发，宿主不给 dsh 换会话），`DSH_HOME` 默认是 `runtime/dsh/home`，不写用户的 `~/.dsh`。DeepSeek 凭据由使用者用环境变量 `DEEPSEEK_API_KEY` 或 dsh 自己的凭据配置提供，仓库和脚本都不保存。启动：`./start-server-play.ps1 -Agent dsh -ConnectionFile <connection.json>`。别处的 dsh 可用 `MCBOT_DSH_BIN` 指到它的 `lib/bin.js`。

也可以直接用 DeepSeek Harness 桌面版自带的 dsh（默认装在 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，别的位置用 `MCBOT_DSH_DESKTOP` 指到安装目录）：驱动器用它的 Electron 加 `ELECTRON_RUN_AS_NODE=1` 跑 `app.asar` 里的命令行，和它自带的 `dsh.cmd` 一样。找 dsh 的顺序：`MCBOT_DSH_BIN` > `MCBOT_DSH_DESKTOP` > `runtime/dsh` 的锁定安装 > 默认位置的桌面版。想用桌面版里已经配好的 Key，就把 `DSH_HOME` 设成 `~/.dsh`；这会在 `~/.dsh/profiles` 里多一个 `acp` profile，会话也记在 `~/.dsh/sessions`，桌面版自己的 profile 不受影响。桌面版会自动升级，版本和 `0.2.0-rc.2` 不同时要重测补丁。

## 本地 WebUI

```pwsh
node scripts/webui.mjs --open      # 默认端口 8770，--port 换端口，--runtime 指定别的 runtime 目录
```

- 界面上的文字按[界面文案规范](ui_text.md)写：书面语，状态用固定词（「已安装」「未安装」，不写「已装好」「没装」）；改了界面文字运行 `node scripts/check-ui-text.mjs`，`mcp-server` 的 `npm test` 也会查。
- 页面风格参考 NapCat WebUI（渐变背景加模糊光斑、透明侧栏、胶囊顶栏和按钮、半透明毛玻璃卡片），颜色、图标、字样都是自己的，没有用它的代码和素材；有亮色、暗色和跟随系统三种主题，窄屏时侧栏变成抽屉。页面在 `scripts/webui-page.html`（单个内联 HTML，不依赖外部资源，改完要重启 WebUI）；下拉框是自己写的组件（原生 select 只当数据存着），按钮、开关、折叠区和列表都有动画，列表按 key 原地更新，不会每次刷新都重画。
- 模型列表从本机 CLI 读（`scripts/agent-models.mjs`），都不发对话消息、不消耗额度：Claude Code 用 stream-json 只发 `initialize` 控制请求（关掉 hooks、不挂 MCP 和工具），返回里有每个模型支持的思考强度；Codex 用 `codex debug models`；dsh 开一个空的 ACP 会话读 `configOptions`（第一次约 20 秒，会在 DSH_HOME 留一条空会话记录）。按 Agent 和账号目录缓存在 `runtime/webui-models.json`，1 小时内不重读，页面上可以「重新读取」。思考强度跟着选中的模型变；读不到列表时 Claude 只给 opus／sonnet／fable／haiku 这几个别名。
- 「设置」页（10-14）：显示数据目录和程序目录，「打开数据目录」用资源管理器打开数据目录（不存在就先建）。
- 主程序更新和公告（10-14，`scripts/webui-update.mjs`，设计见[更新方式](update_design.md)第六、七节）：WebUI 打开时在后台按来源顺序读一次总清单 `index.json`（每个来源最多等 5 秒，默认来源在文件开头 `DEFAULT_SOURCES`，清单里的 `sources` 排在前面），读到就存进 `runtime/update-index.json`，读不到时页面按上次的结果显示并注明失败。有新版本时页面顶部提示，可展开更新说明、在浏览器中下载，或点「更新」：没有托管在跑（心跳之外还查从程序目录启动的 node 进程）、插件页没有在装卸时，下载安装包到 `runtime/updates`（只比大小，60 秒收不到数据算超时，一个来源失败换下一个），用 `/SILENT /SUPPRESSMSGBOXES /NORESTART` 运行后 WebUI 以退出码 0 退出。开发环境（程序目录没有安装标记）只检查、不更新。公告按 `appMin`～`appMax` 筛选，打开时弹出没看过的，点「知道了」后 id 记进 `runtime/notices-seen.json`；「设置」页显示当前版本、「检查更新」和全部公告。
- 只监听 `127.0.0.1`。每次启动生成一次性令牌，终端里打印的地址带着它，打开后存进 Cookie；不带令牌、Host 不是本机地址的请求都拒绝，别的网页没法调它。
- 只读驱动器写在 `runtime/` 里的文件：心跳 `companion-<名字>.json`（在线、是否在推理）、会话 `session-<名字>.json`（上下文大小、上次请求）、活动记录 `activity-<名字>.jsonl`（游戏事件和聊天、AI 回复、工具调用、每轮开始和结束、驱动器提示；驱动器启动时超过 5MB 就轮转，运行中不轮转）。三家 Agent 都走同一个驱动器，记录格式一样。
- 页面上的「陪伴模式」「最近工具」「最近出错」是从记录里推算的。
- 快速开始（10-15）：没有任何配置档案、也没有托管记录时，「监控」页换成五步引导（准备 AI、选择游戏、安装插件、打开世界、启动托管），前两步按账号目录和已添加的游戏标出是否完成，按钮跳到「配置」对应的标签页；保存第一个配置或有了 Bot 之后不再显示。左下角显示当前版本，有新版本时标出，点了去「设置」。
- 「叫停」放 `companion-<名字>.halt` 标记，是急停：驱动器撤销控制、结束这一轮 Agent（对话保留，托管不退出），等玩家用名字或昵称给新任务（目前只支持 ServerBody）。游戏里说“等一下”（暂停）或“停”（取消）由运行端原地停下，Agent 和对话不断，见 `client-runtime/player-stop.json` 和[陪伴体验评审](companion_experience_review.md)第 1 条；「停止托管」放 `companion-<名字>.stop`，和 `stop-companion.ps1` 一样让驱动器退出。WebUI 不碰游戏，关掉它不影响托管。
- 「配置」页（`scripts/webui-profiles.mjs`、`scripts/webui-games.mjs`）：按档案保存启动参数，存在 `runtime/webui-profiles.json`，不进仓库。10-10 按小白的操作顺序分成标签页（第一次给朋友试玩前用户要求的，一次只看一块，信息别太密）；页面上的顺序是连接配置、角色、灵魂设置、记忆、行为、插件、高级，下面按功能写：
  1. **连接配置**：先选模式「单人 / 局域网」或「服务器」（有 `server.properties` 的目录算服务器），再从本机的游戏目录里点一个（Prism、ElyPrism、MultiMC、PolyMC 的实例，`%APPDATA%\.minecraft` 和它 `versions` 下的版本隔离目录；服务器和找不到的手动粘贴目录添加，记在 `runtime/webui-games.json`），每个显示核心模组装没装、版本和主程序是否一致（10-14 起按 mods.toml 的版本比；仓库里有本地构建时版本相同再比字节）、开没开过世界、世界现在开着没有（用连接文件问一次 hello）。10-10 起还读游戏版本（实例的 `mmc-pack.json`、服务器 `libraries` 里的 NeoForge、版本隔离目录的版本 json），不是 `compat.json` 的 Minecraft 版本加 NeoForge 下限以上的标「不支持的版本」、排在最后，插件页不让装；读不出版本的不拦。地址固定是本机（控制口只开在 127.0.0.1，服务器模式要在开服的那台电脑上运行；远程地址以后单独做），端口可改（写 `server.json` 的 `port`，默认 8766）。10-10 起档案只存游戏目录、模式、名字和端口，**连接文件不出现在网页上**：它在 `<游戏目录>/config/mcbot-server-control/connection.json`，模组每次开世界都换令牌重写；旧档案的 `connectionFile` 读的时候换成游戏目录。
  2. **角色**：游戏名（存在档案里，保存和启动托管时写进游戏目录的 `server.json`，只改 `username` 和 `port`，没有文件就按模组默认值建一个；模组开世界时读，世界开着要退出重进）、昵称（留空时用游戏名，不再有预设昵称）、外观卡片（YSM 模型的显示名读 `ysm.json`；世界没开时直接列 `config/yes_steve_model/custom` 里的模型，要装了 YSM 适配）。头像是像素史蒂夫（默认外观），不再用名字首字母。可导入 YSM 模型：一个 `.ysm` 文件或一个带 `ysm.json`／`main.json` 的模型文件夹，网页读成 base64 发给本机服务，写进所选游戏的 `config/yes_steve_model/custom`（要装了 YSM 插件，不覆盖同名，合计最多 64 MB，只写游戏列表里的目录）。普通皮肤（png）不做：Bot 是服务端模拟的玩家，原版客户端只显示 Mojang 皮肤服务器上签过名的皮肤（10-10 用户定先只支持 YSM）。
  3. **灵魂设置**：Agent、凭据、模型、思考强度、账号目录（新建 dsh 配置时有 `~/.dsh` 就默认用它）、人设。人设编辑的就是托管时带上的 `persona.md`，位置是 `<记忆目录>/<游戏名小写>/persona.md`（10-10 起各 Agent 一样，`start-server-play.mjs` 把 `--memory-agent <游戏名小写>` 传给驱动器；记忆目录留空时 Claude 用仓库的 `memory`，dsh、Codex 用 `runtime/<agent>-memory`）；改游戏名时把已有的人设带到新名字下。不再有写死的 `xiaoke` 目录和「填入示例」模板；说话风格放在人设里，不写死在系统指令里。长期记忆见[记忆方案](memory_plan.md)。
  4. **行为**：保护玩家（开关、用弓、举盾、范围、撤退血量，见[协议](server_body_protocol.md#保护玩家8h2026-10-08)）。
  5. **插件**（10-10，`scripts/webui-plugins.mjs`）：按 `compat.json` 把核心模组和每个适配当成插件，装进或卸出「连接配置」选中的游戏目录。状态按实际文件判断：读 `mods` 里每个 jar 的 `META-INF/neoforge.mods.toml`（只看 `[[mods]]` 段，`${file.jarVersion}` 用 MANIFEST 的版本）得到 mod id 和版本，我们自己的 jar 按版本比较（10-14，见下面「更新」），通用物品槽插件看 `item-handlers.json` 有没有这一条。一个插件 = 我们的附属 jar ＋ 被适配模组本体（确切版本）＋ 要写的配置，一起装；核心没装或是旧版时一起装上。点按钮先出计划（下载什么、放进什么、移走什么、改哪个配置，下载写文件名、大小、来源和许可证），确认后在后台执行，网页轮询进度：先下载（第三方模组只从清单里的 Modrinth 地址，大小对上才用；我们的 jar 按来源顺序从更新服务器或 GitHub 下载，大小和 mods.toml 里的 mod id、版本都对上才用，仓库里有同名本地构建时直接复制；都存进 `runtime/mod-downloads` 下次直接用），再把要换掉的旧文件和改之前的配置挪进 `<游戏目录>/mcbot-backups/<时间>/`（不删），再放新文件；中途出错就改回原样（改回也可能失败，比如文件被游戏占用：这时不说“已恢复原状”，接口返回 `rolledBack: false`、没恢复的文件 `rollbackFailed` 和备份目录，页面逐个列出该把哪个文件放回、删掉哪个，让用户关掉游戏后手动处理）。卸载只移走我们的适配 jar 或配置条目，模组本体留着（世界里可能有它的方块）；核心本身不在这里卸。游戏或服务器开着时不改（世界开着即能问通 hello；加载中和主菜单时看有没有 `java`/`javaw` 进程的 `--gameDir` 指向该目录，服务器看命令行里的目录，见 `scripts/game-processes.mjs`；查不了进程也拒绝，下载前后各查一次）；服务器模式提醒带「客户端也要装」的模组玩家自己也要装。接口只接受游戏列表里的目录（外观列表 `/api/appearances` 和保存配置 `/api/profiles/save` 也一样，不在列表里的目录返回“不在游戏列表中”；目录进列表靠自动找到或在连接配置里手动添加，所以首次配置不受影响）。每个已安装的插件有「给 AI 使用」开关（10-10 晚）：默认开启，按游戏目录存在 `runtime/webui-plugins.json`（不写进游戏目录，清单里删掉的插件自动失效），下次启动托管时生效；启动时启动器读当前开关，作为 `--disabled-plugins` 传给 `start-server-play.mjs`，再写进 `mcp.json` 的运行端参数，运行端注册工具前统一过滤 hello、硬调返回 UNSUPPORTED（见[协议](server_body_protocol.md)的「插件开关和插件说明」和 [Mod 适配](mod_adapters.md#给-ai-用开关)）。附属模组可用 `McbotApi.registerHint` 带给 AI 的用法说明，运行端只收开着的官方插件：托管时工具描述里只列插件名，说明随这个工具第一次调用附上（10-12）；不托管时附在对应工具的描述末尾。
     - **更新**（10-14，[更新方式](update_design.md)第八节）：核心要装的版本 = 主程序版本，地址按规则拼（`core/<jar>`、`app-v<版本>`）；适配插件要装总清单（`runtime/update-index.json`）里满足 `coreMin` 的最新版，清单里的条目连同被适配模组的版本一起换，主程序太旧时卡片提示先更新主程序；没有清单按 `compat.json` 的版本、地址按 `plugins/<jar>`、`<插件id>-v<版本>` 拼，并注明插件版本信息检查于何时。游戏里的比要装的旧显示「需更新」；核心比主程序新显示「版本较新」，不在这里装。10-14 定版本号方案之前的 jar 都是 0.1.0，要装的版本低于 0.1.0 时当旧版。顶部「全部更新」把核心和已安装的插件一起出计划；「从此游戏移除 mcbot」把核心、所有适配 jar 和 `config/mcbot-server-control/` 移到备份，被适配的模组本体保留。
  6. **记忆**（10-12，`scripts/webui-memory.mjs`）：看当前档案角色的回忆、约定和想做的事、最近几天、玩家档案、各世界现状和每天的日志（10-13 起约定、最近几天和日志按世界分开列）；只能删某段的一行或某一天的日志（日志不能删单行），删之前把原文件复制到 `runtime/memory-backup/`，删行时拿和运行端同一把写锁、核对行内容没变；删一天时也在锁里先把文件改名移开再读、备份、删（运行端追加日志不拿锁，这样读之后追加的一行不会连文件一起没了），整理游标正好在这一天时退到当天的 `#0`（当天之后新写的日志从 1 重新编号，不会被当成已整理）；不提供编辑，人设仍在「灵魂设置」里改。
  「高级」标签里有凭据、记忆目录、蓝图目录、Node 路径和会话选项；每项对应 `scripts/start-server-play.mjs` 的同名参数。托管退出后按日志区分「游戏已关闭，托管结束」「已停止」「托管异常退出」「启动失败」，不再一律显示启动失败。「保存并启动托管」用跑 WebUI 的同一个 Node 执行 `scripts/start-server-play.mjs --headless --wait --username <名字>`（10-10 起不再需要 PowerShell），脚本输出写 `runtime/webui-launch-<角色>.log`，没起来时页面显示退出码和输出。
  - **先开托管还是先开世界都行**（10-10 实测反馈：先开托管再开局域网进不来、改名没生效、死了不复活）：`--wait` 时启动脚本每 2 秒重新读连接文件，用 `respawn` 探一次能不能接管——服务端在接管前检查单人有没有开局域网、是不是暂停，死了的角色顺便原生复活，活着的回 `INVALID_ARGUMENT`。没开世界、没开局域网、暂停、世界里的名字和配置不一样时页面显示「等待中：…」，「停止托管」也能停（启动脚本看 `companion-<名字>.stop`）。能接管了才启动驱动器；驱动器带 `--reconnect`，身体断开（游戏关了、退出世界、角色死了，运行端发 `disconnect` 事件）就撤销（不让角色下线）并以退出码 75 退出，启动脚本回去等，能连上时重新启动驱动器（会话照常接着，复活过的告诉 Agent 自己死过）。一连上就断的按次数退避，最多 60 秒一次；别的退出码（停止、崩溃）直接结束。测试用环境变量 `MCBOT_WEBUI_LAUNCH_CMD`（JSON 数组）替换启动命令。
- 配置页只存路径和参数，不存凭据：Agent 用账号目录里已有的登录；档案里出现 `apiKey` 这类不认识的字段会被拒绝。连接文件只在本机读出角色、世界和地址，控制令牌不回传给网页。能从网页启动托管，就等于拿到令牌的人能用你的账号开托管，所以令牌地址不要发给别人。

## 打包安装包

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
- 上传：`publish.mjs` 先传 GitHub（tag 打在当前提交上，提交要先推送；每个 tag 一个 Release，已有的只补缺的文件，`index` Release 每次覆盖 `index.json`），再传服务器（经 ssh 和 scp，对方是 Windows 的 OpenSSH；已有同名同大小的跳过，大小不同就停下；`index.json` 最后传，先传成 `.tmp` 再改名）。服务器的 ssh 别名和目录不写进仓库，跑的时候用参数给。
- Node 用官方 zip 版：解压到 `runtime/node-dist/node-v<版本>-win-x64`（被 git 忽略），脚本默认用版本最新的那个；安装版 Node 没有 LICENSE，会拒绝。10-10 用的是 24.21.0。
- 不联网：运行依赖复制 `client-runtime/node_modules` 再 `npm prune --omit=dev`；打包前先跑 `compat.json` 核对。
- 10-14 演练（0.0.1，安装包 25.5 MB）：在临时目录 `/SILENT` 安装，装完自动开 WebUI；WebUI 开着再装一次，旧 node 被关掉、装完重新打开、旧脚本被删、程序目录里别的目录保留；WebUI 开着时 `/SILENT` 卸载，node 被结束，程序文件、快捷方式、卸载登记都删掉，数据目录保留。还没测：有界面的安装和卸载对话框（删数据的提问）、干净 Windows 上安装、未签名时 SmartScreen 的提示。
- 10-10 的绿色版演练（zip 解压到带中文和空格的目录、dsh 在单人局域网接管 9 分钟）记在 git 历史里；那时修的 zip 文件名编码问题，安装包不再打 zip，不涉及。

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