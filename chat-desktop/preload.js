'use strict';
// 预加载脚本：只向页面暴露极少数受控的接口，页面本身没有 Node.js 权限。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  // 用系统加密（Windows DPAPI）保存/读取字符串
  secureGet: (name) => ipcRenderer.invoke('secure:get', name),
  secureSet: (name, value) => ipcRenderer.invoke('secure:set', name, value),
  secureInfo: () => ipcRenderer.invoke('secure:info'),
  setBadge: (count, dataUrl) => ipcRenderer.send('app:badge', count, dataUrl),
  focus: () => ipcRenderer.send('app:focus'),
  version: () => ipcRenderer.invoke('app:version'),
});
