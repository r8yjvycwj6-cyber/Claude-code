# SecureChat 桌面版（Windows）

`chat-server` 的电脑客户端：仿 WhatsApp 桌面版的界面，端到端加密。基于 Electron，安装包就是一个普通的 Windows 程序。

## 功能

* 注册 / 登录（填写自己的服务器地址），重新打开自动登录
* 一对一聊天、群聊、回复、表情、复制、对所有人删除 / 为我删除
* 图片（缩略图预览、点击查看大图、保存）、任意文件，**先在本机加密再上传**
* 消息状态：🕓 发送中 → ✓ 已发送 → ✓✓ 已送达 → 蓝色 ✓✓ 已读（群聊为所有人都读了才变蓝）
* 正在输入…、在线 / 最后上线时间、未读数（任务栏角标 + 托盘提示 + 窗口闪烁）、Windows 桌面通知
* 联系人、备注名、屏蔽、个人资料与头像、群组管理（加人、踢人、管理员、改名、退群）
* 安全码核对（60 位数字）、"安全码已更改"提示、密钥备份导出 / 恢复
* 离线发件箱：断网时写的消息会在重新连上后自动加密发送
* 浅色 / 深色主题（默认跟随系统）、拖拽或粘贴（Ctrl+V）发送文件、Ctrl+N 新聊天
* 关闭窗口最小化到托盘，托盘菜单"退出"才真正退出

## 安全设计

| | |
| --- | --- |
| 界面代码 | 打包在安装包内，通过 `app://` 本地协议加载，**不从服务器下载任何代码**（服务器被攻破也无法注入窃取密钥的脚本） |
| 私钥 | 只在本机生成和保存，用 Windows **DPAPI**（Electron `safeStorage`）加密后写到 `%APPDATA%\SecureChat\secure\` |
| 聊天记录 | 服务器送达后即删除密文；本机记录存在 IndexedDB 中，每条都用本地密钥 AES-256-GCM 加密，本地密钥同样由 DPAPI 保护 |
| 页面权限 | `contextIsolation` + `sandbox`，页面无法访问 Node.js；只通过 preload 暴露 4 个受控接口 |
| 防注入 | 所有消息内容都以纯文本插入页面（不使用 innerHTML），并启用了严格的 CSP |
| 加密协议 | X3DH + 双棘轮 + AES-256-GCM，代码在 `app/lib/e2ee.mjs`（与 `chat-server/shared/e2ee.mjs` 相同） |

## 直接使用

运行 `SecureChat-Setup-1.0.0.exe` 安装（可选择安装目录，会创建桌面和开始菜单快捷方式），
或者使用免安装的 `SecureChat-Portable-1.0.0.exe`。

首次打开时填写服务器地址，例如 `http://192.168.1.10:3000`（服务器部署见 `../chat-server/README.md`）。

> 安装包没有代码签名，Windows SmartScreen 可能提示"未知发布者"，点"更多信息 → 仍要运行"即可。
> 正式分发时建议购买代码签名证书，在 `package.json` 的 `build.win` 中配置。

## 自己构建安装包（在 Windows 上）

需要 Node.js 22 或更高版本。

```bat
cd chat-desktop
npm install
npm start            :: 开发运行
npm run dist         :: 生成 dist\SecureChat-Setup-1.0.0.exe 和 dist\SecureChat-Portable-1.0.0.exe
```

`npm run dist:dir` 只生成免安装的 `dist\win-unpacked\` 目录（最快，适合调试）。

同一台电脑上想同时登录两个账号测试：

```bat
npx electron . --securechat-profile=%TEMP%\securechat-test2
```

## 测试

```bash
npm test   # 加密库一致性检查 + 浏览器界面端到端测试（3 个用户）+ 真实 Electron 测试
```

Linux 无显示器时 Electron 测试需要 `xvfb-run -a node test/electron.e2e.js`。

## 服务器跨域设置

桌面端的来源是 `app://securechat`。服务器默认 `corsOrigins` 为 `*`，无需设置；
如果你在服务器的 `config.json` 里限定了 `corsOrigins`，需要把 `app://securechat` 加进去。

## 目录结构

```
chat-desktop/
├─ main.js            Electron 主进程：窗口、app:// 协议、DPAPI 安全存储、托盘、角标
├─ preload.js         向页面暴露的受控接口
├─ app/               界面（纯 HTML/CSS/JS，无需编译）
│  ├─ index.html
│  ├─ css/style.css   WhatsApp 风格样式（浅色 / 深色）
│  ├─ lib/e2ee.mjs    端到端加密库（从 chat-server/shared 同步：npm run sync-crypto）
│  └─ js/
│     ├─ core.js      客户端核心：密钥、加解密、收发、回执、离线发件箱
│     ├─ db.js        本地加密数据库
│     ├─ api.js       服务器接口
│     ├─ platform.js  桌面端 / 浏览器差异
│     ├─ login.js     登录页
│     └─ main-view.js 主界面
├─ build/             图标
├─ scripts/           加密库同步
└─ test/              端到端测试
```

## 已知限制

* 一个账号同一时间只有一台设备持有密钥（"最后登录的设备生效"）。换电脑请先在 设置 → 导出密钥备份，新电脑登录时选择"从密钥备份恢复"。
  聊天记录只在本机，不会随备份迁移。
* 暂不支持语音 / 视频通话、语音消息、消息转发和搜索聊天内容。
* 只在 Linux 上的 Electron 和 Chromium 中做过自动化测试；Windows 安装包是交叉编译出来的，还没有在真实 Windows 机器上运行过。
