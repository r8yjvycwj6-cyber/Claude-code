# 聊天服务器（仿 WhatsApp，端到端加密）

聊天软件的后端。电脑客户端在 `../chat-desktop/`，内置服务器地址 `https://neonhost.top:8443`。

* **端到端加密**：X3DH 密钥协商 + Double Ratchet 双棘轮 + AES-256-GCM，与 Signal / WhatsApp 的思路相同。
  **服务器只保存公钥和密文，没有能力解密任何消息或附件。**
* 一对一聊天、群聊、离线消息、已送达 / 已读回执（✓ / ✓✓ / 蓝色 ✓✓）、正在输入、在线状态 / 最后上线时间
* 联系人、屏蔽、头像、个人签名、加密的图片 / 语音 / 视频 / 文件
* "安全码已更改"通知、60 位安全码核对
* **Windows 服务器开箱即用**：只依赖 Node.js，数据库用 Node 内置的 SQLite，不需要编译任何原生模块，不需要单独安装数据库
* **IPv6 + IPv4 双栈**，HTTPS 证书续期后自动热更新
* 单进程约可承载 **1 万同时在线**用户（压测数据见下文）

---

## 一、在 Windows 服务器上部署（neonhost.top:8443）

客户端内置的服务器地址是 **`https://neonhost.top:8443`**。服务器同时监听 **IPv6 和 IPv4**（双栈），
用 8443 端口是为了避开家庭宽带对 80/443 的封锁。

```
 客户端 ──► DNS 查询 neonhost.top ──► AAAA 记录（IPv6）/ A 记录（IPv4）
        ──► https://[服务器 IPv6]:8443 ──► 光猫/路由器（需放行 IPv6 入站）──► Windows 防火墙（8443）──► 本服务
```

### 1. 安装 Node.js

到 <https://nodejs.org/> 下载 **Node.js 22 LTS（22.13 以上）或 24 LTS** 的 Windows 安装包（.msi），一路下一步即可。

### 2. 域名解析（IPv6）

1. 在服务器上运行 `ipconfig`，找到网卡下的 **"IPv6 地址"**（以 2 或 3 开头，例如 `240e:3b4:...`）。
   **不要用"临时 IPv6 地址"**，它每天都会变。启动本服务时也会打印出本机的公网 IPv6 地址。
2. 在 neonhost.top 的 DNS 服务商那里添加记录：`AAAA  neonhost.top → 上面的 IPv6 地址`。
   如果服务器也有公网 IPv4，再加一条 `A` 记录；只有 IPv6 也可以。
3. **家庭宽带的 IPv6 前缀会定期变化**，需要动态域名（DDNS）自动更新 AAAA 记录。推荐
   [ddns-go](https://github.com/jeessy2/ddns-go)（有 Windows 版，支持阿里云、腾讯云 DNSPod、Cloudflare 等），
   设置里选择 IPv6、"通过网卡获取"，并选中上面那个固定的 IPv6 地址。

### 3. 申请 HTTPS 证书（Let's Encrypt，免费，自动续期）

使用 [win-acme](https://www.win-acme.com/)（Windows 上最常用的证书工具）：

1. 下载解压 win-acme，**以管理员身份**运行 `wacs.exe`。
2. 选择创建证书的完整选项（full options）→ 手动输入域名 `neonhost.top`。
3. **验证方式选 DNS 验证**（家庭宽带的 80 端口通常被封，HTTP 验证会失败）：
   * 优先选择你的 DNS 服务商对应的插件（如 Cloudflare、阿里云等），填入 API 密钥，以后可以**全自动续期**；
   * 如果没有对应插件，可选"手动创建 DNS 记录"，但每次续期（约 60 天一次）都要手动添加一次 TXT 记录。
   * 如果你的 80 端口是通的，也可以选"自托管 HTTP 验证"（self-hosting）。
4. 证书保存方式选 **PFX 文件**，保存到 `C:\chat-server\certs\`，并设置一个 PFX 密码。
5. win-acme 会自动创建续期计划任务。续期后本服务会在 30 秒内**自动换用新证书，不需要重启**，在线用户也不会掉线。

（菜单的具体文字以 win-acme 实际界面为准；生成的文件名一般是 `neonhost.top.pfx`。）

### 4. 配置

复制 `config.example.json` 为 `config.json`，把 `tlsPfx` 改成实际的证书文件路径，`tlsPassphrase` 填 PFX 密码。

### 5. 启动

把 `chat-server` 文件夹复制到服务器上（例如 `C:\chat-server`），然后**双击 `start.bat`**。第一次会自动安装依赖。正常输出：

```
已加载 HTTPS 证书
聊天服务器已启动: https://localhost:8443
WebSocket:        wss://localhost:8443/ws
监听地址:         [::]:8443（IPv6 + IPv4 双栈）
对外地址:         https://neonhost.top:8443
本机公网 IPv6:
                  240e:3b4:xxxx:xxxx::xxxx（以太网）
```

* 如果系统没有启用 IPv6，会提示"本机不支持 IPv6，改为只监听 IPv4"，此时只能通过 IPv4 访问。
* 证书文件不存在或密码错误时服务**不会启动**（不会悄悄退回不加密的 HTTP）。

### 6. 放行端口（三处都要放行）

1. **Windows 防火墙**：右键 `scripts\open-firewall.bat` → 以管理员身份运行（默认放行 8443，IPv4/IPv6 同时生效）。
2. **光猫 / 路由器的 IPv6 防火墙**：大多数家用光猫默认拦截所有 IPv6 入站连接。
   进入光猫管理页面（常见 192.168.1.1），在"安全 / 防火墙"里关闭 IPv6 防火墙或"IPv6 会话保护"，
   或者为服务器放行 TCP 8443（不同型号叫法不同，部分运营商光猫需要超级管理员账号）。
   如果光猫是桥接模式、由路由器拨号，则在路由器里设置。
3. **云服务器**：在控制台的安全组里放行 TCP 8443（IPv4 和 IPv6 规则都要加）。

**验证**：手机关掉 Wi-Fi 用流量（国内移动网络基本都有 IPv6），浏览器打开
<https://neonhost.top:8443/api/health>，看到 `{"ok":true,...}` 就说明外网可以访问了。
也可以在 <https://ipw.cn> 之类的网站测试 IPv6 端口连通性。

### 7. 开机自启、崩溃自动重启

右键 `scripts\install-service.bat` → 以管理员身份运行。它会创建一个名为 `ChatServer` 的计划任务，
开机时以 SYSTEM 身份在后台运行，进程退出 5 秒后自动重启，日志写到 `data\server.log`。

* 停止：`schtasks /End /TN ChatServer`
* 卸载：右键 `scripts\uninstall-service.bat` → 以管理员身份运行

### 8. 全部配置项

`config.json` 修改后重启生效。也可以用环境变量（括号内）覆盖：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `domain` (`CHAT_DOMAIN`) | 空 | 对外域名，只用于启动时显示 |
| `host` (`CHAT_HOST`) | `::` | 监听地址。`::` = IPv6 + IPv4 双栈；不支持 IPv6 时自动退回 `0.0.0.0` |
| `port` (`CHAT_PORT`) | 有证书时 `8443`，否则 `3000` | 端口 |
| `dataDir` (`CHAT_DATA_DIR`) | `data` | 数据目录（数据库、密文附件、头像、日志） |
| `tlsPfx` / `tlsPassphrase` | 空 | HTTPS 证书（.pfx 及其密码） |
| `tlsCert` / `tlsKey` | 空 | 或者 PEM 格式证书 + 私钥 |
| `tlsWatchMs` | `30000` | 多久检查一次证书文件是否更新（毫秒） |
| `corsOrigins` | `*` | 允许跨域的前端地址，逗号分隔。桌面客户端的来源是 `app://securechat` |
| `trustProxy` | `false` | 放在 IIS / Nginx 反向代理后面时设为 `true` |
| `tokenTtlDays` | `30` | 登录有效期（天） |
| `maxMediaMB` | `64` | 单个附件上限 |
| `mediaTtlDays` | `30` | 附件在服务器上保留天数 |
| `queueTtlDays` | `30` | 离线消息保留天数（对方一直不上线就丢弃） |
| `maxGroupSize` | `256` | 群成员上限 |

### 9. 性能与容量

为承载更多用户做的优化：

* **组提交**：同一轮事件循环里的所有数据库写入合并成一个事务一次提交（之前每条消息单独提交，54% 的 CPU 花在提交上）；
* SQLite WAL + `synchronous=NORMAL`、64MB 缓存、内存映射；预编译语句缓存；
* 密码哈希（scrypt）移到线程池，登录高峰不会卡住消息收发；登录令牌校验结果缓存 60 秒；
* 同一连接一轮内的多帧合并成一次系统调用写出（cork）；消息只序列化一次；确认收到时不再解析密文；
* 登录 / 注册限流按来源区分：IPv4 按地址，**IPv6 按 /64 网段**（防止攻击者换地址绕过）。

压测结果（`bench/load.js`，单个服务器进程、单核，4 核 Linux 虚拟机，消息约 400 字节，1/10 是 20 人群消息）：

| 场景 | 投递量 | 延迟 p50 / p99 | 服务器内存 |
| --- | --- | --- | --- |
| 优化前：2000 人在线，每秒 4000 条 | 2,684 条/秒（**积压，近一半未送达**） | 6.4 秒 / 26.9 秒 | 139 MB |
| 优化后：同上 | 10,838 条/秒（全部送达） | 103 毫秒 / 345 毫秒 | 129 MB |
| 优化后：10,000 人在线（WSS 加密），每人每 5 秒发一条 | 5,358 条/秒（全部送达） | 6 毫秒 / 28 毫秒 | 769 MB |
| 优化后：2000 人在线（WSS 加密），满负荷 | 11,905 条/秒（全部送达） | 150 毫秒 / 368 毫秒 | 350 MB |

单进程单核即可承载约 1 万同时在线用户；TLS 连接每个约占 70KB 内存。
Windows 服务器的实际数字会因 CPU 和磁盘不同而有差异，可以在服务器上自己跑：

```bat
node bench/load.js --clients 5000 --rate 0.2 --duration 20
```

### 10. 备份

停止服务后备份整个 `data` 目录即可（`chat.db`、`chat.db-wal`、`media\`、`avatars\`）。
服务器上没有用户的私钥，备份泄露也无法解密聊天内容。

### 11. 运行测试

```bat
npm install
npm test
```

---

## 二、端到端加密是怎么做的

```
 Alice 的设备                       服务器                        Bob 的设备
 ───────────                       ──────                        ─────────
                                                   生成身份密钥、签名预密钥、100 个一次性预密钥
                              ◄── PUT /api/keys（只有公钥）──
 GET /api/keys/Bob ──►  返回 Bob 的公钥包（并删除用掉的一次性预密钥）
 X3DH 算出共享密钥
 双棘轮加密 "你好"
 { type:'send', envelope:密文 } ──►  存入离线队列，转发 ──►  X3DH 算出同一个共享密钥，解密
                                    ◄── ack ──               （服务器删除该条）
 ◄── receipt: delivered ──
```

* 加密库：`shared/e2ee.mjs`，只依赖标准 WebCrypto，**浏览器和 Node.js 通用**，服务器在 `/shared/e2ee.mjs` 提供给前端直接引用。
* **私钥只在客户端**。服务器只校验签名预密钥的签名格式，然后原样转发密文。
* 每条消息使用不同的密钥（双棘轮）：今天的密钥泄露，解不开以前的消息（前向保密），对方回复几轮后也解不开以后的消息（自愈）。
* 群聊采用"成对扇出"：发送方用和每个成员的一对一会话分别加密一份。成员被移除后自然收不到新的密文。
* 附件：客户端随机生成 AES-256 密钥加密文件后上传，密钥和 SHA-256 放在加密消息里。
* 服务器（或冒充服务器的人）能做的最坏的事是把某人的公钥换成自己的——所以客户端会：
  1. 发现对方身份密钥变化时提示"安全码已更改"；
  2. 提供 60 位**安全码**，双方当面或电话核对一致，即可确认没有中间人。

### 服务器能看到什么、看不到什么

| 看不到 | 能看到（与 WhatsApp 相同） |
| --- | --- |
| 消息文字、图片、语音、视频、文件内容 | 手机号、昵称、头像、个人签名 |
| 附件的文件名、类型、加密密钥 | 谁在什么时候给谁发了消息、密文大小 |
| 撤回、回复、表情回应等（都在加密内容里） | 群名称、群成员、在线状态 |

### 客户端用法示例

```js
import { E2EEAccount, encryptForMany, encryptAttachment, decryptAttachment } from '/shared/e2ee.mjs';

// 1. 第一次登录：生成密钥并上传公钥（私钥保存在本机 IndexedDB）
const acc = await E2EEAccount.create();
await fetch('/api/keys', { method: 'PUT', headers, body: JSON.stringify(acc.publicBundle()) });
await saveToIndexedDB('account', acc.toJSON());

// 2. 给 Bob 发消息
if (!acc.hasSession(bobId)) {
  const bundle = await (await fetch(`/api/keys/${bobId}`, { headers })).json();
  const { identityChanged } = await acc.initSession(bobId, bundle);
}
const envelope = await acc.encrypt(bobId, { t: 'text', body: '你好', ts: Date.now() });
ws.send(JSON.stringify({ type: 'send', id: crypto.randomUUID().replaceAll('-', ''), to: bobId, envelope }));

// 3. 收到消息
ws.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'message') {
    const { payload, identityChanged } = await acc.decrypt(m.from, m.envelope);
    // ...显示 payload，持久化 acc.toJSON()
    ws.send(JSON.stringify({ type: 'ack', qids: [m.qid] }));
  }
};

// 4. 群消息
const { envelopes } = await encryptForMany(acc, memberIds, { t: 'text', body: '大家好' }, getBundle);
ws.send(JSON.stringify({ type: 'send_group', id, groupId, envelopes }));

// 5. 安全码
await acc.safetyNumber(myId, bobId); // "12345 67890 ..."（双方算出来一样）

// 6. 加密备份（口令保护）
const backup = await acc.exportEncrypted('用户设置的备份口令');
```

`payload` 是任意 JSON，建议约定：

```js
{ t: 'text', body: '...', ts }                                   // 文字
{ t: 'image', media: { id, key, sha256, mime, size, w, h }, caption, ts }  // 图片/视频/语音/文件同理
{ t: 'reply', replyTo: '消息id', body, ts }                        // 回复
{ t: 'reaction', target: '消息id', emoji: '👍' }                   // 表情回应
{ t: 'delete', target: '消息id' }                                 // 对所有人撤回
{ t: 'edit', target: '消息id', body }                             // 编辑
```

---

## 三、HTTP 接口

除注册 / 登录外都需要请求头 `Authorization: Bearer <token>`。请求和响应都是 JSON，出错时返回 `{ "error": "原因" }`。

### 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ phone, name, password }` → `{ token, user }` |
| POST | `/api/auth/login` | `{ phone, password }` → `{ token, user }` |
| POST | `/api/auth/logout` | 退出当前登录 |
| POST | `/api/auth/logout-all` | 退出所有设备 |
| GET | `/api/me` | 我的资料 |
| PATCH | `/api/me` | `{ name?, about? }` |
| POST | `/api/me/password` | `{ oldPassword, newPassword }`，其它设备的登录失效 |
| PUT | `/api/me/avatar` | 请求体为图片二进制，`Content-Type: image/jpeg|png|webp|gif`，≤2MB |
| DELETE | `/api/me/avatar` | 删除头像 |
| DELETE | `/api/me` | `{ password }` 注销账号，删除全部数据 |

### 用户、联系人、屏蔽

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/users?phone=+86138...` | 按手机号精确查找（不提供模糊搜索，防止枚举用户） |
| GET | `/api/users/:id` | 用户资料 + `online`、`lastSeen` |
| GET | `/api/contacts` | 联系人列表 |
| POST | `/api/contacts` | `{ userId }` 或 `{ phone }`，可带 `alias` |
| DELETE | `/api/contacts/:id` | 删除联系人 |
| GET / POST | `/api/blocks` | 屏蔽列表 / `{ userId }` 屏蔽 |
| DELETE | `/api/blocks/:id` | 取消屏蔽 |

### 加密公钥

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PUT | `/api/keys` | 上传完整公钥包 `acc.publicBundle()`；身份密钥变化时通知联系人和群友 |
| PUT | `/api/keys/signed` | 轮换签名预密钥 `await acc.rotateSignedPreKey()`（建议每周） |
| POST | `/api/keys/prekeys` | `{ oneTimePreKeys: await acc.generateOneTimePreKeys(50) }` 补充一次性预密钥 |
| GET | `/api/keys/count` | 服务器上剩余的一次性预密钥数量 |
| GET | `/api/keys/:userId` | 对方的公钥包（取走一个一次性预密钥），传给 `acc.initSession` |
| GET | `/api/keys/:userId/identity` | 只取身份公钥 |

### 群组

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/groups` | 我加入的群 |
| POST | `/api/groups` | `{ name, description?, members: [userId] }`，创建者为管理员 |
| GET | `/api/groups/:id` | 群信息和成员 |
| PATCH | `/api/groups/:id` | `{ name?, description? }`（管理员） |
| POST | `/api/groups/:id/members` | `{ userIds: [...] }` 加人（管理员） |
| DELETE | `/api/groups/:id/members/:userId` | 踢人（管理员）或自己退群；最后一个管理员退出时自动指定新管理员 |
| PUT / DELETE | `/api/groups/:id/admins/:userId` | 设为 / 取消管理员 |

### 附件（密文）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/media` | 请求体为加密后的二进制（`application/octet-stream`）→ `{ id, size, url }` |
| GET | `/api/media/:id` | 下载密文 |
| DELETE | `/api/media/:id` | 上传者删除 |

---

## 四、WebSocket 协议 `/ws`

连上后 10 秒内先发送 `{ "type": "auth", "token": "..." }`，收到 `{ "type": "ready" }` 后，服务器会立刻补发所有离线期间的事件。

**所有带 `qid` 的事件，客户端处理完后都要回 `{ type:'ack', qids:[...] }`**，否则下次连接会重发（客户端需按消息 `id` 去重）。

### 客户端 → 服务器

| type | 字段 | 说明 |
| --- | --- | --- |
| `auth` | `token` | 认证 |
| `send` | `id, to, envelope` | 一对一消息。`id` 由客户端生成（1~64 位字母数字 `_-`） |
| `send_group` | `id, groupId, envelopes: {userId: envelope}` | 群消息 |
| `ack` | `qids` | 确认收到；对 `message` 的确认会给发送方产生"已送达"回执 |
| `read` | `to, msgIds, groupId?` | 已读回执 |
| `typing` | `to` 或 `groupId`, `state` | `composing` / `recording` / `paused` |
| `presence_subscribe` | `userIds` | 打开聊天窗口时订阅对方在线状态（联系人会自动推送） |
| `presence_unsubscribe` | `userIds` | |
| `ping` | | 返回 `pong` |

### 服务器 → 客户端

| type | 字段 | 需 ack | 说明 |
| --- | --- | --- | --- |
| `ready` | `userId` | | 认证成功 |
| `sent` | `id, ts, groupId?, missing?` | | 服务器已收下（一个灰色勾）。`missing` 为群里漏加密的成员，客户端应补发 |
| `message` | `qid, id, from, groupId?, envelope, ts` | ✔ | 收到消息，用 `acc.decrypt(from, envelope)` 解密 |
| `receipt` | `qid, status, from, msgIds, groupId?` | ✔ | `delivered`（两个灰勾）/ `read`（蓝勾） |
| `group_update` | `qid, groupId, action, actor, targets, group` | ✔ | `created / updated / members_added / member_removed / member_left / admin_added / admin_removed` |
| `identity_changed` | `qid, userId, identityKey` | ✔ | 对方换了设备，提示"安全码已更改"，并删除旧会话 |
| `typing` | `from, groupId?, state` | | |
| `presence` | `userId, online, lastSeen` | | |
| `prekeys_low` | `count` | | 一次性预密钥快用完了，客户端应上传新的 |
| `error` | `ref, message` | | `ref` 为出错的消息 id |
| `pong` | `ts` | | |

---

## 五、目录结构

```
chat-server/
├─ server.js               启动入口
├─ start.bat               Windows 双击启动
├─ config.example.json     配置模板
├─ shared/e2ee.mjs         端到端加密库（客户端用，浏览器/Node 通用）
├─ src/
│  ├─ app.js               组装 HTTP + WebSocket
│  ├─ config.js / db.js    配置、数据库结构
│  ├─ auth.js              密码哈希（scrypt）、登录令牌
│  ├─ hub.js               在线连接、可靠投递队列
│  ├─ ws.js                WebSocket 协议
│  └─ routes/              auth / users / keys / groups / media
├─ scripts/                Windows 自启动、防火墙脚本
└─ test/                   加密库单元测试 + 服务器集成测试
```

## 六、当前限制 / 后续计划

* **一个账号同一时间只有一台设备持有加密密钥**。在新设备登录并重新生成密钥后，旧设备上的会话失效，联系人会看到"安全码已更改"
  （可以用 `exportEncrypted` 的加密备份迁移到新设备，避免这一点）。WhatsApp 那样的多设备同步是后续可以加的。
* 注册没有短信验证码（需要接入短信服务商），目前用手机号 + 密码。
* 推送通知（App 不在前台时）需要接入 FCM / APNs，后续做移动端时再加。
* 语音 / 视频通话需要 WebRTC 信令 + TURN 服务器，后续可以复用 WebSocket 通道实现。
* 电脑客户端（WhatsApp 风格界面）在 `../chat-desktop/`。如果限定了 `corsOrigins`，需要加入 `app://securechat`。
