# lightning (闪电导入 - 图文强化版)

Secure local Markdown & Image importer for X Articles.

## What It Does

- **全新：完整支持带配图文档导入**
  - 支持本地相对路径配图（如 `images/1-2/05-官网下载页.png`）。
  - 支持在线图片链接（`https://...`）与内嵌 Base64 图片。
  - 支持直接拖入整个文章目录或同时拖入 `.md` 与 `images` 文件夹。
  - 缺失配图智能检测与“一键补充载入”按钮。
- **全新：文章配图助手（Image Helper）**
  - 展示文章内所有配图的缩略图与图序。
  - **一键复制单图**：一键写入系统剪贴板原生图片格式，在 X 正文任何光标处按 `Cmd + V` 即可秒变原生媒体卡片。
  - **拖拽插图**：缩略图支持直接拖拽进 X 长文编辑器。
- **正文与标题智能导入**
  - 从 Frontmatter `title` 或首个 `# H1` 自动提取标题。
  - 将 Markdown 转换为安全、美观的图文富文本注入 X Articles 编辑器。
  - 自动回退保护：若自动写入受限，回退并格式化纯文本（保留清晰的【🖼️ 配图：xxx】占位符）。
- **图文预览模态框**
  - 导入前可在大窗口完整预览图文排版效果与图片就绪状态。

## Security Choices

- 本地文件直接在浏览器内存中解析（Data URL），不上传至第三方服务器。
- No X bearer token / No private API calls.
- HTML tag allowlist & URL protocol filtering.
- 保护本地隐私，不泄露文件绝对路径。

## Install / Reload Locally

1. 打开 Chrome 浏览器，访问 `chrome://extensions`。
2. 开启右上角“开发者模式”（Developer Mode）。
3. 如果之前已经安装过，找到 **闪电导入 (Lightning)** 点击“重新加载”（🔄 刷新图标）。
4. 如果首次安装，点击“加载已解压的扩展程序”（Load unpacked），选择本目录：`/Users/mars/Desktop/闪电插件/lightning-importer`。
5. 打开 X (Twitter) 长文编辑器（`https://x.com/compose/articles`），即可在右下角看到全新的图文导入面板！
