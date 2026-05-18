# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 项目概述

年会抽奖程序：Node + Express 后端，Three.js 3D 球面抽奖前端。参与人员通过 Excel 导入，抽奖结果可导出为 Excel。

## 开发命令

```bash
# 安装依赖（两个目录都需要执行）
cd server && npm install
cd product && npm install

# 构建前端
cd product && npm run build

# 生产模式运行（通过 Express 托管构建后的前端）
cd product && npm run serve

# 开发模式（webpack-dev-server 热更新 + Express 后端）
cd product && npm run dev

# Docker：本地构建并运行
./build.sh [TAG]    # 打包源码，构建 Docker 镜像
./dev.sh [TAG]      # 本地运行容器，映射到 5003 端口
```

开发服务器（`npm run dev`）在 9000 端口启动 webpack-dev-server，Express 后端在 18888 端口通过代理转发。生产模式（`npm run serve`）在配置的端口（默认 8888）运行 Express，托管 `product/dist/` 下构建好的前端。

## 架构

### 目录结构

```
lottery/
├── product/          # 前端：Three.js 网页应用（webpack 构建）
│   ├── src/
│   │   ├── lottery/  # 主应用：index.js, canvas.js, prizeList.js, config.js, index.css
│   │   ├── lib/      # 内嵌库：Three.js, CSS3DRenderer, TrackballControls, tween.js, ajax 工具
│   │   ├── css/      # animate.min.css
│   │   ├── img/      # 奖品图片
│   │   └── data/     # music.mp3
│   └── dist/         # 构建产物（由 Express 托管）
├── server/           # 后端：Express API
│   ├── server.js     # Express 应用、API 路由、数据加载
│   ├── help.js       # Excel 读写（node-xlsx）、JSON 缓存持久化、洗牌算法
│   ├── config.js     # 奖品定义、EACH_COUNT、COMPANY 名称
│   ├── index.js      # CLI 入口
│   ├── data/         # user.xlsx（参与人员名单）
│   └── cache/        # 运行时状态：temp.json（中奖者）, error.json（缺席者）
```

### 数据流转

1. **启动**：`server.js` 读取 `server/data/user.xlsx`（列：工号、姓名、部门），洗牌打乱顺序，尝试从 `server/cache/temp.json` 和 `error.json` 恢复上次状态
2. **前端初始化**：调用 `POST /getTempData`（返回配置 + 剩余人员 + 已有中奖数据）和 `POST /getUsers`（返回完整人员列表，用于创建 3D 名牌）
3. **抽奖回合**：用户点击"开始抽奖" → 球体旋转 `ROTATE_TIME * ROTATE_LOOP` 毫秒 → 从 `leftUsers` 中随机选中卡片 → 卡片动画移至前景 → 前端调用 `POST /saveData` 持久化数据
4. **重新抽奖**：调用 `POST /errorData` 标记缺席中奖者，然后重新抽取替补
5. **导出**：`POST /export` 将所有结果写入 `抽奖结果.xlsx` 并返回下载地址
6. **重置**：`POST /reset` 清除所有缓存状态

### API 路由（均为 POST，JSON 格式）

| 路由 | 用途 |
|---|---|
| `/getTempData` | 返回配置、剩余人员以及所有中奖者数据 |
| `/getUsers` | 返回完整参与人员列表 |
| `/saveData` | 保存某个奖项的中奖者（写入 `cache/temp.json`） |
| `/errorData` | 保存缺席/未到场的中奖者（写入 `cache/error.json`） |
| `/reset` | 清除所有中奖/错误数据 |
| `/export` | 生成可下载的 `抽奖结果.xlsx` 并返回地址 |

### 配置说明（server/config.js）

- `prizes[]` — 奖项数组。type 为 `0` 的奖项是"特别奖"占位符，不限制数量，在常规奖项抽完后可继续抽取。每个奖项包含 `type`、`count`、`text`、`title`、`img`
- `EACH_COUNT[]` — 每次点击抽取的人数，按索引与 `prizes[]` 对应。例如 `[1, 10, 10, 10]` 表示特别奖每次抽 1 人，后续奖项每次各抽 10 人
- `COMPANY` — 名牌上显示的公司名称
- `department_prizes[]` — 可选，各部门中奖人数上限（`department` 部门名、`quantity` 上限数量）

### 抽奖逻辑（product/src/lottery/index.js）

- 奖品从低等奖开始抽取（从 prizes 末尾向 0 遍历）。某等奖抽满后，索引递减进入下一等奖
- 球面共 7 行 × 17 列 = 119 张可视名牌。部分名牌位置通过 `config.js` 中的 `NUMBER_MATRIX` 高亮拼接出 4 位年份数字
- 旋转过程中，卡片每 500ms 随机切换剩余人员的姓名和颜色。停止时从 `leftUsers` 中随机选取，并遵循部门中奖上限
- 停止后，中奖卡片动画移动到前排展示。抽奖按钮切换旋转/停止
- 每次点击"停止"时数据同步持久化到服务器，防止服务器崩溃丢失状态

### 前端依赖库

所有 JavaScript 库均内嵌在 `product/src/lib/` 目录中：Three.js（3D 渲染）、CSS3DRenderer（将 DOM 元素进行 3D 变换）、TrackballControls（摄像机轨道控制）、Tween.js（动画过渡），以及一个简易的 AJAX 工具。前端通过 webpack 的 babel-loader 支持 ES 模块语法。
