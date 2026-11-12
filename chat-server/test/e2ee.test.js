'use strict';
// 加密库单元测试（不经过服务器）
const test = require('node:test');
const assert = require('node:assert/strict');

let E;
test.before(async () => {
  E = await import('../shared/e2ee.mjs');
});

function bundleOf(acc, { useOtk = true } = {}) {
  const b = acc.publicBundle();
  const otk = useOtk ? b.oneTimePreKeys.shift() : null;
  return { identityKey: b.identityKey, signedPreKey: b.signedPreKey, oneTimePreKey: otk || null };
}

test('X3DH + 双棘轮：双向通信、多轮切换', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 5 });
  const bob = await E.E2EEAccount.create({ oneTimePreKeys: 5 });
  await alice.initSession('bob', bundleOf(bob));

  const e1 = await alice.encrypt('bob', { t: 'text', body: '你好 Bob' });
  assert.equal(e1.type, 'prekey');
  assert.ok(!JSON.stringify(e1).includes('你好'));
  assert.deepEqual((await bob.decrypt('alice', e1)).payload, { t: 'text', body: '你好 Bob' });
  assert.equal(bob.oneTimePreKeyCount, 4, '一次性预密钥用后即删');

  for (let round = 0; round < 5; round++) {
    const r = await bob.encrypt('alice', { n: round });
    assert.equal(r.type, 'msg');
    assert.equal((await alice.decrypt('bob', r)).payload.n, round);
    const a = await alice.encrypt('bob', { n: round + 100 });
    assert.equal(a.type, 'msg', '收到回复后不再携带 x3dh 头');
    assert.equal((await bob.decrypt('alice', a)).payload.n, round + 100);
  }
});

test('乱序与丢失的消息', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  const bob = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  await alice.initSession('bob', bundleOf(bob));
  const msgs = [];
  for (let i = 0; i < 5; i++) msgs.push(await alice.encrypt('bob', { i }));
  // 先收到第 0 条（建立会话），然后 4、2、3、1
  for (const i of [0, 4, 2, 3, 1]) assert.equal((await bob.decrypt('alice', msgs[i])).payload.i, i);
  // 同一条消息不能解密两次（防重放）
  await assert.rejects(bob.decrypt('alice', msgs[2]));
});

test('没有一次性预密钥也能建立会话；同一会话的多条 prekey 消息', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 0 });
  const bob = await E.E2EEAccount.create({ oneTimePreKeys: 0 });
  await alice.initSession('bob', bundleOf(bob, { useOtk: false }));
  const a = await alice.encrypt('bob', { n: 1 });
  const b = await alice.encrypt('bob', { n: 2 });
  assert.equal(b.type, 'prekey');
  assert.equal((await bob.decrypt('alice', b)).payload.n, 2);
  assert.equal((await bob.decrypt('alice', a)).payload.n, 1);
});

test('篡改密文、伪造签名预密钥都会被拒绝', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  const bob = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  const mallory = await E.E2EEAccount.create({ oneTimePreKeys: 0 });

  // 服务器把 Bob 的签名预密钥换成自己的 -> 签名校验失败
  const forged = bundleOf(bob);
  forged.signedPreKey = { ...mallory.publicBundle().signedPreKey };
  await assert.rejects(alice.initSession('bob', forged), /签名/);

  await alice.initSession('bob', bundleOf(bob));
  const env = await alice.encrypt('bob', { body: 'secret' });
  const bad = structuredClone(env);
  const ct = E.b64d(bad.ct);
  ct[0] ^= 1;
  bad.ct = E.b64e(ct);
  await assert.rejects(bob.decrypt('alice', bad));
  // 失败不影响后续正确消息
  assert.equal((await bob.decrypt('alice', env)).payload.body, 'secret');
});

test('双方同时发起会话也能互相解密', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  const bob = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  await alice.initSession('bob', bundleOf(bob));
  await bob.initSession('alice', bundleOf(alice));
  const a1 = await alice.encrypt('bob', { from: 'a' });
  const b1 = await bob.encrypt('alice', { from: 'b' });
  assert.equal((await bob.decrypt('alice', a1)).payload.from, 'a');
  assert.equal((await alice.decrypt('bob', b1)).payload.from, 'b');
  for (let i = 0; i < 3; i++) {
    assert.equal((await bob.decrypt('alice', await alice.encrypt('bob', { i }))).payload.i, i);
    assert.equal((await alice.decrypt('bob', await bob.encrypt('alice', { i }))).payload.i, i);
  }
});

test('序列化恢复、口令备份、安全码、身份变化提示', async () => {
  const alice = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  let bob = await E.E2EEAccount.create({ oneTimePreKeys: 2 });
  await alice.initSession('2', bundleOf(bob));
  await bob.decrypt('1', await alice.encrypt('2', { x: 1 }));

  bob = E.E2EEAccount.fromJSON(JSON.stringify(bob.toJSON()));
  const backup = await bob.exportEncrypted('correct horse');
  await assert.rejects(E.E2EEAccount.importEncrypted(backup, 'wrong'), /口令错误/);
  bob = await E.E2EEAccount.importEncrypted(backup, 'correct horse');
  assert.equal((await bob.decrypt('1', await alice.encrypt('2', { x: 2 }))).payload.x, 2);

  const sn1 = await alice.safetyNumber(1, 2);
  const sn2 = await bob.safetyNumber(2, 1);
  assert.equal(sn1, sn2);
  assert.match(sn1, /^(\d{5} ){11}\d{5}$/);

  // Bob 换了设备（新身份密钥）
  const bob2 = await E.E2EEAccount.create({ oneTimePreKeys: 1 });
  const r = await alice.initSession('2', bundleOf(bob2));
  assert.equal(r.identityChanged, true);
});

test('附件加解密', async () => {
  const data = new Uint8Array(100000).map((_, i) => i % 251);
  const enc = await E.encryptAttachment(data);
  assert.deepEqual(await E.decryptAttachment(enc.ciphertext, enc.key, enc.sha256), data);
  enc.ciphertext[50] ^= 1;
  await assert.rejects(E.decryptAttachment(enc.ciphertext, enc.key, enc.sha256), /校验失败/);
});
