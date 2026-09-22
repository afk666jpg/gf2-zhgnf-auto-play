# 指挥官能飞！自动小游戏油猴脚本

Tampermonkey userscript for `gf2.sunborngame.com/zhgnf`.

## 功能

- 自动识别首页“开始游戏”和结算页“再试一次”。
- 桌面端自动发送左键、右键交替操作。
- 自动运行每天最多 3 局。
- 面板提供“手动再来一局（不计次）”测试按钮。

## 安装

1. 安装 Tampermonkey。
2. 打开 [`gf2-zhgnf-auto-play.user.js`](./gf2-zhgnf-auto-play.user.js)。
3. 在脚本管理器中安装并打开游戏页面。

脚本只模拟游戏页面本身的鼠标事件，不修改游戏接口，也不绕过账号登录。
