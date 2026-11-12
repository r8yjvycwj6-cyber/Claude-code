'use strict';
// 服务器集成测试：真实启动服务器，模拟多个客户端完成端到端加密通信。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, WsClient } = require('./helpers');

let E;
let srv;
test.before(async () => {
  E = await import('../shared/e2ee.mjs');
  srv = await startServer();
});
test.after(() => srv.stop());

// 注册 + 生成密钥 + 上传公钥
async function newUser(phone, name) {
  const reg = await api(srv.base, 'POST', '/api/auth/register', { body: { phone, name, password: 'password123' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const acc = await E.E2EEAccount.create({ oneTimePreKeys: 20 });
  const up = await api(srv.base, 'PUT', '/api/keys', { token: reg.data.token, body: acc.publicBundle() });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  return { id: reg.data.user.id, token: reg.data.token, acc };
}

const getBundle = (me) => async (uid) => (await api(srv.base, 'GET', `/api/keys/${uid}`, { token: me.token })).data;

test('注册、登录、资料、查找、联系人', async () => {
  const u = await newUser('+8613800000001', '张三');
  assert.equal((await api(srv.base, 'POST', '/api/auth/register', { body: { phone: '+8613800000001', name: 'x', password: 'password123' } })).status, 409);
  assert.equal((await api(srv.base, 'POST', '/api/auth/login', { body: { phone: '+8613800000001', password: 'wrong-pass' } })).status, 401);
  const login = await api(srv.base, 'POST', '/api/auth/login', { body: { phone: '+86 138-0000-0001', password: 'password123' } });
  assert.equal(login.status, 200);

  const me = await api(srv.base, 'PATCH', '/api/me', { token: login.data.token, body: { about: '忙碌中' } });
  assert.equal(me.data.about, '忙碌中');
  assert.equal((await api(srv.base, 'GET', '/api/me')).status, 401);

  const v = await newUser('+8613800000002', '李四');
  const found = await api(srv.base, 'GET', '/api/users?phone=%2B8613800000002', { token: u.token });
  assert.equal(found.data.id, v.id);
  await api(srv.base, 'POST', '/api/contacts', { token: u.token, body: { userId: v.id, alias: '老李' } });
  const contacts = await api(srv.base, 'GET', '/api/contacts', { token: u.token });
  assert.equal(contacts.data[0].alias, '老李');

  // 公钥包每次取走一个一次性预密钥
  const b1 = await api(srv.base, 'GET', `/api/keys/${v.id}`, { token: u.token });
  const b2 = await api(srv.base, 'GET', `/api/keys/${v.id}`, { token: u.token });
  assert.notEqual(b1.data.oneTimePreKey.keyId, b2.data.oneTimePreKey.keyId);
  assert.equal((await api(srv.base, 'GET', '/api/keys/count', { token: v.token })).data.oneTimePreKeys, 18);

  // 签名错误的密钥包被拒绝
  const bad = v.acc.publicBundle();
  bad.signedPreKey.signature = E.b64e(new Uint8Array(64));
  assert.equal((await api(srv.base, 'PUT', '/api/keys', { token: v.token, body: bad })).status, 400);
});

test('一对一加密聊天：实时投递、回执、离线消息、服务器只见密文', async () => {
  const alice = await newUser('+8613900000001', 'Alice');
  const bob = await newUser('+8613900000002', 'Bob');
  const wa = new WsClient(srv.base, alice.token);
  const wb = new WsClient(srv.base, bob.token);
  await Promise.all([wa.ready, wb.ready]);

  // Alice 建立会话并发送
  await alice.acc.initSession(bob.id, await getBundle(alice)(bob.id));
  const secret = '今晚 8 点老地方见';
  wa.send({ type: 'send', id: 'm1', to: bob.id, envelope: await alice.acc.encrypt(bob.id, { t: 'text', body: secret }) });
  assert.equal((await wa.next((m) => m.type === 'sent' && m.id === 'm1')).id, 'm1');

  const msg = await wb.next((m) => m.type === 'message');
  assert.equal(msg.from, alice.id);
  const { payload } = await bob.acc.decrypt(msg.from, msg.envelope);
  assert.equal(payload.body, secret);

  // 服务器数据库里找不到明文
  const rows = srv.db.prepare('SELECT payload FROM queue').all();
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(!r.payload.includes(secret));

  // Bob 确认收到 -> Alice 收到"已送达"；Bob 已读 -> Alice 收到"已读"
  wb.send({ type: 'ack', qids: [msg.qid] });
  const delivered = await wa.next((m) => m.type === 'receipt' && m.status === 'delivered');
  assert.deepEqual(delivered.msgIds, ['m1']);
  wb.send({ type: 'read', to: alice.id, msgIds: ['m1'] });
  const read = await wa.next((m) => m.type === 'receipt' && m.status === 'read');
  assert.equal(read.from, bob.id);
  wa.send({ type: 'ack', qids: [delivered.qid, read.qid] });

  // 正在输入
  wb.send({ type: 'typing', to: alice.id, state: 'composing' });
  assert.equal((await wa.next((m) => m.type === 'typing')).from, bob.id);

  // Bob 下线，Alice 继续发 -> 上线后补收
  await wb.close();
  await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 3; i++) {
    wa.send({ type: 'send', id: `off${i}`, to: bob.id, envelope: await alice.acc.encrypt(bob.id, { t: 'text', body: `离线${i}` }) });
    await wa.next((m) => m.type === 'sent' && m.id === `off${i}`);
  }
  const wb2 = new WsClient(srv.base, bob.token);
  await wb2.ready;
  const qids = [];
  for (let i = 0; i < 3; i++) {
    const m = await wb2.next((x) => x.type === 'message' && x.id === `off${i}`);
    assert.equal((await bob.acc.decrypt(m.from, m.envelope)).payload.body, `离线${i}`);
    qids.push(m.qid);
  }
  wb2.send({ type: 'ack', qids });
  const d2 = await wa.next((m) => m.type === 'receipt' && m.status === 'delivered' && m.msgIds.length === 3);
  assert.deepEqual(d2.msgIds, ['off0', 'off1', 'off2']);

  // Bob 回复（普通 msg 类型）
  wb2.send({ type: 'send', id: 'r1', to: alice.id, envelope: await bob.acc.encrypt(alice.id, { t: 'text', body: '好的' }) });
  const reply = await wa.next((m) => m.type === 'message' && m.id === 'r1');
  assert.equal(reply.envelope.type, 'msg');
  assert.equal((await alice.acc.decrypt(bob.id, reply.envelope)).payload.body, '好的');

  await wa.close();
  await wb2.close();
});

test('群聊：每个成员单独加密，成员变更通知', async () => {
  const [a, b, c] = await Promise.all([
    newUser('+8613700000001', 'A'), newUser('+8613700000002', 'B'), newUser('+8613700000003', 'C'),
  ]);
  const ws = [a, b, c].map((u) => new WsClient(srv.base, u.token));
  await Promise.all(ws.map((w) => w.ready));

  const g = await api(srv.base, 'POST', '/api/groups', { token: a.token, body: { name: '周末爬山', members: [b.id] } });
  assert.equal(g.status, 201);
  const gid = g.data.id;
  assert.equal((await ws[1].next((m) => m.type === 'group_update' && m.action === 'created')).groupId, gid);

  // 非管理员不能加人
  assert.equal((await api(srv.base, 'POST', `/api/groups/${gid}/members`, { token: b.token, body: { userIds: [c.id] } })).status, 403);
  await api(srv.base, 'POST', `/api/groups/${gid}/members`, { token: a.token, body: { userIds: [c.id] } });
  await ws[2].next((m) => m.type === 'group_update' && m.action === 'members_added');

  // A 发群消息：对 B、C 各加密一份
  const { envelopes } = await E.encryptForMany(a.acc, [b.id, c.id], { t: 'text', body: '早上 7 点集合' }, getBundle(a));
  ws[0].send({ type: 'send_group', id: 'g1', groupId: gid, envelopes });
  const sent = await ws[0].next((m) => m.type === 'sent' && m.id === 'g1');
  assert.deepEqual(sent.missing, []);
  for (const [i, u] of [[1, b], [2, c]]) {
    const m = await ws[i].next((x) => x.type === 'message' && x.groupId === gid);
    assert.equal((await u.acc.decrypt(m.from, m.envelope)).payload.body, '早上 7 点集合');
  }

  // 漏掉一个成员时服务器会告诉发送方
  const partial = await E.encryptForMany(a.acc, [b.id], { t: 'text', body: 'x' }, getBundle(a));
  ws[0].send({ type: 'send_group', id: 'g2', groupId: gid, envelopes: partial.envelopes });
  assert.deepEqual((await ws[0].next((m) => m.type === 'sent' && m.id === 'g2')).missing, [c.id]);

  // C 退群后不能再发群消息
  await api(srv.base, 'DELETE', `/api/groups/${gid}/members/${c.id}`, { token: c.token });
  ws[2].send({ type: 'send_group', id: 'g3', groupId: gid, envelopes: {} });
  assert.match((await ws[2].next((m) => m.type === 'error' && m.ref === 'g3')).message, /不在该群/);

  await Promise.all(ws.map((w) => w.close()));
});

test('加密附件上传下载、屏蔽、身份变更通知', async () => {
  const a = await newUser('+8613600000001', 'A');
  const b = await newUser('+8613600000002', 'B');
  await api(srv.base, 'POST', '/api/contacts', { token: b.token, body: { userId: a.id } });

  const file = new TextEncoder().encode('这是一张照片的二进制数据'.repeat(100));
  const enc = await E.encryptAttachment(file);
  const up = await api(srv.base, 'POST', '/api/media', {
    token: a.token, raw: enc.ciphertext, headers: { 'Content-Type': 'application/octet-stream' },
  });
  assert.equal(up.status, 201);
  const down = await api(srv.base, 'GET', up.data.url, { token: b.token });
  assert.deepEqual(await E.decryptAttachment(down.data, enc.key, enc.sha256), file);
  // 超过大小限制
  const big = await api(srv.base, 'POST', '/api/media', { token: a.token, raw: new Uint8Array(2 * 1024 * 1024) });
  assert.equal(big.status, 413);

  // B 屏蔽 A：A 的消息"已发送"但 B 收不到
  const wb = new WsClient(srv.base, b.token);
  const wa = new WsClient(srv.base, a.token);
  await Promise.all([wa.ready, wb.ready]);
  await api(srv.base, 'POST', '/api/blocks', { token: b.token, body: { userId: a.id } });
  await a.acc.initSession(b.id, await getBundle(a)(b.id));
  wa.send({ type: 'send', id: 'blk', to: b.id, envelope: await a.acc.encrypt(b.id, { t: 'text', body: 'hi' }) });
  await wa.next((m) => m.type === 'sent' && m.id === 'blk');
  await assert.rejects(wb.next((m) => m.type === 'message', 300));

  // A 换设备重新生成身份密钥 -> 把 A 加为联系人的 B 收到 identity_changed
  const newAcc = await E.E2EEAccount.create({ oneTimePreKeys: 5 });
  const r = await api(srv.base, 'PUT', '/api/keys', { token: a.token, body: newAcc.publicBundle() });
  assert.equal(r.data.identityChanged, true);
  const ev = await wb.next((m) => m.type === 'identity_changed');
  assert.equal(ev.userId, a.id);

  await wa.close();
  await wb.close();
});

test('WebSocket 未认证会被断开', async () => {
  const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws');
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: 'send', to: 1 }));
  const code = await new Promise((r) => (ws.onclose = (e) => r(e.code)));
  assert.equal(code, 4000);
});
