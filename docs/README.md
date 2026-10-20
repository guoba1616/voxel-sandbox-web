# Minecraft 网页版(仿原版重制)非官方！非官方！粉丝自制！

用法:需要联网(three.js 走 CDN)。在本目录起一个静态服务器后打开 `index.html`,例如:

    npx serve mc        # 或  python -m http.server --directory mc

直接双击打开 `file://` 通常也能跑,但浏览器的指针锁定在 file:// 下可能受限。

## 操作
WASD 移动 · 空格 跳跃 · Shift 潜行 · Ctrl / 双击W 疾跑 · 左键 挖/打 · 右键 放置/使用/吃 · 滚轮或 1-9 切换 · E 物品栏 · Q 丢弃 ·
F3 调试 · F5 切换视角 · 创造模式:双击空格飞行,中键取方块 · Esc 暂停(自动存档)

## 文件
- `js/noise.js` 噪声 · `js/blocks.js` 方块/物品/配方 · `js/textures.js` 程序化贴图 · `js/world.js` 区块、地形、光照、网格
- `js/entities.js` 生物/掉落物/TNT/箭/粒子 · `js/player.js` 玩家物理与交互 · `js/ui.js` 界面 · `js/main.js` 主循环、天空、存档
