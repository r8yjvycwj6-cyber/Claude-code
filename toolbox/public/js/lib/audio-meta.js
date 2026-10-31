// 极简 ID3v2 / LRC 解析（标题、歌手、专辑、封面、歌词）
const dec = (bytes, enc) => {
  try {
    if (enc === 1) { const le = bytes[0] === 0xff && bytes[1] === 0xfe; const be = bytes[0] === 0xfe && bytes[1] === 0xff; return new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(be || le ? bytes.subarray(2) : bytes); }
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    if (enc === 3) return new TextDecoder('utf-8').decode(bytes);
    if (bytes.some((b) => b >= 0x80)) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('gbk').decode(bytes); } }
    return new TextDecoder('latin1').decode(bytes);
  } catch { return ''; }
};
const clean = (s) => s.replace(/\0+$/g, '').replace(/^﻿/, '').trim();

export async function readTags(file) {
  const meta = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(...head.slice(0, 3)) !== 'ID3') return meta;
    const ver = head[3]; const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
    const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 6e6)).arrayBuffer());
    let p = 0; const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    while (p + hdr < buf.length) {
      const id = String.fromCharCode(...buf.slice(p, p + idLen)); if (!/^[A-Z0-9]+$/.test(id)) break;
      let fs;
      if (ver === 2) fs = (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5];
      else if (ver === 4) fs = ((buf[p + 4] & 127) << 21) | ((buf[p + 5] & 127) << 14) | ((buf[p + 6] & 127) << 7) | (buf[p + 7] & 127);
      else fs = (buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7];
      if (fs <= 0 || p + hdr + fs > buf.length) break;
      const data = buf.subarray(p + hdr, p + hdr + fs); const enc = data[0];
      const text = () => clean(dec(data.subarray(1), enc));
      if (id === 'TIT2' || id === 'TT2') meta.title = text();
      else if (id === 'TPE1' || id === 'TP1') meta.artist = text();
      else if (id === 'TALB' || id === 'TAL') meta.album = text();
      else if (id === 'APIC' || id === 'PIC') {
        let i = 1; if (ver === 2) i += 3; else { while (data[i] !== 0) i++; i++; }
        i++; // picture type
        if (enc === 1 || enc === 2) { while (!(data[i] === 0 && data[i + 1] === 0)) i += 2; i += 2; } else { while (data[i] !== 0) i++; i++; }
        const img = data.subarray(i); if (img.length > 100) { const mime = img[0] === 0x89 ? 'image/png' : 'image/jpeg'; meta.cover = URL.createObjectURL(new Blob([img], { type: mime })); }
      } else if (id === 'USLT' || id === 'ULT') {
        let i = 4; if (enc === 1 || enc === 2) { while (!(data[i] === 0 && data[i + 1] === 0)) i += 2; i += 2; } else { while (data[i] !== 0) i++; i++; }
        const t = clean(dec(data.subarray(i), enc)); if (t && /\[\d+:\d+/.test(t)) meta.lrc = t;
      }
      p += hdr + fs;
    }
  } catch { /* 标签损坏就忽略 */ }
  return meta;
}
export function parseLrc(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const times = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]; if (!times.length) continue;
    const t = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of times) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: t });
  }
  return out.sort((a, b) => a.t - b.t);
}
export function hueOf(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
