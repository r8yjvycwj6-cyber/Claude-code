// 端到端加密库（客户端使用）——浏览器和 Node.js (>=22) 通用，只依赖标准 WebCrypto。
//
// 协议与 Signal / WhatsApp 相同的思路：
//   * X3DH 密钥协商：用对方在服务器上发布的公钥包（身份密钥 + 签名预密钥 + 一次性预密钥）
//     在对方离线时也能建立共享密钥。
//   * Double Ratchet（双棘轮）：每条消息使用不同的密钥，提供前向保密和被攻破后的自愈能力。
//   * AES-256-GCM 加密消息内容。
//   * 群聊：对每个成员分别用一对一会话加密（成对扇出）。
//   * 附件：随机 AES 密钥加密后上传，密钥通过加密消息发送。
//
// 与 Signal 的差异：WebCrypto 不支持 XEdDSA，所以身份密钥由一对 X25519（协商）+ 一对 Ed25519（签名）组成。
//
// 私钥只存在于客户端！服务器只能看到公钥和密文。
//
// 用法见 README.md 与 test/e2ee.test.js。

const subtle = globalThis.crypto.subtle;
const getRandom = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const te = new TextEncoder();
const td = new TextDecoder();

const INFO_X3DH = te.encode('ChatE2EE_X3DH_v1');
const INFO_RK = te.encode('ChatE2EE_Ratchet_v1');
const INFO_MSG = te.encode('ChatE2EE_MessageKeys_v1');
const MAX_SKIP = 1000; // 单条链上最多跳过的消息数
const MAX_STORED_SKIPPED = 2000; // 最多缓存多少个乱序消息密钥
const ZERO32 = new Uint8Array(32);

// ---------------------------------------------------------------- 字节工具
export function b64e(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64d(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ---------------------------------------------------------------- 密码学原语
async function genX25519() {
  const kp = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  return {
    pub: b64e(new Uint8Array(await subtle.exportKey('raw', kp.publicKey))),
    priv: await subtle.exportKey('jwk', kp.privateKey),
  };
}
async function genEd25519() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    pub: b64e(new Uint8Array(await subtle.exportKey('raw', kp.publicKey))),
    priv: await subtle.exportKey('jwk', kp.privateKey),
  };
}
async function dh(privJwk, pubB64) {
  const priv = await subtle.importKey('jwk', privJwk, { name: 'X25519' }, false, ['deriveBits']);
  const pub = await subtle.importKey('raw', b64d(pubB64), { name: 'X25519' }, false, []);
  // 对于小阶点（全零输出）WebCrypto 会直接抛错，避免了无效公钥攻击
  return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256));
}
async function sign(privJwk, data) {
  const k = await subtle.importKey('jwk', privJwk, { name: 'Ed25519' }, false, ['sign']);
  return new Uint8Array(await subtle.sign({ name: 'Ed25519' }, k, data));
}
async function verify(pubB64, data, sig) {
  try {
    const k = await subtle.importKey('raw', b64d(pubB64), { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, k, sig, data);
  } catch {
    return false;
  }
}
async function hkdf(ikm, salt, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
async function sha256(data) {
  return new Uint8Array(await subtle.digest('SHA-256', data));
}
async function aesGcm(mode, key, iv, data, ad) {
  const k = await subtle.importKey('raw', key, 'AES-GCM', false, [mode]);
  const params = { name: 'AES-GCM', iv, ...(ad ? { additionalData: ad } : {}) };
  const out = mode === 'encrypt' ? await subtle.encrypt(params, k, data) : await subtle.decrypt(params, k, data);
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- Double Ratchet
async function kdfRK(rkB64, dhOut) {
  const out = await hkdf(dhOut, b64d(rkB64), INFO_RK, 64);
  return [b64e(out.slice(0, 32)), b64e(out.slice(32))];
}
async function kdfCK(ckB64) {
  const ck = b64d(ckB64);
  const mk = await hmac(ck, new Uint8Array([1]));
  const next = await hmac(ck, new Uint8Array([2]));
  return [b64e(next), mk];
}
function headerBytes(h) {
  return concat(b64d(h.dh), u32(h.pn), u32(h.n));
}
async function sealMessage(mk, plaintext, ad) {
  const km = await hkdf(mk, ZERO32, INFO_MSG, 44); // 32 字节密钥 + 12 字节 IV（每个 mk 只用一次）
  return aesGcm('encrypt', km.slice(0, 32), km.slice(32), plaintext, ad);
}
async function openMessage(mk, ct, ad) {
  const km = await hkdf(mk, ZERO32, INFO_MSG, 44);
  return aesGcm('decrypt', km.slice(0, 32), km.slice(32), ct, ad);
}

async function ratchetInitAlice(sk, bobRatchetPub) {
  const DHs = await genX25519();
  const [RK, CKs] = await kdfRK(b64e(sk), await dh(DHs.priv, bobRatchetPub));
  return { DHs, DHr: bobRatchetPub, RK, CKs, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: {} };
}
function ratchetInitBob(sk, bobSpk) {
  return { DHs: { pub: bobSpk.pub, priv: bobSpk.priv }, DHr: null, RK: b64e(sk), CKs: null, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: {} };
}

async function ratchetEncrypt(st, plaintext, ad) {
  if (!st.CKs) throw new Error('会话尚不能发送消息');
  const [CKs, mk] = await kdfCK(st.CKs);
  st.CKs = CKs;
  const header = { dh: st.DHs.pub, pn: st.PN, n: st.Ns };
  st.Ns++;
  const ct = await sealMessage(mk, plaintext, concat(ad, headerBytes(header)));
  return { header, ct: b64e(ct) };
}

async function skipKeys(st, until) {
  if (st.Nr + MAX_SKIP < until) throw new Error('跳过的消息过多');
  if (!st.CKr) return;
  while (st.Nr < until) {
    const [CKr, mk] = await kdfCK(st.CKr);
    st.CKr = CKr;
    st.skipped[`${st.DHr}:${st.Nr}`] = b64e(mk);
    st.Nr++;
  }
  const keys = Object.keys(st.skipped);
  for (let i = 0; i < keys.length - MAX_STORED_SKIPPED; i++) delete st.skipped[keys[i]];
}

async function ratchetDecrypt(st, header, ctB64, ad) {
  if (typeof header?.dh !== 'string' || !Number.isInteger(header.n) || !Number.isInteger(header.pn) || header.n < 0 || header.pn < 0) {
    throw new Error('消息头格式错误');
  }
  const ct = b64d(ctB64);
  const fullAd = concat(ad, headerBytes(header));
  const skKey = `${header.dh}:${header.n}`;
  if (st.skipped[skKey]) {
    const pt = await openMessage(b64d(st.skipped[skKey]), ct, fullAd);
    delete st.skipped[skKey];
    return pt;
  }
  if (header.dh !== st.DHr) {
    await skipKeys(st, header.pn);
    // DH 棘轮步进
    st.PN = st.Ns;
    st.Ns = 0;
    st.Nr = 0;
    st.DHr = header.dh;
    [st.RK, st.CKr] = await kdfRK(st.RK, await dh(st.DHs.priv, st.DHr));
    st.DHs = await genX25519();
    [st.RK, st.CKs] = await kdfRK(st.RK, await dh(st.DHs.priv, st.DHr));
  }
  await skipKeys(st, header.n);
  const [CKr, mk] = await kdfCK(st.CKr);
  st.CKr = CKr;
  st.Nr++;
  return openMessage(mk, ct, fullAd);
}

// ---------------------------------------------------------------- 工具
const clone = (o) => JSON.parse(JSON.stringify(o));
const identityBytes = (ik) => concat(b64d(ik.dh), b64d(ik.sig));
const sameIdentity = (a, b) => !!a && !!b && a.dh === b.dh && a.sig === b.sig;

function validBundle(b) {
  return (
    b && b.identityKey && typeof b.identityKey.dh === 'string' && typeof b.identityKey.sig === 'string' &&
    b.signedPreKey && Number.isInteger(b.signedPreKey.keyId) &&
    typeof b.signedPreKey.publicKey === 'string' && typeof b.signedPreKey.signature === 'string'
  );
}

// ---------------------------------------------------------------- 账号 / 会话管理
export class E2EEAccount {
  constructor(state) {
    this.s = state;
    this._locks = new Map();
  }

  /** 新建账号密钥（首次登录客户端时调用一次），默认生成 100 个一次性预密钥 */
  static async create({ oneTimePreKeys = 100 } = {}) {
    const identity = { dh: await genX25519(), sig: await genEd25519() };
    const acc = new E2EEAccount({
      version: 1,
      identity,
      signedPreKey: null,
      prevSignedPreKey: null,
      oneTimePreKeys: {},
      nextPreKeyId: 1,
      nextSignedPreKeyId: 1,
      sessions: {},
      identities: {},
    });
    await acc.rotateSignedPreKey();
    await acc.generateOneTimePreKeys(oneTimePreKeys);
    return acc;
  }

  /** 从 toJSON() 的结果恢复（客户端应保存在 IndexedDB 等本地存储中） */
  static fromJSON(json) {
    return new E2EEAccount(typeof json === 'string' ? JSON.parse(json) : clone(json));
  }

  toJSON() {
    return clone(this.s);
  }

  /** 用口令加密导出（用于备份）。PBKDF2-SHA256 60 万次 + AES-256-GCM */
  async exportEncrypted(passphrase) {
    const salt = getRandom(16);
    const iv = getRandom(12);
    const key = await deriveBackupKey(passphrase, salt);
    const ct = await aesGcm('encrypt', key, iv, te.encode(JSON.stringify(this.s)));
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
  }
  static async importEncrypted(backup, passphrase) {
    const key = await deriveBackupKey(passphrase, b64d(backup.salt), backup.iter);
    let pt;
    try {
      pt = await aesGcm('decrypt', key, b64d(backup.iv), b64d(backup.ct));
    } catch {
      throw new Error('口令错误或备份已损坏');
    }
    return E2EEAccount.fromJSON(td.decode(pt));
  }

  get identityKey() {
    return { dh: this.s.identity.dh.pub, sig: this.s.identity.sig.pub };
  }

  /** PUT /api/keys 的请求体（包含当前所有一次性预密钥的公钥） */
  publicBundle() {
    const spk = this.s.signedPreKey;
    return {
      identityKey: this.identityKey,
      signedPreKey: { keyId: spk.keyId, publicKey: spk.pub, signature: spk.signature },
      oneTimePreKeys: Object.entries(this.s.oneTimePreKeys).map(([keyId, k]) => ({ keyId: Number(keyId), publicKey: k.pub })),
    };
  }

  /** 生成新的一次性预密钥，返回公钥列表，用于 POST /api/keys/prekeys */
  async generateOneTimePreKeys(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const keyId = this.s.nextPreKeyId++;
      const kp = await genX25519();
      this.s.oneTimePreKeys[keyId] = kp;
      out.push({ keyId, publicKey: kp.pub });
    }
    return out;
  }

  /** 轮换签名预密钥（建议每周一次），旧的保留一份以解密还在路上的消息。返回 PUT /api/keys/signed 的请求体 */
  async rotateSignedPreKey() {
    const kp = await genX25519();
    const signature = b64e(await sign(this.s.identity.sig.priv, b64d(kp.pub)));
    if (this.s.signedPreKey) this.s.prevSignedPreKey = this.s.signedPreKey;
    this.s.signedPreKey = { keyId: this.s.nextSignedPreKeyId++, pub: kp.pub, priv: kp.priv, signature, createdAt: Date.now() };
    return { keyId: this.s.signedPreKey.keyId, publicKey: kp.pub, signature };
  }

  hasSession(peerId) {
    return !!this.s.sessions[peerId]?.current;
  }

  /** 已知的对方身份公钥（首次通信时信任，TOFU） */
  knownIdentity(peerId) {
    return this.s.identities[peerId] || null;
  }

  /** 手动删除会话（例如用户点了"重置会话"） */
  deleteSession(peerId) {
    delete this.s.sessions[peerId];
  }

  // 同一个联系人的加解密操作串行执行，防止并发修改棘轮状态
  _withLock(peerId, fn) {
    const prev = this._locks.get(peerId) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this._locks.set(peerId, tail);
    tail.then(() => {
      if (this._locks.get(peerId) === tail) this._locks.delete(peerId);
    });
    return run;
  }

  _rememberIdentity(peerId, ik) {
    const old = this.s.identities[peerId];
    const changed = !!old && !sameIdentity(old, ik);
    this.s.identities[peerId] = { dh: ik.dh, sig: ik.sig };
    return changed;
  }

  /**
   * 用对方的预密钥包（GET /api/keys/:userId 的返回值）建立会话（X3DH 发起方）。
   * 返回 { identityChanged }：为 true 时 UI 应提示"安全码已更改"。
   */
  initSession(peerId, bundle) {
    return this._withLock(String(peerId), async () => {
      if (!validBundle(bundle)) throw new Error('预密钥包格式错误');
      const ik = bundle.identityKey;
      const spk = bundle.signedPreKey;
      if (!(await verify(ik.sig, b64d(spk.publicKey), b64d(spk.signature)))) {
        throw new Error('签名预密钥校验失败：服务器可能被篡改');
      }
      const opk = bundle.oneTimePreKey || null;
      const me = this.s.identity;
      const ek = await genX25519();
      const parts = [
        new Uint8Array(32).fill(0xff),
        await dh(me.dh.priv, spk.publicKey),
        await dh(ek.priv, ik.dh),
        await dh(ek.priv, spk.publicKey),
      ];
      if (opk) parts.push(await dh(ek.priv, opk.publicKey));
      const sk = await hkdf(concat(...parts), ZERO32, INFO_X3DH, 32);
      const ad = b64e(concat(identityBytes(this.identityKey), identityBytes(ik)));

      const session = {
        ad,
        remoteIdentity: { dh: ik.dh, sig: ik.sig },
        remoteEk: null,
        pending: { ik: this.identityKey, ek: ek.pub, spk: spk.keyId, opk: opk ? opk.keyId : null },
        ratchet: await ratchetInitAlice(sk, spk.publicKey),
      };
      const identityChanged = this._rememberIdentity(String(peerId), ik);
      this._setCurrent(String(peerId), session);
      return { identityChanged };
    });
  }

  _setCurrent(peerId, session) {
    const entry = this.s.sessions[peerId] || (this.s.sessions[peerId] = { current: null, previous: null });
    if (entry.current) entry.previous = entry.current;
    entry.current = session;
  }

  /**
   * 加密要发给 peerId 的内容（任意可 JSON 序列化的对象，例如 { t:'text', body:'你好' }）。
   * 返回 envelope，直接放进 WebSocket 的 { type:'send', id, to, envelope } 中发送。
   */
  encrypt(peerId, payload) {
    return this._withLock(String(peerId), async () => {
      const entry = this.s.sessions[String(peerId)];
      if (!entry?.current) throw new Error('还没有与对方的加密会话，请先 initSession');
      const session = entry.current;
      const pt = te.encode(JSON.stringify(payload));
      const { header, ct } = await ratchetEncrypt(session.ratchet, pt, b64d(session.ad));
      const env = { v: 1, type: session.pending ? 'prekey' : 'msg', header, ct };
      if (session.pending) env.x3dh = session.pending;
      return env;
    });
  }

  /**
   * 解密 peerId 发来的 envelope。返回 { payload, identityChanged }。
   * 解密失败会抛错且不改变任何状态。
   */
  decrypt(peerId, envelope) {
    return this._withLock(String(peerId), async () => {
      const pid = String(peerId);
      if (!envelope || envelope.v !== 1 || !envelope.header || typeof envelope.ct !== 'string') {
        throw new Error('不支持的消息格式');
      }
      const entry = this.s.sessions[pid];
      let identityChanged = false;

      // 1) 尝试已有会话（当前会话，其次上一个会话——处理双方同时发起会话的情况）
      const candidates = [];
      if (entry?.current) candidates.push('current');
      if (entry?.previous) candidates.push('previous');
      if (envelope.type === 'prekey' && envelope.x3dh) {
        // 发起方的会话尚未收到回复时，每条消息都带 x3dh 头；如果是同一个会话（ek 相同）就直接用已有会话
        const match = candidates.find((c) => entry[c].remoteEk === envelope.x3dh.ek);
        if (!match) candidates.length = 0;
        else candidates.splice(0, candidates.length, match);
      }
      for (const which of candidates) {
        const session = clone(entry[which]);
        let pt;
        try {
          pt = await ratchetDecrypt(session.ratchet, envelope.header, envelope.ct, b64d(session.ad));
        } catch {
          continue;
        }
        session.pending = null; // 收到对方的消息，说明对方已建立会话
        if (which === 'previous') {
          entry.previous = entry.current;
          entry.current = session;
        } else {
          entry.current = session;
        }
        return { payload: JSON.parse(td.decode(pt)), identityChanged };
      }

      if (envelope.type !== 'prekey' || !envelope.x3dh) throw new Error('无法解密：没有匹配的会话（对方可能需要重新建立会话）');

      // 2) 新的 X3DH 会话（我方是接收方）
      const x = envelope.x3dh;
      if (!x.ik || typeof x.ik.dh !== 'string' || typeof x.ik.sig !== 'string' || typeof x.ek !== 'string') {
        throw new Error('x3dh 头格式错误');
      }
      const spk = [this.s.signedPreKey, this.s.prevSignedPreKey].find((k) => k && k.keyId === x.spk);
      if (!spk) throw new Error('签名预密钥已过期，无法解密');
      let opk = null;
      if (x.opk !== null && x.opk !== undefined) {
        opk = this.s.oneTimePreKeys[x.opk];
        if (!opk) throw new Error('一次性预密钥已被使用或不存在（可能是重放消息）');
      }
      const me = this.s.identity;
      const parts = [
        new Uint8Array(32).fill(0xff),
        await dh(spk.priv, x.ik.dh),
        await dh(me.dh.priv, x.ek),
        await dh(spk.priv, x.ek),
      ];
      if (opk) parts.push(await dh(opk.priv, x.ek));
      const sk = await hkdf(concat(...parts), ZERO32, INFO_X3DH, 32);
      const ad = b64e(concat(identityBytes(x.ik), identityBytes(this.identityKey)));
      const session = {
        ad,
        remoteIdentity: { dh: x.ik.dh, sig: x.ik.sig },
        remoteEk: x.ek,
        pending: null,
        ratchet: ratchetInitBob(sk, spk),
      };
      const pt = await ratchetDecrypt(session.ratchet, envelope.header, envelope.ct, b64d(ad)); // 失败则抛错，状态未改
      // 成功后才删除一次性预密钥、保存会话
      if (opk) delete this.s.oneTimePreKeys[x.opk];
      identityChanged = this._rememberIdentity(pid, x.ik);
      this._setCurrent(pid, session);
      return { payload: JSON.parse(td.decode(pt)), identityChanged };
    });
  }

  /** 剩余一次性预密钥数量（本地） */
  get oneTimePreKeyCount() {
    return Object.keys(this.s.oneTimePreKeys).length;
  }

  /**
   * 安全码（类似 WhatsApp 的 60 位数字）。双方各自计算，结果相同即说明没有中间人。
   * myId / peerId 为用户 id。
   */
  async safetyNumber(myId, peerId) {
    const peerIk = this.s.identities[String(peerId)];
    if (!peerIk) throw new Error('还不知道对方的身份密钥');
    const a = await fingerprint(String(myId), this.identityKey);
    const b = await fingerprint(String(peerId), peerIk);
    const [first, second] = String(myId) < String(peerId) ? [a, b] : [b, a];
    return (first + second).match(/.{5}/g).join(' ');
  }
}

async function fingerprint(userId, ik) {
  let h = concat(new Uint8Array([0, 0]), identityBytes(ik), te.encode(userId));
  const input = identityBytes(ik);
  for (let i = 0; i < 5200; i++) h = await sha256(concat(h, input));
  let out = '';
  for (let i = 0; i < 30; i += 5) {
    const v = ((h[i] * 2 ** 32) + ((h[i + 1] << 24) >>> 0) + (h[i + 2] << 16) + (h[i + 3] << 8) + h[i + 4]) % 100000;
    out += String(v).padStart(5, '0');
  }
  return out;
}

async function deriveBackupKey(passphrase, salt, iter = 600000) {
  const base = await subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256));
}

// ---------------------------------------------------------------- 群聊（成对扇出）
/**
 * 给多个接收者加密同一条内容。recipients 为 userId 数组；
 * getBundle(userId) 在没有会话时被调用，应返回 GET /api/keys/:userId 的结果。
 * 返回 { envelopes: { [userId]: envelope }, identityChanged: [userId...] }，
 * envelopes 可直接用于 WebSocket { type:'send_group', id, groupId, envelopes }。
 */
export async function encryptForMany(account, recipients, payload, getBundle) {
  const envelopes = {};
  const identityChanged = [];
  await Promise.all(
    recipients.map(async (uid) => {
      if (!account.hasSession(uid)) {
        const r = await account.initSession(uid, await getBundle(uid));
        if (r.identityChanged) identityChanged.push(uid);
      }
      envelopes[uid] = await account.encrypt(uid, payload);
    })
  );
  return { envelopes, identityChanged };
}

// ---------------------------------------------------------------- 附件
/**
 * 加密附件。返回 { ciphertext(Uint8Array，上传到 /api/media), key, sha256 }，
 * key 和 sha256 放进加密消息里发给对方，例如 { t:'image', media:{ id, key, sha256, mime, size, name } }。
 */
export async function encryptAttachment(bytes) {
  const key = getRandom(32);
  const iv = getRandom(12);
  const ct = concat(iv, await aesGcm('encrypt', key, iv, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  return { ciphertext: ct, key: b64e(key), sha256: b64e(await sha256(ct)) };
}

/** 解密附件：先校验密文哈希，再解密 */
export async function decryptAttachment(ciphertext, keyB64, sha256B64) {
  const ct = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
  if (!equalBytes(await sha256(ct), b64d(sha256B64))) throw new Error('附件校验失败（文件被篡改）');
  return aesGcm('decrypt', b64d(keyB64), ct.slice(0, 12), ct.slice(12));
}
