# ServerBody 控制协议：历史记录

2026-10-18 从[控制协议](../server_body_protocol.md)移出：生存 Alpha 第一、二批的合同和试玩修正、10-03 到 10-11 各次改动的说明和验证范围、旧的自写寻路合同、已删的 `follow-companion`／`step-aside-stop`／`beside-follow` 合同、各批次的工具数和离线检查数。下面是 10-17 版（278f408）的原文，没有改写；现行规范以[控制协议](../server_body_protocol.md)为准，这里的说法和它不一致时以它为准。

## 一、早期批次（10-03～10-04）

原头部：

> 2026-10-04 更新。本协议是当前实现与测试共用契约；当前只交付独服、本机控制、单 Bot。客户端协议 v1 保持兼容。服务端正常成本不设预算，默认无 Bot MC 客户端。Agent／模型凭据留在 Agent 主机。本日整栈转移、任务总期限与矿石目录仅做编码和离线验证，未更新运行中的服务器。

B 基线和交互、陪伴、采集各批的工具数：

B 基线已有11个动作：send-chat、look-at、move-to-position、follow-player、dig-block、place-block、open-container、click-slot、close-container、select-slot、drop-item。参数见 `client-runtime/src/body.ts` 与下面的服务端必填核验；stdio MCP 只发布实际 capabilities 允许的动作。B另有10个观察／控制工具，合计21个：get-status、get-position、list-inventory、find-entity、read-chat、get-block、get-container、get-operation、stop-action、wait-for-events。respawn不发布为模型可调用的MCP工具；最新增量见下段。

交互增量另声明只读 `nearby-blocks` 及两个走近动作。Node 在所需原子能力齐备时提供 `discover-containers`、`container-list`、`container-withdraw`、`give-item`、`fetch-and-give`（10-12 已删），再加 `approach-container`／`approach-player`，该历史批次合计28个MCP工具。持续陪伴另声明内部动作 `follow-companion`，Node增加`companion-mode`／`get-companion-mode`，该历史批次为30个工具。此前有限采集再声明`nearby-resources`／`approach-resource`／`pickup-item`能力，Node增加`discover-resources`／`gather-resources`／`collect-items`，该批完整能力集为 **33 个 MCP 工具**；持续跟随与新增采集原子动作由任务层内部使用，不直接发布给模型。工具仍按实际capabilities裁剪。任务在 Agent 主机组合原子动作，不新增服务器模型或第二个 MC 客户端。容器HTTP候选为 `{position,id,properties,targetToken,distance,visible,visibility}`；MCP保留私有targetToken，仅返回本地containerRef。可见性相对 center，可能为 visible／occluded／unknown。发现不代表菜单一定受支持，空结果不代表未加载区域或更远处不存在箱子。

R2 修复：

2026-10-03 R2 修复：原生调用入口前置待确认标记；调用内部或其后回执构造抛出协议错误（包括 UNSUPPORTED）／运行时异常时，尚未建立可靠结果的操作保留 unknown。写前拒绝、已证实无变化的拒绝仍是 failed；drop 的已确认 droppedCount 与独立已知 removedCount 保留，即使后续单件结果未知。重复 operationId 继续返回原回执。详见[边界修复与故障注入范围](boundary_review_fixes.md)，不把该离线验证称为真实 Mod 故障验收。

已删的 `follow-companion` 动作（8m 第二步由 `posture` 方法取代）：

| 动作 | args／确认边界 |
| --- | --- |
| follow-companion | **已删（8m 第二步，由 `posture` 方法取代，能力名也不再声明）**。原来：`{player,expectedEntityId,distance?}`；UUID必需，distance默认2.5、范围1.5–6。持续运行，无总时长自然结束；距离及LOS满足时waiting，玩家离开站位后following。绑定真实玩家实例／UUID／维度，已加载安全高差地形内有界重规划；受阻、离线、受伤等失败后不自动恢复。原follow-player有限语义不变 |

## 二、可选陪伴拾取保护（2026-10-03 首批）

新增能力标记`companion-pickup`只供Node门控，不是可执行动作；`act.name:"companion-pickup"`明确返回UNSUPPORTED，不会落入通用移动分支。当时为33个MCP工具，标记本身不增加工具。服务端只扩展pickup-item，不新增自动挖矿、dig guard或矿石目录。

`companionGuard`格式为`{player,expectedEntityId,maxDistance}`，三个字段均必需；player为1–16字符游戏名、expectedEntityId为完整UUID、maxDistance为1.5–4格且服务端不补默认。开始本次拾取时绑定真实ServerPlayer实例；执行前与每tick核验该实例、UUID、维度、生命和连接。身体与指定掉落实体必须同时在该玩家**当前**位置的maxDistance半径内；初始身体已更远也拒绝。路线候选、剩余路点、下一驾驶步与带0.2到达裕量的站位均限制在玩家半径内，仍保留全部原平地／危险／租约核验。

玩家仍为同一存活实例而身体、掉落或路线超出该半径时，返回`COMPANION_OUT_OF_RANGE`；玩家离线、死亡、换维度、同名UUID变化或真实实例替换返回`STALE_COMPANION`。Node只可把前者作为结束该次旁路拾取、重新核验后回到跟随的信号，不重试同一失败物品；身份失效、危险、unknown、无路等不因陪伴模式自动重试。外部pause／stop／失租约仍废弃旧步骤与迟到回执，不借此恢复旧意图。

guard只阻止后续驾驶，不能回滚普通物理已经发生的碰撞拾取。每tick在picked成功之前先核验anchor；如果原生Post已证明获得物品、之后anchor越界或失效，则失败result仍保留实际pickedUpCount／stack与`pickup:"confirmed"`，不伪造0或以成功为由继续越界。没有Post就没有获得证据。指定物品过滤用于主动追逐，不改变原版可能自然拾取其它相碰物品的规则。

本批Java21 build为**387项离线检查**（前批330＋CompanionPickupTest57），日志见`output/server-escort-java.log`（本地证据未随仓库分发：`../output/server-escort-java.log`），其中保留首次测试helper编译错误及修正后的最终成功。Node可选拾取已接线，143项Node、23项真实程序矩阵、Claude-b／Codex各5阶段通过；证据见[跟随拾取验收](server_escort_validation.md)，不把有限样本外推到任意玩法。

有限采集批次的离线检查数：

此前有限采集批次最终Java21 build通过**330项离线检查**；历史B为80项、第二批交互为163项、持续陪伴为227项，均保留为各自当时的结果，不与当前重复相加。该采集批次程序矩阵及真实Claude-b四阶段的最终证据见[有限采集验收](server_gather_validation.md)，不是当前可选陪伴拾取批次的实测证据。33工具是能力齐备时的接线数量，不代表逐一验收所有参数、任意Mod或自动陪挖。

## 三、Node 与宿主约定（10-03～10-10 的写法）

（10-12 注：本段和下面两段是 10-03～10-10 的写法，现在跟随／等待是服务端姿态，见「陪伴姿态」一节；`companion-mode` 在服务端有 `server-posture` 或 `guard-duty-fenced` 能力时发布，状态随 `get-status.companionMode` 返回，没有 `get-companion-mode` 工具；保护是常驻的，等待和空闲时也有。）当时：持续陪伴工具仅在 `follow-companion` 能力存在时发布：`companion-mode` 接受 `{action:"follow"|"wait"|"pause"|"resume"|"stop"|"guard",player?,distance?,pickup?,guard?,say?}`，只有新follow允许指定player／distance／pickup。follow先核验附近玩家身份，返回受理状态，原生动作在后台持续；wait原地等候，两者都持有与有限任务共用的写锁。切换先确认旧动作停止。

当时：跟随（和原地等待）是持续状态，不是任务（10-10 起）：用身体的工具（走路、采集、合成、建造、进食、表情、睡觉……，`mcp.ts`的`bodyTools`）开始前，运行端自动让开——确认身体停止、释放写锁、保留意图，状态为`paused`并带`suspendedFor`（工具名）和`reason`；该工具／反射结束、身体上没有别的东西在跑（没有运行中的操作和容器／采集／生存任务、没有打开的菜单、没睡着）并空闲约0.8秒后，运行端自己恢复同一个意图（重新核验会话和玩家身份），模型不用调`resume`。返回`running`、结果稍后用task事件到来的操作，在它终止时才恢复；同时有几个在跑，按最后一个结束算。睡觉在醒来后恢复。恢复时玩家不在附近：继续让开、给一次companion事件，玩家回到附近自动接上，不算受阻。让开期间任务让身体停止过（控制代次后移）不算失控，同一实例／会话／世界／维度即可沿用意图。模型显式`pause`是手动暂停，一直到`resume`（让开期间再pause也转成手动暂停）。只有这几种情况真正结束跟随：玩家叫停的`stop-action`（丢弃意图，不恢复）、`companion-mode stop`（结束跟随／等待，不打断正在做的其他任务，回执`state:"stopped"`并说明已结束；本来没有跟随时原样返回）、显式换成别的`follow`／`wait`。`guard`动作（要`guard`参数：布尔或保护选项）在当前跟随上开／关／改保护，选项逐项并到现有选项上；正在跟随时按新选项重启服务端的follow-companion，让开期间只改意图、恢复时生效；等待中没有保护，会报`INVALID_STATE`。

当时：`get-companion-mode` 与 `get-status.companionMode` 给出 `{state,intent?,player?,distance?,guardEnabled?,suspendedFor?,stage?,operationId?,code?,reason?}`。state为idle／following／waiting／paused／blocked／stopped；intent为follow／wait，stage为starting／active；`guardEnabled`是跟随意图上的保护开关（保护进行时另带`guard`战斗状态）；`suspendedFor`有值表示跟随正为某个工具让开、会自动接上，没有就是手动暂停。让开和恢复都记`companion_state`事件。受理不代表已开始移动。后台500ms监视更新状态，不让模型循环发起有限跟随；靠近／走远的正常切换不唤醒模型，受阻后给一次companion事件。显式切换记录companion_state供后续上下文，非唤醒事件；已向模型交付的终态按session／operationId去重，查询和异步通知不会各触发一轮。

stop-action立即清除陪伴意图（反射抢占和`set-reflexes`改策略只取消正在做的任务，让开中的跟随意图保留；2026-10-11起模型可传`keepCompanion:true`，同样只停正在做的任务，跟随／等待和保护照旧，用于改主意换任务，试玩里模型为取消回家用了不带它的stop-action，把晚上的保护也关了）并推进身体控制代次；确认停止后无需等待旧动作HTTP回执才允许新任务，迟到回执由本地epoch及身体代次共同丢弃。后台观察也携观察开始时的epoch，暂停／切换前开始的旧观察不能误判新意图失控，转换中不启动新后台观察。失租约、宿主／Agent退出、身体会话变化终止意图且不保存为可恢复任务，重启只接受新的明确请求。持续路线采用文末统一导航预算；目标移动的重规划最少间隔500ms，行走 2 秒无进展触发有限重规划，搜索停驻另计；默认跟随只跟随，可选拾取由Node在原生follow与受保护pickup-item之间调度，见上节已验边界，不加入自动采矿／陪挖。显式有限采集另走以下入口。

follow的可选pickup仅在companion-pickup能力存在时发布，`items`明确1–8个物品ID、`radius`默认3且1.5–4，distance≤radius。靠近玩家waiting时选择当前可见白名单掉落，全程持外层token，单UUID子任务不另占锁或释放父锁、不发逐物品task事件。停止换代必须同一instance／session／world／dimension的下一代；观察revision独立防旧读穿越转换。暂停／恢复保留配置，wait／stop清除；范围越界复核同一玩家后回跟随，其他失败先确认停止再blocked。状态增加activity与pickup统计，格式见[运行端说明](../../client-runtime/README.md)；外层按原生游标分组件变体累计，子任务不重复加数，自然收取其他UUID不导致单件任务误停，缺口标最后确认量。

R4 增量和撤销竞态（10-03）：

R4增量：容器多步骤任务要求Body同时提供acquireTask/releaseTask。cancel先废弃旧步骤并保留写锁，只有最新匹配停止句柄的`stopped:true`确认才能收尾；停止失败不准新任务写入。停止确认后首新任务不等待旧HTTP回执，旧finally／旧停止确认不释放新任务锁。迟到可靠部分回执仍保留确认数量，迟到unknown不降级为确定失败或无副作用。`stopped:true`确认的是控制输入与任务被停止；正常重力／惯性不被冻结，最后实际物理位移另测，见[混合回归](server_mixed_validation.md)。

2026-10-03再补撤销请求在途竞态：开始revoke即保留新明确消息，等待撤销结束再尝试投递，不因stopped状态尚未收到回执而推进游标丢失。回执暂停的可控测试先失败后通过；并发Driver回归另行通过。

## 四、生存 Alpha 两批和之后的保护、陪伴改动（10-03～10-11）

### 生存Alpha第一批增量（2026-10-03）

新增原子能力`swap-inventory`／`eat-item`和只读`survival-state`／`assess-tool`。Node按能力提供`get-survival-state`、`assess-tool`、`prepare-item`、`eat-food`、`set-reflexes`，该批完整38个MCP工具。策略是运行端状态，不是服务端另起的控制者；游戏端不自发抢占或推进generation。

- `swap-inventory`：`{sourceSlot:0..35,hotbarSlot:0..8,expectedSource:{id,count,components,maxStackSize?},expectedTarget:{...}}`。不同逻辑槽，必须当前自身库存菜单、空carried，按真实backing identity映射原生槽，核验双向mayPickup/mayPlace和实际容量；使用原生SWAP，不直接赋值库存。成功核对完整交换；原生发出后的回执异常unknown，不重放。
- `eat-item`：`{slot:0..8,expectedItem,expectedCount,expectedComponents,expectedMaxStackSize?,timeoutMs?}`。原生主手使用与原生时长，绑定槽位、完整初始栈、本次Finish和最终结果；成功`consumedCount:1,consumption:"confirmed"`。已确认部分结果保留`lastConfirmedConsumedCount`，取消／错误不能改成无消费。停止撤销关联并结束原生use，旧Finish不能启动新动作。
- 自身库存观察的`componentsComplete:false`必须省略components并给出原因；已编码完整物品仍含精确components。未知不能伪造`{}`；涉及该栈的写入拒绝。当前未放宽容器／地面实体的完整快照要求。
- 工具policy为`fastest_valid|conserve_durability`，默认保留2耐久；dropPreference为`any|silk_touch|no_silk_touch`。返回eligible true/false/null及基础资格依据（2026-10-07 起模组方块和工具也按原生 isCorrectToolForDrops 判断，另标 `modHooks:"unassessed"`；模组附魔的掉落效果仍算未知），预计ticks不含所有玩家／Mod钩子，原生执行重查。nearby-resources保留0..8的recommendedToolSlot，另可带0..35的recommendedInventorySlot。
- `set-reflexes`使用预期revision避免旧决策覆盖；策略改变先阻断／取消旧任务并确认停写。默认自动进食和自卫（自卫要服务端有 `defend-entity` 能力，没有时公开 `defenseSupported:false`）。叫停只停正在跑的，结束后自动进食和自卫照旧（10-08 定）；`armed:false` 只暂停到下一次动作或叫停，真要关用 `autoEat`／`autoDefend:false`。普通进食借父token只在安全间隙执行，未知结果向同一仲裁器上报并解除自动授权；停止确认也不代表允许自动重试该未知动作。

该批实际证据和限制见[第一批验收](server_survival_alpha_validation.md)；下节记录第二批新增合同，其实服验收另行记录。

### 生存Alpha第二批：导航与防卫合同

`navigation-3d`是能力标记，不是可执行原子动作。move／follow／approach／pickup复用同一个原生导航器。只读已加载地形，使用实际碰撞形状、站立支撑、身体扫掠和实体阻挡；以原生前进和跳跃输入执行，不传送、不挖路、不搭桥。半砖、楼梯、一格跳上与最多2.5格的有界下落分别经过起跳净空和落地核验。任意离地不等于获授权跳跃；硬停止清除前进和跳跃，已有惯性与重力仍按原版继续。

（10-12 注：本段是 10-03 自写寻路的合同；3a 起改用原版 `PathFinder`／`WalkNodeEvaluator` 一次算路，节点上限 2048、宽搜 6000，按距离缩放，见 `NativeNavigation.java`；之后加了跳一格空隙、开关木门、游泳上岸，下面“未交付”只剩梯子和有伤下落。）当时：搜索分tick续算，单片最多64次展开，2ms是软时间目标（单次地形核验不可中途暂停），另有4096节点、32768候选边、192路点和地形读预算。有限动作总期限与行走无进展计时分开；搜索时停驻不触发行走卡住判定。实际预算诊断在完整动作回执的`navigation`中，不能把软目标说成硬实时保证。动态地形执行时重查，卡住／障碍仅有限重算。游泳、梯子、开门、跨沟跑酷和有伤下落未交付。

（10-17）原版把着火的方块（火、岩浆、点着的营火和炉灶、岩浆块）周围一格当作 `DANGER_FIRE`，导航一律不走。只有 pickup 放开一半：这一格周围一格内没有火和岩浆、只挨着踩上去才烫的方块（点着的营火、农夫乐事点着的炉灶、岩浆块）时可以站进去捡，代价照原版 8；火和岩浆旁边、着火的方块本身仍然不走。见 `NativeNavigation.nearHeat()`。

`survival-state`增加`dangers`及`threats`。前者包含火焰、液体、氧气、下落和默认低血事实；后者包含服务端tick、8格范围、complete标志及最多24个实体的UUID、类型、分类、敌对依据、是否锁定自己、距离、视线、存活、爆炸准备和防卫资格。未知Mod实体不能按名字猜敌对；当前原版明确敌对清单或原生攻击自身证据可获得资格，玩家及友军始终排除。单实体事实读取异常返回明确null、unknown、factsAvailable:false，整体complete:false，不能当作安全或拖垮全部观察。

- `defend-entity`：`{entityId,expectedDimension,slot,expectedItem,expectedCount,expectedComponents,expectedMaxStackSize?,maxDistance:1..3,minHealth:1..20,maxAttacks:1..3,timeoutMs:500..5000}`。只做近身有限防卫，不追击。当前手持、身份、维度、资格、视线、原生触及范围、攻击冷却、潜在群伤、生命阈值和租约在每次挥击前核验。未知Mod武器、未验证的附魔／行为组件拒绝；当前仅验证裸手与普通原版剑斧。
- 防卫回执分开返回`attemptedAttacks`、`confirmedHits`与`confirmedDamage`。伤害仅从绑定本次同步原生攻击的直接玩家伤害事件确认；挥击或目标血量净变化不能替代收据。取消保留可靠部分结果；原生调用后的未知副作用不得降级为确定失败。尚未终结时用unknown；已取消的终态保持cancelled并携sideEffects:unknown及可靠部分量，均禁止重放。
- 同步原生攻击scope保持到调用真正返回，撤销执行意图不能提前清掉它。攻击／伤害原生事件入口再查同一操作授权，并关闭本有限防卫scope的横扫。若Mod回调在原生调用内部重入stop／revoke等，先撤销授权但返回`STOP_UNCONFIRMED`，调用栈结束前不能确认停写或接新控制。同期已经发生的伤害Post仍可记入旧操作的可靠部分结果，scope结束后的迟到事件不计入；这类只读记账不恢复任何动作。
- `retreat-from-entity`：`{entityId,expectedDimension,distance?,timeoutMs?}`。默认目标敌我距离4格，允许1.5–6；自身从起点水平移动最多4格、高差最多2.5格，仍走同一导航和安全检查。每步核验同一威胁，禁止向其明显靠近。成功返回实际位置、距离、requestedDistance及travelLimit；无安全路或超时失败，不声称一定逃生。

有`defend-entity`能力时，MCP新增`defend-self({entityId?})`，完整工具数39；低层attack／retreat不额外发布给模型。显式与自动防卫共用威胁选择、背包准备、任务锁和原生回执。低血或点燃苦力怕先尝试安全退让；战斗中明确RETREAT_REQUIRED可转入一次重读后的退让，unknown不能借此继续执行。

`set-reflexes`新增autoDefend、defenseRadius（1–3，默认3）、lowHealth（1–20，默认8）、excludedEntityIds（最多64个UUID）、maxAttacks（1–3，默认2）和defenseTimeoutMs（500–5000，默认3000）。有效策略公开defenseSupported；旧身体没有该能力时autoDefend为false。变更仍带expectedRevision，先确认旧活动动作停止，再应用新策略，不恢复旧任务。

#### 保护玩家（8h，2026-10-08）

（10-12 注：本节的 `follow-companion.guard` 是第一版做法，已被下面的常驻保护取代，`follow-companion` 操作也已删。）

能力标记`companion-guard`。`follow-companion`多一个可选参数`guard:{radius:3..12,lowHealth:4..16,bow,shield}`（都可省，默认 8、8、开、开），跟随运行中每个游戏刻由服务端判断，不经过模型：

- **打谁**：玩家身边`radius`格内的原版明确敌对生物，或者正在打玩家、打 Bot 的生物（Mod 生物只在后一种情况下算；正在打玩家的放宽到玩家 `radius+4` 格内）；先打正在打玩家的，其次打 Bot 的，再按离玩家远近。玩家、有主人的动物、起了名字的、拴着的、村民和商人、不是怪物的傀儡、悦灵、盔甲架一律不算目标。
- **怎么打**：够得着（原生交互距离加视线）就用热栏里最好的原版剑或斧挥，冷却满了才挥，挥击在自己的原生攻击 scope 里，伤害只按原生事件记账，横扫照旧关闭；够不着就走过去，路线不出玩家身边`radius+4`格（最多 16）。远处的远程怪、苦力怕、飞行怪，或者走不到的，有弓有箭就拉满弓射（按原版箭的速度、阻力和重力算仰角，按目标速度提前量），弹道上 1 格内有玩家、宠物、村民就不放箭，一直拉着等。武器只认原版物品、原版附魔、已知数据组件；带火矢的弓不用。剑、弓在背包主栏时先换到热栏，盾在副手空着时换进副手。
- **盾**：等冷却时对着正在打 Bot 的怪举盾；血少撤退时也举。挥击前放下。苦力怕已点燃（快炸）、按剩余引信（30 减去已膨胀的 tick）以 0.2 格每 tick 的速度、不出玩家身边的范围、要跑到爆炸伤害范围（爆炸半径的两倍，带电再翻倍，另留 1 格）之外却跑不出去时，原地不动举盾面朝它（状态 `shielding`），正拉着的弓先放下；爆炸后或苦力怕不见了就放下盾。跑得出去照旧撤退，不举盾（举着东西不能冲刺）。“跑得出去”只按空地直线估算，墙和坑要试了才知道，所以两种情况也改成原地举盾：往外撤被拒绝（走不通）；引信只剩 `SHIELD_LEAD`（10）tick 而身体还在爆炸范围内（盾举起 5 tick 后才挡得住，留出余量）。爆炸伤害范围内（不再只是 5 格）的点燃苦力怕才触发。保护状态多 `shields`（开始举盾的次数）、`lastShield`（`OFF` 关了盾、`NO_SHIELD` 手上没盾）；盾因远程威胁举着时还有 `blocking`（`RANGED`、`PROJECTILE`），见下面「保护举盾挡远程」。
- **撤**：血量不高于`lowHealth`且 8 格内有怪时往外撤（玩家在怪的另一边就撤到玩家身边，否则背离怪走 5 格，都不出范围），回到`lowHealth+4`以上才再打；苦力怕点燃且在 5 格内时也先躲。
- 打不到的目标 5 秒内不再追；一场打了 15 秒没打中就放下。没事可做时交还给普通跟随，跟随路线重新算；保护跟随挨打不再结束跟随。
- 回执：`follow-companion`运行中的结果多一个`guard:{state,target,targetId,hits,damage,shots,kills,retreats,options}`，`state`是 idle／approaching／fighting／aiming／shooting／repositioning／shielding／retreating／evading；跟随本身的`state`多一个`guarding`。
- 兜底：Bot 造成的任何伤害（挥击、箭、其他）落到上面那些不算目标的实体上时，服务端直接取消这次伤害。

运行端：`companion-mode follow`默认带保护（`--guard on|off`、`--guard-radius`、`--guard-low-health`、`--guard-bow`、`--guard-shield`给默认值，WebUI「配置」页的「保护玩家」一栏和`scripts/start-server-play.mjs`的`--guard*`参数转过来），请求里`guard:false`关掉、对象逐项覆盖；身体没有该能力时不带，明确要求就拒绝。保护时运行端只把「开打（20 秒内只报一次）」「打完了，打倒几只」「血少在撤」「躲苦力怕」作为`guard`事件唤醒模型，`companion-mode`状态仍是 following／waiting，另带`guard`。保护进行时 3 格近身自卫不插手；自动进食和近身自卫遇到普通跟随／等待时改为先让开、处理完再恢复同一个意图（以前是取消）；让开期间任务在跑时，反射先取消那个任务（不重放），跟随意图保留。让开期间服务端的保护跟着跟随操作一起停了，只剩 3 格近身自卫。保护是跟随上的开关，用`companion-mode guard`改，不必重新follow。

同一仲裁器在普通观察之外独立采样紧凑生存状态；模式切换、慢普通观察与原生战斗等待不能挤掉感知。防卫抢占前阻断新普通写入，撤销容器／采集／陪伴／进食后等待身体停止确认，再获得写锁；不新增第二个控制者或偷偷接纳外部generation。人工停止解除armed，读状态与危险仍存在都不能重新授权。危险事件只按有意义的状态变化生成，不因距离微调、每次挥击、空气补回或跳跃下落数值变化反复唤醒模型。

分段时间字段sensedAt、stopRequestedAt、stopConfirmedAt、actionRequestedAt、actionAcceptedAt记录运行端时间；actionAcceptedAt是收到回执的时刻，不是服务器最后实际写入tick。真实反应延迟与更长运行的结果须看本批验收，工具数量不代表通用Mod、任意武器或全地形支持。

#### 常驻保护（8m 第一步第一块，2026-10-10）

设计见[陪伴状态设计](../companion_state_design.md)第 5 节。能力标记`guard-duty-fenced`（第一块用过的`guard-duty`已不再声明）：保护不再挂在`follow-companion`操作上，而是租约上的一项常驻职责，战斗逻辑和上面 8h 的一样（`GuardCombat`），并支持下面的请求排序和原子清除。

- **方法`guard`**（要租约，校验 instance／session／lease，不看`controlGeneration`；**不是操作**，不占操作 ID 预算）：`{player, expectedEntityId, options?}`打开或替换（`options`同 8h 的`guard`对象，省略用默认值），玩家不在 32 格内报`PLAYER_NOT_VISIBLE`，UUID 不符报`STALE_TARGET`；`{off:true}`关掉。所有请求还必须带`guardRevision`，回执带同一序号。运行中的普通操作不阻止配置；HTTP 队列仍可能报`BUSY`，原生写入尚未返回时不能确认停稳或开启替代职责。
- **配置排序**：每份新租约从 0 开始记录`guardRevision`；每次配置及`stop(clearGuard:true)`携带严格递增的正安全整数，不复用序号。`guard`的序号小于或等于已接受序号报`CANCELLED`；接受序号后即使后续参数／原生检查失败也不回退。顺序只看序号：后到的旧开启不能越过新的关闭或`stop(clearGuard)`；普通 stop 保留保护意图，所以它前后到达的配置（开或关）照常生效。运行端同时撤销等待观察／聊天的旧配置，并丢弃被取代的迟到回执，不自动重放开启。
- **生命周期**：普通`stop`（代次加一）保留保护意图，只打断正在进行的执行，后续 tick 可重新判断；`stop`带`clearGuard:true`及新`guardRevision`时，在同一服务端请求中停止操作并清保护，确认后才返回`stopped:true`；序号已被更新的设置超过时照样停止，但保留那个更新的设置。`revoke`、`release`、新的`claim`、租约过期、身体死亡／换维度／移除时也清掉。保护正在打时被关掉或换成新的，和打完同一套收尾（`DutyFight.end`）：被暂停的任务重新寻路、受伤基线从此刻算（打架挨的伤不让它以`BLOCKED`结束），期限只给被暂停的那个操作顺延；没有任务时身体站住，姿态接回去。
- **原生撤销**：意图绑定原租约和身体会话，当前战斗另持可撤销的执行授权。普通 stop、off 或替换配置立即使旧攻击 scope 的授权失效；后续 tick 或新租约不能复活旧 scope。原生攻击回调内重入停止／关闭时先撤销，调用栈尚未退出仍报`STOP_UNCONFIRMED`，已发生的伤害仅保留为旧执行的只读回执。
- **观察**：保护开着时`observe`多一个`guard`：`{enabled:true, player, entityId, options, covering, reason?, returning, busyMs, state, target?, targetId?, hits, damage, shots, kills, retreats}`。`covering:false`时`reason`是`PLAYER_AWAY`（下线、换维度、超出 32 格）、`TOO_FAR`（Bot 离玩家超过 16 格）、`BUSY`（正在做的事不能打断）或`NO_CONTROL`；玩家回来后自动接着保护。`busyMs`是累计打架时长，以后给任务顺延期限用。
- **什么时候接管身体**：Bot 离玩家 16 格内，且此刻没有操作在跑（空闲，或运行端在原地等待），或者在跑的是不带自己保护的`follow-companion`；在吃东西、挖掘、自卫（原生使用或写入中）、睡觉、开着界面时不接管。这一块里别的任务（建筑、采集、走路、长途走、工作站……）还不能被打断，保护等它们做完（`reason:BUSY`），这期间只有 3 格近身自卫；任务打断在下一块做。
- **打完以后**：跟随时交还给跟随，跟随重新算路线，打架时挨的伤不再算作跟随受伤；空闲时走回开始打之前站的地方（1.2 格内算到，最多 15 秒，走不到就留在原地）。跟随在保护同一个玩家时挨打不会结束跟随。
- **运行端**：身体有`guard-duty-fenced`时，`companion-mode follow`的保护（默认开，`guard:false`关）变成在开始跟随时调`guard`，`follow-companion`不再带`guard`；跟随让开、改成原地等待都不动保护；`companion-mode guard`不需要先跟随，没跟随时带`player`；`companion-mode stop`发 off 关保护，`stop-action`使用上述原子停止并清除，反射引起的停止不关。关闭要收到确认才清本地已确认状态；关闭遭`BUSY`（HTTP 队列满）后可显式重试，即使此前开启尚未回执也必须发送关闭。正在停止时也可以发关闭或开启，不报`BUSY`。`guard`事件从观察里的`guard`生成，规则同 8h；服务端那边保护没了（换过控制权等）时发一条`guard`事件说明。保护覆盖时 3 格近身自卫不插手，不覆盖时照常；保护在打时普通进食等打完，紧急进食照旧。
- **兼容**：当时新运行端连接没有`guard-duty-fenced`的旧身体时回退到`follow-companion.guard`路径；8m 第二步删掉了这条旧路径，现在没有`guard-duty-fenced`时保护报 UNSUPPORTED，提示更新核心模组。
- **验证范围**：配置请求／回执乱序、关闭拒绝后重试、停止升级、租约边界及原生回调重入授权撤销均有离线回归；没有本次修复的隔离服实测或真实模型试玩证据，离线夹具不证明真实伤害事件顺序。

#### 保护打断任务（8m 第一步第二块，2026-10-10）

能力标记`guard-duty-tasks`（和`guard-duty-fenced`一起声明）：常驻保护除了空闲、等待、跟随，也会在下面这些任务的安全时刻接管身体去打，打完把身体交还给任务，任务从身体所在处重新寻路、接着做。

| 正在跑的 | 什么时候能打断 |
| --- | --- |
| `follow-player`、`move-to-position`、`approach-container`、`approach-resource`、`sleep-in-bed`（走向床）、`sit`（走向座位） | 站在地上时 |
| `hunt` | 地面阶段走向下一只时；挥击、垫高跳起、站在垫脚柱上时不打断 |
| `travel-to` | 走路段，不在游泳过水时 |
| `build` | 地面层：没在挖、没有垫脚柱（站着的或留在屋顶上的）、没在回垫脚柱的路上、没在超时收尾 |
| `tend-crops`、`breed-animals` | 走路时，不在挖作物时 |
| `craft-item`、`smelt-item`、`produce-item`、`modify-item` | 走向工作站时；界面一开就等它做完（烧炼带`wait`时一直开着界面，期间不打断） |
| `pickup-item` | 一直可以；打完掉落物超出 8 格或被挪动时照常失败 |

不打断：`approach-player`（玩家一动就失败）、`retreat-from-entity`、`pillar-up`、`emote`手势（几秒就完）、挖掘、进食等原生使用、开着的界面、睡着。不能打断时观察里`guard.covering:false`、`reason:"BUSY"`，近身自卫照常。

- **期限顺延**：被打断的操作期限加上打架时长，累计最多再加一倍原期限，超过照常`TIMEOUT`（可再调一次接着做）。打架途中新开始的操作（例如采集两步之间）也算被打断，同样顺延。打完后任务的受伤基线从当前血量算起，打架挨的伤不让任务以`BLOCKED`结束；打架还没开始前在路上挨打照旧`BLOCKED`。
- **运行端**：`Body.fightMs()`把观察里各次保护的`busyMs`累加；运行端自己计时的采集（`GatherTasks`）和容器任务（`ContainerTasks`，总期限和每步等待都算）按增量顺延，同样最多一倍；陪挖仍用跟随自己的期限。`companion-mode`的说明和启动提示按新行为写。
- **验证范围**：离线：Java `GuardDutyTest` 31 项（含任务挂起、不打断时说明 BUSY、顺延上限），运行端`guard-fights.test.mjs`和容器任务期限顺延用例。隔离服`scripts/server-guard-duty-smoke.mjs` 8 项（2026-10-10）：等待中打完回原地 1.3 格内；地面盖 21 格圆石时第 3～4 格间刷尸壳，打完盖满、没有超时；8 格柱子在垫脚柱上时尸壳不挨打（BUSY），下来后打死、柱子盖完、垫脚挖回；玩家在 20 格外时`TOO_FAR`不打。尸壳不动（NoAI），测试玩家是协议机器人；合成界面开着时不打断只有离线检查；没有真实模型试玩。

#### 打指定生物 hunt、金苹果（2026-10-11 试玩反馈）

- **能力`hunt`**（操作，同时一个）：`{type, count?, pillar?, radius?, player?|center?, lowHealth?, survey?, timeoutMs?}`。在中心（默认 Bot 自己，或玩家、坐标）`radius`（1～16，默认 12）内找成年的该种生物，走过去用背包里最好的剑或斧（不在热栏就换进热栏），满蓄力一下一下砍，攻击走和自卫一样的原生攻击范围（只能伤到目标，不横扫），直到打死`count`只（1～16，默认 1）或附近没有了。永远不打：玩家、村民和商人、玩家造的傀儡、有主人或拴着的、起了名字的、幼崽；苦力怕直接拒绝（`UNSUPPORTED`）。**唯一的例外是村子自己生成的铁傀儡**（不是玩家造的、没名字、没拴着，`GuardCombat.wildGolem`），只在`type`是`minecraft:iron_golem`时才会被选为目标，`survey`里也按这个算“可打／受保护”；玩家造的和起了名字的铁傀儡照旧受保护。放行只在这一次挥击里生效（`GuardCombat.huntSwing`临时记下被打的那只，友军伤害取消`protectedFromBody`据此放过，挥完就清掉），自卫、保护玩家（GuardDuty）、弓箭路线上的判断都没改，仍把铁傀儡当受保护的。血量到`lowHealth`（默认 8）就停（`LOW_HEALTH`）。掉落只在走过时按原版拾取。`survey:true`只数（`total`、`huntable`、`babies`、`protected`）。结果：`killed`（只算自己砍过、随后死亡的）、`swings`、`damage`、走不到的个数和原因、背包变化。走路时可被常驻保护打断。运行端工具`hunt`，说明里要求只打玩家要求的。
- **垫高打法（`HuntPillar`，铁傀儡一定用，其他怪传`pillar:true`才用）**：近战怪的攻击范围是自己的碰撞箱只向水平方向扩一点、竖直方向不扩（原版 1.21.1 `Mob.getAttackBoundingBox`、`isWithinMeleeAttackRange`），所以 Bot 脚底不低于目标碰撞箱顶就够不着。流程：走到目标 2.4 格内（`HuntTask.NEAR`；已经在追 Bot 的怪就原地不走）→ 按“目标碰撞箱顶 − 脚底高度”向上取整算要垫几格（`HuntPillar.levels`，铁傀儡 2.7 高同一地面是 3，僵尸是 2；不写死）→ 一格一格用 `NativePillar`（和`pillar-up`同一段代码，作为 hunt 的子操作）跳起放方块 → 换回剑站在垫脚上，目标在交互距离里就打，直到打死 `count` 只、血量到`lowHealth`、超时或这只一直够不着（`WALK_MS`）→ 用`dig-block`（同一段原生挖掘）从最上面一块往下拆回自己放的方块，再继续或结束；结果里`standBlocksLeft`是没拆掉的个数，`note`写原因。垫脚用背包里软的、手或带着的工具能挖的普通整块（和 build 的脚手架同一套挑法，上限`BuildTask.MAX_SCAFFOLD`=8 格），数量不够直接失败`NO_BLOCKS`（不会走过去）、目标太高失败`UNSUPPORTED`。`pillar:true`只对地面近战怪（`HuntTask.pillarable`：要是铁傀儡或敌对怪；不含远程的、手里拿弓弩三叉戟的、法术师、会飞的、蜘蛛、末影人、监守者、守卫者、旋风人、末影龙、苦力怕），其他类型整次拒绝`UNSUPPORTED`。不处理怪跳起来，也不追：目标走开出了交互距离就等到`WALK_MS`后放弃这只。叫停（`stop`）或租约丢了时 Bot 留在垫脚上，不会先拆。
- **金苹果**：金苹果、附魔金苹果的效果都是有益的，不再按“带效果的食物”拒绝；仍是贵重食物，自动进食只在血量紧急线才吃，模型可以按玩家要求指定槽位吃；和原版一样饱腹时也能吃。
- **验证**：隔离服`scripts/server-hunt-smoke.mjs` 8 项（2026-10-11）：只数不动；打 2 只成年羊、剩 1 只，剑从背包换到手上；起名字的和小羊没挨打；苦力怕拒绝；饱腹时吃附魔金苹果少一个、有伤害吸收。羊会走动，没有测会还手的怪，没有真实模型试玩。

#### 跟随让开、自卫失败、没武器（试玩反馈修正）

（10-12 注：第一条的`stepAside`、`step-aside-stop`、`ControlSession.carries` 在 8m 第二步随服务端姿态删掉了：姿态让开不再停身体、不推进代次，目标自然继续有效。没武器时腾手空手打仍是现行做法。）

玩家实测 Bot 一边跟随一边干活时的三个问题。只有离线测试，**未在真实游戏中验证**（没有隔离服实测，也没有真实模型试玩）。

- **让开不再作废刚找到的目标（能力`step-aside-stop`）**：以前跟随为工具让开要停一次身体（代次加一），而`discover-resources`的 resourceRef、`discover-containers`的 containerRef 在运行端和服务端都按发现时的代次核验，于是跟随中“先找再做”的`gather-resources`、`approach-container`和存取箱子必定`WORLD_CHANGED`。现在`stop`可带`stepAside:true`：照常取消操作、代次加一，但服务端把这之前发出的资源目标和容器目标继续认作当前控制。规则是`ControlSession.carries(g)`：从代次 g 到当前只有 step-aside 停止。普通`stop`（包括`stop-action`）、带`clearGuard`的`stop`（同时带`stepAside`也按普通算）、`claim`、`revoke`、`release`、身体变化都会截断。会话、维度和服务端 120 秒期限照旧核验。运行端`ServerBody.carries`按同一规则记账，资源引用和容器引用的上下文比较改用`sameControl`（实例、会话、世界、维度相同，代次相同或被承接），本地 30 秒期限不变。只有`CompanionMode`为工具或反射让开时才发`stepAside`，服务端没声明能力时不发，行为同旧版。
  - **玩家叫停照样作废**：①`stop-action`经`stopCurrent`同步清空本地引用（`gather.cancel()`、`tasks.cancel()`），再发不带`stepAside`的停止（带`clearGuard`），服务端截断承接；②让开的停止还在途中时到达的普通停止不合并进去，而是在它之后单独再停一次，所以照样截断；③`companion.stop`推进 epoch，途中的让开拿不到确认。即使有别的路径留下了本地引用，只要中间有过一次非让开的停止，运行端（`WORLD_CHANGED`）和服务端（`STALE_TARGET`）都会拒绝。
- **自卫确定失败后跟随照常接上**：跟随中近身自卫要先让开（停一次），身体正被跟随占着又会再停一次（代次加二）。以前自卫`failed`（比如没有能核验的武器）时把跟随转成手动暂停，下一次后台观察发现代次变了、又不是让开状态，就判`WORLD_CHANGED`。现在`failed`、`cancelled`和成功一样让跟随自己接上，只有`unknown`（没人确认的结果）才停在暂停、并停用自卫。
- **陪伴意图作废不再结束整个控制**：以前的升级链：`CompanionMode.fail`遇到`WORLD_CHANGED`／`CANCELLED`也按失控处理，调用`body.close()`（释放租约、`ServerBody`进入 closed）→ 下一次`RuntimeMonitor`读观察时`assertActive`报`LEASE_LOST`（“服务端控制权已结束；请显式重启接管，不得重放旧动作”）→ `disconnect`事件 → 带`--reconnect`的驱动器以 75 退出、重新接管，跟随和保护都没了。现在这两个码只结束跟随／等待（状态`stopped`并带码和原因），身体控制、租约和常驻保护都保留；失租约、过期、断线、回执无效、停止未确认等仍关闭身体。旧的跟随不会留下无主的移动：服务端只在 follow-companion 的代次仍是当前代次时驱动它。陪挖／陪捡的阻断收尾里，停止已确认后的代次异常也只结束意图。
- **暂停、受阻时接住同会话的新代次**：手动暂停（模型`pause`、或让开转成的手动暂停）和`blocked`时，身体上没有我们的东西在跑，代次只是因为别的任务停过身体才前进。同一实例、会话、世界、维度的较新代次直接沿用（后台观察和`resume`都是）；`resume`仍重新核验玩家身份。换会话、世界、维度照旧作废意图。玩家叫停不经过这里：`stop-action`直接清掉意图。
- **没武器时腾手空手打**：保护（`GuardCombat`）和`defend-self`都按这个顺序：背包里最好的可核验原版剑／斧 → 空着的热栏格 → 把手上那格的东西用原生 SWAP 挪进背包主区（9～35）第一个空格，空手打。挪开的东西不会被拿来打，未知 Mod 物品照旧不用。热栏和背包主区都满时照旧放弃：保护对这只怪暂时不打，观察的`guard.unarmed`为`NO_FREE_HAND`，运行端发一条`guard`事件说明；`defend-self`报`UNSAFE_WEAPON`，原因写明“热栏和背包主区都满，空不出手”。`defend-self`挪的是选中格，选中格组件不完整时换别的热栏格再选中，挪动走`swap-inventory`并核对两格的结果。
- **验证范围**：运行端`npm test`（Node 24.21）新增`companion-step-aside.test.mjs`（跟随中发现后采集／走近箱子能开始、叫停后仍拒绝、非让开停止仍拒绝、让开途中到达的停止单独执行、跟随＋自卫失败后恢复且不断开、手动暂停接住新代次、`WORLD_CHANGED`只结束跟随），`survival-defense.test.mjs`腾手三项，`companion-guard-duty.test.mjs`空手原因一项。Java 用例补在`ControlSessionTest`（承接链）、`ResourcePickupTest`（资源目标）、`GuardCombatTest`（腾手顺序、放弃和原因）。

#### 玩家丢来的物品、附近实体的装备（2026-10-11）

背景：玩家把下界合金剑丢给 Bot，原版拾取后保护战斗也用上了，但模型不知道，还说“你没给我”；模型也看不到玩家和生物拿着、穿着什么。两个能力标记都是只读的（不是动作），旧运行端不认识新字段时按原样忽略（zod 默认丢掉多出的键），新运行端遇到不带标记的旧服务端也照常工作。

**`gift-receipts`：拾取收据记丢出者。** 原生拾取（`ItemEntityPickupEvent.Post`，以及背包类拾取槽在 Pre 里接走的那条路径）记收据时，读 `ItemEntity.getOwner()`（1.21.1 里就是丢出者 `thrower` 的 UUID 解析出的实体）。丢出者是玩家、且不是 Bot 自己时，收据多一个可选字段 `thrownBy`（玩家名）：`{seq,…,storedIn?,thrownBy?}`。采集的方块掉落、打怪掉落没有丢出者；Bot 自己 `drop-item`、递物没被接住又捡回来的，丢出者是 Bot 自己，都不带 `thrownBy`。死亡掉落（原版不记丢出者）、丢出者已下线（解析不到实体）时也没有这个字段；读取出错只丢掉名字，不影响收据本身。物品的 `target`（只许某人捡）不参与判断：指定给别人的物品 Bot 捡不到。

运行端（`EventJournal.useGifts`，只在 hello 带 `gift-receipts` 时开启）：

- 每个服务器实例（`instanceId`）的第一份观察是基线，之前的收据不算；之后只看 `seq` 更大的收据，同一条收据只通知一次（重复观察、`get-status` 和后台轮询都会 ingest，按 seq 去重）。
- `thrownBy` 是自己的名字或 `--bot-players` 里的名字时不算。
- 同一个人的物品从第一件起收集 2 秒，合成一条唤醒模型的 `gift` 事件；相同物品且组件相同的数量相加，进了背包类存储的单列：`muxue 丢给你：minecraft:netherite_sword ×1（已进背包）`、`muxue 丢给你：minecraft:bread ×5、minecraft:iron_sword ×1（带附魔、名字等属性）（已进背包）；minecraft:coal ×9（已放进 sophisticatedbackpacks:backpack）`。
- 驱动器把 `gift` 加进唤醒类型；启动提示：收到 gift 时在游戏里简短回应、道谢或确认收到，需要时再用 `list-inventory` 查背包。

**`assess-armour`：收到的护甲自己穿上（10-11 试玩：玩家丢钻石胸甲，Bot 不会自己换）。** 只读能力（不是动作，`atomicAction` 排除）。请求 `{instanceId,sessionId,leaseId,items:[物品ID,1..8个]}`；服务端在主背包 0..35 格里找这些 ID 的、能穿的东西，对照身上现在穿的，返回 `candidates:[{slot,item,count,part,verdict,reason,wearing?}]`。能穿的只有原版人形护甲（`ArmorItem` 的头、胸、腿、脚，不含鞘翅、南瓜、头颅、马铠、狼铠）和**副手空着时**的盾牌（`part:"offhand"`）。**“更好”只在服务端判断一处（`ArmourChoice.java`，原生读取在 `ArmourAssessment.java`）**：先比护甲值，再韧性（都是该部位属性修饰符的加法值），再附魔总等级，最后剩余耐久（不会坏的算最大）；四项全相同不换。`verdict`：`better`（`reason` 为 `slot-empty` 或 `better-stats`）、`not-better`（`same`／`worse`／`better-candidate`＝同部位另有更好的候选／`offhand-occupied`）、`blocked`（`new-binding`＝新的带绑定诅咒穿上脱不掉、`worn-binding`＝身上的带绑定诅咒脱不下、`no-room`＝被替下的那件没地方放）。同部位多个候选时只有最好的一个是 `better`。被替下的旧件放回新件原来的格子（`equip-item` 的原有行为），所以单件永远放得下；`no-room` 只在新件是一叠多件、背包又没有空格时出现。

运行端（`gift-gear.ts`，hello 同时带 `assess-armour`、`equip-item` 时由 `main.ts` 接到 `EventJournal.useGiftHandler`）：`gift` 事件发出前，把进了背包的礼物物品 ID 交给服务端评估；`better` 且身体不忙时用 `equip-item`（带评估的 `slot`；`equip-item` 不让姿态挂起，跟随／等待中照常跟）穿上，事件在原文后接 `已换上 X（替下 Y）`；其余结果也写进事件（不比身上的好、带绑定诅咒、放不下、副手有东西）。**忙**＝任务、采集、动作在跑，保护正在打，陪挖，或跟随被工具暂停：不打断，事件写 `可以换上 X，比身上的 Y好，但正在忙，没有换（空下来可以用 equip-item）`。评估或穿戴失败、8 秒内没结果时，事件照常发出（失败写“没成功”）。只处理玩家丢来的礼物，不是任何拾取。

**`entity-equipment`：附近实体的装备。** 观察 `entities` 里每个 `LivingEntity`（玩家、僵尸、骷髅、猪灵、凋灵骷髅、村民、盔甲架、马、狼……），只要有一个装备位不空，就带 `equipment`：

```json
{"mainhand":{"id":"minecraft:netherite_sword","count":1,"enchantments":["minecraft:sharpness 5"],"name":"屠龙","durability":"2000/2031"},
 "offhand":{"id":"minecraft:shield","count":1},
 "chest":{"id":"minecraft:iron_chestplate","count":1}}
```

- 装备位用原版 `EquipmentSlot` 名，顺序 `mainhand`、`offhand`、`head`、`chest`、`legs`、`feet`、`body`（马铠、狼铠等）；只列非空的。全部为空的实体不加字段。
- 每件：`id`、`count`；有附魔时 `enchantments`（`"id 等级"`，排序，和 `ItemDescriptions` 的写法一样）；有自定义名字时 `name`；掉过耐久时 `durability`（`"剩余/上限"`，和 `ItemDescriptions.describe` 一样，没有这个字段表示满耐久或不会损耗）。不给整份组件 / NBT。
- **上限**（`EquipmentView`）：`id` 和每条附魔最多 64 字符，名字最多 32 个字符（超出截断加 `…`），附魔最多列 4 条（多的数在 `enchantmentsMore`）；一个实体的装备最坏约 3.8 KB；每次观察最多给离 Bot 最近的 16 个实体带装备，装备 JSON 合计最多 8192 字节，超出的、或读取出错的实体带 `equipmentOmitted:true`（不是“没装备”）。`entities` 本身仍是 32 格内最多 64 个。典型场景（玩家拿附魔剑和盾、穿两三件钻石甲，一只穿铁甲拿铁剑的僵尸，一只拿弓的骷髅）约增加 620 字节（紧凑 JSON）。
- **同样带装备的其它读取**：`survival-state` 的 `threats.nearby` 里 `hostile`、`attacking_self`、`unknown` 的条目（最多 24 条，同样的上限）；`look-around` 的 `players`（最多 8 个）和每种生物最近那只的 `nearest`。
- **运行端**：观察、威胁的 zod schema 加可选的 `equipment`、`equipmentOmitted`，单个字段不合格只丢掉这个字段，不让整份观察失败。工具说明写明哪里有装备：`get-status`（紧凑视图前 16 个实体）、`find-entity`（按距离排序，用来看玩家拿着什么）、`look-around`、`get-survival-state`。`survival` 危险事件末尾加 `；装备：minecraft:zombie（穿 iron_helmet、iron_chestplate，拿 iron_sword），minecraft:skeleton（拿 bow）`，不进事件比较的键，装备变化不会再次唤醒。
- **验证范围**：离线：Java `EquipmentViewTest`（玩家装备、穿铁甲的僵尸、拿弓的骷髅、全空不出字段、16 个实体和 8 KB 截断、读取失败标记、`thrownBy` 判断）；运行端 `gifts-equipment.test.mjs`。从原生实体读装备位（`ItemDescriptions.equipment`）、`getOwner()` 取丢出者只有代码审阅，没有隔离服实测和真实模型试玩。

#### 试玩反馈修正（2026-10-08）

10-08 用户用 Claude（Haiku）实测时遇到的问题，按顺序修了五处；实测见`scripts/server-equip-swim-smoke.mjs`（隔离服：装着 SB 时 16 项；挪开客户端模组、加`--with-peer`时 15 项，含跟随下水）。

- **停托管不留假人**：驱动器退出（WebUI 停止、`stop-companion.ps1`）时`revoke`带`leave:true`，角色下线、原版照常存档，下次启动在原地上线。聊天叫停、换会话、托管出错重启这些不带`leave`，角色还在原地。驱动器异常退出没机会撤销时，角色仍留在服务器，等租约过期（不下线）。
- **穿装备**：新原子能力`equip-item`：`{slot:0..35,expectedItem,expectedCount>0,expectedComponents}`。物品要是原版判定穿在护甲槽的（头盔、胸甲、鞘翅、护腿、靴子、生物头颅）。要求自身物品栏、空光标。护甲槽空着就原生 QUICK_MOVE（shift 点击）；有东西就原生 PICKUP 三下（拿起新的、点护甲槽对换、放回原槽），和玩家在物品栏里换装一样；绑定诅咒的脱不下来先拒绝。回执`{part,slot,wearing,tookOff?,inventory}`；没动就`failed`+`FORBIDDEN`，光标里还留着东西就放回原槽并判`unknown`。穿在身上的护甲本来就在观察的`inventory`里：槽 36 靴子、37 护腿、38 胸甲、39 头盔、40 副手。可选`hand:"offhand"`（10-11 加）：任意非空物品（火把、食物、地图等）都放进副手，原生 PICKUP 点副手空槽，副手原来有的就对换、旧的放回新物品原来那格；副手是空的就两下（拿起、点副手槽）放完。绑定诅咒和原版一样只锁护甲槽，副手不限；副手里已经是同一种物品（同组件）时报 ALREADY_HELD，因为原版点击会把两堆合并而不是对换。不给`hand`时行为不变，护甲和盾照旧不用加；回执多一个`hand:"offhand"`，`wearing`是副手现在的物品，`tookOff`是换下的。Node 发布`equip-item`工具，参数是`item`和可选的`hand`，运行端从最新观察里挑主背包的那一格填守卫。
- **水里能走**：导航的前置条件不再拒绝「在水里」（岩浆、着火、骑乘等照旧拒绝）。身体在水里时不规划步行路线，像玩家一样按住跳浮上水面，朝岸边游：在身边 10 格内找能站的岸（从水面往下看每一列第一个不是空气的格子；第二轮起只要和水面齐平的，见下），选「离身体近、离目的地也近」的（到目的地的距离按一半算）；碰到岸边时原版的出水攀爬把身体送上去，上岸后照常规划步行路线。4 秒没进展就换下一处岸，换 4 次还出不去判`BLOCKED`，10 格内没有岸判`NO_PATH`。步行路线照旧不穿过水。`navigation`诊断多一个`swims`（找岸次数），`stage`多一个`swim`。`move-to-position`、`travel-to`可以从水里开始；`pillar-up`仍要求站在干地上。跟随、保护、拾取等用同一个导航，所以跟随时下了水也会自己游上岸再跟。
- 生存危险事件不再把「在水里」当成变化唤醒模型，只有空气不足（`oxygenLow`）才算。
- **自卫说清楚**：试玩里被蜘蛛打时小克说「已经处理掉了」，其实一下也没打；后来模型手动叫的自卫因为蜘蛛在 3 格外返回`NO_THREAT`，这一下把自动自卫整个停掉了（`armed:false`），之后旁边的僵尸也不管。现在：①NO_THREAT（什么都没做）不再停用自动自卫；②危险事件末尾加一句不参与去重的说明：每个威胁「会自动还手」还是「不还手（不在 3 格内／没有视线／没确认是敌对的／服务端给的原因）」，自动自卫停用时写明原因。13:37 那次蜘蛛在 3 格内却没自动还手，当时没留下原因，下一轮试玩看这句说明就能确定。
- **背上背包**（SB 适配）：新交互`sophisticatedbackpacks:backpack/take`（方块类、空手、潜行），把放着的背包连同内容捡到手上；带没验证过的升级的背包拒绝，和打开一样。然后`equip-item`穿上：SB 的背包物品声明穿在胸甲格，所以和胸甲二选一（服务器没装 Curios）；对换时只用左键点击，不会触发 SB 右键把东西塞进背包的行为。实测在同一脚本里（装着 SB 时 16 项）。

第二轮（同日傍晚试玩）：

- **盾牌放副手**：`equip-item`也接受原版判定拿在副手的物品（盾牌），放进槽 40；副手有东西就对换。
- **旁边有人也照打**：自卫原来在目标旁边有别的生物（试玩里是用户）时拒绝出手（`COLLATERAL_RISK`）。原生横扫本来就被`SweepAttackEvent`取消、对目标以外的伤害也被拦下，只会打中目标，这项检查删掉。
- **自卫不再轻易关掉**：①`stop-action`只停正在做的事，确认停下后自动自卫马上恢复；叫停时正在打的那只怪先放 3 秒，它还在打就接着还手。②有明确结果的失败（拒绝、退路被堵）不再关掉自卫，只是对这只怪 3 秒内不再试，同样的失败 10 秒内只报一次；结果未知（`unknown`）的才停用。试玩里模型叫停卡住的移动后，被 5 只僵尸围着也不还手，就是因为①。
- **水里不再淹死**：身体空着（没有任务）、眼睛在水下时像玩家一样按住跳，浮在水面。试玩里小克沉到湖底站着，模型以为掉进了「地下水」，最后淹死。
- **上岸只选和水面齐平的岸**：比水面高一整格的岸从水里爬不上去（实测浮到差 0.14 格，原版玩家也一样），不再当成上岸点；只有这种岸时直接`NO_PATH`说明。紧挨着水的岸原版标成`WATER_BORDER`，也算能上的岸（原来漏掉了，只会选离水一格的）。游泳的进展只按离岸变近算，水面上下浮动不算；浮出水面一下不算上岸，不会清掉试过的岸。试玩里卡在岸边就是选了高一格的岸，又因为浮动一直算「有进展」不换岸。
- **追怪疾跑**：保护玩家时追怪和撤退都疾跑（饱食度大于 6、不在水里、没在用物品、不是跳空隙），骷髅退着射也追得上。
- **胡萝卜、土豆能自动吃**：能种的原版食物（`ItemNameBlockItem`：胡萝卜、土豆、甜浆果）原来被当成「未验证」，现在和普通食物一样。
- **死后照样能下线**：宿主退出时驱动器先核对身体的会话编号，角色死了重生后编号变了，撤销就没发出去，留下假人。撤销现在不要求编号一致（服务端只认它自己退役的那份租约，别人接管了就不下线）。
- 实测：`server-equip-swim-smoke.mjs`装着 SB 21 项、挪开模组加`--with-peer`19 项；`server-guard-smoke.mjs`14 项（含疾跑）；`server-navigation-defense-smoke.mjs`55 项；`server-stroll-smoke.mjs`10 项。

#### 瞬间动作旁边跟随（能力 beside-follow，2026-10-11）

（10-12 注：已删。8m 第二步改成服务端姿态后，这份名单变成 `Posture.KEEPS`，见「陪伴姿态」一节的「不让姿态挂起的操作」；下面是当时的写法。）

- 服务端声明 `beside-follow` 后，`select-slot`、`equip-item` 可以在 `follow-companion` 运行时执行：跟随不停、不重发，运行端也不让开。两个动作都在服务端同步完成（`begin` 返回时已不是 running）；它们不移动身体，不改跟随的 `active`。
- 放行条件：当前正在 running 的非聊天动作全部是 `follow-companion`。运行端的 exclusive 槽和共享任务锁在这种情况下对这两个动作同样放行。
- 其余照旧：别的动作（如 `dig-block`、`build`）在跟随旁边仍返回 `BUSY`。（之后的写法：`look-at` 不再让开，内置 `emote` 只停住、不挂起，见陪伴姿态一节的「不让姿态挂起的操作」。）万一服务端没有同步完成，回执按 `failed`（`INTERNAL`）处理。

#### 死后原地复活、死因、断开前的陪伴状态（能力 last-death，2026-10-11 试玩反馈）

- 原版玩家死后 20 tick 会被移出世界（移除原因 `KILLED`），但仍留在玩家列表里，直到 `PERFORM_RESPAWN` 换成新实体。以前服务端把“已移除”当成身体不在了：死后超过 1 秒才复活时，会先让身体下线、再读死亡存档上线（聊天栏出现退出、加入）。现在 `KILLED` 的尸体照常原地复活（`NativeRespawn.present`）。
- `hello.lastDeath`：最近一次死亡的原版死亡消息（`message`，即聊天栏那句）、维度、位置和时间（毫秒），一直保留到下次死亡；从没死过时没有这个字段。只读，不影响控制。
- 托管重连（驱动器 `--reconnect`）启动时，驱动器不等玩家开口，马上给 Agent 一轮：复活的带上 30 分钟内的死因和死的地方。断开前的陪伴状态不再经过驱动器（8m 第二步，2026-10-11 起）。
- 陪伴状态由运行端写在 `runtime/posture-<名字>.json`（跟随谁、原地等、保护谁，以及保护开没开）。身体丢了不清，只有明确结束才清：`companion-mode stop`、没跟随时 `guard:false`、`stop-action`、玩家叫停、托管真的停止。有 `server-posture` 时由**运行端**启动时读一次就删（`client-runtime/src/posture.ts`），超过一小时、或早于 `session-<名字>.json` 里最近一次叫停（`lastStopAt`）的不用；然后运行端自己先按「陪伴姿态」一节去捡死亡掉落，再恢复跟随／等待／保护（坐着不恢复；记录时跟随／等待是手动暂停或受阻的，记录里带 `state: paused|blocked`（受阻带 `code`），这种不自动接上，只恢复保护并在事件里说明原因），结果用一条【死后恢复】事件告诉 Agent。

#### 保护用弓（2026-10-11 试玩反馈修正）

- 保护接管身体前会检查“身体忙不忙”（吃东西、同步原生写入、睡觉、开着界面、正在用物品）。以前保护自己拉的弓、举的盾也算“正在用物品”，下一 tick 就把身体收回、弓放下，所以永远拉不满 20 tick。现在保护正在战斗时，它自己用的物品不算忙（`GuardDuty.bodyFree`）；别人在用的物品（比如正在吃）照旧算忙。
- 能不能射：依次试怪的中间、胸口、头（`AIM_HEIGHTS`），按原版箭的飞行（每 tick 移动后 0.99 阻力、0.05 重力，满弓初速 3）逐 tick 模拟，先碰到怪（碰撞箱外扩 0.3）而不是方块才射，弧线及没射中后再飞的两 tick 内不能经过玩家、宠物、村民（碰撞箱外扩 1 格）。都不行就不射，只拉着等。
- 诊断（只用于排查，不影响决定）：保护状态多 `draws`（开始拉弓的次数）、`lastEnd`（上一场战斗为什么结束，如 `NO_FOE`、`STALE`、`NO_PATH`、`INTERRUPTED`）、`lastDrop`（上次弓为什么没射就放下，如 `MELEE`、`NOT_VISIBLE`、`NO_CLEAR_SHOT`、`EVADING`）、`lastBreak`（保护为什么中途把身体还回去，如 `TOO_FAR`、`BUSY`）。一场战斗拉过弓却没射出时，服务端日志写一行 `MCBOT guard: drew the bow …`，最多每 10 秒一行。

#### 保护用弓：站位不好时挪一步

- 现在的位置射不中（脚下的崖边、墙角挡住），就找一个能射中的地方：以脚为中心 1 到 4 格、八个方向共 32 个点，近的在前；点要在 `min(leash, ENGAGE_RANGE) - 1.5` 格内（`GuardDuty.ENGAGE_RANGE` 是身体离玩家超过多远保护就不接管身体，所以不能走出这个距离）、离怪 `BOW_MIN`（4）到 `BOW_MAX`（24）格（再近就改近战了）、不在刚走不通的点附近。服务端对每个点查：脚下和头顶是原版路径类型的“可行走”（不是水、火、仙人掌、悬崖）、比现在最多低 1 格，然后用射中判断同一套逐 tick 箭模拟（眼睛高度从那个点算，也查玩家、宠物、村民）；最多查 24 个，选最近的。
- 每秒最多找一次，一场战斗（同一个目标）最多挪 6 次；走路最多 6 秒；`NativeNavigation` 报走不通就记下这个点不再选（走不到的只是这个点，怪照样打，不记 `noPath`）。走的过程中途能射了就停下拉弓；怪进了近战范围就改近战。
- 状态：挪动时 `state:"repositioning"`，保护状态多 `repositions`（累计次数）和 `lastReposition`（`WALKING`、`ARRIVED`、`CLEAR`、`NO_SPOT` 没有可行点、`NO_CANDIDATE` 范围内没有候选、`NO_PATH`、`TIMEOUT`、`LIMIT`）；弓因此放下时 `lastDrop:"REPOSITION"`。

#### 保护举盾挡远程（2026-10-11 试玩反馈）

状态：①②已实现，离线测试通过，待隔离服和真实游戏实测；③只有设计。

保护时骷髅、流浪者、沼骸等拉弓瞄准 Bot，或有弹射物飞向 Bot，Bot 转向它、举副手的盾挡这一箭；射完放下，照常去打（近战冲上去，或用弓射）。不靠生物名单，分三层：

- **① 原版判据（`Foe.charging`，`GuardCombat.windingUp`）**：怪自己的目标（`Mob.getTarget()`，不含“最近被打过”）是 Bot，并且手里的东西在蓄力——正在使用的物品是弓、弩、三叉戟（物品类是`ProjectileWeaponItem`，或使用动画是 BOW／CROSSBOW／SPEAR，模组武器只要沿用这些就算），或者手上拿着已装填的弩（`CrossbowItem.isCharged`，弩装填完举着瞄准的那段）。不看生物名，也不要求怪实现`RangedAttackMob`／`CrossbowAttackMob`。还要看得见 Bot（`visible`），隔着墙拉弓不算。进入`foes()`的条件没改（玩家身边`radius`格内，或打玩家／Bot 的怪，打 Bot 的要在 8 格内），所以离玩家远、离 Bot 又超过 8 格的瞄准者靠②。
- **② 来袭弹射物兜底（`GuardCombat.View.incoming`、`ticksToHit`）**：每个游戏刻查 Bot 身边`BOW_MAX`（24）格内的`Projectile`，按当前速度逐 tick 推算（箭按原版每 tick 先移动再乘 0.99 阻力、减 0.05 重力，其他直线），`SHIELD_LEAD`（10）tick 内会不会进入 Bot 的碰撞箱（外扩 0.3，和射箭的判断同一个边距）；已经在碰撞箱里的（插在身上、擦过）不算。下面这些不算（`GuardCombat.blockable`）：Bot 自己射的（带`mcbot_body_projectile`标签或主人是玩家）、玩家射的、主人是宠物或不是怪物的傀儡等友方（起了名字的怪物仍算敌人）、药水（溅射无视盾）、穿透箭（原版`isDamageSourceBlocked`挡不了）。“来得及”：会在`SHIELD_DELAY`（5，盾举起这么多 tick 才挡得住）tick 之后到才举；盾已经举着的就不看这个。幽灵火球、烈焰人火球、潜影贝子弹等没有“拉弓”动作的，只能靠这一层。
- **③ 附属模组登记（设计，没有写代码）**：见下。

**决定（`GuardCombat.tick` → `shieldAgainstRanged`）**：

- 位置：在苦力怕／低血撤退那段之后、挑目标（`choose`）之前，所以点燃的苦力怕、低血撤退优先（爆炸比一箭重；低血撤退本来就举着盾，只是朝最近的怪）。
- 有怪已经在近战够得着的范围里时不为远程停下来：先挥剑（贴身的骷髅点射一箭，不如尽快杀掉它；血少了自然进撤退）；等攻击冷却的间隙，对在拉弓的怪也举盾（原来只对打 Bot 的怪举）。这时`incoming`也不查。
- 举盾时：正在拉的 Bot 的弓先放下（`lastDrop:"SHIELD"`），停下脚步（举着盾不能冲刺），面朝来袭弹射物，没有弹射物就面朝最近的蓄力怪；同一时间只举一次，`shields`按举起算一次。状态`shielding`，保护状态多`blocking`（`RANGED`：蓄力怪，`PROJECTILE`：弹射物）。
- 放下：最后一次看到威胁（不再蓄力，或弹射物已过、没打中）之后再举`SHIELD_HOLD_MS`（`SHIELD_DELAY`×50 毫秒，约 5 tick）才放，之后照常打。盾举起不满 5 tick 挡不住东西，所以不会举一下就放；怪拉一下放一下弓也不会抖。有新威胁就继续举。
- 没盾（`lastShield:"NO_SHIELD"`）或`shield:false`（`lastShield:"OFF"`，此时不查弹射物）：不动，原来怎么打还怎么打，包括 Bot 自己拉弓对射。

**③ 附属模组登记（设计，未实现）**：原版判据和弹射物兜底处理不了的两类，将来由附属模组登记，核心里不放名单：

1. “这种怪在蓄力”：蓄力不是使用物品的怪（法师读条、自定义的蓄力标志）。附属提供只读判断`怪 → 是／否／不知道`，核心把“是”当作`charging`；目标是不是 Bot 仍由核心看`Mob.getTarget()`，附属不能自己声明谁是目标。
2. “这种弹射物盾挡不了”：魔法、穿盾的弹射物。附属提供只读判断`弹射物 → 盾能挡／挡不了／不知道`；“挡不了”的不进`Incoming`，Bot 不会白白站着挨打；“能挡”可补回核心默认认为挡不了的。

形式：`McbotApi`加一个`registerRangedThreat`，规则和其他适配一样——id 与别的适配共用命名空间、服务器启动后冻结（`Registered`多一项，旧构造器补空列表）、`installed()`要检查被适配模组的确切版本（`versionsMatch`）、方法抛异常当作“不知道”、先登记的优先、答“不知道”回到上面两层、`hello.adapters`列出、`registerHint`可附用法说明、WebUI 插件页的「给 AI 用」开关同样管它（见[Mod 适配](../mod_adapters.md)）。这次不写代码的理由：现在没有哪个附属模组需要它，登记接口要进公开的`McbotApi`（加了就得兼容），等第一个要适配的模组（有蓄力怪或穿盾弹射物）出现，按它的实际行为定形状比现在猜稳。

**验证范围**：离线——`GuardCombatTest`（决策：蓄力怪举盾、射完放下去打、没蓄力不举、隔墙不举、弹射物来得及／来不及／已举着／飞偏、关盾或没盾照旧、苦力怕优先、近战优先、对射的弓放下又拉起；弹道推算几何）和`FollowCompanionTest`（经协议`act follow-companion`带`guard`，跟随驱动真实的`GuardCombat`，视图为脚本）。**没有验证**，要真实游戏：`foes()`从真实生物读出蓄力（骷髅、流浪者、沼骸、掠夺者的弩、溺尸的三叉戟）、`incoming`读真实弹射物（箭的速度和下坠是否与推算吻合）、盾真的挡下这一箭、朝向、骷髅射击循环里举放的节奏、Bot 和玩家同时被瞄准时站着不动是否碍事。

## 五、陪伴姿态和打断窗口的当时状态

陪伴姿态（10-11，10-12 补）：

**状态（2026-10-11，10-12 补）：服务端和运行端都已按本节实现，离线测试（`PostureTest`、`FollowCompanionTest`、`ControlSessionTest`，运行端 companion 相关用例），10-11 用户试玩过坐下和站起来打，其余没在游戏里单独验证。** 被取代的旧小节（`follow-companion`、`step-aside-stop`、`beside-follow`）保留作记录，开头都注明了已删。实现时补定的细节已写进下文，标“实现补定”。设计见[陪伴状态设计](../companion_state_design.md)第 7 节；只针对单人陪伴（一个真人、一个 Bot），多人问题见该文 7.9。

打断窗口的验证范围（10-11）：

**验证范围**：离线——Java `TaskInterruptTest`（能开／不能开、窗口步骤名单、超时自关、和保护共用顺延额度）、`ControlSessionTest`（代次屏障、不占操作 ID、窗口里只放行打断步骤且一次一步、取消残留步骤、`stop`连窗口一起结束）；运行端`task-interrupts.test.mjs`（协议、令牌、任务锁持有者等窗口、窗口里叫停、暂停续做和第 3 次取消、不可续做照旧取消、`NOT_PAUSABLE`等待和低血取消、`unknown`先停）。**没有**隔离服或真实游戏验证：真实任务被暂停后从身体所在处重新寻路、`ServerController`的暂停和恢复（任务槽搬进窗口再搬回来）、窗口里`retreat-from-entity`占用任务槽，只经过编译和上述逻辑测试。
