# 建筑设计能力

2026-10-15 用户提出：让 Agent 学会**自己设计**房子，不只是照着别人的蓝图盖。分支 `build-design`，和 main 分开。

## 为什么不只是整理成 skill

模型盖不好房子卡在三处：不知道什么好看（审美和规律）、要逐格写坐标（空间推理容易错，弱一些的模型更明显）、看不见自己设计的样子（没法自己改）。一份文字说明只解决第一处。所以分三层：

| 层 | 做什么 | 状态 |
|---|---|---|
| 知识 | 设计流程、零件用法、通用手法、看图检查清单、各风格的材料和形体，放在 `client-runtime/building-guide.md`，模型用 `blueprints` 的 `guide` 动作按需取（三家 Agent 都能用，不占启动提示词） | 10-15 写了初稿；风格部分还要用收集的投影统计核对（第 1 步） |
| 表达 | 零件和材料表：模型写二三十行描述一栋房子，运行端展开成几千格；换风格只换材料表和屋顶参数 | 10-15 完成（离线） |
| 反馈 | 画图：两张斜 45° 立体图、每层平面图，加文字平面图给看不了图的模型；改蓝图不用整张重写 | 10-15 完成（离线） |

旧 Mineflayer 时代有过这一套（私有仓库的 minecraft-building skill、`render-blueprint`、`edit-blueprint`），小克自己设计的现代平顶别墅得过 8/10；换成 ServerBody 后没搬过来，这次搬回来并加上零件。

## 零件（`client-runtime/src/blueprints.ts`）

`build` 和 `blueprints` 的 save/render 收同样的 `shapes`、`blocks`、`palette`，最后都展开成格子交给服务端，服务端代码不变。

- `palette`：按用途起名的材料表，任何写方块的地方写 `@名字` 或 `@名字[属性]`。
- `box`：四面墙，`floor`／`ceiling` 填底层和顶层里面，`frame` 加底圈和顶圈横梁、四角和每 `pillarEvery` 格的竖柱。
- `window`：同一面墙上的开口，`facing` 朝外；`recess` 玻璃退一格、`sill` 窗台（楼梯倒放贴墙、台阶放上半）、`trim` 一圈框。
- `door`：一或两格宽，门朝里放（从外面放的朝向），双开门铰链在外侧；门上那格给 `air`，服务端把它当门的上半的位置（BuildTask 允许门上半位置是 air 目标）。
- `stairs`：朝 `facing` 每格升一格，每级上面清两格（会在上层楼板开楼梯洞），`support` 填实下面。
- `roof`：`style` gable／hip，`pitch` 1（楼梯）／0.5（台阶，上下半交替）。山墙统一按“每列屋面下面填到上一层”算，原来的双坡结果不变。
- `line` 和零件里的原木、柱子类按走向自动设 `axis`（状态里写了就不动）。
- 每个零件先估格数，超过一次 build 的 4096 格就拒绝，不先生成几百万格。

限制：开着的活板门（百叶窗）服务端不核对 `open`，放不出来，所以没有百叶零件；`pitch 0.5` 的山墙在上半台阶下面会留半格缝；楼梯转角画图时都按直的画（游戏里放下去会自己连成转角）。

## 画图（`client-runtime/src/render.ts`）

照搬旧的 `mcp-server/src/vision/voxel-render.ts`（正交投影、深度缓冲、平面图切在地板上两格），区别：

- 不带 prismarine-viewer（安装包会多几百 MB）和原版贴图：`scripts/render-assets.mjs` 在开发时从 mcp-server 装好的 prismarine-viewer（MIT）读 1.21.1 的方块模型，只留形状和每个面的平均颜色，生成 `client-runtime/render-assets.json.gz`（约 80 KB，随包带）。换 MC 版本或改生成方式时重跑这个脚本。
- 不认识的方块（模组的）画成品红色方块。
- PNG 自己编码（zlib + 格式要求的 CRC），不依赖 pngjs。
- 结果同时给文字平面图（`#` 墙、`W` 窗、`D` 门、`/` 楼梯…），坐标能直接核对，也给看不了图的模型用。工具结果里带图片（MCP image content）；Claude Code 能看，Codex 和 dsh 能不能看还没试，`image:false` 只要文字。

还没做：画世界里实际盖出来的样子（要服务端读一块区域的方块）。

## 改蓝图（`blueprints` 的 `edit`）

`replace` 换材料（只写名字就全换，facing、half 这些在新方块也有的才保留，靠 render-assets 里的默认属性判断；写了属性只换对得上的）、`within` 限定范围、`remove` 删格子、`set` 改几格；`saveAs` 另存或 `overwrite`。最小角变了会说坐标挪了多少。

## 收集的投影怎么用

用户 10-15 收集了 12 个 `.litematic`（来自教学网站，主办方允许下载和二次分发）。用途：
1. 提炼规律和风格卡：统计材料分工、层高、出檐、屋顶坡度、窗墙比，画图对照，写进 `building-guide.md` 的风格部分（第 1 步，还没做）。
2. 考试题：只给文字题目让 Agent 设计，和原作的图放一起由用户打分。
3. 施工测试：转成蓝图用 `server-build-smoke.mjs --house` 测 build 放得准不准。

不建议把它们当作能直接盖的蓝图放进 Bot 的蓝图库，模型会倾向照抄。

## 验证

- 离线：运行端 `tests/building-design.test.mjs` 11 项（材料表、原木朝向、box、窗、门、楼梯、四坡和缓坡屋顶、改蓝图、画图和文字平面图、设计参考的示例房子能展开、工具的 guide/save/render/edit）；运行端全部测试通过。
- 没做：真实模型用零件设计、看图修改；隔离服按零件设计的房子实际盖一遍；Codex、dsh 收图片。
