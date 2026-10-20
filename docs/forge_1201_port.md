# 1.20.1 Forge 移植评估

2026-10-21。用户想让 Bot 支持整合包「香草纪元：食旅纪行」2.7.1，这个包是 MC 1.20.1、Forge 47.3.33。我们现在只支持 MC 1.21.1、NeoForge，所以第一步是把核心移植到 1.20.1 Forge 上。这份文档记下试编的结果、选定的做法和还要做的事。

**进度（10-21）**：在分支 `forge-1.20.1`（worktree `G:\mc\muxue-mcbot-platform-1201`）上分步提交，没推送。
- 已经做完的：
  1. 共用代码改成 Java 17 写法；
  2. 事件桥和版本目录；
  3. 垫片第一批：上线和连接、配方、触及距离、零碎的签名差异；
  4. 垫片第二批：寻路；
  5. 垫片第三批：物品数据和 `ResourceLocation`。
- 1.21.1 层已经拆完。共用代码里没有加载器的类，已知的 1.21 专有调用也都改走垫片了。还有没有漏的，要等写出 1.20.1 层、用 Forge 试编才知道。
- 每一步都只做了离线验证：1.21.1 版 `build check` 通过（37 组 `controlTest`，`loaderNeutralCheck`）。还没进游戏，1.21.1 的隔离服实测没重跑（要用户同意）。
- Forge 试编的错误数现在不用看。共用代码调用的垫片类在 `forge-1.20.1` 里还没有，一个缺类会连带报一大片。第三步后量过一次是 1130 个，比拆之前的 354 个还多。

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

**版本垫片**（1.21.1 的在 `src/neoforge-1.21.1/java/com/mcbot/servercontrol/`）
- 垫片和共用代码在同一个包 `com.mcbot.servercontrol` 里，都是包内可见。两个版本目录各放一份同名、同签名的类，共用代码直接调用；编译时只会带上其中一份，哪边少了方法，那边就编不过。
- 现有的垫片：

  | 类 | 管什么 |
  |---|---|
  | `Version` | 一两行的差异：触及距离、两个物品是否相同、按位置判断工具能不能掉落、装水、骨粉、掉落物指定的拾取人、使用物品的包、读压缩 NBT、暂停、全员可用命令、拴绳、旋风人、火把、试炼方块、`ResourceLocation`、盔甲槽、方块实体的存档数据 |
  | `VersionItems` | 物品数据：有没有额外数据、药水、附魔（含诅咒和绑定）、损耗、改名、修理花费、其它数据、盔甲点数、食物、组件编码、默认堆叠数、附魔台线索 |
  | `VersionRecipes` | 配方：按类型取全部、烧炼、切石机选项、酿造 |
  | `VersionPath`、`RouteEvaluatorBase` | 寻路的格子类型和搜索中的状态。格子类型放在 `var` 里，和垫片常量比较（1.21.1 是 `PathType`，1.20.1 是 `BlockPathTypes`，常量名一样） |
  | `BodyPlayerBase`、`GameListenerBase`、`VirtualConnection`、`RespawnSeam` | Bot 上线、连接、重生。`BodyPlayer`、`VirtualGameListener` 留在共用代码，继承这两个基类 |
  | `McbotServerControl`、`NeoForgePlatform` | 模组入口、事件桥、`LoaderPlatform` 的实现 |

- 共用代码里放两版通用的中立类型：`IdRecipe`（配方和它的 id）、`ItemData`（数据种类、附魔的 id 和等级）、`FoodSafety.Food`（饱和度按点数）。
- 1.21.1 的垫片方法都是把原来那行代码原样搬过去，逻辑没改。报错文案和 `key` 里各段的顺序都留在共用代码里。

**事件桥**（已做）
- `ServerController`、`SurvivalActions`、`ValidationProtection`、`RespawnValidationFixture` 不再接收、也不再注册加载器事件。它们只提供普通方法，参数是玩家、物品、伤害来源这些原版对象；要取消就返回 true。
- 1.21.1 的 `McbotServerControl` 注册全部监听，优先级和“已取消的也收”都照原来的，负责拆事件、按返回值取消。
- 涉及的事件：聊天、拾取前／后、吃完东西、受伤后、攻击和即将受伤（保护和误伤）、横扫、箭的标记、踩耕地、死亡、掉落、tick、开服／关服、验收夹具的命令和重生。
- Bot 发言走 `LoaderPlatform.chatAs`：先发一个聊天事件，让别的模组改或拦。默认实现返回 null，当作被拦。
- Forge 1.20.1 没有横扫事件，要写一个 mixin，或者靠“即将受伤”那一道挡住。

**mixin**
- `BlockItemInvoker`、`ServerPlayerGameModeAccessor` 两版都能用，留在共用的 `mcbot-server-control.mixins.json`，`compatibilityLevel` 已改成 `JAVA_17`。
- `VirtualPayloadMixin`、`PlayerListRespawnMixin` 各版本一份，放在包 `com.mcbot.servercontrol.versionmixin`，配置是 `mcbot-server-control.version.mixins.json`。
- NeoForge 的 `neoforge.mods.toml` 模板还在 `src/main/templates`，因为 `check-compat` 和版本测试按这个路径读。两份 mixin 配置都登记在里面。
- Forge 构建要配 mixin 和 refmap。

**检查**
- `loaderNeutralCheck`（已改）：整个 `src/main/java` 里不准出现 `net.neoforged`、`net.minecraftforge`。
- Java 17 没法在 NeoForge 那边检查：1.21.1 的类是 Java 21 字节码，不能用 `--release 17` 编。所以真正的检查是 Forge 1.20.1 能编过，要写进开发说明的离线验证。
- 两边都编过、两边的 `controlTest` 都过，才算改完。
- 物品数据这一批没有单元测试覆盖：`ItemDescriptions`、`ArmourAssessment`、`DefenseWeaponSafety`、`FoodSafety.assess`、药水这些路径都要游戏里的物品。`build check` 通过只能说明能编译，要靠实测：
  - 生存：损耗、改名；
  - ore-alpha：精准采集、时运；
  - respawn、dead-save：损耗加改名；
  - content：`custom_data`；
  - station、machine-wait：酿造、附魔台；
  - navigation-defense、survival-alpha：防身武器、吃东西、穿戴；
  - guard 系列、hunt：武器和盾牌的检查；
  - pillar：蓝图里的方块 id；
  - resource-tags、mod-resources：资源选择器和掉落（`ResourceLocation`、精准采集的测试工具）；
  - workstation、review-fix：熔炉的存档数据、放料的堆叠上限。
- `assess-armour`（`ArmourAssessment` 读盔甲点数、诅咒、绑定）没有实测脚本，`ArmourChoiceTest` 只测判断，不读物品。实测全过也不代表它验过。

**两版输出要一样**
- `ItemDescriptions.key` 和 `describe`、回执和观察的 JSON，在 1.20.1 上要和 1.21.1 一字不差（`potion=`、`enchantments=`、`damage=`、`name=`、`repairCost=`），因为运行端和它的测试按这些字符串认。
- 物品的 `components` 是线上协议（[server_body_protocol.md](server_body_protocol.md)），用 1.21 的组件 id 和 1.21 的形状：`"minecraft:damage"`、`"minecraft:enchantments": {levels: {...}}`、`"minecraft:custom_name"`……
  - 按这些键读的有：client-runtime 的 `events.ts`、`survival-tasks.ts`，`SurvivalActions`、`ItemInteractions`（`minecraft:damage`），还有实测脚本。
  - 1.20.1 的 `VersionItems.encodeData` 要把 NBT 翻成同样的键和形状。已知的几种照着翻：损耗、附魔、存储附魔、改名、修理花费、药水。别的 NBT 翻不了就让它失败，走现有的 UNSUPPORTED 或 `componentsComplete=false`，不能随手给出另一种形状。

**写 1.20.1 层时要注意**（到时候再对着 1.20.1 的源码核）
- `noExtraData`：1.20.1 新建的可损耗物品会带 `{Damage:0}`，这要算“没有额外数据”。不然所有工具都不算干净物品，`key` 也会多出东西。
- 药水：没有药水时 `PotionUtils.getPotion` 给的是 `minecraft:empty`，要换成 null。不然 `key` 会多出 `potion=minecraft:empty`。
- 食物：
  - `saturation` 要给点数（营养 × 饱和系数 × 2），1.20.1 的 `FoodProperties` 存的是系数；
  - 吃的时长用 `getUseDuration`；
  - 炖菜在 1.20.1 是 `BowlFoodItem`，`FoodSafety` 的类检查会把它当成没核过的实现，要不要放行到时再定。
- 附魔：
  - 诅咒用 `Enchantment.isCurse()`，绑定用 `EnchantmentHelper.hasBindingCurse`；
  - 附魔台的线索号是附魔注册表的数字 id。
- `otherData`：要把 NBT 的键对到 `ItemData.Kind` 上，如 `Damage`、`display.Name`、`display.Lore`、`RepairCost`、`Enchantments`、`StoredEnchantments`、`Potion`、`CustomPotionEffects`，以及盾牌的 `BlockEntityTag`。
- 熔炉和酿造台的存档键（`BurnTime`、`CookTime`、`CookTimeTotal`、`BrewTime`）两版一样。

**jar 名**：1.20.1 的 jar 不能也叫 `mcbot-server-control-<版本>.jar`。WebUI 和 `start-server-play.mjs` 按 `^mcbot-server-control-.*\.jar$` 找核心，名字要能分出版本，到 Node 侧那一步再定。

**顺序**
1. 共用代码改成 Java 17 写法（10-21 已提交）：
   - `getFirst/getLast/removeFirst/removeLast/addFirst` 换成下标；
   - `reversed()` 换成 `Collections.reverse`；
   - `Math.clamp` 换成 `Mth.clamp`；
   - Gson 的 `JsonObject.isEmpty()` 换成 `size()`，因为 1.20.1 带的 Gson 2.10 没有它。
2. 拆出 1.21.1 层：文件搬家、事件桥、垫片，1.21.1 行为不变。
   - 10-21 已分四步提交，离线检查通过。
   - 还差 1.21.1 隔离服实测重跑。
   - 这一步会改 main 的核心。合进 main 的时机由用户定：v0.1 发版前还是发版后。build-speed 分支改过 `BuildTask`，合并时会有小冲突。
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
