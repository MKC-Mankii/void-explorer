# 世界环境连续性

本轮基于第三轮 WebGL 2 渲染、第五轮 AURORA 集成及右键修复（源码基线 `d60189172e28a18d84bcc56e1834c68c28748058`）。分支 `feat/world-coherence` 叠加在 `fix/right-click-targeting` 上。地形种子、高度函数、碰撞、飞行导航、AURORA 源资产与存档格式保留。

## 问题与实际修改

### 大气边界

基线相邻机位跨越大气外边界约 20 米时，地表从蓝色散射覆盖突然变成棕色。旧球壳在外部使用正面、内部使用背面：内部背面位于地表之后，深度测试会挡掉本应位于观察者和地表之间的散射。单独的局部 FogExp2 又为标准材质叠加了另一套雾，云和星环没有使用这套雾。

新增 `src/atmosphere.ts`，在现有线性 HDR 合成器内读取不透明场景的对数深度，反算真实视线长度，并积分到飞船、地形或海面的实际可见位置。外部与内部共用球形区间、指数密度和外缘渐隐，不再切换大气球壳正反面，也不再叠加标准材质的局部雾。保留连续的日间星点对比度渐隐。

维持 WebGL 2、现有 PBR / ACES / Bloom 管线，不迁移 WebGPU。低、中、高画质分别最多 2 / 3 / 6 个密度采样；短于半个密度尺度的近景区间使用一次中点采样。三个大气区间按前后顺序合成，质量设置和窗口尺寸变更沿用原入口。

### 水面与地形

旧海面为固定分段球，顶点半径比物理海平面高 0.1 单位（1 米）；顶点间弦面又会下沉，导致不同机位下的几何海面与碰撞海平面不完全对应。

海面改用保守包围网格作为光栅代理，在片元中求解半径恰为 `planet.radius` 的真实球面交点，并使用该点的法线、PBR 光照位置与对数深度。包围网格扩大不等于海平面升高。分段从 192×128 降为 96×64，形状精度交给解析交点。沿用既有海水配色、粗糙度和微法线，微细节按片元距离渐变并由纹理 mip 过滤；没有加入几何波浪或动态反射。

地形保留预算式加载、父节点覆盖、滞回和形变过渡。新增独立高程属性，按父子采样高程一起形变，避免把球面弦差和补缝裙边深度误作材质海拔。岩层、微法线细节也改为按片元距离渐变，避免相机高度改变时整个星球同时切换细节。

### 近地物件

旧岩石、晶体每移动约 650 米会以新观察位置重新生成，且在离地 1,200 米时整体开关。现将同类物件分配到固定种子的立方球面格子，按球面面积校正密度，移动只更新可见工作集。物件使用 1,150–1,850 米的距离渐隐，缓存到 2,900 米；高度开关位于渐隐范围以外。保留实例化绘制，不加入新物件类型或游戏机制。

## 证据与复现

使用原有 `window.__VOID__`、场景加载、冻结机位和截图/性能采样框架。新增十个 `coherence-*` 场景，覆盖轨道、大气边界两侧、云层边界两侧、陆岸、近水面、地面、夜侧及另一颗干燥行星。`tests/coherence.mjs` 只是现有 `tests/rendering.mjs` 的套件选择入口。

开发快照新增 `rendering.environment`，记录实际启用的大气路径、最大/近景采样数、各星球径向高度、密度、海平面，以及近地实例数与重建次数。生产构建继续不公开测试接口。

```bash
npm test
npm run build
VOID_VISUAL_STAGE=before npm run test:coherence # 在基线渲染器上，仅添加本轮场景/测试文件
npm run test:coherence
npm run test:coherence-journey
```

`before/` 截图来自原渲染器加相同诊断场景；`after/` 来自本轮渲染器。均为 Chromium、ANGLE SwiftShader、1280×800、DPR 1、中画质，同一位置、朝向及 FOV；每场景等待 30 帧，记录最后 8 个样本。基线可在 `d601891` 工作树中应用本轮 `src/diagnostics.ts`、`tests/rendering.mjs`、`tests/coherence.mjs` 的差异复现，不应应用渲染实现。

`tests/coherence-journey.mjs` 在正常玩家出生点通过真实按键启动推进/制动、L 连续自动下降、E 离舱、W 步行、F 采样、Escape 存档、重载、E 登船、Space 起飞并继续升出大气层，不调用场景放置、冻结或时间推进。另一个明确标记的沿海诊断从固定近水位置开始，再以真实 W/Space 连续飞行；该段不证明玩家从出生点飞到了其初始位置。

## 局限

- 散射为有限采样近似，不是完整多次散射、体积天气或精确山体太阳遮挡；低画质的长切线视线仍可能出现采样误差。
- 云仍是薄壳，云层穿越使用既有平滑遮罩；透明云和星环没有独立的不透明深度，合成仍有顺序近似。不能声称已完成体积云或所有透明层的正确散射。
- 远处地形仍逐渐细分，海岸也受地形近似精度影响；解析水面不能消除地形本身的 LOD 误差。近地渐隐采用 alpha hash，未加入 TAA，远物件可能有点状噪声。
- 本轮增加一次全屏深度采样/合成、将既有两个深度附件改为可采样纹理及地形高程属性；云端软件帧间隔仅用于同环境的成本观察。未验证 Windows/macOS 实体 GPU、Safari 或 Firefox，不作桌面帧率承诺。
- 公网 Chromium 的证书信任问题不通过忽略证书错误或扩大 CA 信任处理。部署可用正常 TLS 校验的 HTTPS 字节核验，以及同一产物的本地浏览器交互分别验证。

## 固定视点结果

十组同机位检查通过，两个原始报告保存于 [before/report.json](world-coherence/before/report.json) 和 [after/report.json](world-coherence/after/report.json)。对比脚本确认角色与相机的位置、旋转、FOV 一致，浏览器未记录脚本或 WebGL 着色器错误。[比较数据](world-coherence/comparison.json)包含截图地表区域的像素差异和各场景成本。

| 场景         | 改前                                                                                                       | 改后                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 大气外侧     | [截图](world-coherence/before/coherence-air-out.png)                                                       | [截图](world-coherence/after/coherence-air-out.png)                                                      |
| 大气内侧     | [截图](world-coherence/before/coherence-air-in.png)                                                        | [截图](world-coherence/after/coherence-air-in.png)                                                       |
| 近水面与远岸 | [截图](world-coherence/before/coherence-water.png)                                                         | [截图](world-coherence/after/coherence-water.png)                                                        |
| 近地岩层     | [截图](world-coherence/before/coherence-ground.png)                                                        | [截图](world-coherence/after/coherence-ground.png)                                                       |
| 云层边界     | [外](world-coherence/before/coherence-cloud-out.png) / [内](world-coherence/before/coherence-cloud-in.png) | [外](world-coherence/after/coherence-cloud-out.png) / [内](world-coherence/after/coherence-cloud-in.png) |
| 夜侧         | [截图](world-coherence/before/coherence-night.png)                                                         | [截图](world-coherence/after/coherence-night.png)                                                        |
| 干燥行星     | [截图](world-coherence/before/coherence-dry.png)                                                           | [截图](world-coherence/after/coherence-dry.png)                                                          |

大气边界相邻机位的地表区域（x=70、y=555、930×95 像素），平均绝对 RGB 差异由 **49.87 降至 2.76 / 255**。这是该局部边界的证据，不代表完整旅程或所有星球的视觉质量评分。截图显示内外地表均保留散射、远岸融入大气；海面仍是无几何波浪的简化水体。

同机软件渲染的“各场景最后 8 帧中位间隔”的跨场景中位数由 **566.7 ms 增至 683.3 ms（约 +21%）**。近地场景为 716.8 → 866.7 ms，轨道 366.7 → 483.3 ms，夜侧 799.9 → 766.7 ms；并非每个场景都更快。CPU 更新中位数约 0.9–2.2 ms。解析海面及移除大气球壳降低三角形数量，例如轨道 82,418 → 39,731，地面 240,230 → 195,337；全屏积分仍增加像素工作。这些短样本、同机软件数据不等价于 GPU 时间，不支持宣称桌面端达到某个 FPS。

## 连续旅程与测试设施

实际通过的 [旅程报告](world-coherence/journey/report.json) 包含 **61 个连续渲染帧**的状态，全部 `rendering.ready=true`，近地面预算每帧不超过 8 个地形补丁。正常旅程全程 `scenario=player`；原始报告中的 method 字段描述这一主旅程，单独的 `coast` 字段为明确标记的固定起点诊断。没有通过直接设定飞船位置或推进模拟时间来完成正常旅程。

| 正常操作旅程         | 实际画面                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 太空正常出生         | [起点](world-coherence/journey/01-space.png)                                                                                                                                                              |
| L 连续下降           | [太空接近](world-coherence/journey/02-approach.png) → [大气内](world-coherence/journey/03-air.png) → [低空](world-coherence/journey/04-low.png) → [近地](world-coherence/journey/05-ground-approach.png)  |
| 着陆、离舱步行       | [已着陆](world-coherence/journey/06-landed.png) / [步行](world-coherence/journey/07-walking.png)                                                                                                          |
| 存档重载、登船与起飞 | [恢复步行存档](world-coherence/journey/08-restored.png) / [重新起飞](world-coherence/journey/09-takeoff.png) / [升出大气层](world-coherence/journey/10-exit-air.png)                                      |
| 单独的近水连续飞行   | [固定起点](world-coherence/journey/11-coast-start.png) → [3 秒](world-coherence/journey/12-coast-3.png) → [6 秒](world-coherence/journey/12-coast-6.png) → [9 秒](world-coherence/journey/12-coast-9.png) |

正常下降截图四个高度区间使用浏览器每帧观察器，在游戏刚完成渲染的 RAF 中同时读取快照和实际画布；低画质原始画布为 960×600，没有 HUD。其余为 1280×800 整页浏览器截图。这样避免整页截图等待阻塞 Node 采样循环而漏掉短暂的低空区间，未调用暂停、冻结或模拟时间推进接口；读回自身会增加软件渲染负担，因此这段旅程不用于性能采样。第一次旅程检查因漏图失败，改为上述捕获方式后才通过；不能把第一次漏图当作游戏画面跳变。

着陆位置地形射线与碰撞半径差约 **0.00165 米**（该确定性干地点、补丁就绪后）；这不是所有海岸位置的误差承诺。另一个近水连续飞行从命名场景开始，以 W/Space 实际移动约 **1,909 米**，没有时间推进。浏览器检查还通过低/中/高画质的 2/3/6 采样切换及 960×600 → 1280×800 窗口变更，未记录页面、着色器或控制台错误。

新增的 4 项单元测试检查：世界格子物件跨观察位置和立方体边界保持同一坐标/尺寸；海中不生成陆地物件；材质高程独立于补缝与球面弦差；诊断快照不暴露可变的实时配置。旧 36 项逻辑测试继续保留。本轮没有重建测试平台。

## 回归与发布方式

本地回归实际通过：40 项逻辑测试、15 组探索流程、16 组导航、10 组右键输入、6 组 AURORA 资产/接触/实际交互、11 组生产构建检查；构建及格式检查通过。详见 [验收汇总](world-coherence/verification.json) 与 `regression/` 中的原始报告。AURORA GLB 校验、四翼与双推进器、镜头切换、四个起落架接触、离舱/登船和存档流程均继续检查。

CI 保留所有原套件，增加本轮固定场景和连续旅程；地表边界图像检查要求相邻视点的指定地表区域平均 RGB 差异小于 12/255。这里的组数与单元测试数是不同层级，不合并成虚假的“总测试数”。

独立试玩入口为 [/coherence/](https://mkc-mankii.github.io/void-explorer/coherence/)，部署内容用该目录的 [build-info.json](https://mkc-mankii.github.io/void-explorer/coherence/build-info.json) 与资产 SHA-256 清单标识。最终提交、CI 和实际发布状态以本轮 Draft PR 为准。默认第二轮、首轮、第三轮、AURORA 及 `aurora-793eacd` 路径不覆盖；历史 PR 不合并、不强制推送。
