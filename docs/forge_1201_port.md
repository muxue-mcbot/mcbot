# 1.20.1 Forge 移植评估

2026-10-21。用户想让 Bot 支持整合包「香草纪元：食旅纪行」2.7.1，这个包是 MC 1.20.1、Forge 47.3.33。我们现在只支持 MC 1.21.1、NeoForge，所以第一步是把核心移植到 1.20.1 Forge 上。这份文档记下试编的结果、选定的做法和还要做的事。

**进度（10-21）**：在分支 `forge-1.20.1`（worktree `G:\mc\muxue-mcbot-platform-1201`）上做，都没提交。
- 共用代码已改成 Java 17 写法（16 个文件、41 处）。1.21.1 版 `build check` 通过，37 组 `controlTest` 全过，`loaderNeutralCheck` 也过。
- 1.20.1 试编从 396 个错误降到 354 个（36 个文件）。

## 整合包

- 服务端包是 `香草纪元：食旅纪行 Server2.7.1.zip`，1.6 GB，里面有 414 个模组 jar。模组清单在 `runtime/forge1201/vefc-server-mods.txt`（本地，不进仓库）。
- 加载器是 Forge 47.3.33（不是 NeoForge）。包里还带了 Sinytra Connector（用来跑 Fabric 模组）和 KubeJS。
- 和我们的附属模组对得上的有：
  - 农夫乐事 1.2.8，外加几十个 Delight 附属；
  - 森罗厨房 1.3.0；
  - 精致背包 3.23.5；
  - 铁炉 4.1.6。

  这些都是 1.20.1 的版本，和 `compat.json` 里锁的不一样。
- 路线里排着的车万女仆 1.5.3、Handcrafted 3.0.6 也在包里。包里用的是 Refined Storage，没有 AE2；也没有 YSM。
- 运行时可能碍事的：
  - Open Parties and Claims：领地可能拦住 Bot；
  - servercore、immersive_optimization、mobtimizations：会降 tick；
  - Better Combat：改了攻击，可能和 Bot 的战斗冲突；
  - Connector：Fabric 模组的 mixin 也会加载进来。
- 旧的 Mineflayer 身体进不了装了几百个模组的 Forge 服务器（要过模组握手）。所以只能走服务端身体，也就是移植核心。

## 试编

试编工程在 `mods/mcbot-server-control-forge1201`。它用 ModDevGradle Legacy，Forge `1.20.1-47.3.33`、Java 17，直接编译 `mods/mcbot-server-control/src/main/java`，源码一行没改。复现：

```pwsh
$env:JAVA_HOME = 'D:\Java\jdk-21'
./gradlew.bat compileJava --max-workers 2 "-Dorg.gradle.java.installations.paths=D:\Java\jdk-17,D:\Java\jdk-21"
```

第一次要下载并反编译 1.20.1 和 Forge，大约 5 分半。原始报错在 `runtime/forge1201/compile-errors.log`，分组脚本是同目录的 `javac-groups.mjs`。

**结果**：107 个源文件里，64 个原样编译通过，43 个出错，一共 396 个错误。分组如下（每条错误只算进第一组对上的）：

| 类别 | 错误数 | 主要文件 | 怎么改 |
|---|---|---|---|
| 物品组件、附魔、药水、食物、属性（1.20.5／1.21 改的） | 131 | ItemDescriptions 23、GuardCombat 21、ArmourAssessment 14、ProduceTask 14、VanillaWorkstations 12、SurvivalActions 10、ToolAssessment 9、FoodSafety 9 | `DataComponents` 换回 NBT／`PotionUtils`／`EnchantmentHelper`，附魔从数据驱动的 Holder 换回 `Enchantment` 对象，`FoodProperties` 换旧 getter |
| NeoForge → Forge（事件、能力、模组列表） | 128 | ServerController 61、McbotServerControl 31、ValidationProtection 12、NeoForgePlatform 11 | 都在登记的加载器文件里。事件改名（受伤、拾取、tick），`IItemHandler` 改走 `LazyOptional`。Forge 1.20.1 没有 `SweepAttackEvent`，要自己写 mixin |
| Java 21 → 17 | 43 | 分散在 16 个文件 | `getFirst/getLast/reversed/removeFirst`、`Math.clamp` 换成 17 有的写法，纯机械 |
| 寻路 PathType | 32 | NativeNavigation 25、GuardCombat 7 | `PathType` 换回 `BlockPathTypes`；`getPathTypeStatic`、`PathfindingContext` 的签名不同 |
| Bot 上线和连接（1.20.2 加的配置阶段） | 25 | ServerController、BodyPlayer、VirtualConnection、NativeRespawn、两个 mixin | 1.20.1 没有 `CommonListenerCookie`、`ClientInformation`、`ServerCommonPacketListenerImpl`，`placeNewPlayer` 和重生要按旧签名重写 |
| 玩家触及距离（1.20.5 才变成属性） | 17 | 分散在 12 个文件 | 换成 Forge 的 `BLOCK_REACH`／`ENTITY_REACH` 属性，或者用常量 |
| 其他签名变化 | 10 | SurvivalActions、VirtualConnection、PickupItem、FarmTask | `hasCorrectToolForDrops`、`canPlaceLiquid`、`isValidBonemealTarget`、`ItemEntity.getTarget` 等 |
| 1.20.1 里没有的内容 | 6 | HuntTask、LookAround、GuardCombat、BuildTask | 旋风人、试炼刷怪笼、宝库、`Leashable` 拿掉或者换掉 |
| 配方 RecipeHolder／RecipeInput | 4 | VanillaWorkstations、StationQuery | 1.20.1 直接用 `Recipe`，输入用 `Container` |

**试编没覆盖到的**（396 只是下限）：

- javac 遇到解析不了的类型会跳过后面的检查，改完一批还会冒出新的错误。
- mixin 没验证。试编工程没配 mixin 和 refmap，注入点要到运行时才核对。
  - `VirtualPayloadMixin` 的目标类在 1.20.1 里不存在；
  - `PlayerList.respawn` 里 `new ServerPlayer` 的参数不同；
  - `mixins.json` 的 `compatibilityLevel` 要改成 `JAVA_17`。
- `GuardCombat` 按 Mojang 名反射 `Creeper` 的 `explosionRadius`、`maxSwell`。Forge 1.20.1 正式环境用的是 SRG 名，这两个字段会找不到，代码就退回原版数值，不会崩。要改成 `ObfuscationReflectionHelper` 或者 accessor。
- 37 个测试文件没编译。`mods.toml`、重新混淆（reobf）没做。
- 64 个“编译通过”的文件只是能编译，行为对不对要等隔离服实测。

## 版本层的做法（10-21 用户选了“共用代码加版本层”）

**目录**
- `mods/mcbot-server-control/src/main/java`：两版共用的代码。
  - 原地不动，方便 build-speed、build-design 这些分支以后合并。
  - 里面不准出现 `net.neoforged` 和 `net.minecraftforge`，也不准用 Java 17 没有的接口。
- `mods/mcbot-server-control/src/neoforge-1.21.1/{java,resources}` 和 `src/forge-1.20.1/{java,resources}`：每个版本一份，放这些：
  - 模组入口；
  - `LoaderPlatform` 的实现；
  - 事件桥；
  - 版本垫片（下面说）；
  - 只属于这个版本的 mixin 和 mixin 配置；
  - `neoforge.mods.toml` 或 `mods.toml`。
- 两个构建：
  - `mods/mcbot-server-control/build.gradle`（NeoForge 1.21.1）编 `main` 加 `neoforge-1.21.1`。
  - `mods/mcbot-server-control-forge1201/build.gradle`（Forge 1.20.1，ModDevGradle Legacy）编同一份 `main` 加 `forge-1.20.1`。它的 `mod_version` 从核心的 `gradle.properties` 读，不另写一份，免得 `set-version.mjs` 只改到一边。
- 公开接口 `api/` 只用两个版本都有的类型，附属模组编译时只认它。

**版本垫片**
- 垫片是包 `com.mcbot.servercontrol.version` 里的几个类。两个版本目录各放一份同名、同签名的类，共用代码直接调用；编译时只会带上其中一份。哪边少了方法，那边就编不过。
- 一两行的差异写成垫片方法：
  - 比较两个物品是否相同；
  - 触及距离；
  - 使用物品的包；
  - `hasCorrectToolForDrops` 等签名变化。
- 成段不同的，整个方法搬进垫片：
  - `ItemDescriptions.key`（读物品组件，1.20.1 读 NBT）；
  - 附魔等级；
  - 食物、药水；
  - 盔甲和工具的属性。
- 寻路：
  - 格子类型用垫片常量加 `var`（1.21.1 是 `PathType`，1.20.1 是 `BlockPathTypes`，常量名一样）。
  - `RouteEvaluator` 重写的方法签名不同，按版本各写一个薄子类，逻辑留在共用代码里。
- 配方差异放进现有的 `RecipeSource`，不另做一套。
- Bot 上线、连接、重生（`placeNewPlayer`、`VirtualConnection`、`VirtualGameListener`、`BodyPlayer` 的构造、`NativeRespawn`）整块放进版本目录。

**事件桥**
- `ServerController`、`SurvivalActions`、`ValidationProtection` 现在直接接收 NeoForge 的事件对象，也自己注册监听。改成：
  - 它们只提供普通方法，参数是玩家、物品、伤害来源这些原版对象，要不要取消用返回值表示；
  - 每个版本的事件桥负责注册、拆事件、按返回值取消。
- 这几个文件留在原地，只改接收事件的那些方法。
- 涉及的事件：聊天（含 Bot 发言时先发一个聊天事件让保护模组拦）、拾取前／后、吃完东西、受伤后、攻击和即将受伤（保护和误伤）、横扫、箭的标记、踩耕地、死亡、掉落、tick、开服／关服、验收夹具的命令和重生。
- Forge 1.20.1 没有横扫事件，要写一个 mixin，或者靠“即将受伤”那一道挡住。

**mixin**
- `BlockItemInvoker`、`ServerPlayerGameModeAccessor` 两版都能用，留在共用代码。
- `VirtualPayloadMixin`、`PlayerListRespawnMixin` 各版本一份。
- Forge 构建要配 mixin 和 refmap，`compatibilityLevel` 改成 `JAVA_17`。

**检查**
- `loaderNeutralCheck` 改成检查整个 `src/main/java` 里没有任何加载器的类。
- Java 17 没法在 NeoForge 那边检查：1.21.1 的类是 Java 21 字节码，不能用 `--release 17` 编。所以真正的检查是 Forge 1.20.1 能编过，要写进开发说明的离线验证。
- 两边都编过、两边的 `controlTest` 都过，才算改完。

**两版输出要一样**：`ItemDescriptions.key` 和 `describe`、回执和观察的 JSON，在 1.20.1 上要和 1.21.1 一字不差（`potion=`、`enchantments=`、`damage=`、`name=`、`repairCost=`），因为运行端和它的测试按这些字符串认。

**jar 名**：1.20.1 的 jar 不能也叫 `mcbot-server-control-<版本>.jar`。WebUI 和 `start-server-play.mjs` 按 `^mcbot-server-control-.*\.jar$` 找核心，名字要能分出版本，到 Node 侧那一步再定。

**顺序**
1. 共用代码改成 Java 17 写法（10-21 已改，没提交；`getFirst/getLast/removeFirst/removeLast/addFirst` 换成下标，`reversed()` 换成 `Collections.reverse`，`Math.clamp` 换成 `Mth.clamp`，Gson 的 `JsonObject.isEmpty()` 换成 `size()`，因为 1.20.1 带的 Gson 2.10 没有它）。
2. 拆出 1.21.1 层：文件搬家、事件桥、垫片，1.21.1 行为不变。
   - 检查：NeoForge 的 `build check`，加上 1.21.1 隔离服实测重跑。
   - 这一步会改 main 的核心。合进 main 的时机由用户定：v0.1 发版前还是发版后。
3. 写 1.20.1 层，直到编译和 `controlTest` 都过。
4. 搭 1.20.1 隔离服，跑实测。
5. 附属模组、Node 侧、整合包试玩。

## 两种做法（10-21 已选第 2 种）

1. **单独分支**：在 `forge-1.20.1` 分支上直接改核心。
   - 最快能玩上。
   - 以后核心每改一处（比如 build-speed 的 C'），都要手工再搬一遍，两边会越差越远。
2. **共用代码加版本层**：64 个文件本来就能共用；有差异的点包进几个接口，每个版本各写一份实现。这些点有：上线和连接、物品比较和描述、附魔等级、食物和药水、寻路格子类型、配方、触及距离、事件。
   - Java 21 → 17 的 43 处直接改在 main 上，再加一个检查，免得 `getFirst()` 又写回来。
   - 先多花 3～4 天。它会动到 main 的代码，1.21.1 的实测要重跑一遍。
   - 以后改一处，两个版本都有。

注意：[工作站设计](workstation_design.md)「加载器和版本」第 6 条写的是“不追求一份代码同时编译多个游戏版本”。那条是按 1.21.x 之间的小改动写的，做法 2 和它字面上冲突，要用户决定要不要改这条。

## 估时（没做过，粗估）

**(a) 核心移植**
- 编译通过、离线测试过：约 6～8.5 天（Java 17 半天、加载器 1～1.5 天、物品组件等 1.5～2 天、寻路 0.5～1 天、上线和 mixin 1～1.5 天、其余 0.5～1 天、测试和元数据 1 天）。
- 搭 1.20.1 Forge 隔离服，smoke 脚本加版本参数，全部重跑、修行为差异：3～5 天。
- 选做法 2 再加 3～4 天。

**(b) 这个整合包**（在 (a) 之上）
- 附属模组按包里的版本重做：2～4 天。农夫乐事最值，包里几十个 Delight 附属用的都是它的砧板和厨锅。森罗厨房 1.3.0 和我们锁的 1.6.0 差得多。
- 在 414 个模组的服务端上试：2～5 天，不确定性最大（领地、降 tick、Better Combat、Connector）。
- Node 侧：
  - `compat.json` 现在只有一个 `platform`，WebUI 插件页会拒装 1.20.1；
  - `short_grass` 在 1.20.1 叫 `grass`，`mcp-server` 的蓝图和画图写死了 1.21.1；
  - 发布时要出两套核心。

  合计 2～3 天。
- 包里没适配的做饭机器（Let's Do 系列、Brewin' and Chewin'、Farmer's Respite、Crock Pot……）：每台 0.5～2 天，没算在内。先看能不能走通用物品槽（`machine-items`）。

合计约 3～5 周。离线编译已实测；隔离服和真实模型还没有任何证据。
