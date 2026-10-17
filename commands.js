// Ask Buddy: turns a typed sentence into a safe action (open, search, close, clean up).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FOLDERS = ['documents', 'downloads', 'desktop', 'pictures', 'music', 'videos'];
const APPS = {
  notepad: 'notepad', calculator: 'calc', calc: 'calc', paint: 'mspaint',
  chrome: 'chrome', edge: 'msedge', explorer: 'explorer', settings: 'ms-settings:',
  word: 'winword', excel: 'excel', powerpoint: 'powerpnt', whatsapp: 'whatsapp:'
};
const SITES = { youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', google: 'https://www.google.com', github: 'https://github.com' };
const OLD_DAYS = 30;

function enc(s) { return encodeURIComponent(s); }

// Turns simple Tamil, Tanglish or mixed commands into the English form the parser understands.
// Returns null when the text has no Tamil script or Tanglish filler words.
const TAMIL_RE = /[\u0B80-\u0BFF]/;
const TANGLISH_RE = /\b(pannu|pannunga|panni|pannuga|kudu|kudunga|podu|poduga|seiyu|seyyu)\b/i;
const FILLERS = /(பண்ணு|பண்ணுங்க|பண்ணி|பண்ணிடு|செய்|செய்யவும்|செய்யுங்கள்|கொடு|கொடுங்க|போடு|ப்ளீஸ்|தயவுசெய்து|please|pls|pannu|pannunga|panni|pannuga|kudu|kudunga|podu|poduga|seiyu|seyyu|எனக்கு)/gi;
const NOUNS = [
  [/யூடியூப்\S*|யூட்யூப்\S*|youtube\S*/i, 'youtube'], [/ஜிமெயில்\S*/i, 'gmail'], [/கூகுள்\S*|கூகிள்\S*/i, 'google'],
  [/டாக்குமெண்ட்\S*|டாக்யூமெண்ட்\S*|ஆவணங்கள்\S*|documents?/i, 'documents'], [/டவுன்லோட்\S*|downloads?/i, 'downloads'],
  [/டெஸ்க்டாப்\S*|desktop/i, 'desktop'], [/ரீசைக்கிள்\s*பின்\S*|குப்பை\S*|recycle\s*bin/i, 'recycle bin'],
  [/டெம்ப்\S*|temp\S*/i, 'temp'], [/குரோம்\S*|க்ரோம்\S*|chrome/i, 'chrome'], [/நோட்பேட்\S*|notepad/i, 'notepad'],
  [/கால்குலேட்டர்\S*|calculator/i, 'calculator']
];
const VERBS = {
  open: /(திற\S*|ஓபன்|தொற\S*|\bopen\b)/i,
  close: /(மூடு\S*|க்ளோஸ்|குளோஸ்|\bclose\b)/i,
  search: /(தேடு\S*|தேடி\S*|சர்ச்|\bsearch\b)/i,
  clear: /(அழி\S*|நீக்கு\S*|டெலீட்|கிளியர்|\bclear\b|\bdelete\b)/i
};

function normalize(raw) {
  const text = String(raw || '').trim();
  if (!TAMIL_RE.test(text) && !TANGLISH_RE.test(text)) return null;
  const verb = Object.keys(VERBS).find(v => VERBS[v].test(text));
  if (!verb) return null;
  let rest = text.replace(VERBS[verb], ' ').replace(FILLERS, ' ').replace(/\s+/g, ' ').trim();
  const noun = NOUNS.find(([re]) => re.test(rest));
  const key = noun ? noun[1] : null;
  if (verb === 'clear') {
    if (key === 'temp') return 'clear temp files';
    if (key === 'recycle bin') return 'empty recycle bin';
    if (key === 'downloads') return 'clean downloads';
    return null;
  }
  if (verb === 'search') {
    if (noun) rest = rest.replace(noun[0], ' ').replace(/\s+/g, ' ').trim();
    if (!rest) return null;
    return (key === 'youtube' ? 'search ' + rest + ' on youtube' : 'search ' + rest);
  }
  if (!key) return null;
  return verb + ' ' + key;
}

// Pure parser: returns { type, ... } or { type: 'unknown' }.
function parse(input) {
  let raw = String(input || '').trim();
  const normalized = normalize(raw);
  if (normalized) raw = normalized;
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  let m;
  if (!t) return { type: 'unknown' };
  if ((m = t.match(/^voice (on|off)$/))) return { type: 'voice', on: m[1] === 'on' };
  if ((m = t.match(/^full access (on|off)$/))) return { type: 'fullAccess', on: m[1] === 'on' };
  if ((m = raw.match(/^(?:do|please|agent)[:\s]+(.+)$/i))) return { type: 'agent', task: m[1].trim() };

  if ((m = t.match(/^(?:close|quit|exit|stop)\s+(.+)$/))) {
    const target = m[1].replace(/^(the|my)\s+/, '').replace(/\s+(tab|window|app)$/, '').trim();
    return { type: 'close', target };
  }
  if ((m = t.match(/^(?:search|find|google|look up)\s+(.+?)\s+(?:on|in)\s+youtube$/)) || (m = t.match(/^youtube\s+(?:search\s+)?(.+)$/))) {
    return { type: 'url', url: 'https://www.youtube.com/results?search_query=' + enc(m[1]), say: 'Searching YouTube for "' + m[1] + '"' };
  }
  if ((m = t.match(/^(?:search|find|google|look up|what is|who is|how to)\s*(.*)$/)) && (m[1] || /^(what is|who is|how to)/.test(t))) {
    const q = /^(what is|who is|how to)/.test(t) ? t : m[1].replace(/^for\s+/, '');
    return { type: 'url', url: 'https://www.google.com/search?q=' + enc(q), say: 'Searching Google for "' + q + '"' };
  }
  if (/^(?:clear|clean|delete|remove)\s+(?:the\s+)?(?:temp|temporary)(?:\s+files)?$/.test(t)) return { type: 'cleanTemp' };
  if (/^(?:empty|clear|clean)\s+(?:the\s+)?(?:recycle bin|trash|bin)$/.test(t)) return { type: 'emptyBin' };
  if (/^(?:clear|clean|delete|remove)\s+(?:old\s+)?(?:files\s+(?:in|from)\s+)?downloads(?:\s+(?:folder|files))?$/.test(t) ||
      /^(?:clear|clean)\s+(?:my\s+)?old\s+downloads$/.test(t)) return { type: 'cleanDownloads' };
  if ((m = t.match(/^(?:delete|remove)\s+(.+?)\s+(?:from|in)\s+downloads$/))) return { type: 'deleteDownload', name: m[1] };

  if ((m = t.match(/^open\s+(?:my\s+|the\s+)?(.+?)(?:\s+folder)?$/))) {
    const what = m[1];
    if (FOLDERS.includes(what)) return { type: 'folder', which: what };
    if (SITES[what]) return { type: 'url', url: SITES[what], say: 'Opening ' + what };
    if (APPS[what]) return { type: 'app', app: APPS[what], say: 'Opening ' + what };
    if (/^[\w-]+(\.[\w-]+)+$/.test(what)) return { type: 'url', url: 'https://' + what, say: 'Opening ' + what };
  }
  return { type: 'unknown' };
}

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function runPs(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000 }, (err, out) => {
      if (err) reject(err); else resolve(String(out || '').trim());
    });
  });
}

function listOldDownloads(dir, days, now) {
  const cutoff = (now || Date.now()) - days * 86400000;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.map(n => path.join(dir, n)).filter((p) => {
    try { return fs.statSync(p).mtimeMs < cutoff; } catch (e) { return false; }
  });
}

function listTemp(dir, now) {
  const cutoff = (now || Date.now()) - 86400000;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.map(n => path.join(dir, n)).filter((p) => {
    try { return fs.statSync(p).mtimeMs < cutoff; } catch (e) { return false; }
  });
}

// deps: { shell, app, platform, runPs }. Returns { say } or { confirm, run } (run is called after the user agrees).
async function execute(cmd, deps) {
  const d = Object.assign({ platform: process.platform, runPs }, deps);
  const win = d.platform === 'win32';
  switch (cmd.type) {
    case 'url':
      await d.shell.openExternal(cmd.url);
      return { say: cmd.say };
    case 'folder': {
      const key = cmd.which;
      const err = await d.shell.openPath(d.app.getPath(key));
      return { say: err ? 'Could not open ' + key : 'Opening ' + key };
    }
    case 'app':
      if (!win) return { say: 'Opening apps works on Windows only.' };
      execFile('cmd.exe', ['/c', 'start', '""', cmd.app], { windowsHide: true }, () => {});
      return { say: cmd.say };
    case 'close': {
      if (!win) return { say: 'Closing windows works on Windows only.' };
      const target = cmd.target;
      if (!/^[\w .+-]{2,40}$/.test(target)) return { say: 'I did not understand what to close.' };
      // Close politely (like pressing the X) any window whose title or process name matches.
      const script = "$n=0; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like " +
        psQuote('*' + target + '*') + " -or $_.ProcessName -like " + psQuote(target + '*') + ") } | ForEach-Object { if($_.CloseMainWindow()){$n++} }; Write-Output $n";
      const out = await d.runPs(script);
      const n = parseInt(out, 10) || 0;
      return { say: n ? 'Closed ' + n + ' window(s) for "' + target + '".' : 'No open window found for "' + target + '". For a browser tab, the tab must be the active one.' };
    }
    case 'cleanTemp': {
      const files = listTemp(os.tmpdir());
      if (!files.length) return { say: 'Temp folder is already clean.' };
      return {
        confirm: 'Delete ' + files.length + ' old temp item(s) (older than 1 day)?',
        run: async () => {
          let ok = 0;
          for (const f of files) { try { fs.rmSync(f, { recursive: true, force: true }); ok++; } catch (e) {} }
          return { say: 'Cleared ' + ok + ' temp item(s). Items in use were skipped.' };
        }
      };
    }
    case 'emptyBin':
      if (!win) return { say: 'Recycle Bin works on Windows only.' };
      return {
        confirm: 'Empty the Recycle Bin? This cannot be undone.',
        run: async () => { await d.runPs('Clear-RecycleBin -Force -ErrorAction SilentlyContinue'); return { say: 'Recycle Bin emptied.' }; }
      };
    case 'cleanDownloads': {
      const dir = d.app.getPath('downloads');
      const files = listOldDownloads(dir, OLD_DAYS);
      if (!files.length) return { say: 'No downloads older than ' + OLD_DAYS + ' days.' };
      return {
        confirm: 'Move ' + files.length + ' download(s) older than ' + OLD_DAYS + ' days to the Recycle Bin? You can restore them from there.',
        run: async () => {
          let ok = 0;
          for (const f of files) { try { await d.shell.trashItem(f); ok++; } catch (e) {} }
          return { say: 'Moved ' + ok + ' item(s) to the Recycle Bin.' };
        }
      };
    }
    case 'deleteDownload': {
      const dir = d.app.getPath('downloads');
      let names = [];
      try { names = fs.readdirSync(dir); } catch (e) {}
      const q = cmd.name.toLowerCase();
      const hits = names.filter(n => n.toLowerCase().includes(q));
      if (!hits.length) return { say: 'No file named "' + cmd.name + '" in Downloads.' };
      if (hits.length > 5) return { say: hits.length + ' files match. Please be more specific.' };
      return {
        confirm: 'Move to the Recycle Bin: ' + hits.join(', ') + '?',
        run: async () => {
          let ok = 0;
          for (const n of hits) { try { await d.shell.trashItem(path.join(dir, n)); ok++; } catch (e) {} }
          return { say: 'Moved ' + ok + ' file(s) to the Recycle Bin.' };
        }
      };
    }
    default:
      return { say: 'Try: "open youtube", "search cats", "close youtube", "open documents", "clear temp files", "clean downloads".' };
  }
}

module.exports = { normalize, parse, execute, listOldDownloads, listTemp };
