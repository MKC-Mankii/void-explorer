# 产品精修01：开场与初始视觉

基线为 `feat/engineering-03` 的 `74bd18c50e061360fc657a104824494949b9aa36`，也是已验收 `/coherence/` 的源码。新分支 `feat/product-polish-01-opening` 以该提交为祖先，PR 比较目标为 `feat/engineering-03`，不合并 Draft #8/#9。

## 实际观察与设计

改前浏览器画面：VESPER 和星环占据中心，飞船以正后方视角叠在星环上，四翼与机身层次不清；瞄准标记、飞行状态与欢迎文案同时出现。

已实际打开 [官方展示页](https://developers.openai.com/showcase/void-explorer) 及其 [实时 Demo](https://void-explorer.openai.chatgpt.site/)，两者均 HTTP 200。仅参考 Demo 的文字留白、近景飞船、远景天体、对角线构图与冷暖层次。未复制官方代码、图片、模型、音乐或字体；此处的截图全部来自我们自己的运行中游戏。

采用左侧欢迎文案、右侧三分之四视角 AURORA、远处完整 VESPER 与既有星场的构图。保留当前中文标题、品牌、开始/继续、飞行指南及顶部菜单。仅在开场隐藏飞行标记等视觉信息，不改变菜单路径或事件绑定。

## 实现边界

- `src/opening.ts`：只读所选行星与飞船既有中心挂点，设置展示镜头和现有飞船的渲染姿态；两盏开场补光复用整个生命周期，退出开场即隐藏。使用现有 WebGL renderer、composer、GLB 和渲染循环，不创建第二套模型/画布/RAF。
- `src/main.ts`：未开始、非诊断场景时调用开场呈现；开始后恢复原相机投影、FOV 和原模拟姿态。同一帧的常规同步先恢复真实飞船位置与旋转。开发 snapshot 增加只读开场边界观察，生产隔离规则保持原样。
- `src/style.css`：仅 `#interface:not(.playing)` 范围的遮罩、排版、对比度与响应式规则。保留点击行为和游戏中 HUD 样式。
- 动效为极慢、低幅度姿态变化；`prefers-reduced-motion` 下固定展示姿态且取消欢迎淡入。尾焰开场时间固定，避免新增闪动。
- `tests/opening.mjs` 复用 Playwright、device-browser、GL 计数和 failure-evidence，加入现有 CI。

`ui.ts`、`simulation.ts`、`audio.ts`、`save-storage.ts`、`universe.ts`、`spacecraft.ts`、`ship-layout.ts`、地形/大气/行星材质、所有 assets 和依赖锁文件与基线无差异。没有新增外部资源，现有 AURORA GLB 仍为 163,824 字节，授权和制作来源沿用 assets/aurora 的记录。

## 真实浏览器截图

Linux Chromium 154 / SwiftShader，DPR 1、默认 medium、无存档、减少动态效果偏好。等待真实渲染就绪及字体加载后，以既有开发 freeze 固定画面；没有生成图或替换画布。前后采用同尺寸、同模拟初态，开场相机本身是本轮修改内容。

| 窗口     | 修改前                                        | 修改后                                       |
| -------- | --------------------------------------------- | -------------------------------------------- |
| 1440×900 | [改前](product-polish-01/before/1440x900.png) | [改后](product-polish-01/after/1440x900.png) |
| 1366×768 | [改前](product-polish-01/before/1366x768.png) | [改后](product-polish-01/after/1366x768.png) |
| 1000×700 | [改前](product-polish-01/before/1000x700.png) | [改后](product-polish-01/after/1000x700.png) |

## 验证与发布约束

本地已执行：85 项单元、生产构建、全仓格式检查、开场 9 组浏览器检查通过。开场检查包括三个尺寸的主体边界和入口可见性、减少动态效果、只改变展示不改变模拟、6 轮指南/设置切换资源稳定、开始后原 FOV/姿态、保存继续、3 次真实刷新资源稳定、GLB 失败/恢复及 WebGL 不可用提示。

GLB 仍是游戏必需资源，加载失败时保留原先禁用开始及刷新提示；指南继续可用。没有以装饰性资源增加新的阻塞条件。无 WebGL 时保留原先可理解的图形引擎错误和重试入口。

完整原有 CI、实际飞行/着陆/步行/采样/恢复/登船/起飞回归、生产存档保护与公网校验的最终结果应以本 PR 验收记录和部署来源为准；本文件不提前声称尚在执行的检查通过。性能比较使用同机 ABBA 开场采样，软件渲染数字不代表实体 GPU。Windows/macOS GPU、Firefox/Safari 和 30–60 分钟真实设备长测不在已通过范围。

只允许新增独立 `/product-polish-01/` 预览，带完整源码 SHA、构建清单和 SHA-256。默认入口、`/coherence/`、历史预览及其旧资源必须保持逐字节不变；所有 PR 保持 Draft 未合并。审美与实际体验由用户试玩验收。
