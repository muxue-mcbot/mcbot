# dsh（DeepSeek Harness）

托管用 `-Agent dsh` 时怎么装、怎么找到 dsh。总规则见[开发与验证](dev.md)。

dsh 锁定在 `0.2.0-rc.2`，装在仓库的 `runtime/dsh`（被 git 忽略，依赖约 500MB），不全局安装：

```pwsh
cd runtime/dsh
npm install --save-exact @deepseek-ai/dsh@0.2.0-rc.2
```

托管时驱动器用 `dsh --profile acp` 加生成的补丁启动它（只留游戏工具；ACP 发不了 `/compact`，补丁把 dsh 自己的自动压缩设成在 `--rotate-tokens` 触发，宿主不给 dsh 换会话），`DSH_HOME` 默认是 `runtime/dsh/home`，不写用户的 `~/.dsh`。DeepSeek 凭据由使用者用环境变量 `DEEPSEEK_API_KEY` 或 dsh 自己的凭据配置提供，仓库和脚本都不保存。启动：`./start-server-play.ps1 -Agent dsh -ConnectionFile <connection.json>`。别处的 dsh 可用 `MCBOT_DSH_BIN` 指到它的 `lib/bin.js`。

也可以直接用 DeepSeek Harness 桌面版自带的 dsh（安装目录从注册表里安装程序登记的卸载项读，装在哪个盘都能找到；读不到时看默认位置 `%LOCALAPPDATA%\Programs\DeepSeek Harness`；也可以用 `MCBOT_DSH_DESKTOP` 直接指到安装目录）：驱动器用它的 Electron 加 `ELECTRON_RUN_AS_NODE=1` 跑 `app.asar` 里的命令行，和它自带的 `dsh.cmd` 一样。找 dsh 的顺序：`MCBOT_DSH_BIN` > `MCBOT_DSH_DESKTOP` > `runtime/dsh` 的锁定安装 > 桌面版（注册表登记的目录，再默认位置）。驱动器启动、WebUI 读模型列表和启动托管前的检查都用 `scripts/agents/dsh-acp.mjs` 的 `locateDsh`。想用桌面版里已经配好的 Key，就把 `DSH_HOME` 设成 `~/.dsh`；这会在 `~/.dsh/profiles` 里多一个 `acp` profile，会话也记在 `~/.dsh/sessions`，桌面版自己的 profile 不受影响。桌面版会自动升级，版本和 `0.2.0-rc.2` 不同时要重测补丁。
