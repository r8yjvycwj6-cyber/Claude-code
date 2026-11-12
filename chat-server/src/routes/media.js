'use strict';
// 媒体文件（图片、语音、视频、文档）。
// 客户端先用随机 AES 密钥加密文件，再上传密文；密钥和文件哈希放在端到端加密的消息里发给对方。
// 服务器只存一个看不懂的二进制块。
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HttpError, now } = require('../util');

module.exports = function mediaRoutes({ db, auth, config }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const dir = path.join(config.dataDir, 'media');
  const ID_RE = /^[A-Za-z0-9_-]{32}$/;

  // 上传：请求体为原始二进制（Content-Type: application/octet-stream）
  r.post('/', (req, res, next) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > config.maxMediaBytes) return next(new HttpError(413, '文件太大'));
    const id = crypto.randomBytes(24).toString('base64url');
    const file = path.join(dir, id);
    const out = fs.createWriteStream(file, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(file, { force: true }, () => {});
      next(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxMediaBytes) {
        req.unpipe(out);
        req.resume();
        fail(new HttpError(413, '文件太大'));
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (size === 0) return fail(new HttpError(400, '文件为空'));
      db.prepare('INSERT INTO media (id, owner_id, size, created_at) VALUES (?, ?, ?, ?)').run(id, req.userId, size, now());
      res.status(201).json({ id, size, url: `/api/media/${id}` });
    });
    req.pipe(out);
  });

  // 下载：持有 id 的已登录用户即可下载（id 是 192 位随机数，只会出现在加密消息中）
  r.get('/:id', (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) throw new HttpError(404, '文件不存在');
    const row = db.prepare('SELECT size FROM media WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, '文件不存在或已过期');
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': row.size,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    fs.createReadStream(path.join(dir, id)).on('error', () => res.destroy()).pipe(res);
  });

  // 上传者可以删除
  r.delete('/:id', (req, res) => {
    const id = req.params.id;
    const row = ID_RE.test(id) && db.prepare('SELECT owner_id FROM media WHERE id = ?').get(id);
    if (!row || row.owner_id !== req.userId) throw new HttpError(404, '文件不存在');
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
    fs.rm(path.join(dir, id), { force: true }, () => {});
    res.json({ ok: true });
  });

  return r;
};
