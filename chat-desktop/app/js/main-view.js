// 主界面：左侧导航栏 + 会话列表 + 聊天窗口 + 右侧信息面板
import {
  h, add, iconBtn, toast, showMenu, closeMenu, showModal, confirmDialog, formDialog, hhmm, listTime, dayLabel, sameDay,
  lastSeenText, formatSize, linkify, isOnlyEmoji, colorFor, avatarEl, pickFile, saveBlobAs, animateOut, reducedMotion,
} from './dom.js';
import { icon, ticks } from './icons.js';
import { EMOJI } from './emoji.js';
import { previewOf } from './core.js';
import { setBadge, notify, secureInfo, isDesktop } from './platform.js';

const PAGE = 60;

// 两条消息除发送状态外是否相同
function sameContent(a, b) {
  return a.type === b.type && a.body === b.body && a.caption === b.caption && a.media?.id === b.media?.id && a.replyTo?.id === b.replyTo?.id;
}

// "正在输入"后面跳动的三个点
const typingDots = () => h('span', { class: 'typing-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

export function applyTheme(pref) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const resolved = pref === 'dark' || (pref !== 'light' && mq.matches) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
}
export function themePref() {
  try {
    return localStorage.getItem('theme') || 'system';
  } catch {
    return 'system';
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref()));

export class MainView {
  constructor(root, core) {
    this.root = root;
    this.core = core;
    this.current = null; // 当前打开的会话 id
    this.filter = 'all';
    this.search = '';
    this.msgs = [];
    this.msgNodes = new Map();
    this.typing = new Map(); // chatId -> { from, until }
    this.replyTo = null;
    this.infoOpen = false;
    this.hasMore = false;
    this.unsub = [];
    this.build();
    this.bind();
  }

  on(type, fn) {
    this.core.addEventListener(type, fn);
    this.unsub.push(() => this.core.removeEventListener(type, fn));
  }

  destroy() {
    for (const u of this.unsub) u();
    clearInterval(this.typingTimer);
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('focus', this.onFocus);
    closeMenu();
    setBadge(0);
  }

  // ================================================================ 布局
  build() {
    this.rail = h('nav', { class: 'rail' });
    this.sidebar = h('aside', { class: 'sidebar' });
    this.conv = h('main', { class: 'conversation' });
    this.info = h('aside', { class: 'info-panel', 'aria-hidden': 'true' });
    this.layoutEl = h('div', { class: 'layout' }, this.rail, this.sidebar, this.conv, this.info);
    this.root.replaceChildren(this.layoutEl);
    this.renderRail();
    this.renderSidebar();
    this.renderEmpty();
  }

  bind() {
    const rerenderList = () => {
      cancelAnimationFrame(this.listRaf);
      this.listRaf = requestAnimationFrame(() => {
        this.renderChatList();
        this.renderRailBadge();
        setBadge(this.core.totalUnread());
        if (this.current) {
          this.renderHeader();
          if (!!this.textarea !== this.core.canSend(this.current)) this.renderComposer();
        }
        if (this.infoOpen) this.renderInfo();
      });
    };
    this.on('chats', rerenderList);
    this.on('me', () => {
      this.renderRail();
      rerenderList();
    });
    this.on('conn', () => this.renderConnBanner());
    this.on('toast', (e) => toast(e.detail.text));
    this.on('message', (e) => {
      if (e.detail.chatId === this.current) this.upsertMessage(e.detail.msg);
    });
    this.on('reload', (e) => {
      if (e.detail.chatId === this.current) this.loadMessages();
    });
    this.on('incoming', (e) => this.onIncoming(e.detail));
    this.on('typing', (e) => {
      const { chatId, from, state } = e.detail;
      if (state === 'paused') this.typing.delete(chatId);
      else this.typing.set(chatId, { from, state, until: Date.now() + 6000 });
      rerenderList();
    });
    this.on('presence', () => {
      if (this.current) this.renderHeader();
    });
    this.on('group', rerenderList);

    this.typingTimer = setInterval(() => {
      let changed = false;
      for (const [k, v] of this.typing) {
        if (v.until < Date.now()) {
          this.typing.delete(k);
          changed = true;
        }
      }
      if (changed) rerenderList();
    }, 1000);

    this.onKey = (e) => {
      if (e.key === 'Escape') {
        if (this.emojiPop) return this.closeEmoji();
        if (this.replyTo) return this.setReply(null);
        if (this.openPanel) return this.closePanel();
        if (this.infoOpen) return this.toggleInfo(false);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.panelNewChat();
      }
    };
    document.addEventListener('keydown', this.onKey);
    this.onFocus = () => {
      if (this.current) this.core.markRead(this.current);
    };
    window.addEventListener('focus', this.onFocus);
    setBadge(this.core.totalUnread());
  }

  // ================================================================ 左侧导航栏
  renderRail() {
    const me = this.core.me;
    this.railChats = h('button', { class: 'icon-btn active', title: '聊天', onClick: () => this.closePanel() }, icon('chats'));
    this.rail.replaceChildren(
      this.railChats,
      h('div', { class: 'spacer' }),
      iconBtn('settings', '设置', () => this.panelSettings()),
      h('div', { title: '个人资料', onClick: () => this.panelProfile() }, avatarEl(this.core.api.avatarUrl(me.avatar), { size: 32 }))
    );
    this.renderRailBadge();
  }
  renderRailBadge() {
    this.railChats?.querySelector('.rail-badge')?.remove();
    const n = this.core.totalUnread();
    if (n) this.railChats.append(h('span', { class: 'rail-badge' }, n > 99 ? '99+' : n));
  }

  // ================================================================ 会话列表
  renderSidebar() {
    this.connBanner = h('div');
    this.listEl = h('div', { class: 'chat-list' });
    const searchInput = h('input', {
      placeholder: '搜索或开始新的聊天',
      onInput: (e) => {
        this.search = e.target.value.trim().toLowerCase();
        this.renderChatList();
      },
    });
    const chips = [['all', '全部'], ['unread', '未读'], ['groups', '群组']].map(([k, label]) =>
      h('button', {
        class: `chip ${this.filter === k ? 'active' : ''}`,
        type: 'button',
        onClick: (e) => {
          this.filter = k;
          for (const c of e.currentTarget.parentNode.children) c.classList.toggle('active', c === e.currentTarget);
          this.renderChatList();
        },
      }, label)
    );
    const moreBtn = iconBtn('more', '菜单', () =>
      showMenu(moreBtn, [
        { label: '新建群组', icon: 'group', onClick: () => this.panelNewGroup() },
        { label: '个人资料', icon: 'person', onClick: () => this.panelProfile() },
        { label: '设置', icon: 'settings', onClick: () => this.panelSettings() },
        { label: '退出登录', icon: 'logout', onClick: () => this.logout() },
      ])
    );
    this.sidebar.replaceChildren(
      h('div', { class: 'side-header' }, h('h2', {}, '聊天'), iconBtn('newchat', '新的聊天 (Ctrl+N)', () => this.panelNewChat()), moreBtn),
      this.connBanner,
      h('div', { class: 'searchbar' }, h('label', { class: 'searchbox' }, icon('search', 20), searchInput)),
      h('div', { class: 'chips' }, chips),
      this.listEl
    );
    this.renderConnBanner();
    this.renderChatList();
  }

  renderConnBanner() {
    const st = this.core.connState;
    if (st === 'online') return this.connBanner.replaceChildren();
    this.connBanner.replaceChildren(
      h('div', { class: 'conn-banner' },
        icon('alert', 20),
        h('span', {}, st === 'connecting' ? '正在连接服务器…' : '未连接到服务器，消息会在连上后自动发送'),
        st === 'offline' ? h('button', { class: 'link', onClick: () => this.core.reconnectNow() }, '立即重试') : null
      )
    );
  }

  chatAvatar(chat, size = 49) {
    if (chat.type === 'group') return avatarEl(null, { size, kind: 'group', seed: chat.groupId * 7 + 3 });
    const u = this.core.users.get(chat.peerId);
    return avatarEl(this.core.api.avatarUrl(u?.avatar), { size, seed: u?.avatar ? 0 : chat.peerId });
  }

  typingText(chatId) {
    const t = this.typing.get(chatId);
    if (!t) return null;
    const verb = t.state === 'recording' ? '正在录音' : '正在输入';
    return chatId.startsWith('g:') ? `${this.core.displayName(t.from)} ${verb}` : verb;
  }

  // 会话列表：按 id 复用 DOM 节点，只重建内容变化的行；顺序变化时用 FLIP 动画平滑移动
  renderChatList() {
    const q = this.search;
    let chats = this.core.sortedChats();
    if (this.filter === 'unread') chats = chats.filter((c) => c.unread);
    if (this.filter === 'groups') chats = chats.filter((c) => c.type === 'group');
    if (q) chats = chats.filter((c) => this.core.chatTitle(c).toLowerCase().includes(q) || (c.lastMsg?.text || '').toLowerCase().includes(q));
    this.chatEls = this.chatEls || new Map();

    if (!chats.length) {
      this.chatEls.clear();
      this.listEl.replaceChildren(h('div', { class: 'list-empty fade-in' },
        q || this.filter !== 'all' ? '没有找到聊天' : h('span', {}, '还没有聊天。', h('br'), h('button', { class: 'link', onClick: () => this.panelNewChat() }, '开始新的聊天'))));
      return;
    }
    this.listEl.querySelector(':scope > .list-empty')?.remove();

    // FLIP 第一步：记录旧位置
    const animate = !reducedMotion() && this.listEl.isConnected && chats.length <= 300;
    const oldTops = new Map();
    if (animate) for (const [id, rec] of this.chatEls) if (rec.el.isConnected) oldTops.set(id, rec.el.getBoundingClientRect().top);

    const next = new Map();
    const els = chats.map((chat) => {
      const sig = this.chatSig(chat);
      const prev = this.chatEls.get(chat.id);
      let el;
      if (prev && prev.sig === sig) el = prev.el;
      else {
        el = this.chatItemEl(chat);
        if (prev) {
          prev.el.replaceWith(el);
          if ((chat.unread || 0) > (prev.unread || 0)) el.querySelector('.badge')?.classList.add('pop');
        } else if (animate && this.chatEls.size) el.classList.add('enter');
      }
      el.classList.toggle('active', chat.id === this.current);
      next.set(chat.id, { el, sig, unread: chat.unread || 0 });
      return el;
    });
    // 移除不再显示的行
    for (const [id, rec] of this.chatEls) if (!next.has(id)) rec.el.remove();
    // 按新顺序排列（只移动需要移动的节点，不打乱滚动位置）
    els.forEach((el, i) => {
      if (this.listEl.children[i] !== el) this.listEl.insertBefore(el, this.listEl.children[i] || null);
    });
    while (this.listEl.children.length > els.length) this.listEl.lastChild.remove();
    this.chatEls = next;

    // FLIP 第二步：从旧位置平滑移动到新位置
    if (animate && oldTops.size) {
      const moved = [];
      for (const [id, rec] of next) {
        const before = oldTops.get(id);
        if (before === undefined) continue;
        const dy = before - rec.el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) continue;
        rec.el.style.transition = 'none';
        rec.el.style.transform = `translateY(${dy}px)`;
        moved.push(rec.el);
      }
      if (moved.length) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          for (const el of moved) {
            el.style.transition = '';
            el.style.transform = '';
          }
        }));
      }
    }
  }

  chatSig(chat) {
    const last = chat.lastMsg;
    const u = chat.type === 'direct' ? this.core.users.get(chat.peerId) : null;
    return JSON.stringify([
      this.core.chatTitle(chat), last?.id, last?.ts, last?.text, last?.status, last?.from, chat.unread || 0,
      this.typingText(chat.id), u?.avatar, chat.updatedAt, chat.left,
    ]);
  }

  chatItemEl(chat) {
    const last = chat.lastMsg;
    const typing = this.typingText(chat.id);
    let preview;
    if (typing) preview = h('div', { class: 'preview typing' }, typing, typingDots());
    else {
      const prefix = last && chat.type === 'group' && !last.mine && last.type !== 'system' && last.from ? `${this.core.displayName(last.from)}: ` : '';
      preview = h('div', { class: 'preview' },
        last?.mine && last.type !== 'deleted' ? ticks(last.status || 'sent') : null,
        h('span', { class: 'ptext' }, last ? prefix + last.text : chat.type === 'group' ? '群组已创建' : '开始聊天吧')
      );
    }
    return h('div', {
      class: `chat-item ${chat.unread ? 'unread' : ''}`,
      dataset: { chat: chat.id },
      onClick: () => this.openChat(chat.id),
      onContextmenu: (e) => {
        e.preventDefault();
        this.chatContextMenu(chat, { x: e.clientX, y: e.clientY });
      },
    },
      this.chatAvatar(chat),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('div', { class: 'name' }, this.core.chatTitle(chat)), h('div', { class: 'time' }, listTime(last?.ts || chat.updatedAt))),
        h('div', { class: 'row' }, preview, chat.unread ? h('div', { class: 'badge' }, chat.unread) : null)
      )
    );
  }

  chatContextMenu(chat, at) {
    showMenu(at, [
      chat.unread
        ? { label: '标为已读', icon: 'check', onClick: () => this.core.markRead(chat.id) }
        : null,
      { label: '清空聊天记录', icon: 'trash', onClick: () => this.clearChat(chat.id) },
      { label: '删除聊天', icon: 'trash', danger: true, onClick: () => this.deleteChat(chat.id) },
    ], { align: 'left' });
  }

  async clearChat(chatId) {
    if (await confirmDialog('清空聊天记录？', '本机上该聊天的所有消息都会被删除，无法恢复。', '清空', true)) await this.core.clearChat(chatId);
  }
  async deleteChat(chatId) {
    if (!(await confirmDialog('删除此聊天？', '本机上该聊天的所有消息都会被删除。', '删除', true))) return;
    if (this.current === chatId) {
      this.current = null;
      this.core.setActiveChat(null);
      this.renderEmpty();
      this.toggleInfo(false);
    }
    await this.core.deleteChat(chatId);
  }

  // ================================================================ 聊天窗口
  renderEmpty() {
    this.conv.replaceChildren(
      h('div', { class: 'empty-state' },
        h('div', { class: 'es-logo' }),
        h('h1', {}, 'SecureChat 桌面版'),
        h('p', {}, '在电脑上收发消息。选择左侧的聊天，或者点击 ', h('button', { class: 'link', onClick: () => this.panelNewChat() }, '新的聊天'), '。'),
        h('div', { class: 'es-foot' }, icon('lock', 14), '你的个人消息已进行端到端加密')
      )
    );
  }

  async openChat(chatId) {
    if (!this.core.chats.has(chatId)) return;
    this.closePanel();
    if (this.current === chatId) {
      this.textarea?.focus();
      return;
    }
    this.current = chatId;
    this.core.setActiveChat(chatId);
    this.setReply(null, false);
    this.closeEmoji();
    for (const el of this.listEl.querySelectorAll('.chat-item')) el.classList.toggle('active', el.dataset.chat === chatId);
    this.renderConversation();
    await this.loadMessages();
    if (this.current === chatId) this.core.markRead(chatId);
    if (this.infoOpen) this.renderInfo();
  }

  renderConversation() {
    this.header = h('header', { class: 'conv-header' });
    this.msgList = h('div', { class: 'messages fade-in', onScroll: () => this.onScroll() });
    this.scrollBtn = h('button', { class: 'scroll-down', title: '滚动到底部', onClick: () => this.scrollToBottom(true) }, icon('chevron'));
    this.composerWrap = h('div', { class: 'composer-wrap' });
    this.conv.replaceChildren(this.header, this.msgList, this.scrollBtn, this.composerWrap);
    this.renderHeader();
    this.renderComposer();
    this.setupDrop();
  }

  renderHeader() {
    const chat = this.core.chats.get(this.current);
    if (!chat || !this.header) return;
    let sub = '';
    const typing = this.typingText(chat.id);
    if (typing) sub = typing;
    else if (chat.type === 'group') {
      const g = this.core.groups.get(chat.groupId);
      sub = chat.left ? '你已不在此群组中' : g ? g.members.map((m) => (m.id === this.core.me.id ? '你' : this.core.displayName(m.id))).join('、') : '';
    } else {
      sub = lastSeenText(this.core.presence.get(chat.peerId)) || '点击这里查看联系人信息';
    }
    const menuBtn = iconBtn('more', '菜单', () =>
      showMenu(menuBtn, [
        { label: chat.type === 'group' ? '群组信息' : '联系人信息', icon: 'info', onClick: () => this.toggleInfo(true) },
        { label: '清空聊天记录', icon: 'trash', onClick: () => this.clearChat(chat.id) },
        { label: '删除聊天', icon: 'trash', danger: true, onClick: () => this.deleteChat(chat.id) },
      ])
    );
    this.header.replaceChildren(
      h('div', { style: { cursor: 'pointer' }, onClick: () => this.toggleInfo() }, this.chatAvatar(chat, 40)),
      h('div', { class: 'who', onClick: () => this.toggleInfo() },
        h('div', { class: 'title' }, this.core.chatTitle(chat)),
        sub ? h('div', { class: `subtitle ${typing ? 'typing' : ''}` }, sub, typing ? typingDots() : null) : null
      ),
      menuBtn
    );
  }

  // ---------------------------------------------------------------- 消息列表
  async loadMessages() {
    const chatId = this.current;
    const msgs = await this.core.db.messages(chatId, PAGE);
    if (chatId !== this.current) return;
    this.msgs = msgs;
    this.hasMore = msgs.length === PAGE;
    this.renderAllMessages();
    this.scrollToBottom();
  }

  async loadOlder() {
    if (!this.hasMore || this.loadingOlder || !this.msgs.length) return;
    this.loadingOlder = true;
    const chatId = this.current;
    const older = await this.core.db.messages(chatId, PAGE, this.msgs[0].ts);
    this.loadingOlder = false;
    if (chatId !== this.current) return;
    const seen = new Set(this.msgs.map((m) => m.id));
    const add2 = older.filter((m) => !seen.has(m.id));
    this.hasMore = older.length === PAGE;
    if (!add2.length) return;
    const prevH = this.msgList.scrollHeight;
    const prevTop = this.msgList.scrollTop;
    this.msgs = [...add2, ...this.msgs];
    this.renderAllMessages();
    this.msgList.scrollTop = this.msgList.scrollHeight - prevH + prevTop;
  }

  renderAllMessages() {
    const chat = this.core.chats.get(this.current);
    this.msgNodes.clear();
    const nodes = [];
    if (!this.hasMore) {
      nodes.push(h('div', { class: 'e2e-notice', onClick: () => this.encryptionInfo(chat) },
        icon('lock', 13),
        '消息和通话已进行端到端加密。聊天以外的任何人（包括服务器）都无法读取。点击了解详情。'));
    } else nodes.push(h('div', { class: 'load-more' }, '向上滚动加载更早的消息'));
    let prev = null;
    for (const m of this.msgs) {
      if (!prev || !sameDay(prev.ts, m.ts)) nodes.push(h('div', { class: 'day-sep' }, h('span', {}, dayLabel(m.ts))));
      const node = this.msgNode(m, prev);
      this.msgNodes.set(m.id, node);
      nodes.push(node);
      prev = m;
    }
    this.msgList.replaceChildren(...nodes);
  }

  upsertMessage(msg) {
    const idx = this.msgs.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      const before = this.msgs[idx];
      this.msgs[idx] = msg;
      const old = this.msgNodes.get(msg.id);
      // 只有发送状态变了（✓ → ✓✓ → 蓝色）：原地替换勾号并播放一个小动画，不重建整条消息
      if (old && sameContent(before, msg)) {
        if ((before.status || 'sent') !== (msg.status || 'sent')) {
          const tick = old.querySelector('.meta .tick');
          if (tick) {
            const t = ticks(msg.status || 'sent');
            t.classList.add('tick-pop');
            tick.replaceWith(t);
          }
        }
        return;
      }
      const node = this.msgNode(msg, this.msgs[idx - 1] || null);
      this.msgNodes.set(msg.id, node);
      old?.replaceWith(node);
      return;
    }
    const last = this.msgs[this.msgs.length - 1];
    if (last && msg.ts < last.ts) {
      this.msgs.push(msg);
      this.msgs.sort((a, b) => a.ts - b.ts);
      this.renderAllMessages();
      return;
    }
    const nearBottom = this.msgList.scrollHeight - this.msgList.scrollTop - this.msgList.clientHeight < 120;
    this.msgs.push(msg);
    if (!last || !sameDay(last.ts, msg.ts)) this.msgList.append(h('div', { class: 'day-sep' }, h('span', {}, dayLabel(msg.ts))));
    const node = this.msgNode(msg, last || null);
    node.classList.add('enter'); // 新消息入场动画
    this.msgNodes.set(msg.id, node);
    this.msgList.append(node);
    if (msg.mine || nearBottom) this.scrollToBottom(true);
    else {
      this.newBelow = (this.newBelow || 0) + 1;
      this.updateScrollBtn();
    }
  }

  msgNode(m, prev) {
    if (m.type === 'system') return h('div', { class: 'sys-msg', dataset: { id: m.id } }, h('span', {}, m.body));
    const chat = this.core.chats.get(m.chatId);
    const isGroup = chat?.type === 'group';
    const first = !prev || prev.type === 'system' || prev.from !== m.from || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > 10 * 60000;
    const row = h('div', { class: `msg-row ${m.mine ? 'out' : 'in'} ${first ? 'first' : ''}`, dataset: { id: m.id } });
    const bubble = h('div', { class: `bubble ${m.type}` });
    if (isGroup && !m.mine && first) bubble.append(h('div', { class: 'sender', style: { color: colorFor(m.from) } }, this.core.displayName(m.from)));
    if (m.replyTo && m.type !== 'deleted') {
      bubble.append(h('div', { class: 'quote', onClick: () => this.jumpTo(m.replyTo.id) },
        h('div', { class: 'q-name', style: { color: m.replyTo.from === this.core.me.id ? '#06cf9c' : colorFor(m.replyTo.from) } }, this.core.displayName(m.replyTo.from)),
        h('div', { class: 'q-text' }, m.replyTo.text)));
    }
    const meta = h('span', { class: 'meta' }, hhmm(m.ts), m.mine && m.type !== 'deleted' ? ticks(m.status || 'sent') : null);
    if (m.type === 'text') {
      bubble.append(h('div', { class: `text ${isOnlyEmoji(m.body) ? 'big-emoji' : ''}` }, linkify(m.body), meta));
    } else if (m.type === 'image') {
      bubble.append(this.imageNode(m));
      bubble.append(h('div', { class: 'text caption' }, m.caption ? linkify(m.caption) : null, meta));
    } else if (m.type === 'file') {
      bubble.append(this.fileNode(m));
      bubble.append(h('div', { class: 'text caption' }, m.caption ? linkify(m.caption) : null, meta));
    } else if (m.type === 'deleted') {
      bubble.append(h('div', { class: 'text' }, icon('block', 16), m.mine ? '你删除了此消息' : '此消息已删除', meta));
    } else if (m.type === 'undecryptable') {
      bubble.append(h('div', { class: 'text', title: '可能是对方换了设备或会话已重置。请让对方重新发送。' }, icon('alert', 16), '无法解密此消息', meta));
    }
    if (m.type !== 'deleted') {
      const btn = h('button', { class: 'msg-menu-btn', type: 'button', title: '菜单' }, icon('chevron', 20));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.classList.add('open');
        this.messageMenu(m, btn, () => btn.classList.remove('open'));
      });
      bubble.append(btn);
      bubble.addEventListener('contextmenu', (e) => {
        if (window.getSelection()?.toString()) return; // 允许复制选中文字
        e.preventDefault();
        this.messageMenu(m, { x: e.clientX, y: e.clientY });
      });
      bubble.addEventListener('dblclick', (e) => {
        if (e.target.closest('.media-img, .file-card, a')) return;
        this.setReply(m);
      });
    }
    row.append(bubble);
    return row;
  }

  imageNode(m) {
    const media = m.media || {};
    const ratio = media.w && media.h ? Math.min(1.4, Math.max(0.5, media.h / media.w)) : 0.75;
    const width = Math.min(330, media.w || 330);
    const img = h('img', { src: m.thumb || '', alt: '', class: 'blur', draggable: 'false', style: { width: `${width}px`, height: `${Math.round(width * ratio)}px` } });
    const loading = h('div', { class: 'media-loading' });
    const box = h('div', { class: 'media-img', style: { width: `${width}px` }, onClick: () => this.viewImage(m) }, img, loading);
    const load = () => {
      loading.replaceChildren(h('span', {}, icon('download', 16), '正在加载…'));
      this.core.mediaUrl(media).then((url) => {
        img.src = url;
        img.classList.remove('blur');
        loading.replaceChildren();
      }).catch((e) => {
        loading.replaceChildren(h('span', {}, icon('alert', 16), e.status === 404 ? '图片已过期' : '加载失败，点击重试'));
        box.onclick = (ev) => {
          ev.stopPropagation();
          box.onclick = null;
          load();
        };
      });
    };
    if ((media.size || 0) < 15 * 1024 * 1024) load();
    else loading.replaceChildren(h('span', {}, icon('download', 16), formatSize(media.size)));
    return box;
  }

  fileNode(m) {
    const media = m.media || {};
    const ext = (media.name || '').split('.').pop().slice(0, 4) || 'file';
    return h('div', { class: 'file-card' },
      h('div', { class: 'ficon' }, ext),
      h('div', { class: 'fbody' }, h('div', { class: 'fname', title: media.name }, media.name || '文件'), h('div', { class: 'fsize' }, `${formatSize(media.size || 0)} · ${ext.toUpperCase()}`)),
      iconBtn('download', '下载', () => this.downloadMedia(m), { size: 20 })
    );
  }

  async downloadMedia(m) {
    try {
      toast('正在下载并解密…', 1500);
      saveBlobAs(await this.core.mediaUrl(m.media), m.media.name || (m.type === 'image' ? 'image.jpg' : 'file'));
    } catch (e) {
      toast(e.status === 404 ? '文件已从服务器过期删除' : `下载失败：${e.message}`);
    }
  }

  async viewImage(m) {
    let url;
    try {
      url = await this.core.mediaUrl(m.media);
    } catch {
      return;
    }
    const close = () => {
      animateOut(v, 180);
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const v = h('div', { class: 'viewer', onClick: (e) => { if (e.target === v || e.target.classList.contains('viewer-img')) close(); } },
      h('div', { class: 'viewer-bar' },
        h('div', { class: 'vb-title' }, `${this.core.displayName(m.from)} · ${dayLabel(m.ts)} ${hhmm(m.ts)}`),
        iconBtn('download', '保存', () => saveBlobAs(url, m.media.name || 'image.jpg')),
        iconBtn('close', '关闭', close)),
      h('div', { class: 'viewer-img' }, h('img', { src: url, alt: '' })));
    document.getElementById('overlay-root').append(v);
  }

  messageMenu(m, anchor, onClose) {
    m = this.msgs.find((x) => x.id === m.id) || m; // 状态可能已原地更新过，取最新的
    const canSend = this.core.canSend(m.chatId);
    const items = [
      canSend && m.type !== 'undecryptable' ? { label: '回复', icon: 'reply', onClick: () => this.setReply(m) } : null,
      m.type === 'text' ? { label: '复制', icon: 'copy', onClick: () => navigator.clipboard.writeText(m.body).then(() => toast('已复制')) } : null,
      m.type === 'image' || m.type === 'file' ? { label: '下载', icon: 'download', onClick: () => this.downloadMedia(m) } : null,
      m.mine && m.status !== 'pending' && m.status !== 'failed' && canSend
        ? { label: '对所有人删除', icon: 'trash', danger: true, onClick: () => this.deleteForEveryone(m) } : null,
      { label: '为我删除', icon: 'trash', danger: true, onClick: () => this.core.deleteMessage(m, false) },
    ];
    showMenu(anchor, items, { onClose, align: m.mine ? 'right' : 'left' });
  }

  async deleteForEveryone(m) {
    if (await confirmDialog('对所有人删除？', '对方设备上的这条消息也会被替换为"此消息已删除"。', '删除', true)) {
      await this.core.deleteMessage(m, true);
    }
  }

  jumpTo(id) {
    const node = this.msgNodes.get(id);
    if (!node) return toast('原消息不在已加载的记录中');
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  onScroll() {
    if (this.msgList.scrollTop < 80) this.loadOlder();
    this.updateScrollBtn();
  }
  updateScrollBtn() {
    const dist = this.msgList.scrollHeight - this.msgList.scrollTop - this.msgList.clientHeight;
    if (dist < 60) this.newBelow = 0;
    this.scrollBtn.classList.toggle('show', dist >= 200 || !!this.newBelow);
    this.scrollBtn.querySelector('.sd-badge')?.remove();
    if (this.newBelow) this.scrollBtn.append(h('span', { class: 'sd-badge' }, this.newBelow));
  }
  scrollToBottom(smooth = false) {
    requestAnimationFrame(() => {
      this.msgList.scrollTo({ top: this.msgList.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      this.newBelow = 0;
      this.updateScrollBtn();
    });
  }

  // ---------------------------------------------------------------- 输入区
  renderComposer() {
    const chat = this.core.chats.get(this.current);
    if (!this.core.canSend(this.current)) {
      const blocked = chat.type === 'direct' && this.core.blocked.has(chat.peerId);
      this.textarea = null;
      this.composerWrap.replaceChildren(h('div', { class: 'composer-blocked' },
        blocked
          ? h('span', {}, '你已屏蔽此联系人。', h('button', { class: 'link', onClick: () => this.core.setBlocked(chat.peerId, false).then(() => this.renderComposer()) }, '解除屏蔽'), '后才能发送消息。')
          : '你已不在此群组中，无法发送消息。'));
      return;
    }
    this.replyBar = h('div', { class: 'reply-bar' });
    const ta = h('textarea', { rows: 1, placeholder: '输入消息', spellcheck: false });
    this.textarea = ta;
    const sendBtn = iconBtn('send', '发送', () => this.sendCurrent(), { class: 'send-btn' });
    const emojiBtn = iconBtn('emoji', '表情', () => this.toggleEmoji(emojiBtn));
    const attachBtn = iconBtn('plus', '附件', () =>
      showMenu(attachBtn, [
        { label: '照片', icon: 'image', onClick: async () => { const f = await pickFile({ accept: 'image/*' }); if (f) this.confirmSendFile(f); } },
        { label: '文件', icon: 'file', onClick: async () => { const f = await pickFile(); if (f) this.confirmSendFile(f); } },
      ], { align: 'left' })
    );
    const syncSend = () => sendBtn.classList.toggle('ready', ta.value.trim().length > 0);
    this.syncSend = syncSend;
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
      syncSend();
      if (ta.value) this.onTypingInput();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && this.core.settings.enterToSend) {
        e.preventDefault();
        this.sendCurrent();
      }
    });
    ta.addEventListener('paste', (e) => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) {
        e.preventDefault();
        this.confirmSendFile(file);
      }
    });
    this.composerWrap.replaceChildren(
      this.replyBar,
      h('div', { class: 'composer' }, emojiBtn, attachBtn, h('div', { class: 'input-box' }, ta), sendBtn)
    );
    const draft = this.drafts?.get(this.current);
    if (draft) ta.value = draft;
    syncSend();
    setTimeout(() => ta.focus(), 0);
    ta.addEventListener('blur', () => {
      this.drafts = this.drafts || new Map();
      this.drafts.set(this.current, ta.value);
    });
  }

  onTypingInput() {
    const now = Date.now();
    if (!this.lastTypingSent || now - this.lastTypingSent > 3000) {
      this.core.sendTyping(this.current, 'composing');
      this.lastTypingSent = now;
    }
    clearTimeout(this.typingStop);
    const chatId = this.current;
    this.typingStop = setTimeout(() => {
      this.core.sendTyping(chatId, 'paused');
      this.lastTypingSent = 0;
    }, 4000);
  }

  async sendCurrent() {
    const ta = this.textarea;
    if (!ta) return;
    const text = ta.value;
    if (!text.trim()) return;
    ta.value = '';
    ta.style.height = 'auto';
    this.syncSend?.();
    this.drafts?.delete(this.current);
    clearTimeout(this.typingStop);
    this.core.sendTyping(this.current, 'paused');
    this.lastTypingSent = 0;
    const reply = this.replyTo;
    this.setReply(null);
    try {
      await this.core.sendText(this.current, text, reply);
    } catch (e) {
      toast(`发送失败：${e.message}`);
    }
    ta.focus();
  }

  setReply(m, focus = true) {
    this.replyTo = m;
    if (!this.replyBar) return;
    this.replyBar.classList.toggle('open', !!m);
    if (m) {
      this.replyBar.replaceChildren(h('div', { class: 'rb-inner' }, h('div', { class: 'rb-row' },
        h('div', { class: 'quote' },
          h('div', { class: 'q-name', style: { color: m.mine ? '#06cf9c' : colorFor(m.from) } }, this.core.displayName(m.from)),
          h('div', { class: 'q-text' }, previewOf(m))),
        iconBtn('close', '取消回复', () => this.setReply(null)))));
      if (focus) this.textarea?.focus();
    }
  }

  toggleEmoji(anchor) {
    if (this.emojiPop) return this.closeEmoji();
    let cat = 0;
    const grid = h('div', { class: 'emoji-grid' });
    const tabs = h('div', { class: 'emoji-tabs' });
    const renderCat = () => {
      tabs.replaceChildren(...EMOJI.map((c, i) => h('button', { type: 'button', title: c.name, class: i === cat ? 'active' : '', onClick: () => { cat = i; renderCat(); } }, c.icon)));
      grid.replaceChildren(...EMOJI[cat].list.map((e) => h('button', { type: 'button', onClick: () => this.insertText(e) }, e)));
      grid.scrollTop = 0;
    };
    renderCat();
    this.emojiPop = h('div', { class: 'emoji-pop' }, tabs, grid);
    this.composerWrap.append(this.emojiPop);
    anchor.classList.add('active');
    this.emojiAnchor = anchor;
    this.emojiOutside = (e) => {
      if (!this.emojiPop?.contains(e.target) && !anchor.contains(e.target)) this.closeEmoji();
    };
    document.addEventListener('mousedown', this.emojiOutside, true);
  }
  closeEmoji() {
    if (!this.emojiPop) return;
    animateOut(this.emojiPop, 140);
    this.emojiPop = null;
    this.emojiAnchor?.classList.remove('active');
    document.removeEventListener('mousedown', this.emojiOutside, true);
  }
  insertText(s) {
    const ta = this.textarea;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    ta.value = value.slice(0, a) + s + value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + s.length;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  setupDrop() {
    let depth = 0;
    let zone = null;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    this.conv.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || !this.textarea) return;
      e.preventDefault();
      depth++;
      if (!zone) {
        zone = h('div', { class: 'drop-zone' }, '松开鼠标发送文件（发送前会加密）');
        this.conv.append(zone);
      }
    });
    this.conv.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    this.conv.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        zone?.remove();
        zone = null;
      }
    });
    this.conv.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone?.remove();
      zone = null;
      const f = e.dataTransfer.files[0];
      if (f && this.textarea) this.confirmSendFile(f);
    });
  }

  confirmSendFile(file) {
    const chatId = this.current;
    const isImage = /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type);
    const url = isImage ? URL.createObjectURL(file) : null;
    const caption = h('input', { placeholder: '添加说明…', autocomplete: 'off' });
    const body = h('div', {},
      h('div', { class: 'preview-media' },
        isImage ? h('img', { src: url, alt: '' })
          : h('div', { class: 'file-card', style: { margin: 0, width: '100%' } },
              h('div', { class: 'ficon' }, (file.name.split('.').pop() || 'file').slice(0, 4)),
              h('div', { class: 'fbody' }, h('div', { class: 'fname' }, file.name), h('div', { class: 'fsize' }, formatSize(file.size))))),
      h('div', { class: 'field' }, caption)
    );
    const send = async () => {
      const reply = this.replyTo;
      this.setReply(null, false);
      toast('正在加密并上传…', 2000);
      try {
        await this.core.sendFile(chatId, file, caption.value.trim(), reply);
      } catch (e) {
        toast(`发送失败：${e.message}`);
      }
    };
    const m = showModal({ title: `发送给 ${this.core.chatTitle(this.core.chats.get(chatId))}`, body, actions: [{ label: '取消' }, { label: '发送', primary: true, onClick: send }], onClose: () => url && URL.revokeObjectURL(url) });
    caption.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        m.close();
        send();
      }
    });
  }

  // ---------------------------------------------------------------- 收到新消息
  onIncoming({ chatId, msg, viewing }) {
    this.typing.delete(chatId);
    if (viewing || !this.core.settings.notify) return;
    const chat = this.core.chats.get(chatId);
    if (!chat) return;
    const sender = this.core.displayName(msg.from);
    const title = chat.type === 'group' ? `${sender} @ ${this.core.chatTitle(chat)}` : sender;
    const body = this.core.settings.notifyPreview ? previewOf(msg) : '新消息';
    notify(title, body, () => this.openChat(chatId));
  }

  // ================================================================ 右侧信息面板
  toggleInfo(force) {
    this.infoOpen = force ?? !this.infoOpen;
    if (!this.current) this.infoOpen = false;
    if (this.infoOpen) this.renderInfo();
    this.info.classList.toggle('open', this.infoOpen);
    this.layoutEl.classList.toggle('info-open', this.infoOpen);
    this.info.setAttribute('aria-hidden', String(!this.infoOpen));
  }

  renderInfo() {
    const chat = this.core.chats.get(this.current);
    if (!chat) return this.toggleInfo(false);
    const header = h('div', { class: 'panel-header' }, iconBtn('close', '关闭', () => this.toggleInfo(false)), h('h3', {}, chat.type === 'group' ? '群组信息' : '联系人信息'));
    const body = h('div', { class: 'panel-body' });
    if (chat.type === 'group') this.groupInfo(chat, body);
    else this.contactInfo(chat, body);
    this.info.replaceChildren(header, body);
  }

  contactInfo(chat, body) {
    const id = chat.peerId;
    const u = this.core.users.get(id) || {};
    const isContact = this.core.contacts.has(id);
    const blocked = this.core.blocked.has(id);
    add(body, [
      h('div', { class: 'info-hero' },
        avatarEl(this.core.api.avatarUrl(u.avatar), { size: 200, seed: u.avatar ? 0 : id }),
        h('div', { class: 'big-name' }, this.core.displayName(id)),
        h('div', { class: 'sub' }, u.phone || ''),
        this.core.contacts.get(id) ? h('div', { class: 'sub' }, `昵称：${u.name}`) : null),
      h('div', { class: 'info-block' }, h('div', { class: 'ib-title' }, '个人签名'), h('div', { class: 'ib-text' }, u.about || '')),
      h('div', { class: 'info-block' },
        this.settingsItem('lock', '加密', '消息已进行端到端加密。点击核对安全码。', () => this.encryptionInfo(chat)),
        isContact
          ? this.settingsItem('edit', '修改备注名', null, () => this.editAlias(id))
          : this.settingsItem('personadd', '添加到联系人', null, () => this.editAlias(id, true))),
      h('div', { class: 'info-block' },
        this.settingsItem('block', blocked ? `解除屏蔽 ${this.core.displayName(id)}` : `屏蔽 ${this.core.displayName(id)}`, null, async () => {
          if (!blocked && !(await confirmDialog(`屏蔽 ${this.core.displayName(id)}？`, '被屏蔽的联系人将无法给你发消息，也看不到你的在线状态。', '屏蔽', true))) return;
          await this.core.setBlocked(id, !blocked);
          this.renderComposer();
        }, true),
        isContact ? this.settingsItem('person', '删除联系人', null, async () => {
          if (await confirmDialog('删除联系人？', '聊天记录会保留。', '删除', true)) await this.core.removeContact(id);
        }, true) : null,
        this.settingsItem('trash', '删除聊天', null, () => this.deleteChat(chat.id), true)),
    ]);
  }

  async editAlias(id, adding = false) {
    const r = await formDialog(adding ? '添加到联系人' : '修改备注名', [
      { name: 'alias', label: '备注名（可选）', value: this.core.contacts.get(id) || '', placeholder: this.core.users.get(id)?.name },
    ], { okLabel: '保存' });
    if (!r) return;
    try {
      await this.core.addContact(id, r.alias.trim());
      toast(adding ? '已添加到联系人' : '已保存');
    } catch (e) {
      toast(e.message);
    }
  }

  groupInfo(chat, body) {
    const g = this.core.groups.get(chat.groupId);
    const admin = this.core.isGroupAdmin(chat.groupId);
    add(body, h('div', { class: 'info-hero' },
      avatarEl(null, { size: 200, kind: 'group', seed: chat.groupId * 7 + 3 }),
      h('div', { class: 'big-name' }, this.core.chatTitle(chat)),
      h('div', { class: 'sub' }, g ? `群组 · ${g.members.length} 位成员` : '你已不在此群组中'),
      admin ? h('button', { class: 'link', style: { marginTop: '8px' }, onClick: () => this.editGroup(g) }, '修改群名称和介绍') : null));
    if (!g) {
      add(body, h('div', { class: 'info-block' }, this.settingsItem('trash', '删除群聊', null, () => this.deleteChat(chat.id), true)));
      return;
    }
    add(body, h('div', { class: 'info-block' },
      h('div', { class: 'ib-title' }, '群介绍'),
      h('div', { class: 'ib-text', style: { color: g.description ? '' : 'var(--text-3)' } }, g.description || '暂无群介绍')));
    add(body, h('div', { class: 'info-block' }, this.settingsItem('lock', '加密', '消息已进行端到端加密（为每个成员单独加密）。', () => this.encryptionInfo(chat))));
    const members = [...g.members].sort((a, b) => (a.id === this.core.me.id ? -1 : b.id === this.core.me.id ? 1 : 0) || (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0));
    add(body, h('div', { class: 'info-block' },
      h('div', { class: 'ib-title' }, `${g.members.length} 位成员`),
      admin ? h('div', { class: 'list-item', onClick: () => this.addMembersDialog(g) }, h('div', { class: 'li-icon' }, icon('personadd')), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '添加成员'))) : null,
      members.map((m) => {
        const u = this.core.users.get(m.id) || m;
        const row = h('div', { class: 'list-item', onClick: () => {
          if (m.id === this.core.me.id) return;
          showMenu(row, [
            { label: `给 ${this.core.displayName(m.id)} 发消息`, icon: 'chats', onClick: async () => { const c = await this.core.openDirectChat(m.id); this.openChat(c.id); } },
            admin ? { label: m.role === 'admin' ? '取消管理员' : '设为管理员', icon: 'shield', onClick: () => this.core.setGroupAdmin(g.id, m.id, m.role !== 'admin').catch((e) => toast(e.message)) } : null,
            admin ? { label: '移出群组', icon: 'logout', danger: true, onClick: async () => {
              if (await confirmDialog(`将 ${this.core.displayName(m.id)} 移出群组？`, '', '移出', true)) this.core.removeGroupMember(g.id, m.id).catch((e) => toast(e.message));
            } } : null,
          ], { align: 'left' });
        } },
          avatarEl(this.core.api.avatarUrl(u.avatar), { size: 40, seed: u.avatar ? 0 : m.id }),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, m.id === this.core.me.id ? '你' : this.core.displayName(m.id)), h('div', { class: 'li-sub' }, u.about || u.phone || '')),
          m.role === 'admin' ? h('span', { class: 'tag' }, '管理员') : null);
        return row;
      })));
    add(body, h('div', { class: 'info-block' },
      this.settingsItem('logout', '退出群组', null, async () => {
        if (await confirmDialog(`退出"${g.name}"？`, '退出后将不再收到此群组的消息。', '退出', true)) {
          await this.core.removeGroupMember(g.id, this.core.me.id).catch((e) => toast(e.message));
          this.renderComposer();
        }
      }, true)));
  }

  async editGroup(g) {
    const r = await formDialog('修改群组信息', [
      { name: 'name', label: '群名称', value: g.name },
      { name: 'description', label: '群介绍', value: g.description },
    ], { okLabel: '保存', validate: (v) => (!v.name.trim() ? '群名称不能为空' : null) });
    if (r) await this.core.updateGroup(g.id, { name: r.name.trim(), description: r.description.trim() }).catch((e) => toast(e.message));
  }

  addMembersDialog(g) {
    const existing = new Set(g.members.map((m) => m.id));
    const candidates = [...this.core.contacts.keys()].filter((id) => !existing.has(id));
    const selected = new Set();
    const list = h('div', { style: { maxHeight: '50vh', overflow: 'auto', margin: '0 -24px' } },
      candidates.length ? candidates.map((id) => this.selectableUser(id, selected)) : h('p', { style: { padding: '0 24px' } }, '没有可以添加的联系人。请先在"新的聊天"中添加联系人。'));
    showModal({
      title: `添加成员到"${g.name}"`,
      body: list,
      actions: [{ label: '取消' }, { label: '添加', primary: true, onClick: async () => {
        if (!selected.size) return false;
        try {
          await this.core.addGroupMembers(g.id, [...selected]);
        } catch (e) {
          toast(e.message);
          return false;
        }
      } }],
    });
  }

  selectableUser(id, selected, onChange) {
    const u = this.core.users.get(id) || {};
    const box = h('div', { class: 'check' });
    const row = h('div', { class: 'list-item', onClick: () => {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      box.classList.toggle('on', selected.has(id));
      box.replaceChildren(selected.has(id) ? icon('check', 16) : '');
      onChange?.();
    } },
      avatarEl(this.core.api.avatarUrl(u.avatar), { size: 40, seed: u.avatar ? 0 : id }),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, this.core.displayName(id)), h('div', { class: 'li-sub' }, u.about || u.phone || '')),
      box);
    if (selected.has(id)) {
      box.classList.add('on');
      box.append(icon('check', 16));
    }
    return row;
  }

  async encryptionInfo(chat) {
    if (chat.type === 'group') {
      showModal({
        title: '端到端加密',
        body: h('div', {},
          h('p', {}, '群组消息由你的电脑分别为每一位成员加密，服务器只负责转发无法读取的密文。'),
          h('p', {}, '如需确认某位成员的身份，可以在群成员中点开与他的单聊，核对安全码。')),
        actions: [{ label: '好的', primary: true }],
      });
      return;
    }
    const sn = await this.core.safetyNumber(chat.peerId);
    const name = this.core.displayName(chat.peerId);
    showModal({
      title: '核对安全码',
      body: h('div', {},
        h('p', {}, `你与 ${name} 的消息已进行端到端加密。`),
        sn
          ? [h('div', { class: 'safety-number' }, sn.split(' ').map((g) => h('span', {}, g))),
            h('p', {}, `当面或通过电话与 ${name} 比对上面的 60 位数字。如果完全一致，就说明你们之间的通信没有被任何人（包括服务器）拦截或冒充。`)]
          : h('p', {}, '对方还没有上传加密密钥（从未登录过客户端），暂时无法生成安全码。')),
      actions: [{ label: '完成', primary: true }],
    });
  }

  settingsItem(iconName, title, sub, onClick, danger = false, right = null) {
    return h('div', { class: `settings-item ${danger ? 'danger' : ''}`, onClick },
      icon(iconName),
      h('div', { class: 'si-body' }, h('div', {}, title), sub ? h('div', { class: 'si-sub' }, sub) : null),
      right);
  }

  // ================================================================ 左侧滑出面板
  showPanel(title, body, { onBack } = {}) {
    this.closePanel(true);
    const panel = h('div', { class: 'side-panel' },
      h('div', { class: 'panel-header' }, iconBtn('back', '返回', () => (onBack ? onBack() : this.closePanel())), h('h3', {}, title)),
      body);
    this.sidebar.append(panel);
    requestAnimationFrame(() => panel.classList.add('open'));
    this.openPanel = panel;
    this.railChats?.classList.remove('active');
    return panel;
  }
  closePanel(instant = false) {
    const p = this.openPanel;
    if (!p) return;
    this.openPanel = null;
    this.railChats?.classList.add('active');
    if (instant) return p.remove();
    p.classList.remove('open');
    setTimeout(() => p.remove(), 250);
  }

  panelNewChat() {
    const phone = h('input', { type: 'tel', placeholder: '输入对方手机号，例如 +8613800000000' });
    const result = h('div');
    const find = async () => {
      if (!phone.value.trim()) return;
      result.replaceChildren(h('div', { class: 'small-hint' }, '正在查找…'));
      try {
        const u = await this.core.findByPhone(phone.value.trim());
        if (u.id === this.core.me.id) return result.replaceChildren(h('div', { class: 'small-hint' }, '这是你自己的号码。'));
        result.replaceChildren(
          h('div', { class: 'list-item', onClick: async () => { const c = await this.core.openDirectChat(u.id); this.openChat(c.id); } },
            avatarEl(this.core.api.avatarUrl(u.avatar), { size: 49, seed: u.avatar ? 0 : u.id }),
            h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, u.name), h('div', { class: 'li-sub' }, `${u.phone} · ${u.about || ''}`)),
            this.core.contacts.has(u.id) ? null : h('button', { class: 'btn secondary', onClick: async (e) => {
              e.stopPropagation();
              await this.core.addContact(u.id).catch((er) => toast(er.message));
              this.panelNewChat();
            } }, '加为联系人')));
      } catch (e) {
        result.replaceChildren(h('div', { class: 'small-hint' }, e.message));
      }
    };
    phone.addEventListener('keydown', (e) => e.key === 'Enter' && find());
    const contacts = [...this.core.contacts.keys()].sort((a, b) => this.core.displayName(a).localeCompare(this.core.displayName(b), 'zh'));
    const body = h('div', { class: 'panel-body' },
      h('div', { class: 'searchbar', style: { paddingTop: '6px' } }, h('label', { class: 'searchbox' }, icon('search', 20), phone, h('button', { class: 'link', onClick: find }, '查找'))),
      result,
      h('div', { class: 'list-item', onClick: () => this.panelNewGroup() }, h('div', { class: 'li-icon' }, icon('group')), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, '新建群组'))),
      h('div', { class: 'section-title' }, '联系人'),
      contacts.length
        ? contacts.map((id) => {
            const u = this.core.users.get(id) || {};
            return h('div', { class: 'list-item', onClick: async () => { const c = await this.core.openDirectChat(id); this.openChat(c.id); } },
              avatarEl(this.core.api.avatarUrl(u.avatar), { size: 49, seed: u.avatar ? 0 : id }),
              h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, this.core.displayName(id)), h('div', { class: 'li-sub' }, u.about || u.phone || '')));
          })
        : h('div', { class: 'small-hint' }, '还没有联系人。在上方输入手机号查找好友。'));
    this.showPanel('新的聊天', body);
    setTimeout(() => phone.focus(), 250);
  }

  panelNewGroup(selected = new Set()) {
    const chipsEl = h('div', { class: 'selected-chips' });
    const filter = h('input', { placeholder: '搜索联系人' });
    const listEl = h('div');
    const fab = h('button', { class: 'fab hidden', title: '下一步', onClick: () => this.panelNewGroupName(selected) }, icon('forward'));
    const ids = [...this.core.contacts.keys()].sort((a, b) => this.core.displayName(a).localeCompare(this.core.displayName(b), 'zh'));
    const refresh = () => {
      chipsEl.replaceChildren(...[...selected].map((id) =>
        h('span', { class: 'sel-chip' }, avatarEl(this.core.api.avatarUrl(this.core.users.get(id)?.avatar), { size: 24, seed: id }), this.core.displayName(id),
          h('button', { type: 'button', onClick: () => { selected.delete(id); refresh(); } }, icon('close', 14)))));
      chipsEl.classList.toggle('hidden', !selected.size);
      fab.classList.toggle('hidden', !selected.size);
      const q = filter.value.trim().toLowerCase();
      const shown = ids.filter((id) => !q || this.core.displayName(id).toLowerCase().includes(q));
      listEl.replaceChildren(...(shown.length ? shown.map((id) => this.selectableUser(id, selected, refresh)) : [h('div', { class: 'small-hint' }, ids.length ? '没有匹配的联系人' : '还没有联系人。请先在"新的聊天"中通过手机号添加联系人。')]));
    };
    filter.addEventListener('input', refresh);
    const body = h('div', { class: 'panel-body' }, chipsEl, h('div', { class: 'searchbar', style: { paddingTop: '10px' } }, h('label', { class: 'searchbox' }, icon('search', 20), filter)), listEl);
    const panel = this.showPanel('添加群成员', body);
    panel.append(fab);
    refresh();
  }

  panelNewGroupName(selected) {
    const name = h('input', { placeholder: '群名称', maxLength: 100 });
    const create = async () => {
      if (!name.value.trim()) return toast('请输入群名称');
      fab.disabled = true;
      try {
        const g = await this.core.createGroup(name.value.trim(), [...selected]);
        this.openChat(`g:${g.id}`);
      } catch (e) {
        toast(e.message);
        fab.disabled = false;
      }
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && create());
    const fab = h('button', { class: 'fab', title: '创建群组', onClick: create }, icon('check'));
    const body = h('div', { class: 'panel-body' },
      h('div', { class: 'profile-photo' }, avatarEl(null, { size: 160, kind: 'group' })),
      h('div', { class: 'panel-section' }, h('div', { class: 'field' }, name)),
      h('div', { class: 'small-hint' }, `${selected.size} 位成员 · 群消息会为每位成员单独端到端加密`));
    const panel = this.showPanel('新建群组', body, { onBack: () => this.panelNewGroup(selected) });
    panel.append(fab);
    setTimeout(() => name.focus(), 250);
  }

  panelProfile() {
    const me = this.core.me;
    const photo = h('div', { class: 'photo-edit', onClick: () => {
      showMenu(photo, [
        { label: '上传照片', icon: 'image', onClick: async () => {
          const f = await pickFile({ accept: 'image/png,image/jpeg,image/webp,image/gif' });
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) return toast('头像图片不能超过 2 MB');
          await this.core.setAvatar(f).then(() => this.panelProfile()).catch((e) => toast(e.message));
        } },
        me.avatar ? { label: '移除照片', icon: 'trash', onClick: () => this.core.setAvatar(null).then(() => this.panelProfile()).catch((e) => toast(e.message)) } : null,
      ], { align: 'left' });
    } },
      avatarEl(this.core.api.avatarUrl(me.avatar), { size: 200 }),
      h('div', { class: 'photo-hover' }, icon('camera', 24), '更换头像'));
    const editable = (label, key, max, hint) => {
      const wrap = h('div', { class: 'panel-section' }, h('div', { class: 'small-label' }, label));
      const row = h('div', { class: 'editable' });
      const show = () => row.replaceChildren(h('div', { class: 'val' }, me[key] || ''), iconBtn('edit', '编辑', edit, { size: 20 }));
      const edit = () => {
        const input = h('input', { value: me[key] || '', maxLength: max });
        const save = async () => {
          try {
            await this.core.updateProfile({ [key]: input.value });
            this.panelProfile();
          } catch (e) {
            toast(e.message);
          }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { e.stopPropagation(); show(); }
        });
        row.replaceChildren(input, iconBtn('check', '保存', save, { size: 20 }));
        input.focus();
      };
      show();
      wrap.append(row);
      return [wrap, hint ? h('div', { class: 'small-hint', style: { background: 'var(--panel-2)', paddingTop: '14px' } }, hint) : null];
    };
    const body = h('div', { class: 'panel-body', style: { background: 'var(--panel-2)' } },
      h('div', { class: 'profile-photo', style: { background: 'var(--panel)' } }, photo),
      editable('你的名字', 'name', 50, '这不是你的用户名或 PIN 码。这个名字会显示给你的联系人。'),
      editable('个人签名', 'about', 140),
      h('div', { class: 'panel-section', style: { marginTop: '10px' } }, h('div', { class: 'small-label' }, '手机号'), h('div', { class: 'editable' }, h('div', { class: 'val' }, me.phone))));
    this.showPanel('个人资料', body);
  }

  async panelSettings() {
    const s = this.core.settings;
    const sw = (on) => h('div', { class: `switch ${on ? 'on' : ''}` });
    const info = await secureInfo();
    const toggle = (key, title, sub) => {
      const item = this.settingsItem(key === 'enterToSend' ? 'send' : 'bell', title, sub, async () => {
        await this.core.saveSettings({ [key]: !s[key] });
        item.querySelector('.switch').classList.toggle('on', s[key]);
        if (key === 'notify' && s.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      }, false, sw(s[key]));
      return item;
    };
    const themeNames = { system: '跟随系统', light: '浅色', dark: '深色' };
    const themeItem = this.settingsItem('palette', '主题', themeNames[themePref()], () => {
      showMenu(themeItem, Object.entries(themeNames).map(([k, label]) => ({ label, onClick: () => {
        try { localStorage.setItem('theme', k); } catch {}
        applyTheme(k);
        themeItem.querySelector('.si-sub').textContent = label;
      } })));
    });
    const body = h('div', { class: 'panel-body' },
      h('div', { class: 'list-item', style: { padding: '14px 20px' }, onClick: () => this.panelProfile() },
        avatarEl(this.core.api.avatarUrl(this.core.me.avatar), { size: 82 }),
        h('div', { class: 'li-body' }, h('div', { class: 'li-title', style: { fontSize: '19px' } }, this.core.me.name), h('div', { class: 'li-sub' }, this.core.me.about))),
      h('div', { class: 'panel-sep' }),
      toggle('notify', '桌面通知', '收到新消息时显示通知'),
      toggle('notifyPreview', '通知显示消息内容', '关闭后通知只显示"新消息"'),
      toggle('enterToSend', '按 Enter 发送', 'Shift+Enter 换行'),
      themeItem,
      h('div', { class: 'panel-sep' }),
      this.settingsItem('shield', '本机数据保护', info.encrypted
        ? `私钥和聊天记录已用${info.platform === 'win32' ? ' Windows 账户（DPAPI）' : '系统密钥环'}加密保存`
        : '⚠ 当前系统不支持安全存储，密钥未加密保存', () => {}),
      this.settingsItem('key', '导出密钥备份', '换电脑时用于恢复加密身份（不含聊天记录）', () => this.exportBackup()),
      this.settingsItem('lock', '修改登录密码', null, () => this.changePassword()),
      this.settingsItem('server', '服务器', this.core.api.server, () => {}),
      h('div', { class: 'panel-sep' }),
      this.settingsItem('logout', '退出登录', '保留本机的聊天记录和密钥，下次登录可继续使用', () => this.logout(), true),
      this.settingsItem('trash', '退出并清除本机数据', '删除本机的聊天记录和加密密钥', () => this.logout(true), true),
      h('div', { class: 'small-hint', style: { textAlign: 'center', padding: '20px' } }, `SecureChat ${isDesktop ? '桌面版' : '网页版'} ${await (globalThis.desktop?.version?.() ?? Promise.resolve('dev'))}`));
    this.showPanel('设置', body);
  }

  async exportBackup() {
    const r = await formDialog('导出密钥备份', [
      { name: 'p1', label: '设置备份口令', type: 'password', hint: '至少 8 位。忘记口令将无法恢复备份。' },
      { name: 'p2', label: '再次输入口令', type: 'password' },
    ], {
      okLabel: '导出',
      text: '备份文件包含你的加密私钥（用口令加密）。在新电脑登录时选择"从密钥备份恢复"，联系人就不会看到"安全码已更改"。',
      validate: (v) => (v.p1.length < 8 ? '口令至少 8 位' : v.p1 !== v.p2 ? '两次输入的口令不一致' : null),
    });
    if (!r) return;
    toast('正在加密备份…');
    const backup = await this.core.exportKeyBackup(r.p1);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    saveBlobAs(url, `securechat-keys-${this.core.me.phone.replace(/\D/g, '')}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async changePassword() {
    const r = await formDialog('修改登录密码', [
      { name: 'old', label: '当前密码', type: 'password' },
      { name: 'n1', label: '新密码', type: 'password' },
      { name: 'n2', label: '再次输入新密码', type: 'password' },
    ], {
      okLabel: '修改',
      validate: async (v) => {
        if (v.n1.length < 8) return '新密码至少 8 位';
        if (v.n1 !== v.n2) return '两次输入的新密码不一致';
        try {
          await this.core.changePassword(v.old, v.n1);
        } catch (e) {
          return e.message;
        }
        return null;
      },
    });
    if (r) toast('密码已修改，其它设备上的登录已失效');
  }

  async logout(wipe = false) {
    const ok = wipe
      ? await confirmDialog('退出并清除本机数据？', '本机上的所有聊天记录和加密密钥都会被删除。再次登录会生成新的密钥，联系人会看到"安全码已更改"。如果需要保留身份，请先导出密钥备份。', '清除并退出', true)
      : await confirmDialog('退出登录？', '本机的聊天记录和密钥会保留，下次登录同一账号可以继续使用。', '退出');
    if (ok) await this.core.logout({ wipe });
  }
}
