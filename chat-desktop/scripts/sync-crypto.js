'use strict';
// 加密库只维护一份：chat-server/shared/e2ee.mjs。桌面端打包需要自带一份副本（不能从服务器加载代码）。
//   node scripts/sync-crypto.js          复制最新版本
//   node scripts/sync-crypto.js --check  检查两份是否一致（服务器目录不存在时跳过）
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'chat-server', 'shared', 'e2ee.mjs');
const dst = path.resolve(__dirname, '..', 'app', 'lib', 'e2ee.mjs');

if (!fs.existsSync(src)) {
  console.log('未找到 chat-server/shared/e2ee.mjs，跳过加密库同步检查');
  process.exit(0);
}
const same = fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst));
if (process.argv.includes('--check')) {
  if (!same) {
    console.error('app/lib/e2ee.mjs 与 chat-server/shared/e2ee.mjs 不一致，请运行 npm run sync-crypto');
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(same ? '加密库已是最新' : '已更新 app/lib/e2ee.mjs');
}
