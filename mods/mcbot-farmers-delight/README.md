# mcbot-farmers-delight

MCBOT 的附属模组：让 Bot 会用 [Farmer's Delight（农夫乐事）](https://modrinth.com/mod/farmers-delight) 的砧板、宴席、派、厨锅、炉灶、平底锅、蘑菇菌落、橱柜和篮子，会收番茄、卷心菜、洋葱和稻米。接口见 [Mod 适配接口](../../docs/mod_adapters.md)。

状态：隔离服实测全部功能通过，**还没用真实模型试玩**。

- **只支持** Farmer's Delight `1.2.9`（NeoForge 1.21.1）。版本对不上时适配报告“没安装”，Bot 不会去用。1.21.1 的最新版 1.3.4 核对过（10-16），先不跟：它要 NeoForge 21.1.219 以上（我们最低是 21.1.217），砧板改成一次放一整叠、每刀切一个，番茄换了方块类并多了挂在绳上的番茄，宴席最后一份会掉方块掉落，切派认刀的方式也变了，都要另写规则。
- 用类名和反射访问农夫乐事，编译时不依赖它；模组里不带农夫乐事的代码和素材。
- 服务器上同时装：`mcbot-server-control`、`farmersdelight`、本模组。单人世界也一样，装在客户端的 mods 里。
- 用到核心 10-16 新加的接口（`CropRule`、多原料 `PROCESSOR`、`StationRecipe` 的容器、`notReady`），已发布的核心 0.0.5 里没有。发布前要先提核心版本，再把本模组的 `core_min`（和 compat.json 的 `coreMin`）提到那个版本。

## 能做什么

| 功能 | AI 用什么 | 说明 |
| --- | --- | --- |
| 砧板放料 | `interact-block`，`farmersdelight:cutting_board/place` | 手里拿着有切割配方的食材，放上去一个 |
| 砧板切 | `interact-block`，`farmersdelight:cutting_board/cut` | 拿着配方要的工具（刀、斧等，`summary.tools` 列出），成品掉在砧板旁边，要自己捡；工具掉耐久，可能用坏 |
| 砧板取回 | `interact-block`，`farmersdelight:cutting_board/take` | 空手，取回放着的东西 |
| 宴席分餐 | `interact-block`，`farmersdelight:feast/serve` | 拿着 `summary.container` 写的容器（多数是碗），一次一份；没有剩菜的宴席最后一份分完方块消失，有剩菜的留下剩菜 |
| 切派 | `interact-block`，`farmersdelight:pie/slice` | 拿着刀（`farmersdelight:tools/knives` 标签），一次切下一块掉在地上；刀不掉耐久；最后一块切完派消失 |
| 摘番茄 | `tend-crops` | 熟了的番茄藤右键摘（藤回到 0 龄继续长），不拆藤、不补种；还没爬藤的番茄苗当作在长，不碰 |
| 厨锅 | `produce-item`（item 是菜，count 是份数） | 见下面 |
| 炉灶烤 | `interact-block`，`farmersdelight:stove/add` | 拿着有营火配方的食材，一次放一个到点着的炉灶上（最多 6 个，上面不能压着方块，放了锅就不能直接烤）；烤好的留在炉灶顶上，`summary.readyInSeconds` 是最后一个还要几秒，到时间用 `collect-items` 捡 |
| 点炉灶 | `interact-block`，`farmersdelight:stove/light` | 拿打火石或火焰弹点着没点的炉灶；炉灶给放在它上面的厨锅、平底锅加热 |
| 平底锅放料 | `interact-block`，`farmersdelight:skillet/add` | 拿着有营火配方的食材（生肉、土豆等），整组放进有热源的空平底锅（下面是点着的炉灶、营火、火、岩浆块）；一个一个烤，烤好的从锅边弹出来落在地上，`summary.readyInSeconds` 是全部烤完还要几秒，到时间用 `collect-items` 捡 |
| 平底锅取回 | `interact-block`，`farmersdelight:skillet/take` | 空手，取回还没烤的那组 |
| 剪蘑菇 | `interact-block`，`farmersdelight:mushroom_colony/harvest` | 拿剪刀，长过的蘑菇菌落剪下一个蘑菇（掉在地上），菌落小一级；剪刀掉耐久 |
| 橱柜、篮子 | `discover-containers`、`container-list`、`container-withdraw` 等 | 和箱子一样用（打开的是原版三排箱子界面） |
| 卷心菜、洋葱、稻米 | `tend-crops` | 卷心菜、洋葱照通用作物收和补种；稻米只收上半截稻穗，泡在水里的下半截留着、会再长稻穗；不会在水里种稻米 |

厨锅（`farmersdelight:cooking_pot`）按多原料 `PROCESSOR` 接入：

- 配方从服务器的 `farmersdelight:cooking` 配方读（数据包改了也跟着变），原料不分顺序，最多 6 种；配方要容器（碗等）时一起放进容器格。
- 原料和容器必须先在背包里（不自动去箱子拿）。不够时如果附近有锅正在做这道菜或已经做好，就过去取；都没有报 MISSING_MATERIALS，列出缺什么（容器单独一行）。
- 下面没有热源报 STATION_NOT_READY（热源是 `#farmersdelight:heat_sources`，如点着的炉灶、营火）；放进去 3 秒还没开始做就全部拿回，报 RECIPE_REFUSED。
- 默认看到开始做就走（回执 `cooking:true`、`readyInSeconds`），运行端照熔炉记账，做好、停了（没热源、成品格满）都发 `machine` 事件；之后同样的 item 再调一次取出来，还在做报 STILL_COOKING。`wait:true` 站在旁边等，做好一份取一份。
- 打开前先把手换成空格（或不拿容器的格子）：手里拿着碗右键锅是盛菜，不会打开界面。
- 锅里有别人的原料、别的菜等着盛、成品格有别的东西时不碰，换下一口锅。

炉灶烤好的东西留在炉灶顶上。Bot 平常走路不进点着的炉灶、营火、岩浆块和火旁边那一圈格子；捡东西时（核心的 `pickup-item`，`collect-items` 也走它）放开一半：旁边只有炉灶、营火、岩浆块这种踩上去才烫的，可以站进去捡；一格内有火或岩浆的仍然不进，捡不到报走不过去。平底锅烤好的从锅边弹出一格左右，平常就够得着。

## 安全规则

- **按类名逐个核对**：方块、方块实体、菜单的类名和 1.2.9 一致；菜单 45 格，前 9 格（6 个原料格、盛菜显示格、容器格、成品格）的槽位类都要对上，而且都在锅自己的物品处理器上、编号 0～8 依次对应；后 36 格是 Bot 自己的背包（主背包 27 格、快捷栏 9 格），原索引一致。任何一项对不上，整个界面当作不支持。
- 砧板、宴席、派的每次右键前后各读一次方块内部状态（`summary`），只有变化都在预期范围内才算成功：放料只能少 1 个，切只能掉配方会出的东西，分餐只少一份、只用一个容器。
- 副手拿着非装备的东西时，砧板会去拿副手那件，放料前先拒绝。
- 炉灶放料只能用掉 1 个、炉灶上多 1 个；点炉灶只能让 `lit` 从否变是；平底锅放料只能整组放进空锅、取回只能把锅里那组拿回手上；剪蘑菇只能掉一个那种蘑菇、菌落小一级。都在右键前查好（没营火配方、炉灶没点着、上面压着东西或放满、没热源、泡在水里、锅里已有东西、菌落还没长都会先拒绝）。
- 橱柜和篮子只认“农夫乐事的方块 id ＋ 类名 ＋ 方块实体类名”，界面照原版箱子的规则逐格核对。
- 番茄藤和番茄苗只按“方块 id ＋ 类名”认，认不出的作物照核心原来的规则处理。
- 关掉「给 AI 用」后：交互和厨锅都从 hello 去掉，运行端在工作站调用里带 `skipStations`，服务端不会选农夫乐事的锅。

## 构建和测试

```pwsh
cd mods/mcbot-server-control; ./gradlew.bat build        # 先构建核心，它的 jar 提供 MCBOT API
cd ../mcbot-farmers-delight; ./gradlew.bat build          # 含离线测试 FarmersDelightRulesTest（77 项）
```

离线检查：规则、预期范围、厨锅格子核对和剩余时间、平底锅剩余时间、番茄判断、说明长度。

10-16 在隔离服实测 57 项全部通过（农夫乐事 1.2.9，没用真实模型和测试玩家；先测砧板到厨锅的 36 项，补上炉灶、平底锅、蘑菇菌落、橱柜、篮子、卷心菜、洋葱、稻米和换锅、砧板摆刀后再测）。第一次跑查出两处核心和运行端的问题，已修：最后一个碗盛了菜、菜落在碗原来那格时回执判成 unknown（核心回执比对补上这种情况）；厨锅回执的 `container`（盛菜的容器）被运行端当成菜单读，报错。10-17 补上炉灶直接烤、核心放开捡东西时站到炉灶旁边后再测，62 项全部通过：牛肉放在点着的炉灶上，30 秒后走到炉灶旁边捡回牛排、没掉血；两团火中间的掉落不去捡、人没事。没进游戏测的（只有离线测试）：放进去不开始做（RECIPE_REFUSED）、区块卸载和换维度后的 machine 事件、泡在水里的平底锅。

隔离服实测脚本 `scripts/server-farmers-delight-smoke.mjs`：测试服用平坦世界 `world`，`mods` 里放农夫乐事 1.2.9、带 8c 接口的核心 jar 和本模组 jar，先构建 client-runtime，再运行

```pwsh
$env:MC_SERVER_DIR='<隔离服绝对路径>'; node scripts/server-farmers-delight-smoke.mjs --allow-fixture
```

它在 x6790～6812、z6392～6410、y199 以上搭平台，依次测砧板（几种拒绝、放、切、捡叶子、取回、摆着的刀不能切）、宴席（拿错容器、盛烤鸡、镶馅南瓜最后一份方块消失、饭团拼盘不要容器）、派（木棍被拒、切一块、最后一块派消失）、番茄（survey、右键摘、藤留着、番茄苗不动）、厨锅（缺料、没热源、手里拿着碗也能放好就走、来早了、machine 事件、取出、`wait:true`、近的锅有别的菜就换一口）、炉灶和平底锅（木棍被拒、点着的炉灶放牛肉、没点的被拒、点火、没热源被拒、平底锅放一组、取回、走到点着的炉灶旁边捡牛排和烤土豆、两团火中间的掉落不去捡）、蘑菇菌落、橱柜和篮子（找到、列出、取出）、卷心菜洋葱稻米（收、补种、稻米只收稻穗），最后带 `--disabled-plugins farmers_delight` 再开一个运行端，确认看不到农夫乐事、produce-item 带上 `skipStations` 后服务端报 NO_RECIPE。运行期间把 `randomTickSpeed` 设成 0（测火时把 `doFireTick` 关掉），结束时拆掉平台、恢复原值。报告写在 `output/server-farmers-delight-<时间>/report.json`。
