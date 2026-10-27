# DshDemon 1.0.0

Demon 的 Electron 备用桌宠（原生 Cubism 桌宠是默认方案，本项目用于兼容性兜底）。原名 `small-demon`，1.0.0 起改名 **DshDemon**。

## 运行

```bat
npm install                      :: 首次（装 electron）
Start-DshDemon.cmd               :: 启动（API 127.0.0.1:8792 + 透明桌宠窗口）
```

`renderer\pet\bundle.js` 已随仓库提供，可直接运行；改渲染逻辑后再执行 `node renderer\build-bundle.mjs` 重新构建。

## 与 Demon 的关系

- Demon「桌宠」页的 **启动 DshDemon / 关闭 DshDemon** 控制它
- Demon 通过 `http://127.0.0.1:8792` 下发：`/expression`、`/mouth`、`/mode`、`/show`、`/hide`、`/quit`

## 模型不随仓库分发

Live2D 模型（moc3 + 8192 贴图 + EXP 表情，约 27 MB）受 Live2D 授权约束，本仓库不包含。
默认读取 `E:\dshwork\models\live2d\<模型名>\<模型名>.model3.json`，可用环境变量 `DEMON_LIVE2D_MODEL` 覆盖。
