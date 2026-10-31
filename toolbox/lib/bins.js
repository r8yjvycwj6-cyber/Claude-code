'use strict';
// 定位 ffmpeg / ffprobe / LibreOffice：环境变量 > 系统 PATH > 内置 npm 包
const { spawnSync } = require('child_process');
const fs = require('fs');

function works(cmd, args) {
  try { return spawnSync(cmd, args, { timeout: 8000, stdio: 'ignore' }).status === 0; } catch { return false; }
}
function pick(envName, names, args, fallback) {
  const cands = [process.env[envName], ...names];
  for (const c of cands) if (c && works(c, args)) return c;
  try { const p = fallback && fallback(); if (p && fs.existsSync(p) && works(p, args)) return p; } catch {}
  return null;
}
const win = process.platform === 'win32';
const ffmpeg = pick('FFMPEG_PATH', ['ffmpeg'], ['-version'], () => require('ffmpeg-static'));
const ffprobe = pick('FFPROBE_PATH', ['ffprobe'], ['-version'], () => require('ffprobe-static').path);
const soffice = pick('SOFFICE_PATH',
  win ? ['soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
      : process.platform === 'darwin' ? ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'] : ['soffice', 'libreoffice'],
  ['--version']);
module.exports = { ffmpeg, ffprobe, soffice };
