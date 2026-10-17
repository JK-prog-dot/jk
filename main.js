const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut, desktopCapturer, safeStorage, powerMonitor } = require('electron');
const { spawn, execFile } = require('child_process');
const commands = require('./commands');
const agent = require('./agent');
const sec = require('./security');
const path = require('path');
const fs = require('fs');

const userDir = app.getPath('userData');
const charDir = path.join(userDir, 'characters');
const configPath = path.join(userDir, 'config.json');

const DEFAULT_CONFIG = {
  name: '',
  characterId: null,
  characters: [],
  laterMinutes: 10,
  autoHideSeconds: 45,
  paused: false,
  walkSpeed: 70,
  yesText: 'Nice one, {name}! 👑 Done {count} time(s) today.',
  laterText: 'Okay... {minutes} more minutes. Do not forget me 😊',
  stats: { date: '', counts: {} },
  reminders: [
    { id: 'water', emoji: '💧', text: 'Did you drink water? || Your brain is 75% water. Top it up! || Time for a water break?', yesText: 'Hydrated king 👑 Glass number {count} today.', intervalMin: 45, enabled: true },
    { id: 'stretch', emoji: '🧘', text: 'Stand up and stretch for a minute!', intervalMin: 60, enabled: true },
    { id: 'eyes', emoji: '👀', text: 'Look away from the screen for 20 seconds.', intervalMin: 30, enabled: false }
  ]
};

const VIDEO_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg' };

let config = loadConfig();
let tray = null;
let overlayWin = null;
let settingsWin = null;
let overlayTimer = null;
let currentReminderId = null;
const nextDue = {};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig() {
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Thumbnail for the settings page (images only).
function characterImage(id) {
  const c = config.characters.find(x => x.id === id);
  if (!c || c.type === 'video') return null;
  try {
    const buf = fs.readFileSync(path.join(charDir, c.file));
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

// Full media description sent to the overlay.
function characterMedia(id) {
  const c = config.characters.find(x => x.id === id);
  if (!c) return null;
  try {
    const buf = fs.readFileSync(path.join(charDir, c.file));
    if (c.type === 'video') {
      const ext = path.extname(c.file).slice(1).toLowerCase();
      return {
        type: 'video', bytes: buf, mime: VIDEO_MIME[ext] || 'video/mp4',
        key: c.key || null, tol: c.tol || 40, doodle: c.doodle || { on: false },
        speed: c.speed || null
      };
    }
    return { type: 'image', src: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (e) {
    return null;
  }
}

function resetSchedule() {
  const now = Date.now();
  for (const r of config.reminders) {
    nextDue[r.id] = now + r.intervalMin * 60000;
  }
}

function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  const h = 540;
  overlayWin = new BrowserWindow({
    width: workArea.width, height: h,
    x: workArea.x,
    y: workArea.y + workArea.height - h,
    transparent: true, frame: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, focusable: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile('overlay.html');
}

function showReminder(r) {
  if (!overlayWin) createOverlay();
  currentReminderId = r.id;
  const cid = r.characterId && config.characters.some(x => x.id === r.characterId) ? r.characterId : config.characterId;
  const c = config.characters.find(x => x.id === cid);
  const variants = String(r.text || '').split('||').map(t => t.trim()).filter(Boolean);
  const text = (variants[Math.floor(Math.random() * variants.length)] || r.text || '')
    .replace(/\{name\}/g, config.name || 'friend');
  const payload = {
    greeting: config.name ? `Hey, ${config.name}!` : 'Hey!',
    emoji: r.emoji,
    text,
    media: characterMedia(cid),
    walk: c ? c.walk !== false : true,
    walkRate: Math.max(0.3, Math.min(1.5, (config.walkSpeed || 70) / 100)),
    // A walking video (if chosen) plays while the character crosses the screen.
    walkMedia: c && c.type !== 'video' && config.walkVideoId ? characterMedia(config.walkVideoId) : null
  };
  const send = () => {
    // Let clicks pass through the transparent area; the overlay page turns this off over the bubble.
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
    overlayWin.webContents.send('overlay:show', payload);
    overlayWin.showInactive();
  };
  if (overlayWin.webContents.isLoading()) overlayWin.webContents.once('did-finish-load', send);
  else send();
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => handleAction('later', true), config.autoHideSeconds * 1000);
}

// Shows the saved character with a speech bubble (and reads it aloud) for Ask Buddy answers.
function buddySay(text) {
  if (!text || currentReminderId || agentRunning) return;
  if (config.characterSay === false) return;
  if (!overlayWin) createOverlay();
  const cid = config.characterId;
  const c = config.characters.find(x => x.id === cid);
  const payload = {
    say: true, speak: config.voiceReply !== false,
    greeting: '', emoji: '', text: String(text).slice(0, 300),
    media: characterMedia(cid),
    walk: c ? c.walk !== false : true,
    walkRate: Math.max(0.3, Math.min(1.5, (config.walkSpeed || 70) / 100)),
    walkMedia: c && c.type !== 'video' && config.walkVideoId ? characterMedia(config.walkVideoId) : null
  };
  const send = () => {
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
    overlayWin.webContents.send('overlay:show', payload);
    overlayWin.showInactive();
  };
  if (overlayWin.webContents.isLoading()) overlayWin.webContents.once('did-finish-load', send); else send();
}

function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (all, k) => (vars[k] != null ? vars[k] : all));
}

function handleAction(action, silent) {
  clearTimeout(overlayTimer);
  const r = config.reminders.find(x => x.id === currentReminderId);
  if (!r) {
    if (overlayWin) overlayWin.webContents.send('overlay:leave');
    return;
  }
  const delay = action === 'yes' ? r.intervalMin : config.laterMinutes;
  nextDue[r.id] = Date.now() + delay * 60000;
  currentReminderId = null;

  // Count the "Yes" answers per reminder for today.
  let count = 0;
  if (action === 'yes') {
    const today = new Date().toLocaleDateString('en-CA');
    if (!config.stats || config.stats.date !== today) config.stats = { date: today, counts: {} };
    count = config.stats.counts[r.id] = (config.stats.counts[r.id] || 0) + 1;
    saveConfig();
  }
  if (!overlayWin) return;
  if (silent) { overlayWin.webContents.send('overlay:leave'); return; }

  const tpl = action === 'yes' ? (r.yesText || config.yesText) : (r.laterText || config.laterText);
  const reply = fillTemplate(tpl, { name: config.name || 'friend', count, minutes: config.laterMinutes }).trim();
  if (reply) overlayWin.webContents.send('overlay:reply', reply);
  else overlayWin.webContents.send('overlay:leave');
}

function tick() {
  if (config.paused || currentReminderId) return;
  const now = Date.now();
  for (const r of config.reminders) {
    if (r.enabled && nextDue[r.id] && now >= nextDue[r.id]) {
      showReminder(r);
      break;
    }
  }
}

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 900, height: 760, title: 'Reminder Buddy', backgroundColor: '#141729',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

let cmdWin = null;
let pendingCmd = null;

function openCommandBox() {
  if (cmdWin) { cmdWin.show(); cmdWin.focus(); cmdWin.webContents.send('cmd:focus'); return; }
  const { workArea } = screen.getPrimaryDisplay();
  cmdWin = new BrowserWindow({
    width: 560, height: 420, x: Math.round(workArea.x + (workArea.width - 560) / 2), y: workArea.y + 120,
    title: 'Ask Buddy', backgroundColor: '#141729', autoHideMenuBar: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  cmdWin.loadFile('command.html');
  cmdWin.on('closed', () => { cmdWin = null; pendingCmd = null; pendingSensitive = false; });
}

// ---- PIN protection ------------------------------------------------------
let unlocked = false;
let lastActive = 0;
let pendingSensitive = false;

function isLocked() {
  if (!config.pin || !unlocked) return true;
  if (Date.now() - lastActive > sec.IDLE_MS) { unlocked = false; return true; }
  return false;
}
function lockNow() { unlocked = false; pendingCmd = null; }

function checkPin(pin) {
  const r = sec.attempt(pin, config.pin, config.pinFail, Date.now());
  config.pinFail = r.state;
  saveConfig();
  return r;
}

function getApiKey() {
  if (!config.apiKeyEnc) return null;
  try { return safeStorage.decryptString(Buffer.from(config.apiKeyEnc, 'base64')); } catch (e) { return null; }
}

// Older versions stored the key as plain text. Encrypt it once and remove the plain copy.
function migrateApiKey() {
  if (!config.apiKey) return;
  if (safeStorage.isEncryptionAvailable()) {
    config.apiKeyEnc = safeStorage.encryptString(config.apiKey).toString('base64');
    delete config.apiKey;
    saveConfig();
  }
}

ipcMain.handle('sec:setPin', (_e, pin) => {
  if (config.pin) return { say: 'A PIN is already set.' };
  if (!sec.validPin(pin)) return { say: 'The PIN must be 4 to 12 digits.' };
  config.pin = sec.hashPin(pin);
  config.pinFail = { count: 0, until: 0 };
  saveConfig();
  unlocked = true; lastActive = Date.now();
  return { ok: true, say: 'PIN saved. Buddy is unlocked.' };
});

ipcMain.handle('sec:unlock', (_e, pin) => {
  const r = checkPin(pin);
  if (!r.ok) return { say: r.msg };
  unlocked = true; lastActive = Date.now();
  return { ok: true, say: 'Unlocked.' };
});

ipcMain.handle('cmd:run', async (_e, text) => {
  pendingCmd = null;
  pendingSensitive = false;
  try {
    if (!config.pin) return { needPin: 'set', say: 'First create a PIN (4 to 12 digits). Only you will be able to use Ask Buddy.' };
    if (isLocked()) return { needPin: 'unlock', say: 'Ask Buddy is locked. Enter your PIN.' };
    lastActive = Date.now();
    if (/^\s*lock\s*$/i.test(text)) { lockNow(); return { say: 'Locked.' }; }
    const cmd = commands.parse(text);
    if (cmd.type === 'voice') {
      config.voiceReply = cmd.on; saveConfig();
      const say = cmd.on ? 'Voice replies are ON.' : 'Voice replies are OFF.';
      buddySay(say);
      return { say };
    }
    if (cmd.type === 'fullAccess') {
      if (!cmd.on) { config.fullAccess = false; saveConfig(); return { say: 'Full access is OFF. Buddy can only use the mouse and keyboard.' }; }
      pendingCmd = async () => { config.fullAccess = true; saveConfig(); return { say: 'Full access is ON. Buddy can now also run PowerShell commands, so it can work with files, apps and settings directly. Type "full access off" to turn it off.' }; };
      pendingSensitive = true;
      return { confirm: 'Turn ON full access? Buddy will be able to run PowerShell commands as you (not as administrator) to do tasks on its own. Deleting, stopping the PC, changing settings and downloads still ask you first, and some commands are always blocked. Enter your PIN to confirm.', needPinConfirm: true };
    }
    if (cmd.type === 'unknown' || cmd.type === 'agent') {
      const task = cmd.type === 'agent' ? cmd.task : String(text).trim();
      if (process.platform !== 'win32') return { say: 'Controlling the PC works on Windows only.' };
      if (!getApiKey()) return { needKey: true, say: 'To control the PC I need your Anthropic API key. Paste it below once.' };
      pendingCmd = () => runAgentTask(task);
      pendingSensitive = true;
      return { confirm: 'Buddy will use your mouse and keyboard to: "' + task + '". Press Ctrl+Alt+X or the Stop button to stop it at any time. Enter your PIN to continue.', needPinConfirm: true };
    }
    const r = await commands.execute(cmd, { shell, app });
    if (r.confirm) {
      pendingCmd = r.run;
      pendingSensitive = true;
      return { confirm: r.confirm + ' Enter your PIN to confirm.', needPinConfirm: true };
    }
    buddySay(r.say);
    return { say: r.say };
  } catch (e) {
    return { say: 'Sorry, that did not work: ' + e.message };
  }
});
ipcMain.handle('agent:setKey', (_e, key) => {
  if (isLocked()) return { say: 'Unlock Ask Buddy first.' };
  const k = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { say: 'That does not look like an Anthropic API key (it starts with sk-ant-).' };
  if (!safeStorage.isEncryptionAvailable()) return { say: 'Windows secure storage is not available, so the key was not saved.' };
  config.apiKeyEnc = safeStorage.encryptString(k).toString('base64');
  delete config.apiKey;
  saveConfig();
  return { say: 'Key saved (encrypted) on this computer. Now type your command again.' };
});
ipcMain.handle('cmd:confirm', async (_e, pin) => {
  if (isLocked()) return { say: 'Locked. Enter your PIN again.' };
  const run = pendingCmd;
  if (!run) return { say: 'Nothing to confirm.' };
  if (pendingSensitive) {
    const r = checkPin(pin);
    if (!r.ok) return { confirm: r.msg, needPinConfirm: true };
  }
  pendingCmd = null;
  pendingSensitive = false;
  lastActive = Date.now();
  try {
    const out = await run();
    if (out && out.say) setTimeout(() => buddySay(out.say), 400);
    return out;
  } catch (e) { return { say: 'Sorry, that did not work: ' + e.message }; }
});
ipcMain.on('cmd:cancel', () => { pendingCmd = null; pendingSensitive = false; });
ipcMain.on('cmd:close', () => { if (cmdWin) cmdWin.close(); });
ipcMain.on('agent:stop', () => { agentStop = true; if (approveResolve) approveResolve(false); });

// ---- Computer-use agent -------------------------------------------------
let agentStop = false;
let agentRunning = false;
let statusWin = null;
let inputProc = null;
let inputQueue = [];

function startInputHelper() {
  const script = path.join(userDir, 'agent-input.ps1');
  fs.mkdirSync(userDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'agent-input.ps1'), script);
  inputProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buf = '';
  inputProc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const w = inputQueue.shift();
      if (!w) continue;
      if (line.startsWith('ERR')) w.reject(new Error(line.slice(4))); else w.resolve(line);
    }
  });
  inputProc.on('exit', () => {
    inputQueue.splice(0).forEach(w => w.reject(new Error('Input helper stopped')));
    inputProc = null;
  });
}

function sendInput(op) {
  return new Promise((resolve, reject) => {
    if (!inputProc) return reject(new Error('Input helper is not running'));
    inputQueue.push({ resolve, reject });
    inputProc.stdin.write(JSON.stringify(op) + '\n');
  });
}

async function takeScreenshot(ctx) {
  const d = screen.getPrimaryDisplay();
  const pw = Math.round(d.size.width * d.scaleFactor), ph = Math.round(d.size.height * d.scaleFactor);
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: pw, height: ph } });
  const src = srcs.find(x => x.display_id === String(d.id)) || srcs[0];
  if (!src) throw new Error('No screen found');
  const scale = Math.min(1, 1280 / Math.max(pw, ph));
  ctx.scale = scale;
  let img = src.thumbnail;
  if (scale < 1) img = img.resize({ width: Math.round(pw * scale), height: Math.round(ph * scale), quality: 'good' });
  return img.toPNG().toString('base64');
}

async function callClaude(body) {
  const payload = JSON.stringify({ model: config.agentModel || 'claude-sonnet-5-5', max_tokens: 1024, ...body });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
      body: payload
    });
    if ((res.status === 429 || res.status === 529) && attempt < 2) { await new Promise(r => setTimeout(r, 4000)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json.error && json.error.message) || ('API error ' + res.status));
    return json;
  }
}

function showStatus(text, ask) {
  if (!statusWin) {
    const { workArea } = screen.getPrimaryDisplay();
    statusWin = new BrowserWindow({
      width: 460, height: 190, x: Math.round(workArea.x + (workArea.width - 460) / 2), y: workArea.y + 8,
      frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, show: false,
      backgroundColor: '#141729',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    statusWin.setAlwaysOnTop(true, 'screen-saver');
    statusWin.setContentProtection(true); // keeps this panel out of the screenshots Buddy sees
    statusWin.loadFile('status.html');
    statusWin.on('closed', () => { statusWin = null; });
  }
  const send = () => { statusWin.webContents.send('agent:status', { text, ask: ask || null }); statusWin.showInactive(); };
  if (statusWin.webContents.isLoading()) statusWin.webContents.once('did-finish-load', send); else send();
}

function runShell(command) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        let out = String(stdout || '');
        if (stderr) out += (out ? '\n' : '') + 'STDERR: ' + stderr;
        if (err && !out) out = 'Error: ' + err.message;
        else if (err && err.killed) out += '\n(stopped after 60 seconds)';
        resolve(out.trim());
      });
  });
}

// Asks the user (in the status panel, which Buddy cannot see) to allow or refuse one command.
let approveResolve = null;
function askApproval(command) {
  return new Promise((resolve) => {
    if (approveResolve) approveResolve(false);
    const done = (v) => { clearTimeout(timer); approveResolve = null; resolve(v); };
    const timer = setTimeout(() => done(false), 60000);
    approveResolve = done;
    showStatus(null, command);
  });
}
ipcMain.on('agent:approve', (_e, yes) => { if (approveResolve) approveResolve(!!yes); });

async function runAgentTask(task) {
  if (agentRunning) return { say: 'Buddy is already working on a task.' };
  agentRunning = true;
  agentStop = false;
  const ctx = { scale: 1 };
  if (cmdWin) cmdWin.hide();
  try {
    startInputHelper();
    await takeScreenshot(ctx);
    const io = { send: sendInput, get scale() { return ctx.scale; } };
    const out = await agent.runAgent(task, {
      callApi: callClaude,
      screenshot: () => takeScreenshot(ctx),
      io,
      onStatus: (t) => showStatus(t),
      shouldStop: () => agentStop,
      fullAccess: !!config.fullAccess,
      runShell,
      approve: askApproval,
      denyPaths: [userDir]
    });
    return { say: out.text };
  } catch (e) {
    return { say: 'Sorry, that did not work: ' + e.message };
  } finally {
    agentRunning = false;
    if (inputProc) { try { inputProc.kill(); } catch (e) {} inputProc = null; }
    if (statusWin) { statusWin.close(); statusWin = null; }
    if (cmdWin) { cmdWin.show(); cmdWin.focus(); }
  }
}
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Reminder Buddy');
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ask Buddy (Ctrl+Alt+B)', click: openCommandBox },
    { label: 'Settings', click: openSettings },
    { label: 'Test reminder now', click: () => { const r = config.reminders.find(x => x.enabled) || config.reminders[0]; if (r) showReminder(r); } },
    { label: config.paused ? 'Resume reminders' : 'Pause reminders', click: () => { config.paused = !config.paused; saveConfig(); refresh(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
  refresh();
  tray.on('double-click', openSettings);
}

ipcMain.handle('config:get', () => ({
  ...config,
  apiKey: undefined,
  apiKeyEnc: undefined,
  pin: undefined,
  pinFail: undefined,
  hasKey: !!config.apiKeyEnc,
  characterImages: Object.fromEntries(config.characters.map(c => [c.id, characterImage(c.id)]))
}));

ipcMain.handle('config:save', (_e, partial) => {
  config = { ...config, ...partial };
  saveConfig();
  resetSchedule();
  return true;
});

ipcMain.handle('character:add', (_e, p) => {
  fs.mkdirSync(charDir, { recursive: true });
  const id = 'c' + Date.now();
  let entry;
  if (p.type === 'video') {
    const ext = VIDEO_MIME[String(p.ext || '').toLowerCase()] ? String(p.ext).toLowerCase() : 'mp4';
    const file = id + '.' + ext;
    fs.writeFileSync(path.join(charDir, file), Buffer.from(p.bytes));
    entry = {
      id, name: p.name || 'My character', file, type: 'video',
      key: p.key || null, tol: p.tol || 40, doodle: p.doodle || { on: false }, walk: !!p.walk
    };
  } else {
    const file = id + '.png';
    const base64 = String(p.dataUrl).replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(charDir, file), Buffer.from(base64, 'base64'));
    entry = { id, name: p.name || 'My character', file, type: 'image', walk: p.walk !== false };
  }
  config.characters.push(entry);
  config.characterId = id;
  saveConfig();
  return id;
});

ipcMain.handle('character:delete', (_e, id) => {
  const c = config.characters.find(x => x.id === id);
  if (c) { try { fs.unlinkSync(path.join(charDir, c.file)); } catch (e) {} }
  config.characters = config.characters.filter(x => x.id !== id);
  if (config.characterId === id) config.characterId = config.characters[0] ? config.characters[0].id : null;
  saveConfig();
  return true;
});

ipcMain.handle('reminder:test', () => {
  const r = config.reminders.find(x => x.enabled) || config.reminders[0];
  if (r) showReminder(r);
  return true;
});

ipcMain.on('overlay:action', (_e, action) => handleAction(action));
ipcMain.on('overlay:interactive', (_e, on) => {
  if (overlayWin) overlayWin.setIgnoreMouseEvents(!on, { forward: true });
});
ipcMain.on('overlay:done', () => {
  if (overlayWin && !currentReminderId) overlayWin.hide();
});

// Add the bundled characters once (also for installs that already exist).
const BUNDLED = [
  { key: 'standing', file: 'default-character.png', name: 'Me', type: 'image' },
  { key: 'bottle', file: 'bottle-character.png', name: 'Me with water bottle', type: 'image' },
  { key: 'walker', file: 'walker.webm', name: 'Me walking (video)', type: 'video', speed: 200 }
];

function seedBundledCharacters() {
  config.seeded = config.seeded || [];
  const ids = {};
  let changed = false;
  fs.mkdirSync(charDir, { recursive: true });
  BUNDLED.forEach((b) => {
    const src = path.join(__dirname, 'assets', b.file);
    if (config.seeded.includes(b.key) || !fs.existsSync(src)) return;
    const id = 'b' + b.key;
    const file = id + path.extname(b.file);
    fs.copyFileSync(src, path.join(charDir, file));
    const entry = { id, name: b.name, file, type: b.type, walk: b.type === 'image' };
    if (b.type === 'video') Object.assign(entry, { key: null, tol: 40, doodle: { on: false }, speed: b.speed || null });
    config.characters.push(entry);
    config.seeded.push(b.key);
    ids[b.key] = id;
    changed = true;
  });
  if (!changed) return;
  if (!config.characterId && ids.standing) config.characterId = ids.standing;
  const water = config.reminders.find(r => r.id === 'water');
  if (water && !water.characterId && ids.bottle) water.characterId = ids.bottle;
  if (!config.walkVideoId && ids.walker) config.walkVideoId = ids.walker;
  saveConfig();
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', openSettings);
  app.whenReady().then(() => {
    app.setLoginItemSettings({ openAtLogin: true });
    seedBundledCharacters();
    migrateApiKey();
    powerMonitor.on('lock-screen', lockNow);
    createOverlay();
    buildTray();
    globalShortcut.register('Control+Alt+B', openCommandBox);
    globalShortcut.register('Control+Alt+X', () => { agentStop = true; if (approveResolve) approveResolve(false); });
    resetSchedule();
    setInterval(tick, 15000);
    if (!config.characters.length) openSettings();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}
