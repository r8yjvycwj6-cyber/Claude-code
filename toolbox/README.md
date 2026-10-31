# 在线工具箱

一个基于 **Node.js + Express** 的一站式在线工具网站，默认监听 **2600** 端口。
71 个工具覆盖办公、PDF、扫描、音视频、图片、生活、文本、开发八大类；注册 / 登录只需 **邮箱 + 密码**。

```bash
cd toolbox
npm install
npm start          # → http://localhost:2600
```

> Node.js ≥ 18。首次安装约 700MB（含 OCR 语言包、pdf.js、ffmpeg 等），所有前端依赖都由本站自己提供，**不依赖任何外部 CDN**，内网 / 国内网络均可使用。

## 工具一览

| 分类 | 工具 |
| --- | --- |
| **办公创作** | 在线 PPT 制作（拖拽编辑 / 7 套主题 / 放映 / 导出 PPTX、PDF）、在线 Word 编辑（导出 .docx / PDF / HTML，可打开 .docx）、Markdown 编辑器、表格格式转换（Excel/CSV/JSON，自动识别 GBK）、Office 文档转换、PDF 转 Word、Word/PPT/Excel 转 PDF |
| **PDF** | 合并、拆分 / 提取、页面管理（排序 / 旋转 / 删除）、转图片、图片转 PDF、压缩、加水印（中文）、页码、**签名 / 批注（手写签名、文字、图章）**、提取文字 |
| **扫描识别** | **全能扫描**（自动识别边缘 → 透视矫正 → 阴影消除 / 黑白增强 → 多页导出 PDF / JPG）、图片文字识别 OCR（中英文，离线）、二维码生成 / 识别 |
| **音视频** | 视频格式转换、压缩（H.264/H.265）、转 GIF、提取音频、音频格式转换、音视频剪切、**音频播放器**（频谱 / 均衡器 / LRC 歌词 / ID3 封面 / 睡眠定时）、视频播放器、录音机、屏幕录制 |
| **图片** | 压缩、格式转换、尺寸调整、裁剪旋转、水印、长图拼接、Base64、取色与颜色转换（均支持批量，本地处理） |
| **生活** | 科学计算器、单位换算、房贷（含组合贷）、个税、BMI/基础代谢、日期计算、倒计时 / 秒表、番茄钟、金额大写、百分比 / 折扣、随机抽取（转盘 / 骰子）、密码生成、待办、便签、世界时钟 |
| **文本 / 开发** | 字数统计、大小写 / 命名转换、文本对比、文本整理、简繁转换、汉字转拼音；JSON、Base64、URL、哈希（MD5/SHA）、时间戳、UUID、进制、JWT、正则 |

界面特性：明 / 暗主题、`Ctrl+K` / `/` 全局搜索、收藏与最近使用（登录后跨设备同步）、手机端自适应。

## 数据在哪里处理？

- **浏览器本地**（文件不离开设备）：PDF、扫描、OCR、图片、PPT、Word、Markdown、表格、播放器、录音录屏、全部生活 / 文本 / 开发工具。
- **服务器处理**（需登录，处理后 1 小时内自动删除）：视频 / 音频转换（ffmpeg）、Office 文档转换与 PDF→Word（LibreOffice）。
  - ffmpeg：优先使用系统已安装的；没有则自动使用 npm 内置的 `ffmpeg-static`。
  - LibreOffice：需自行安装（<https://www.libreoffice.org>）；未安装时这几个工具会提示不可用，其余功能不受影响。
- Word 编辑器导出 `.docx` 会把文档 HTML 发到服务器转换（不保存，且服务端会剔除外链图片和脚本）。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `2600` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 用户、会话、临时文件目录 |
| `REQUIRE_LOGIN` | `1` | 设为 `0` 则服务器转换类工具无需登录 |
| `MAX_UPLOAD_MB` | `500` | 服务器转换类工具的单文件上限 |
| `MEDIA_PARALLEL` / `OFFICE_PARALLEL` | `2` | ffmpeg / LibreOffice 并发数 |
| `FFMPEG_PATH` `FFPROBE_PATH` `SOFFICE_PATH` | 自动检测 | 手动指定可执行文件 |
| `TRUST_PROXY` | 空 | 放在 Nginx 等反向代理后面时设为 `1`，才能拿到真实 IP（登录限流用） |

## 部署建议

```bash
# 常驻运行
npm i -g pm2 && pm2 start server.js --name toolbox

# Nginx 反向代理（务必配置 HTTPS）
location / {
    proxy_pass http://127.0.0.1:2600;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 500m;
    proxy_read_timeout 300s;
}
# 此时启动时加 TRUST_PROXY=1
```

- **请使用 HTTPS 或 localhost 访问**：浏览器只在安全上下文里开放摄像头 / 麦克风 / 屏幕录制（扫描摄像头、录音机、录屏、二维码摄像头扫描依赖它）。通过 `http://局域网IP:2600` 访问时这些功能会提示不可用，其它功能正常（哈希、UUID 已做兜底）。
- 数据备份：`data/users.json` 与 `data/sessions.json` 即全部持久化数据。

## 安全说明

- 密码使用 scrypt（随机盐）哈希保存；会话为随机令牌（库中只存其 SHA-256），Cookie 为 `HttpOnly` + `SameSite=Lax`（HTTPS 下自动加 `Secure`）。
- 登录 / 注册按 IP 限流；写请求校验 `Origin` 防 CSRF；响应带 CSP、`nosniff`、`X-Frame-Options`。
- ffmpeg / LibreOffice 全部通过参数数组调用（不经过 shell），格式与参数均为白名单；转换任务按用户隔离，到期自动清理。
- 不做邮箱验证 / 找回密码（按需求只要邮箱 + 密码）。如需对外开放，建议在前面加一层访问控制或自行接入邮件验证。

## 目录结构

```
server.js            入口：路由、安全头、静态资源与第三方库映射
lib/tools.js         工具注册表（首页 / 搜索 / 路由都由它驱动）
lib/auth.js          邮箱 + 密码注册登录、会话、收藏同步
lib/media.js         ffmpeg 任务队列（上传 → 转换 → 进度 → 下载）
lib/office.js        LibreOffice 转换、HTML → docx
lib/store.js         零依赖 JSON 文件存储（原子写入）
public/js/app.js     前端外壳：路由、首页、登录框、命令面板
public/js/ui.js      UI 组件库（h()、dropzone、toast、modal…）
public/js/lib/       PDF / 图片 / OCR / 扫描算法 等公共模块
public/js/tools/     各工具实现（每个文件可导出多个工具）
```

### 新增一个工具

1. 在 `lib/tools.js` 的 `TOOLS` 里加一行（id、分类、名称、描述、lucide 图标名）。
2. 新建 `public/js/tools/<id>.js`，`export default function (root, ctx) { … }`；
   若多个工具共用一个文件，导出 `export const tools = { 'id-a': fnA, 'id-b': fnB }`，并在 `GROUPS` 里登记。
3. 需要清理定时器 / 流时，让函数返回一个清理函数即可。重启服务，首页与搜索会自动出现。
