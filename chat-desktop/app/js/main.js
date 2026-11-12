// 启动入口
import { ChatCore } from './core.js';
import { renderLogin } from './login.js';
import { MainView, applyTheme, themePref } from './main-view.js';

const root = document.getElementById('app');
applyTheme(themePref());

function showLogin(reason) {
  renderLogin(root, { reason, onLoggedIn: showMain });
}

function showMain(core) {
  const view = new MainView(root, core);
  globalThis.__chat = { core, view }; // 便于调试（Ctrl+Shift+I）
  core.addEventListener('logout', (e) => {
    view.destroy();
    showLogin(e.detail?.reason);
  }, { once: true });
}

(async () => {
  let core = null;
  try {
    core = await ChatCore.restore();
  } catch (e) {
    console.error('restore failed', e);
  }
  if (core) showMain(core);
  else showLogin();
})();
