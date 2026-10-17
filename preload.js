const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  addCharacter: (payload) => ipcRenderer.invoke('character:add', payload),
  deleteCharacter: (id) => ipcRenderer.invoke('character:delete', id),
  testReminder: () => ipcRenderer.invoke('reminder:test'),
  onShow: (cb) => ipcRenderer.on('overlay:show', (_e, payload) => cb(payload)),
  onReply: (cb) => ipcRenderer.on('overlay:reply', (_e, text) => cb(text)),
  onLeave: (cb) => ipcRenderer.on('overlay:leave', () => cb()),
  action: (a) => ipcRenderer.send('overlay:action', a),
  interactive: (on) => ipcRenderer.send('overlay:interactive', on),
  done: () => ipcRenderer.send('overlay:done'),
  cmdRun: (text) => ipcRenderer.invoke('cmd:run', text),
  cmdConfirm: (pin) => ipcRenderer.invoke('cmd:confirm', pin),
  setPin: (pin) => ipcRenderer.invoke('sec:setPin', pin),
  unlock: (pin) => ipcRenderer.invoke('sec:unlock', pin),
  setKey: (k) => ipcRenderer.invoke('agent:setKey', k),
  agentStop: () => ipcRenderer.send('agent:stop'),
  onAgentStatus: (cb) => ipcRenderer.on('agent:status', (_e, t) => cb(t)),
  agentApprove: (yes) => ipcRenderer.send('agent:approve', yes),
  cmdCancel: () => ipcRenderer.send('cmd:cancel'),
  cmdClose: () => ipcRenderer.send('cmd:close'),
  onCmdFocus: (cb) => ipcRenderer.on('cmd:focus', () => cb())
});
