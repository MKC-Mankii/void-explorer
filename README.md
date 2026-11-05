# VOID EXPLORER

**[AURORA 集成预览](https://mkc-mankii.github.io/void-explorer/aurora/)** · [第二轮默认试玩](https://mkc-mankii.github.io/void-explorer/) · [首轮试玩归档](https://mkc-mankii.github.io/void-explorer/round1/)

一款面向 PC 桌面浏览器的单人 3D 太空探索游戏。本分支驾驶 **AURORA**，穿越行星大气层，着陆、离舱、步行勘探，再返回星空。默认线上第二轮仍保留旧飞船；AURORA 使用上方独立预览入口。

飞船已在 Blender 4.3.2 制作并以 GLB 集成，源文件、导出与编辑方法见 [资产目录](assets/aurora/README.md)，游戏内截图、必要尺度调整与验证限制见 [集成报告](docs/AURORA-INTEGRATION.md)。第四轮 [概念设计](concepts/aurora/README.md)保留不变。

![AURORA 实际浏览器画面](docs/aurora/real-flight.png)

第二轮以独立分支和叠加 Draft PR 保留完整历史，未合并 PR #1 或 PR #2。游戏改动与测试证据见 [第二轮开发记录](docs/ROUND2.md)，发布方式、入口和源码来源见 [第二轮发布记录](docs/ROUND2-DELIVERY.md)。线上实际源码 SHA 可在 [build-info.json](https://mkc-mankii.github.io/void-explorer/build-info.json) 核对。

**[第三轮渲染预览](https://mkc-mankii.github.io/void-explorer/round3/)** 在独立分支交付；改动、性能限制和八组同机位证据见 [第三轮渲染报告](docs/ROUND3.md)。默认入口仍为第二轮，前两轮分支、PR 和可试玩历史保留。

## 当前可玩内容

- 5 个星系、15 颗行星，确定性程序化生成地形、半径、配色与环境参数。
- 六自由度飞行、惯性巡航、制动、高速推进和近地速度限制。
- 从太空到行星的连续空间；球形自适应地形与同源碰撞高度。
- 轨道扫描、自动选择附近陆地并下降、着陆、第一人称步行与采样、登舱、起飞。
- 星图、行星航向辅助、跨星系跃迁、探索日志与发现积分。
- 追踪 / 驾驶舱视角、摄影模式、画质设置、程序音效、浏览器自动存档。
- 自制 Blender AURORA 飞船，通过仓库内的 GLB 加载；星空、恒星、行星、大气、岩石和晶体继续程序化生成，不依赖外部媒体服务。

这是第一版可玩的探索游戏，范围是有限星系目录，尚无战斗、建造、任务剧情或无限宇宙。具体限制与验证范围见 [开发记录](docs/DEVELOPMENT.md)。

## 在云端运行

本项目已在关联的 Codex Cloud 仓库 `/workspace/void-explorer` 中开发与验证，不依赖开发者本地电脑。需要 Node.js 22.12+（验证环境为 24.19）和 npm。

```bash
cd /workspace/void-explorer
npm ci --cache /tmp/void-npm-cache
npm run dev -- --port 5173
```

打开云端环境提供的 5173 端口预览。`http://localhost:5173` 仅指运行服务器的云端机器，不是用户本地机器。

生产版本：

```bash
npm run build
npm run preview -- --port 4173
```

`dist/` 可由任意 HTTPS 静态托管提供。相对资源路径支持子目录部署。图形引擎需要 WebGL 2；鼠标捕获需要 HTTPS 或浏览器认可的本地可信源。

## 开始探索

1. 点击 **开始航行**，再点击画面捕获鼠标；也可以用方向键转向。
2. 按 **F** 扫描初始行星，按 **W** 推进，**X** 制动。
3. 行星足够近时按 **L** 开始自动着陆，约 13 个模拟秒后抵达地表。
4. 按 **E** 离舱，使用 **WASD** 步行，按 **F** 采集地表样本。
5. 返回飞船附近，按 **E** 登舱、**Space** 起飞。
6. 按 **M** 打开星图，点击当前星系的行星选择并渐进对准，按 **G** 远航至其近空区域；也可继续手动驾驶。另一星系使用星图中的跃迁。

| 输入         | 飞行                           | 地表         |
| ------------ | ------------------------------ | ------------ |
| W / S        | 推进 / 降低推进速度            | 前进 / 后退  |
| 鼠标、方向键 | 改变航向                       | 环顾         |
| A / D        | 侧向平移                       | 左右移动     |
| Space / Ctrl | 上升 / 下降；着陆后 Space 起飞 | —            |
| Q / R        | 横滚                           | —            |
| Shift        | 高速推进                       | 奔跑         |
| X            | 制动                           | —            |
| L            | 自动着陆                       | —            |
| E            | 已着陆时离舱                   | 靠近飞船登舱 |
| F            | 扫描行星                       | 地表采样     |
| Tab / T      | 切换目标 / 对准目标            | —            |
| C            | 追踪 / 驾驶舱视角              | 第一人称     |
| M / H        | 星图 / 操作指南                | 同左         |
| P / Esc      | 摄影模式 / 暂停并释放鼠标      | 同左         |

松开 W 后飞船保持惯性巡航。按 S 可以减速至倒退，按 X 制动全部运动。T 只辅助转向，G 会推进并在近空自动减速；鼠标、方向键、W/S、平移或 X 可接管远航。航路被天体遮挡时需先手动绕行。F 始终扫描所选行星，L 为最近行星寻找着陆点。深水不支持步行；恒星是可接近的实体，但其高温边界会阻止进一步进入。

## 存档与设置

每 5 个活跃模拟秒自动保存；打开菜单和离开页面时也会尝试保存。使用当前浏览器、当前域名的 `localStorage`，无服务器账号。设置中的“重新开始探索”需要再次点击确认。关闭音效或改为低画质可降低负担。

## 开发与验证

```bash
npm test                  # 确定性世界、碰撞、完整探索循环和存档验证
npm run build             # TypeScript + 生产构建
npm run format:check
npx playwright install chromium   # 云端已有 Chromium 时不需要
npm run dev -- --port 5173         # 保持此进程运行
npm run test:e2e                    # 保留的完整探索循环回归
npm run test:navigation             # 真实飞行路径 + 明确标注的导航场景
# build 后启动 npm run preview -- --port 4173，再运行：
npm run test:production             # 生产接口隔离与基本交互
```

浏览器测试可通过 `CHROMIUM_PATH` 指定 Chromium，默认优先使用 `/usr/bin/chromium`，否则使用 Playwright 安装的浏览器。`VOID_URL` 可以覆盖测试服务器地址。截图和报告输出到被 git 忽略的 `test-results/`；交付时精选截图与验收报告保存在 `docs/`。

浏览器测试在开发模式 `?test=1` 复用 `window.__VOID__`，以 `snapshot()` 返回脱离内部对象的状态副本。`?test=1&scenario=approach` 等命名场景用于定位问题，场景模式不保存玩家进度。详见 [测试接口与场景说明](docs/ROUND2.md)。键盘、鼠标锁定、导航和菜单走真实浏览器事件；13 秒着陆和 5 秒起飞通过同一模拟器推进时间，并非依靠等待云端软件渲染帧。生产构建不提供此接口。

更多架构、已知限制和下一步见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。参考体验来自 [OpenAI Showcase / Void Explorer](https://developers.openai.com/showcase/void-explorer)；本项目代码、模型与流程独立实现。
