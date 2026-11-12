// 登录 / 注册页面
import { h } from './dom.js';
import { icon } from './icons.js';
import { ChatCore } from './core.js';

function lastServer() {
  try {
    return localStorage.getItem('lastServer') || 'http://localhost:3000';
  } catch {
    return 'http://localhost:3000';
  }
}
function rememberServer(s) {
  try {
    localStorage.setItem('lastServer', s);
  } catch {}
}

export function renderLogin(root, { onLoggedIn, reason }) {
  let mode = 'login';
  const server = h('input', { name: 'server', value: lastServer(), placeholder: '例如 http://192.168.1.10:3000', autocomplete: 'off', spellcheck: false });
  const phone = h('input', { name: 'phone', type: 'tel', placeholder: '+86 138 0000 0000', autocomplete: 'username' });
  const name = h('input', { name: 'name', placeholder: '别人看到的名字', maxLength: 50 });
  const password = h('input', { name: 'password', type: 'password', placeholder: '至少 8 位', autocomplete: 'current-password' });
  const backupFile = h('input', { type: 'file', accept: '.json,application/json' });
  const backupPass = h('input', { type: 'password', placeholder: '备份口令', autocomplete: 'off' });
  const err = h('div', { class: 'form-error' }, reason || '');
  const submit = h('button', { class: 'btn', type: 'submit' }, '登录');
  const nameField = h('div', { class: 'field hidden' }, h('label', {}, '昵称'), name);
  const tabLogin = h('button', { type: 'button', class: 'active', onClick: () => setMode('login') }, '登录');
  const tabReg = h('button', { type: 'button', onClick: () => setMode('register') }, '注册');

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabReg.classList.toggle('active', m === 'register');
    nameField.classList.toggle('hidden', m !== 'register');
    submit.textContent = m === 'login' ? '登录' : '注册';
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  }

  const form = h('form', { class: 'login-form', onSubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!phone.value.trim()) return (err.textContent = '请输入手机号');
    if (password.value.length < 8) return (err.textContent = '密码至少 8 位');
    if (mode === 'register' && !name.value.trim()) return (err.textContent = '请输入昵称');
    let backup = null;
    if (backupFile.files[0]) {
      try {
        backup = { data: JSON.parse(await backupFile.files[0].text()), passphrase: backupPass.value };
      } catch {
        return (err.textContent = '备份文件格式不正确');
      }
    }
    submit.disabled = true;
    submit.textContent = mode === 'login' ? '正在登录…' : '正在注册…';
    try {
      const core = await ChatCore.login({
        server: server.value, phone: phone.value, password: password.value, name: name.value, register: mode === 'register', backup,
      });
      rememberServer(core.api.server);
      onLoggedIn(core);
    } catch (e2) {
      console.error(e2);
      err.textContent = e2.message || '登录失败';
      submit.disabled = false;
      submit.textContent = mode === 'login' ? '登录' : '注册';
    }
  } },
    h('div', { class: 'tabs' }, tabLogin, tabReg),
    h('div', { class: 'field' }, h('label', {}, '服务器地址'), server),
    h('div', { class: 'field' }, h('label', {}, '手机号'), phone),
    nameField,
    h('div', { class: 'field' }, h('label', {}, '密码'), password),
    h('details', { class: 'restore' },
      h('summary', {}, '从密钥备份恢复（换电脑时使用）'),
      h('div', { class: 'field' }, h('label', {}, '备份文件'), backupFile),
      h('div', { class: 'field' }, h('label', {}, '备份口令'), backupPass),
      h('div', { class: 'hint' }, '恢复后联系人不会看到"安全码已更改"。本机已有该账号的密钥时会忽略备份。')
    ),
    err,
    submit
  );

  root.replaceChildren(
    h('div', { class: 'login' },
      h('div', { class: 'login-inner' },
        h('div', { class: 'login-brand' }, h('div', { class: 'logo' }), 'SECURECHAT'),
        h('div', { class: 'login-card' },
          h('div', {},
            h('h1', {}, '在电脑上使用 SecureChat'),
            h('ol', { class: 'login-steps' },
              h('li', {}, '填写你的', h('b', {}, '聊天服务器地址'), '（问服务器管理员要）'),
              h('li', {}, '已有账号直接', h('b', {}, '登录'), '，没有就先', h('b', {}, '注册')),
              h('li', {}, '加密密钥会在', h('b', {}, '本机自动生成'), '，并用 Windows 账户加密保存')
            ),
            h('div', { class: 'login-note' }, icon('lock', 18),
              h('span', {}, '你的私人消息使用端到端加密。服务器只能看到无法读取的密文，私钥永远不会离开这台电脑。'))
          ),
          form
        )
      )
    )
  );
  (server.value ? phone : server).focus();
}
