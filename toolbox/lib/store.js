'use strict';
// 极简 JSON 文件存储：内存读写 + 防抖原子落盘（无需原生模块，装完即用）
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, initial) {
    this.file = file;
    this.data = initial;
    this._timer = null;
    this._writing = false;
    this._dirty = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) {
        fs.copyFileSync(file, file + '.corrupt-' + Date.now());
        console.error(`[store] ${file} 解析失败，已备份并重建`);
      }
    }
  }
  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._flush(); }, 150);
  }
  async _flush() {
    if (this._writing) { this._timer = setTimeout(() => { this._timer = null; this._flush(); }, 50); return; }
    if (!this._dirty) return;
    this._dirty = false; this._writing = true;
    const tmp = this.file + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(this.data));
      await fs.promises.rename(tmp, this.file);
    } catch (e) { console.error('[store] 写入失败', e); this._dirty = true; }
    this._writing = false;
  }
  flushSync() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this._dirty) return;
    this._dirty = false;
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
module.exports = Store;
