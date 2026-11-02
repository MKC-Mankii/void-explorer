# 第二轮持久化与试玩交付

此次只发布已经完成的第二轮代码，不新增功能。

## Git 与 PR

- 第二轮分支：[feat/flight-navigation-round2](https://github.com/MKC-Mankii/void-explorer/tree/feat/flight-navigation-round2)。
- 第二轮 [Draft PR #2](https://github.com/MKC-Mankii/void-explorer/pull/2) 以 `feat/playable-universe` 为基底，只展示第二轮增量，依赖 [Draft PR #1](https://github.com/MKC-Mankii/void-explorer/pull/1)。两个 PR 均由用户决定是否、何时合并。
- 第一轮分支 `feat/playable-universe` 保持在 `082973602aa40030320f6294d4a61b21e105f1e2`，主分支不变。
- 第二轮原始提交 `8388824`、`73e1a6b` 原样保留。交付时只追加说明文档提交，没有 rebase、squash、强制推送或合并。

## 试玩及构建来源

- [第二轮试玩](https://mkc-mankii.github.io/void-explorer/)：现有 GitHub Pages 默认入口。
- [第一轮试玩归档](https://mkc-mankii.github.io/void-explorer/round1/)：保留原始首轮构建及 `build-info.json`。
- 第二轮实际源码 Commit SHA 以线上 [build-info.json](https://mkc-mankii.github.io/void-explorer/build-info.json) 的 `source_commit` 为准；其中同时记录源码分支和 PR。
- [asset-manifest.json](https://mkc-mankii.github.io/void-explorer/asset-manifest.json) 记录生产文件 SHA-256，用于核对部署内容。源码提交和 `gh-pages` 产物提交是不同的 Git 对象，不混用二者。

发布使用既有 `gh-pages` 分支的后续提交，保留第一轮产物提交 `51d6c42db098f2ed0f1f6de5c45d32986002f21e` 为祖先，不重写分支历史。首轮归档复制原始生产文件，不以第二轮源码重新生成。

## 验证方式

重新检查格式、28 项逻辑测试和生产构建，并在云端浏览器执行 7 项生产冒烟检查。GitHub Actions 执行完整的 15 项探索循环、16 项飞行导航检查及生产冒烟；实际结果可从 [PR #2 Checks](https://github.com/MKC-Mankii/void-explorer/pull/2/checks) 和 [分支流水线](https://github.com/MKC-Mankii/void-explorer/actions?query=branch%3Afeat%2Fflight-navigation-round2) 查看，浏览器截图和报告随流水线保存。

部署完成后，通过现有系统 CA 验证 HTTPS，读取线上构建来源，并逐一核对生产 HTML、JavaScript、CSS、图标、许可文件及首轮归档的哈希。线上源码必须包含 `8388824` 和 `73e1a6b`，生产文件必须与本地构建逐字节一致。没有仅凭 HTTP 200 或静态页面标题声称第二轮已经发布。

本次不改变浏览器证书信任设置。云端本地生产构建与 CI 的浏览器交互验证，加上线上文件一致性核对，是此次部署验收的证据；不将其表述为 Windows/macOS 实机验收或线上浏览器全流程测试。

## 保留的限制

实际桌面 GPU 性能、Safari/Firefox 和长时间游戏仍需后续验证。天体遮挡时需要手动绕行，仍使用压缩尺度。此次交付未扩展这些功能。

`docs/round2/verification.json` 是第二轮开发验收时的历史快照，其中发布状态为 false；不覆盖旧记录。当前发布状态和源码来源应以上述 PR、Pages 部署记录及在线构建元数据为准。
