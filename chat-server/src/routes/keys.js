'use strict';
// 端到端加密的公钥目录（X3DH 协议所需）。
// 服务器只保存和分发公钥，私钥从不离开客户端；服务器也无法解密任何消息。
//
//   身份密钥 identityKey: { dh: X25519 公钥, sig: Ed25519 公钥 }（各 32 字节，base64）
//   签名预密钥 signedPreKey: { keyId, publicKey: X25519 公钥, signature: Ed25519(identity.sig, publicKey 原始字节) }
//   一次性预密钥 oneTimePreKeys: [{ keyId, publicKey }]，每次被取用一个就删除一个
const express = require('express');
const crypto = require('crypto');
const { HttpError, now, isB64Len, isId } = require('../util');
const dbTx = require('../db').tx;

const MAX_OTK = 200;
const LOW_OTK = 10;

function verifyEd25519(pubB64, dataB64, sigB64) {
  try {
    const key = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubB64, 'base64').toString('base64url') },
      format: 'jwk',
    });
    return crypto.verify(null, Buffer.from(dataB64, 'base64'), key, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

function validKeyId(v) {
  return Number.isSafeInteger(v) && v >= 0 && v < 2 ** 31;
}

function validateOtks(list) {
  if (!Array.isArray(list) || list.length > 100) throw new HttpError(400, 'oneTimePreKeys 必须是不超过 100 个元素的数组');
  for (const k of list) {
    if (!k || !validKeyId(k.keyId) || !isB64Len(k.publicKey, 32)) throw new HttpError(400, '一次性预密钥格式错误');
  }
  return list;
}

module.exports = function keysRoutes({ db, auth, hub }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  const getIdentity = db.prepare('SELECT dh_key, sig_key FROM identity_keys WHERE user_id = ?');
  const upsertIdentity = db.prepare(
    `INSERT INTO identity_keys (user_id, dh_key, sig_key, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET dh_key = excluded.dh_key, sig_key = excluded.sig_key, updated_at = excluded.updated_at`
  );
  const upsertSpk = db.prepare(
    `INSERT INTO signed_prekeys (user_id, key_id, public_key, signature, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET key_id = excluded.key_id, public_key = excluded.public_key,
       signature = excluded.signature, updated_at = excluded.updated_at`
  );
  const insertOtk = db.prepare('INSERT OR REPLACE INTO one_time_prekeys (user_id, key_id, public_key) VALUES (?, ?, ?)');
  const countOtk = db.prepare('SELECT COUNT(*) AS n FROM one_time_prekeys WHERE user_id = ?');
  const takeOtk = db.prepare(
    `DELETE FROM one_time_prekeys WHERE rowid = (SELECT rowid FROM one_time_prekeys WHERE user_id = ? ORDER BY key_id LIMIT 1)
     RETURNING key_id, public_key`
  );

  function checkSpk(identitySig, spk) {
    if (!spk || !validKeyId(spk.keyId) || !isB64Len(spk.publicKey, 32) || !isB64Len(spk.signature, 64)) {
      throw new HttpError(400, 'signedPreKey 格式错误');
    }
    if (!verifyEd25519(identitySig, spk.publicKey, spk.signature)) {
      throw new HttpError(400, 'signedPreKey 签名校验失败');
    }
  }

  // 上传/替换完整密钥包（首次登录、或换了新设备重新生成身份密钥时调用）
  r.put('/', (req, res) => {
    const { identityKey, signedPreKey, oneTimePreKeys = [] } = req.body;
    if (!identityKey || !isB64Len(identityKey.dh, 32) || !isB64Len(identityKey.sig, 32)) {
      throw new HttpError(400, 'identityKey 格式错误');
    }
    checkSpk(identityKey.sig, signedPreKey);
    validateOtks(oneTimePreKeys);

    const old = getIdentity.get(req.userId);
    const changed = !!old && (old.dh_key !== identityKey.dh || old.sig_key !== identityKey.sig);
    const t = now();
    dbTx(db, () => {
      upsertIdentity.run(req.userId, identityKey.dh, identityKey.sig, t);
      upsertSpk.run(req.userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature, t);
      if (changed || !old) db.prepare('DELETE FROM one_time_prekeys WHERE user_id = ?').run(req.userId);
      for (const k of oneTimePreKeys) insertOtk.run(req.userId, k.keyId, k.publicKey);
    });

    // 身份密钥变了：通知相关的人（类似 WhatsApp "安全码已更改"）
    if (changed) {
      const peers = db
        .prepare(
          `SELECT user_id AS id FROM contacts WHERE contact_id = ?
           UNION SELECT gm2.user_id FROM group_members gm1 JOIN group_members gm2 ON gm1.group_id = gm2.group_id
             WHERE gm1.user_id = ? AND gm2.user_id != ?`
        )
        .all(req.userId, req.userId, req.userId);
      for (const p of peers) hub.deliver(p.id, 'identity_changed', { userId: req.userId, identityKey });
    }
    res.json({ ok: true, identityChanged: changed, oneTimePreKeys: countOtk.get(req.userId).n });
  });

  // 定期轮换签名预密钥
  r.put('/signed', (req, res) => {
    const id = getIdentity.get(req.userId);
    if (!id) throw new HttpError(409, '请先上传身份密钥');
    checkSpk(id.sig_key, req.body);
    upsertSpk.run(req.userId, req.body.keyId, req.body.publicKey, req.body.signature, now());
    res.json({ ok: true });
  });

  // 补充一次性预密钥
  r.post('/prekeys', (req, res) => {
    if (!getIdentity.get(req.userId)) throw new HttpError(409, '请先上传身份密钥');
    const list = validateOtks(req.body.oneTimePreKeys);
    const n = countOtk.get(req.userId).n;
    if (n + list.length > MAX_OTK) throw new HttpError(400, `一次性预密钥最多保存 ${MAX_OTK} 个，当前 ${n} 个`);
    dbTx(db, () => {
      for (const k of list) insertOtk.run(req.userId, k.keyId, k.publicKey);
    });
    res.json({ ok: true, oneTimePreKeys: countOtk.get(req.userId).n });
  });

  r.get('/count', (req, res) => res.json({ oneTimePreKeys: countOtk.get(req.userId).n }));

  // 只获取某人的身份公钥（用于核对安全码，不消耗一次性预密钥）
  r.get('/:userId/identity', (req, res) => {
    const id = getIdentity.get(Number(req.params.userId));
    if (!id) throw new HttpError(404, '对方还没有上传密钥');
    res.json({ userId: Number(req.params.userId), identityKey: { dh: id.dh_key, sig: id.sig_key } });
  });

  // 获取某人的预密钥包，用于建立加密会话。会消耗对方一个一次性预密钥。
  r.get('/:userId', (req, res) => {
    const userId = Number(req.params.userId);
    if (!isId(userId)) throw new HttpError(400, 'userId 错误');
    const bundle = dbTx(db, () => {
      const id = getIdentity.get(userId);
      const spk = db.prepare('SELECT key_id, public_key, signature FROM signed_prekeys WHERE user_id = ?').get(userId);
      if (!id || !spk) return null;
      const otk = userId === req.userId ? null : takeOtk.get(userId);
      return {
        userId,
        identityKey: { dh: id.dh_key, sig: id.sig_key },
        signedPreKey: { keyId: spk.key_id, publicKey: spk.public_key, signature: spk.signature },
        oneTimePreKey: otk ? { keyId: otk.key_id, publicKey: otk.public_key } : null,
      };
    });
    if (!bundle) throw new HttpError(404, '对方还没有上传密钥（可能从未登录过客户端）');
    const left = countOtk.get(userId).n;
    if (left < LOW_OTK) hub.emit(userId, { type: 'prekeys_low', count: left });
    res.json(bundle);
  });

  return r;
};

module.exports.verifyEd25519 = verifyEd25519;
