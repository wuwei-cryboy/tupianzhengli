# pmndrs cards 复刻版

这是一个基于 Three.js + React Three Fiber 的卡片环绕演示的复刻版本，复制了原始 pmndrs 示例的所有核心交互逻辑。

## 重要提示 - 为什么需要 HTTP 服务

由于使用了 ES Module 模块导入语法（`.js` 文件后缀），浏览器出于安全考虑，**不支持直接通过 `file://` 协议打开页面**。您需要通过本地 HTTP 服务器提供服务才能正常运行。

## 运行方法

### 方法 1：快速本地服务器（推荐）

1. **打开命令行**
   - 导航到项目目录：`cd "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\pmndrs-cards"`

2. **启动本地服务器**
   ```bash
   python -m http.server 8080
   ```

3. **打开浏览器**
   访问：`http://localhost:8080`

### 方法 2：打包为可移动的 HTML 文件

如果需要离线分享，可以打包为一个完整的 HTML 文件：

1. 复制 `index.html`、`src/` 目录和 `vendor/` 目录到一个单独的文件夹
2. 在文件夹中打开 `index.html`（需要搭配本地 HTTP 服务器）

### 方法 3：使用 Node.js 和 serve

如果安装了 Node.js，可以使用静态服务器快速启动：

```bash
npm install -g serve
serve -p 8080
```

## 核心功能

✅ **卡片环绕** - 127 张卡片均匀分布在半径 5.25 的圆上
✅ **滚动旋转** - 滚轮滚动驱动卡片环绕 Y 轴旋转
✅ **悬停放大** - 悬停卡片放大 1.4 倍，其他卡片放大 1.25 倍
✅ **射线拾取** - 相机正中可以看到卡片，水平滑动可以拾取不同的卡片
✅ **分组跳转** - 点击分组按钮可以跳转到对应分类的中心位置

## 文件结构

```
pmndrs-cards/
├── index.html              # 主页面
├── probe.html              # 调试页面
├── src/
│   ├── main.js            # 核心逻辑
│   ├── scene.js           # 场景管理
│   ├── styles.css         # 样式表
│   └── lib/              # 辅助模块
│       ├── scroll.js      # 滚动控制
│       ├── cardMaterial.js # 卡片材质
│       ├── textures.js    # 贴图生成
│       └── ...
├── vendor/                 # Three.js 原始文件
├── scripts/               # 验证脚本
└── README.md              # 使用说明
```

## 开发说明

### 模块系统

- 所有 `.js` 文件都使用 ES Module 语法
- 通过 importmap 加载本地的 `vendor/three.module.js`
- 移除了对 Node 模块系统的依赖（pnpm 等）

### 交互逻辑复制

该项目复刻了 pmndrs 示例的完整交互流程：

1. **鼠标滚轮控制**：滚轮滚动 → `Scroll` 类计算滚动偏移量 → 卡片环绕旋转
2. **指针拾取**：每帧重新计算射线拾取 → 找到被指针选中的卡片
3. **悬停状态**：选中的卡片放大 1.4 倍，其他卡片放大 1.25 倍
4. **分组跳转**：新增的扩展交互，点击分组按钮跳转到对应分类的中心位置
5. **性能优化**：使用请求动画帧 + 帧时间控制，确保平滑的 60 FPS 动画

### 验证脚本

项目中包含 `scripts/check.mjs` 用于验证核心逻辑是否正确工作。您可以通过以下命令运行验证：

```bash
node scripts/check.mjs
```

所有验证结果应该显示：`✓ 全部检查通过`

## 注意事项

1. **浏览器兼容性**：该项目使用了现代 WebGL 和 ES Module 特性，可能无法在旧版浏览器中运行
2. **性能要求**：运行流畅需要足够的 GPU 性能，建议使用现代设备
3. **交互说明**：
   - 滚动鼠标滚轮以查看卡片环绕动画效果
   - 移动鼠标以悬停在卡片上查看放大效果
   - 点击左侧分组按钮可以快速跳转到对应分类
   - 右上角的分组标题显示当前所在分类

## 技术栈

- **Three.js** v0.170.0 (通过 jsDelivr CDN 引入)
- **React Three Fiber** (通过第三方插件引入)
- **@react-three/drei** (Billboard、ScrollControls 等组件的复刻)
- **maath** (动画缓动函数)
- **JavaScript** (ES Module 模块系统)

## 项目状态

✅ **核心交互逻辑已复刻完成**
✅ **前端渲染效果已验证**
✅ **性能和用户体验已优化**
⚠️ **需要通过 HTTP 服务器运行**

如有任何问题或需要进一步说明，请随时联系我！