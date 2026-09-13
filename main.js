'use strict';

const obsidian = require('obsidian');
const { Plugin, PluginSettingTab, Setting, Modal, SuggestModal, Notice, normalizePath, setIcon, TFile } = obsidian;

const VIEW_TYPE = 'plugin-lab-panel';

const DEFAULT_SETTINGS = {
  panelOpen: {},
  outputFolder: 'Plugin Lab',
  settleMs: 700,
  lastPlugin: '',
  includeDefaultTheme: true,
  themes: {},          // theme name -> include (true) ; missing = include
  captures: { settings: true, views: true, scene: false },
  schemes: { dark: true, light: true },
  viewTypes: '',
  commandPicks: {},
  ribbonPicks: {},
  cropHero: true,
};

const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
function stamp() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x'; }
function lineOf(text, idx) { return text.slice(0, idx).split('\n').length; }
function esc(s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }

// ---------- plugin discovery ----------
// app.plugins.manifests is the same map the Community plugins tab reads. Each manifest carries `dir`.
function installedPlugins(app) {
  const ms = (app.plugins && app.plugins.manifests) || {};
  const enabled = (app.plugins && app.plugins.enabledPlugins) || new Set();
  return Object.keys(ms).map((id) => Object.assign({}, ms[id], { enabled: enabled.has ? enabled.has(id) : false })).sort((a, b) => a.name.localeCompare(b.name));
}
async function readIf(app, path) { try { if (await app.vault.adapter.exists(path)) return await app.vault.adapter.read(path); } catch (e) { /* unreadable */ } return null; }
async function loadPluginFiles(app, manifest) {
  const dir = manifest.dir || `${app.vault.configDir}/plugins/${manifest.id}`;
  const files = {};
  for (const f of ['main.js', 'styles.css', 'manifest.json', 'versions.json', 'README.md', 'data.json', 'package.json', 'LICENSE']) files[f] = await readIf(app, `${dir}/${f}`);
  return { dir, files };
}


function extractStrings(js, callName) {
  // matches callName('...') / callName("...") / callName(`...`) with the first string argument; returns [{text, index}]
  const out = []; const re = new RegExp(callName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1', 'g'); let m;
  while ((m = re.exec(js))) out.push({ text: m[2], index: m.index });
  return out;
}
function findAll(text, re) { const out = []; let m; const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = r.exec(text))) { out.push({ index: m.index, match: m[0], groups: m.slice(1) }); if (m[0].length === 0) r.lastIndex++; } return out; }

// ---------- review engine ----------
// Two sources of truth: the community review (what blocks a listing) and eslint-plugin-obsidianmd (the official linter).
// Every item carries a rule id so the note can link to the doc.
const L = { error: 'Error', warning: 'Warning', rec: 'Recommendation', info: 'Info', pass: 'Pass' };
const RULE_DOC = (id) => id.startsWith('obsidianmd/') ? `https://github.com/obsidianmd/eslint-plugin/blob/master/docs/rules/${id.slice(11)}.md` : null;

// From eslint-plugin-obsidianmd lib/rules/ui/brands.ts and acronyms.ts
const BRANDS = ["iOS", "iPadOS", "macOS", "Windows", "Android", "Linux", "Obsidian", "Obsidian Sync", "Obsidian Publish", "Google", "Gemini", "Vertex AI", "OpenAI", "GPT", "Anthropic", "Claude", "Cursor", "Microsoft", "Google Drive", "Dropbox", "OneDrive", "iCloud Drive", "YouTube", "Slack", "Discord", "Telegram", "WhatsApp", "Twitter", "X", "Readwise", "Zotero", "Excalidraw", "Mermaid", "Markdown", "LaTeX", "JavaScript", "TypeScript", "Node.js", "npm", "pnpm", "Yarn", "Git", "GitHub", "GitLab", "Anki", "CalDAV", "CardDAV", "Evernote", "IntelliJ IDEA", "Jekyll", "Logseq", "Notion", "PyCharm", "React", "Reddit", "Roam Research", "Svelte", "VS Code", "Visual Studio Code", "WebDAV", "WebStorm"];
const ACRONYMS = new Set(["API", "HTTP", "HTTPS", "URL", "DNS", "TCP", "IP", "SSH", "TLS", "SSL", "FTP", "SFTP", "SMTP", "JSON", "XML", "HTML", "CSS", "PDF", "CSV", "YAML", "SQL", "PNG", "JPG", "JPEG", "GIF", "SVG", "2FA", "MFA", "OAuth", "JWT", "LDAP", "SAML", "SDK", "IDE", "CLI", "GUI", "CRUD", "REST", "SOAP", "CPU", "GPU", "RAM", "SSD", "USB", "UI", "OK", "RSS", "S3", "ID", "UUID", "GUID", "SHA", "MD5", "ASCII", "UTF-8", "UTF-16", "DOM", "CDN", "FAQ", "AI", "ML", "LLM"].map((s) => s.toUpperCase()));

// Port of the linter's sentence-case evaluator (loose mode): returns the suggested casing, or the input if already fine.
function isSkippableString(text) {
  if (!text) return true;
  if (text.includes('`') || /<\/?[a-z][^>]*>/i.test(text)) return true;
  if (/(\$\{[^}]+\}|\{[^}]+\}|%\d*\$?s|%s)/.test(text)) return true;
  if (/^\.{1,2}\//.test(text) || /\.[a-z0-9]{1,4}(['"\s]|$)/i.test(text)) return true;
  if (/(Ctrl|Cmd|Alt|Shift|Option|⌘|⌥|⌃|⇧)\s*\+\s*[A-Za-z]/.test(text)) return true;
  if (/^v?\d+(?:[._-]\d+)+$/.test(text)) return true;
  if (/^[A-Z0-9_]+$/.test(text)) return true;
  // Plugin Lab extension: date/time format tokens (moment.js placeholders)
  if (/^[YMDHhmsSaAZzTWwEeQx\s:\-./,\[\]]+$/.test(text) && /[YMDH]/.test(text)) return true;
  return false;
}
function sentenceCaseSuggestion(text, extraBrands = []) {
  const brands = BRANDS.concat(extraBrands.filter(Boolean)).sort((a, b) => b.length - a.length);
  const isCamel = (w) => /[A-Z]/.test(w.slice(1)) && /[a-z]/.test(w);
  // split into sentences on . ! ? followed by space
  const parts = text.replace(/\b(e\.g|i\.e|etc|vs|cf|approx|dr|mr|mrs|ms|inc|no)\.\s/gi, (m0) => m0.replace('. ', '.\u0001')).split(/(?<=[.!?])\s+/).map((s) => s.replace(/\u0001/g, ' '));
  const outParts = parts.map((sentence, si) => {
    const matches = [];
    for (const b of brands) { const re = new RegExp('(?<![A-Za-z0-9])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi'); let m; while ((m = re.exec(sentence))) { if (!matches.some((x) => !(m.index + m[0].length <= x.start || m.index >= x.end))) matches.push({ start: m.index, end: m.index + m[0].length, canonical: b }); } }
    const inBrand = (i) => matches.some((x) => i >= x.start && i < x.end);
    const chars = sentence.split('');
    let firstAlpha = chars.findIndex((c) => /[A-Za-z]/.test(c));
    const tokenRe = /[A-Za-z0-9][A-Za-z0-9.\-]*/g; let tm; let first = true;
    while ((tm = tokenRe.exec(sentence))) {
      const s = tm.index, tok = tm[0], e = s + tok.length;
      if (matches.some((x) => !(e <= x.start || s >= x.end))) continue;
      const upper = tok.toUpperCase();
      const isFirst = firstAlpha >= 0 && s <= firstAlpha && firstAlpha < e;
      if (ACRONYMS.has(upper)) { for (let i = 0; i < tok.length; i++) chars[s + i] = upper[i]; continue; }
      if (isFirst) {
        if (isCamel(tok)) continue;
        const leading = sentence.slice(0, firstAlpha).replace(/\p{Extended_Pictographic}/gu, '').replace(/\(/g, '').trim();
        if (leading) { for (let j = s; j < e; j++) chars[j] = tok[j - s].toLowerCase(); continue; }
        chars[firstAlpha] = chars[firstAlpha].toUpperCase(); for (let j = firstAlpha + 1; j < e; j++) chars[j] = chars[j].toLowerCase(); continue;
      }
      if (/^([A-Za-z](?:\.[A-Za-z])+)\.?$/.test(tok) && tok === upper) continue;
      if (tok.includes('-')) { const nt = tok.split('-').map((pt) => ACRONYMS.has(pt.toUpperCase()) ? pt.toUpperCase() : brands.includes(pt) ? pt : pt.toLowerCase()).join('-'); for (let i = 0; i < tok.length; i++) chars[s + i] = nt[i] || chars[s + i]; continue; }
      if (brands.includes(tok) || isCamel(tok)) continue;
      const nt = tok.toLowerCase(); for (let i = 0; i < tok.length; i++) chars[s + i] = nt[i];
    }
    for (const x of matches) for (let i = 0; i < x.canonical.length; i++) chars[x.start + i] = x.canonical[i];
    return chars.join('');
  });
  return outParts.join(' ').length === text.length ? text.replace(/\S+(\s+\S+)*/, () => outParts.join(text.match(/[.!?](\s+)/) ? text.match(/[.!?](\s+)/)[1] : ' ')) : outParts.join(' ');
}

const SAMPLE_NAMES = ['MyPlugin', 'MyPluginSettings', 'SampleSettingTab', 'SampleModal', 'mySetting'];
const MANIFEST_REQUIRED = { author: 'string', minAppVersion: 'string', name: 'string', version: 'string', id: 'string', description: 'string', isDesktopOnly: 'boolean' };
const MANIFEST_OPTIONAL = { authorUrl: 'string', fundingUrl: 'string|object' };

// Replace comments and regex literals with spaces so their contents don't trip the behaviour scans; length and line numbers are preserved.
function maskCode(js, stripStrings = false) {
  let out = ''; let i = 0; const n = js.length; let prevSig = '(';
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const ch = js[i], nx = js[i + 1];
    if (ch === '/' && nx === '/') { const e = js.indexOf('\n', i); const end = e < 0 ? n : e; out += blank(js.slice(i, end)); i = end; continue; }
    if (ch === '/' && nx === '*') { const e = js.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += blank(js.slice(i, end)); i = end; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { let j = i + 1; while (j < n && js[j] !== ch) { if (js[j] === '\\') j++; if (ch !== '`' && js[j] === '\n') break; j++; } out += stripStrings ? ch + blank(js.slice(i + 1, j)) + ch : js.slice(i, j + 1); i = j + 1; prevSig = ch; continue; }
    if (ch === '/' && /[(,=:\[!&|?{};]/.test(prevSig) || (ch === '/' && /return$/.test(out.slice(-8).trim()))) {
      let j = i + 1, cls = false; while (j < n && (cls || js[j] !== '/') && js[j] !== '\n') { if (js[j] === '\\') j++; else if (js[j] === '[') cls = true; else if (js[j] === ']') cls = false; j++; }
      if (js[j] === '/') { while (/[a-z]/.test(js[j + 1] || '')) j++; out += blank(js.slice(i, j + 1)); i = j + 1; prevSig = ')'; continue; }
    }
    out += ch; if (!/\s/.test(ch)) prevSig = ch; i++;
  }
  return out;
}
// regex literal bodies only (everything else blanked) — for the lookbehind check
function regexLiterals(js) { const masked = maskCode(js); const out = []; for (let i = 0; i < js.length; i++) if (masked[i] === ' ' && js[i] !== ' ' && js[i] !== '\n') { let j = i; while (j < js.length && masked[j] === ' ' && js[j] !== '\n') j++; const s = js.slice(i, j); if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/*')) out.push({ text: s, index: i }); i = j; } return out; }

function reviewPlugin(manifestFromApp, files) {
  const sections = []; const add = (name) => { const s = { name, items: [] }; sections.push(s); return (level, text, opts = {}) => { const it = Object.assign({ level, text }, opts); it.blocks = level === L.error && (String(it.rule || '').startsWith('review/') || it.blocks === true); s.items.push(it); }; };
  const js = files['main.js'] || ''; const code = maskCode(js); const bare = maskCode(js, true); const css = files['styles.css'] || ''; const readme = files['README.md'];
  let manifest = null; let manifestErr = null;
  try { manifest = files['manifest.json'] ? JSON.parse(files['manifest.json']) : null; } catch (e) { manifestErr = e.message; }
  const m = manifest || manifestFromApp; const id = m.id || manifestFromApp.id; const name = m.name || manifestFromApp.name || '';
  const desktopOnly = m.isDesktopOnly === true;
  const first = (arr) => (arr.length ? { file: 'main.js', line: lineOf(code, arr[0].index) } : {});

  // ----- manifest -----
  {
    const a = add('Manifest');
    if (!files['manifest.json']) a(L.error, 'manifest.json is missing from the plugin folder.', { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' });
    else if (manifestErr) a(L.error, `manifest.json is not valid JSON: ${manifestErr}`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' });
    if (manifest) {
      for (const [k, t] of Object.entries(MANIFEST_REQUIRED)) { if (!(k in manifest)) a(L.warning, `The manifest is missing the required '${k}' property.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest', help: 'Required for new submissions; older listed plugins sometimes lack it.' }); else if (typeof manifest[k] !== t) a(L.error, `The '${k}' property must be of type '${t}', but was '${typeof manifest[k]}'.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' }); }
      for (const k of Object.keys(manifest)) if (!(k in MANIFEST_REQUIRED) && !(k in MANIFEST_OPTIONAL)) a(L.warning, `The '${k}' property is not allowed in the manifest.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' });
      if ('fundingUrl' in manifest) { const f = manifest.fundingUrl; if (typeof f === 'object' && f !== null) { if (!Object.keys(f).length) a(L.error, "The 'fundingUrl' cannot be empty.", { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' }); else if (Object.values(f).some((v) => typeof v !== 'string' || !v)) a(L.error, "The 'fundingUrl' object must only contain string values.", { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' }); } else if (typeof f !== 'string' || !f) a(L.error, "The 'fundingUrl' property must be a URL string or an object of label → URL.", { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' }); }
      for (const k of ['id', 'name', 'description']) {
        const v = String(manifest[k] || ''); const words = ['obsidian', 'plugin'].filter((w) => v.toLowerCase().includes(w));
        if (!words.length) continue;
        const grand = k === 'id';
        const lvl = words.includes('obsidian') && k !== 'id' ? L.error : grand ? L.warning : L.rec;
        a(lvl, `The '${k}' property cannot contain '${words.join("' or '")}'.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest', blocks: lvl === L.error, help: k === 'id' ? (words.includes('obsidian') ? 'An id cannot change once listed; existing plugins keep theirs. New submissions with "obsidian" in the id are rejected.' : 'The linter warns about "plugin" in ids; the review lists plugins with it.') : k === 'description' && words.includes('obsidian') ? 'The community review rejects "Obsidian" in the description outright.' : 'The linter flags both words; the review has rejected "Obsidian" and tolerates "plugin".' });
      }
      const d = String(manifest.description || '');
      const probs = [];
      if (d.length < 10) probs.push('at least 10 characters'); if (d.length > 250) probs.push('at most 250 characters');
      if (!/^[A-Z]/.test(d)) probs.push('start with a capital letter'); if (!d.endsWith('.')) probs.push('end with a period');
      if (!/^[A-Za-z0-9\s.,!?'"-]+$/.test(d)) probs.push('use only letters, digits, spaces and . , ! ? \' " -');
      if (probs.length) a(L.warning, `The 'description' should ${probs.join('; ')}.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest', help: 'The linter\'s exact format rule. The community review accepted colons and dashes in practice, but this is what the official rule enforces.' });
      if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) a(L.error, `'version' (${manifest.version}) must be plain semver — the release tag must match it exactly, no "v".`, { file: 'manifest.json', rule: 'review/releases' });
      if (manifest.minAppVersion && !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) a(L.error, `'minAppVersion' (${manifest.minAppVersion}) must be semver.`, { file: 'manifest.json', rule: 'obsidianmd/validate-manifest' });
      if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) a(L.error, "'id' should be lowercase letters, digits and hyphens.", { file: 'manifest.json', rule: 'review/manifest' });
      if (manifest.id && manifest.id !== manifestFromApp.id) a(L.error, `'id' (${manifest.id}) does not match the folder Obsidian loaded it from (${manifestFromApp.id}).`, { file: 'manifest.json', rule: 'review/manifest' });
      if (manifest.authorUrl && /github\.com\/obsidianmd/i.test(manifest.authorUrl)) a(L.error, "'authorUrl' points at obsidianmd.", { file: 'manifest.json', rule: 'review/manifest' });
    }
    if (!sections[0].items.some((i) => i.level === L.error)) a(L.pass, 'Manifest has every required field with the right type.', { rule: 'obsidianmd/validate-manifest' });
  }

  // ----- releases -----
  {
    const a = add('Releases');
    if (files['versions.json']) {
      try {
        const v = JSON.parse(files['versions.json']); const keys = Object.keys(v);
        if (m.version && !keys.includes(m.version)) a(L.error, `versions.json has no entry for ${m.version}.`, { file: 'versions.json', rule: 'review/releases' });
        else if (m.version && v[m.version] !== m.minAppVersion) a(L.error, `versions.json maps ${m.version} → ${v[m.version]}; manifest minAppVersion is ${m.minAppVersion}.`, { file: 'versions.json', rule: 'review/releases' });
        else a(L.pass, `versions.json maps ${m.version} → ${m.minAppVersion}.`, { rule: 'review/releases' });
      } catch (e) { a(L.error, `versions.json is not valid JSON: ${e.message}`, { file: 'versions.json', rule: 'review/releases' }); }
    } else a(L.info, 'No versions.json here (normal for an installed copy; required in the repository).', { rule: 'review/releases' });
    if (files['LICENSE']) { if (/Dynalist Inc\./.test(files['LICENSE'])) a(L.warning, 'Please change the copyright holder from "Dynalist Inc." to your name.', { file: 'LICENSE', rule: 'obsidianmd/validate-license' }); const y = files['LICENSE'].match(/\(c\)\s*(\d{4})/i); if (y && Number(y[1]) < new Date().getFullYear() - 1) a(L.rec, `Copyright year is ${y[1]}.`, { file: 'LICENSE', rule: 'obsidianmd/validate-license' }); }
    if (readme === null) a(L.info, 'No README.md here (normal for an installed copy; the directory renders the repository\'s README as the plugin page).', { rule: 'review/releases' });
    else {
      if (readme.length < 400) a(L.warning, `README.md is only ${readme.length} characters; it is the plugin page.`, { file: 'README.md', rule: 'review/readme' });
      const net = /fetch\(|requestUrl\(|XMLHttpRequest|WebSocket\(/.test(code);
      if (net && !/network|internet|request|api|server|online|sync|fetch|download|upload/i.test(readme)) a(L.warning, 'main.js makes network requests but README.md does not mention them.', { file: 'README.md', rule: 'review/policy', help: 'Developer policy: disclose network use — what is sent, to whom, and why.' });
    }
    a(L.info, 'Release checklist: tag equals manifest version, the release has main.js, manifest.json and styles.css attached, and the tagged commit\'s manifest.json matches the default branch.', { rule: 'review/releases' });
  }

  // ----- network -----
  {
    const a = add('Network');
    const hits = findAll(code, /\bfetch\s*\(|\brequestUrl\s*\(|new\s+XMLHttpRequest|new\s+WebSocket\s*\(/);
    const urls = findAll(code, /https?:\/\/[^\s'"`)]+/).map((h) => h.match).filter((u) => !/obsidian\.md|github\.com\/obsidianmd|w3\.org|schema\.org/.test(u));
    const hosts = [...new Set(urls.map((u) => { try { return new URL(u).host; } catch (e) { return null; } }).filter(Boolean))];
    if (!hits.length && !hosts.length) a(L.pass, 'No network requests found.', { rule: 'review/network' });
    else {
      a(L.info, `${hits.length} request call${hits.length === 1 ? '' : 's'}${hosts.length ? '; hosts referenced: ' + hosts.slice(0, 12).map((h) => '`' + h + '`').join(', ') : ''}.`, Object.assign({ rule: 'review/network', help: 'Not a problem by itself; the policy requires the README to say what is sent, to whom and why.' }, first(hits)));
      if (/\b(fetch|XMLHttpRequest)\b/.test(code) && !/requestUrl/.test(code)) a(L.rec, 'Uses fetch/XMLHttpRequest rather than `requestUrl`; `requestUrl` avoids CORS problems and works on mobile.', { file: 'main.js', rule: 'review/network' });
      const sdk = findAll(code, /Sentry\.init\(|mixpanel\.(init|track)\(|posthog\.(init|capture)\(|amplitude\.(init|track|logEvent)\(|\bgtag\(|analytics\.track\(|googletagmanager|segment\.com\/analytics/);
      if (sdk.length) a(L.error, `Analytics SDK call (${sdk[0].match.trim()}). Usage data needs explicit opt-in and README disclosure.`, Object.assign({ rule: 'review/policy' }, first(sdk)));
    }
  }

  // ----- behaviour (community review + linter "problem" rules) -----
  {
    const a = add('Behavior');
    const ev = findAll(bare, /\beval\s*\(|new\s+Function\s*\(/); if (ev.length) a(L.warning, `Uses eval or new Function (${ev.length}×). Often a bundled library; reviewers ask what it evaluates.`, Object.assign({ rule: 'review/behavior' }, first(ev)));
    const obf = findAll(bare, /_0x[0-9a-f]{4,}/i); if (obf.length > 5) a(L.error, 'Identifiers like `_0x1a2b` suggest obfuscated code, which is not allowed.', Object.assign({ rule: 'review/obfuscation' }, first(obf))); else a(L.pass, 'No obfuscation detected.', { rule: 'review/obfuscation' });
    const inner = findAll(bare, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/); if (inner.length) a(L.warning, `innerHTML/outerHTML/insertAdjacentHTML assignment (${inner.length}). Build DOM with createEl/createDiv/createSpan.`, Object.assign({ rule: 'review/behavior', help: 'Plugin guidelines: avoid innerHTML. Reviewers have rejected plugins for it.' }, first(inner)));
    const forb = findAll(code, /(createEl|createElement)\(\s*['"](style|link)['"]/); if (forb.length) a(L.error, `Creating and attaching "${forb[0].match.match(/['"](\w+)['"]/)[1]}" elements is not allowed. For CSS use styles.css.`, Object.assign({ rule: 'obsidianmd/no-forbidden-elements' }, first(forb)));
    const styl = findAll(bare, /\.style\.[a-zA-Z]+\s*=[^=]|\.style\.setProperty\(|setAttribute\(\s*['"]style['"]|setCssProps\(\s*\{|setCssStyles\(\s*\{/); if (styl.length) a(L.error, `Sets styles directly on elements (${styl.length}×); use CSS classes in styles.css.`, Object.assign({ rule: 'obsidianmd/no-static-styles-assignment' }, first(styl)));
    const nav = findAll(bare, /\bnavigator\.(platform|userAgent|appVersion|vendor)\b/); if (nav.length) a(L.error, 'Uses navigator for OS detection; use `Platform` from the Obsidian API.', Object.assign({ rule: 'obsidianmd/platform' }, first(nav)));
    const sample = [...findAll(code, /console\.log\(\s*['"]setInterval['"]\s*\)/), ...findAll(code, /console\.log\(\s*['"]click['"]/)]; if (sample.length) a(L.error, 'Sample code from the plugin template is still present (the demo registerInterval / registerDomEvent).', Object.assign({ rule: 'obsidianmd/no-sample-code' }, first(sample)));
    const sn = findAll(bare, new RegExp('\\b(class|function)\\s+(' + SAMPLE_NAMES.join('|') + ')\\b|\\b(' + SAMPLE_NAMES.join('|') + ')\\s*[:=]')); if (sn.length) a(L.error, 'Rename the sample classes (MyPlugin, SampleSettingTab, SampleModal, MyPluginSettings, mySetting).', Object.assign({ rule: 'obsidianmd/sample-names' }, first(sn)));
    const onun = bare.match(/onunload\s*\([^)]*\)\s*\{/); if (onun) { const body = balancedBlock(bare, onun.index + onun[0].length - 1); if (/detachLeavesOfType\(/.test(body)) a(L.error, "Don't detach leaves in onunload; it resets the leaf to its default location on reload even if the user moved it.", { file: 'main.js', line: lineOf(bare, onun.index), rule: 'obsidianmd/detach-leaves' }); }
    const vref = findAll(bare, /registerView\([^,]+,\s*\(?\s*\w*\s*\)?\s*=>\s*\(?\s*this\.\w+\s*=\s*new/); if (vref.length) a(L.error, 'Do not assign a view instance to a plugin property inside registerView; create and return it directly.', Object.assign({ rule: 'obsidianmd/no-view-references-in-plugin' }, first(vref)));
    const mrc = findAll(bare, /MarkdownRenderer\.(render|renderMarkdown)\([^;]*?,\s*this\s*\)/); if (mrc.length) a(L.error, 'Passing the plugin as the component to MarkdownRenderer.render leaks; use a Component you unload.', Object.assign({ rule: 'obsidianmd/no-plugin-as-component' }, first(mrc)));
    if (!desktopOnly) { const lb = regexLiterals(js).filter((r) => /\(\?<[=!]/.test(r.text)); const lb2 = findAll(js, /new\s+RegExp\(\s*['"`][^'"`]*\(\?<[=!]/); if (lb.length || lb2.length) a(L.error, 'Regex lookbehind is not supported on some iOS versions; the plugin is not desktop-only.', { file: 'main.js', line: lineOf(js, (lb[0] || lb2[0]).index), rule: 'obsidianmd/regex-lookbehind' }); }
    const nodeReq = findAll(bare, /require\(\s*['"](fs|path|child_process|os|electron|crypto|net|http|https|util|stream|zlib)['"]\s*\)/);
    if (nodeReq.length && !desktopOnly) a(L.error, 'Node/Electron modules are used but `isDesktopOnly` is not true; the plugin would fail to load on mobile.', Object.assign({ rule: 'obsidianmd/no-nodejs-modules' }, first(nodeReq)));
    else if (nodeReq.length && !/Platform\.isDesktop/.test(bare)) a(L.info, 'Node/Electron modules are used (desktop-only plugin).', Object.assign({ rule: 'obsidianmd/no-nodejs-modules' }, first(nodeReq)));
    const gt = findAll(bare, /\bglobalThis\b|(^|[^.\w])global\./); if (gt.length) a(L.warning, 'Uses `global`/`globalThis`; use `window` or `activeWindow` for popout compatibility.', Object.assign({ rule: 'obsidianmd/no-global-this' }, first(gt)));
    const timers = findAll(bare, /(^|[^.\w])(setTimeout|setInterval)\s*\(/); if (timers.length) a(L.warning, `Bare ${timers[0].groups[1]}() (${timers.length}×); prefer window.setTimeout()/window.setInterval() for popout windows.`, Object.assign({ rule: 'obsidianmd/prefer-window-timers' }, first(timers)));
    const iv = findAll(bare, /setInterval\s*\(/); if (iv.length && !/registerInterval/.test(bare)) a(L.rec, '`setInterval` without `registerInterval`; the timer survives unload.', Object.assign({ rule: 'review/behavior' }, first(iv)));
    const dom = findAll(bare, /(document|window)\.addEventListener\s*\(/); if (dom.length && !/registerDomEvent/.test(bare)) a(L.rec, 'document/window listeners added without `registerDomEvent`; they leak when the plugin unloads.', Object.assign({ rule: 'review/behavior' }, first(dom)));
    const wson = findAll(code, /\.on\s*\(\s*['"](file-open|active-leaf-change|layout-change|css-change|editor-change|modify|create|delete|rename)['"]/); if (wson.length && !/registerEvent/.test(bare)) a(L.rec, 'Workspace/vault events subscribed without `registerEvent`.', Object.assign({ rule: 'review/behavior' }, first(wson)));
    const cel = findAll(bare, /document\.createElement\s*\(/); if (cel.length) a(L.warning, `document.createElement (${cel.length}×); prefer createEl/createDiv/createSpan/createSvg.`, Object.assign({ rule: 'obsidianmd/prefer-create-el' }, first(cel)));
    const trash = findAll(bare, /vault\.(trash|delete)\s*\(/); if (trash.length) a(L.warning, 'Prefer app.fileManager.trashFile() over vault.trash()/vault.delete() so the user\'s trash setting is respected.', Object.assign({ rule: 'obsidianmd/prefer-file-manager-trash-file' }, first(trash)));
    const lang = findAll(code, /localStorage\.getItem\(\s*['"]language['"]\s*\)|i18next-browser-languagedetector/); if (lang.length) a(L.warning, 'Prefer getLanguage() from the Obsidian API for the user\'s language.', Object.assign({ rule: 'obsidianmd/prefer-get-language' }, first(lang)));
    const iof = findAll(bare, /instanceof\s+(HTMLElement|Element|Node|MouseEvent|KeyboardEvent|Event)\b/); if (iof.length) a(L.warning, `\`instanceof ${iof[0].groups[0]}\`; prefer \`.instanceOf(${iof[0].groups[0]})\` — cross-window safe.`, Object.assign({ rule: 'obsidianmd/prefer-instanceof' }, first(iof)));
    const tis = findAll(bare, /class\s+\w+\s+extends\s+TextInputSuggest\b/); if (tis.length) a(L.warning, 'The copied TextInputSuggest; use the built-in AbstractInputSuggest.', Object.assign({ rule: 'obsidianmd/prefer-abstract-input-suggest' }, first(tis)));
    const oa = findAll(bare, /Object\.assign\(\s*([A-Za-z_$][\w$.]*)\s*,\s*[^,()]+\)/).filter((h) => !/^\{/.test(h.groups[0])); if (oa.length) a(L.warning, `Object.assign with two arguments mutates the first (${oa.length}×); use three arguments or spread.`, Object.assign({ rule: 'obsidianmd/object-assign' }, first(oa)));
    const vit = findAll(bare, /get(Markdown)?Files\(\)\s*\.(find|filter)\(/); if (vit.length) a(L.warning, 'Iterating all files to find one by path; use vault.getFileByPath() / getAbstractFileByPath().', Object.assign({ rule: 'obsidianmd/vault/iterate' }, first(vit)));
    const cfg = findAll(code, /['"`][^'"`\n]*(?<![a-zA-Z0-9])\.obsidian(?![a-zA-Z_-])[^'"`\n]*['"`]/); if (cfg.length) a(L.warning, `Hardcoded config-folder path ("${'.obsi' + 'dian'}/…"); use \`app.vault.configDir\`.`, { file: 'main.js', line: lineOf(code, cfg[0].index), rule: 'obsidianmd/hardcoded-config-path' });
    const edp = findAll(code, /\.on\s*\(\s*['"]editor-(paste|drop)['"]/); if (edp.length && !/defaultPrevented/.test(bare)) a(L.warning, 'editor-paste/editor-drop handler without checking evt.defaultPrevented and calling evt.preventDefault().', Object.assign({ rule: 'obsidianmd/editor-drop-paste' }, first(edp)));
    const log = findAll(bare, /console\.(log|info)\s*\(/); if (log.length) a(L.warning, `console.${log[0].groups[0]} (${log.length}×). Only warn, error and debug are allowed by the recommended config.`, Object.assign({ rule: 'no-console' }, first(log)));
    const declaresApp = /(?:\(|,)\s*app\s*(?:,|\)|=)|\b(?:const|let|var)\s+app\b|\{\s*app\s*[,}]|\bapp\s*=[^=]/.test(bare);
    const winApp = findAll(bare, /\bwindow\.app\b/); const glob = declaresApp ? [] : findAll(bare, /(^|[^.\w])app\.(vault|workspace|metadataCache|plugins|commands)\b/);
    if (winApp.length || glob.length) a(L.warning, `References the global \`app\` (${winApp.length + glob.length}×); use \`this.app\`.`, Object.assign({ rule: 'review/behavior' }, first(winApp.length ? winApp : glob)));
    const al = findAll(bare, /workspace\.activeLeaf\b/); if (al.length) a(L.warning, '`workspace.activeLeaf` is deprecated; use getActiveViewOfType() or getMostRecentLeaf().', Object.assign({ rule: 'review/behavior' }, first(al)));
    const enumr = findAll(bare, /vault\.get(Files|MarkdownFiles|AllLoadedFiles)\(\)/); if (enumr.length) a(L.rec, 'Vault enumeration: lists every file in the vault (vault.getFiles / getMarkdownFiles). The scorecard notes it as a recommendation.', Object.assign({ rule: 'review/behavior' }, first(enumr)));
    const clip = findAll(bare, /navigator\.clipboard/); if (clip.length) a(L.rec, 'Reads or writes the system clipboard; the scorecard notes it. Fine if the README says so.', Object.assign({ rule: 'review/behavior' }, first(clip)));
    const adapter = findAll(bare, /vault\.adapter\.(read|write|exists|list|remove|rename|mkdir)/); if (adapter.length) a(L.rec, `Uses \`vault.adapter\` (${adapter.length}×); prefer the Vault API where possible.`, Object.assign({ rule: 'review/behavior' }, first(adapter)));
    const ls = findAll(bare, /\blocalStorage\.(get|set|remove)Item/).filter((h) => !/language/.test(js.slice(h.index, h.index + 60))); if (ls.length) a(L.rec, 'Uses localStorage; prefer loadData()/saveData() or app.loadLocalStorage/saveLocalStorage.', Object.assign({ rule: 'review/behavior' }, first(ls)));
    if (/vault\.(modify|create|createBinary|delete|trash|rename|append|process)\(|adapter\.(write|writeBinary|remove|rename|mkdir)\(/.test(bare)) a(L.info, 'Creates or modifies vault files.', { rule: 'review/behavior' });
    if (/vault\.(read|cachedRead|readBinary)\(|adapter\.(read|readBinary|list)\(/.test(bare)) a(L.info, 'Reads vault files.', { rule: 'review/behavior' });
    const priv = findAll(bare, /app\.(plugins|customCss|internalPlugins|hotkeyManager|setting)\b/); if (priv.length) a(L.info, `Uses undocumented app internals (${[...new Set(priv.map((p) => p.match))].join(', ')}); expect them to change without notice.`, Object.assign({ rule: 'review/behavior' }, first(priv)));
    if (!/module\.exports\s*=|export\s+default\s|exports\.default\s*=/.test(js)) a(L.error, 'main.js has no default export of the Plugin class.', { file: 'main.js', rule: 'review/behavior' });
  }

  // ----- css -----
  {
    const a = add('CSS');
    if (!css) a(L.pass, 'No styles.css (nothing to lint).', { rule: 'review/css' });
    else {
      const imp = findAll(css, /!important/); if (imp.length) a(L.warning, `${imp.length} \`!important\`${imp.length === 1 ? '' : 's'}; the review flags each one.`, { file: 'styles.css', line: lineOf(css, imp[0].index), rule: 'review/css' }); else a(L.pass, 'No !important.', { rule: 'review/css' });
      const cs = css.replace(/\/\*[\s\S]*?\*\//g, ''); const rules = findAll(cs, /([^{}]+)\{([^{}]*)\}/);
      const OBS_PREFIX = /^(workspace|view-|nav-|markdown-|cm-|modal|setting|menu|prompt|suggestion|tree-item|status-bar|tab-|side-dock|sidebar|titlebar|callout|metadata|clickable-icon|dropdown|checkbox|is-|mod-|internal-embed|inline-title|community|vertical-tab|horizontal-tab|search-|graph|canvas|notice|tooltip|popover|task-list|list-|table|math|mermaid|footnote|tag|HyperMD|multi-select|slider|document-search|empty-state|file-embed|frontmatter|hover|input|kanban|properties)/;
      const stem = id.replace(/^obsidian-/, '').split('-')[0];
      const own = (c) => !OBS_PREFIX.test(c) && (js.includes(c) || js.includes(c.replace(/\d+$/, '')) || (c.includes('-') && js.includes(c.slice(0, c.lastIndexOf('-') + 1))) || c.includes(stem) || c.includes(id));
      const unscoped = [];
      for (const r of rules) { const sel = r.groups[0].trim(); if (!sel || sel.startsWith('@') || sel.startsWith(':root') || sel === 'body' || sel.startsWith('body.')) continue; const classes = (sel.match(/\.[A-Za-z0-9_-]+/g) || []).map((c) => c.slice(1)); if (!classes.some(own) && !/\[data-type=|#|::?[a-z-]+\(/.test(sel)) unscoped.push({ sel, line: lineOf(cs, r.index) }); }
      if (unscoped.length) a(L.rec, `${unscoped.length} rule${unscoped.length === 1 ? '' : 's'} restyle Obsidian's own classes with no plugin class in the selector (first: \`${esc(unscoped[0].sel.slice(0, 80))}\`).`, { file: 'styles.css', line: unscoped[0].line, rule: 'review/css' });
      const hard = findAll(cs, /#[0-9a-fA-F]{3,8}\b|rgba?\(/); const vars = findAll(cs, /var\(--/); if (hard.length > 8 && hard.length > vars.length) a(L.rec, `${hard.length} hard-coded colours vs ${vars.length} variable uses; prefer Obsidian's CSS variables.`, { file: 'styles.css', line: lineOf(cs, hard[0].index), rule: 'review/css' });
      const glob = findAll(cs, /(^|\})\s*(\*|html|body|\.workspace(?![-\w])|\.view-content|\.markdown-preview-view|\.cm-editor)\s*\{/); if (glob.length) a(L.warning, 'Rules on `*`, `html`, `body`, `.workspace` or the editor/preview root change the whole app.', { file: 'styles.css', line: lineOf(cs, glob[0].index), rule: 'review/css' });
    }
  }

  // ----- ui text (commands + settings tab + sentence case) -----
  {
    const a = add('UI text');
    const cmdBlocks = findAll(code, /addCommand\s*\(\s*\{/).map((h) => ({ index: h.index, block: balancedBlock(js, h.index + h.match.length - 1) }));
    const cmdOf = (b, key) => (b.block.match(new RegExp('\\b' + key + '\\s*:\\s*[\'"`]([^\'"`]+)[\'"`]')) || [])[1];
    for (const b of cmdBlocks) {
      const cid = cmdOf(b, 'id') || '', cname = cmdOf(b, 'name') || ''; const where = { file: 'main.js', line: lineOf(js, b.index) };
      if (/\bcommand\b/i.test(cid)) a(L.warning, `Command id "${cid}" contains "command".`, Object.assign({ rule: 'obsidianmd/commands/no-command-in-command-id' }, where));
      if (/\bcommand\b/i.test(cname)) a(L.warning, `Command name "${cname}" contains "command".`, Object.assign({ rule: 'obsidianmd/commands/no-command-in-command-name' }, where));
      if (id && cid.toLowerCase().includes(id.toLowerCase())) a(L.warning, `Command id "${cid}" includes the plugin id; Obsidian namespaces ids already.`, Object.assign({ rule: 'obsidianmd/commands/no-plugin-id-in-command-id' }, where));
      if (name && cname.toLowerCase().includes(name.toLowerCase())) a(L.warning, `Command name "${cname}" includes the plugin name; the UI already shows it next to the command.`, Object.assign({ rule: 'obsidianmd/commands/no-plugin-name-in-command-name' }, where));
      if (/\bhotkeys\s*:/.test(b.block)) a(L.warning, `Command "${cname || cid}" sets a default hotkey; they conflict with users' and Obsidian's own.`, Object.assign({ rule: 'obsidianmd/commands/no-default-hotkeys' }, where));
    }
    // settings tab
    const tabM = bare.match(/class\s+\w+\s+extends\s+(?:\w+\.)?PluginSettingTab\s*\{/);
    if (tabM) {
      const tabBody = balancedBlock(js, tabM.index + tabM[0].length - 1); const tabStart = tabM.index;
      const hEl = findAll(maskCode(tabBody), /createEl\(\s*['"]h[1-6]['"]/); if (hEl.length) a(L.error, 'Settings headings created with createEl("h2"); use new Setting(el).setName("…").setHeading().', { file: 'main.js', line: lineOf(js, tabStart + hEl[0].index), rule: 'obsidianmd/settings-tab/no-manual-html-headings' });
      const heads = findAll(tabBody, /\.setName\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)\s*\.setHeading\(\)/);
      for (const h of heads) { const t = h.groups[1].toLowerCase(); const where = { file: 'main.js', line: lineOf(js, tabStart + h.index), rule: 'obsidianmd/settings-tab/no-problematic-settings-headings' }; if (t.includes('settings') || t.includes('options')) a(L.error, `Avoid using "settings" in settings headings ("${h.groups[1]}").`, where); else if (t.includes('general')) a(L.error, `Avoid using a "General" heading in settings ("${h.groups[1]}").`, where); else if (name && t.includes(name.toLowerCase())) a(L.error, `Avoid including the plugin name in settings headings ("${h.groups[1]}").`, where); }
      if (m.minAppVersion && /^1\.(1[3-9]|[2-9]\d)/.test(m.minAppVersion) && !/getSettingDefinitions/.test(tabBody)) a(L.rec, 'Implement getSettingDefinitions() so settings appear in Obsidian 1.13+ settings search.', { file: 'main.js', line: lineOf(js, tabStart), rule: 'obsidianmd/settings-tab/prefer-setting-definitions' });
    }
    // sentence case over UI strings
    const uiStrings = [];
    for (const b of cmdBlocks) { const n = cmdOf(b, 'name'); if (n) uiStrings.push({ text: n, index: b.index, kind: 'command' }); }
    for (const meth of ['setName', 'setDesc', 'setButtonText', 'setTooltip', 'setPlaceholder', 'setText', 'setTitle']) for (const s of extractStrings(js, '.' + meth)) uiStrings.push({ text: s.text, index: s.index, kind: meth });
    for (const h of findAll(js, /addRibbonIcon\(\s*['"`][^'"`]*['"`]\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/)) uiStrings.push({ text: h.groups[1], index: h.index, kind: 'ribbon tooltip' });
    for (const h of findAll(js, /addOption\(\s*['"`][^'"`]*['"`]\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/)) uiStrings.push({ text: h.groups[1], index: h.index, kind: 'dropdown option' });
    for (const s of extractStrings(js, 'new Notice')) uiStrings.push({ text: s.text, index: s.index, kind: 'notice' });
    for (const h of findAll(js, /\b(text|title)\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2/)) uiStrings.push({ text: h.groups[2], index: h.index, kind: h.groups[0] });
    const bad = [];
    for (const u of uiStrings) { const t = u.text.replace(/\\n/g, ' ').trim(); if (isSkippableString(t) || t.length < 3 || !/[A-Za-z]/.test(t)) continue; const sug = sentenceCaseSuggestion(t, [name]); if (sug !== t) bad.push(Object.assign({ suggestion: sug }, u)); }
    if (bad.length) a(L.warning, `${bad.length} UI string${bad.length === 1 ? '' : 's'} not in sentence case.`, { file: 'main.js', line: lineOf(js, bad[0].index), rule: 'obsidianmd/ui/sentence-case', help: 'Brand names and acronyms from the official lists plus this plugin\'s own name are kept; CamelCase words are allowed.', details: bad.slice(0, 40).map((b) => `${b.kind}: "${b.text}" → "${b.suggestion}"`) });
    const sec = sections[sections.length - 1];
    if (!sec.items.length) a(L.pass, 'Commands and settings text follow the guidelines: sentence case, no plugin name, no "settings" headings, no default hotkeys.', { rule: 'obsidianmd/ui/sentence-case' });
  }

  const counts = { error: 0, warning: 0, rec: 0, info: 0, pass: 0, blocking: 0 };
  for (const s of sections) for (const i of s.items) { const k = Object.keys(L).find((kk) => L[kk] === i.level); counts[k]++; if (i.blocks) counts.blocking++; }
  return { sections, counts, manifest: m };
}

function reviewNote(plugin, dir, files, r) {
  const when = new Date();
  const out = [];
  const verdict = r.counts.blocking ? 'fail' : 'pass';
  out.push('---', `plugin: ${plugin.name}`, `plugin_id: ${plugin.id}`, `plugin_version: ${(r.manifest && r.manifest.version) || plugin.version}`, `date: ${when.toISOString().slice(0, 10)}`, `verdict: ${verdict}`, `blocking: ${r.counts.blocking}`, `lint_errors: ${r.counts.error - r.counts.blocking}`, `warnings: ${r.counts.warning}`, `recommendations: ${r.counts.rec}`, 'tags: [plugin-lab, review]', '---', '');
  out.push(`# ${plugin.name} — pre-flight review`, '');
  out.push(`\`${dir}\` · ${(r.manifest && r.manifest.version) || plugin.version} · ${when.toLocaleString()}`, '');
  const lintErr = r.counts.error - r.counts.blocking;
  const callout = r.counts.blocking ? 'failure' : lintErr ? 'warning' : 'success';
  out.push(`> [!${callout}] Summary`,
    `> **Community review:** ${r.counts.blocking ? `would fail — ${r.counts.blocking} blocking error${r.counts.blocking === 1 ? '' : 's'}.` : 'would pass.'} This is the gate for the plugin directory.`,
    `> **Official linter:** ${lintErr} error${lintErr === 1 ? '' : 's'} · ${r.counts.warning} warning${r.counts.warning === 1 ? '' : 's'} (eslint-plugin-obsidianmd, the guidelines reviewers point to; not enforced by the directory).`,
    `> ${r.counts.rec} recommendations · ${r.counts.pass} passes`, '');
  const icon = { Error: '✗', Warning: '⚠', Recommendation: '△', Info: 'ℹ', Pass: '✓' };
  for (const s of r.sections) {
    out.push(`## ${s.name}`, '');
    const order = ['Error', 'Warning', 'Recommendation', 'Info', 'Pass'];
    const items = [...s.items].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    for (const i of items) {
      const where = i.file ? ` <small>${i.file}${i.line ? ':' + i.line : ''}</small>` : '';
      const rule = i.rule ? (RULE_DOC(i.rule) ? ` <small>[${i.rule}](${RULE_DOC(i.rule)})</small>` : ` <small>${i.rule}</small>`) : '';
      out.push(`- ${icon[i.level]} **${i.level}** — ${i.text}${where}${rule}`);
      if (i.help) out.push(`    - ${i.help}`);
      if (i.details) for (const d of i.details) out.push(`    - ${esc(d)}`);
    }
    out.push('');
  }
  out.push('## Sources', '', 'Rules marked `obsidianmd/…` mirror [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin), the official linter (its `recommended` config; Error = enabled rule, Warning = warn-level rule), including its brand and acronym lists for sentence case. Rules marked `review/…` are what the community review scorecard checks — Manifest, Releases, Network, Behavior, CSS lint, Dependencies and Code obfuscation — where Errors block a listing. This is a static approximation of both: it reads main.js as text, so a few rules that need type information (no-unsupported-api, no-tfile-tfolder-cast) are not covered, nor are npm dependency audits.', '');
  return out.join('\n');
}


// ---------- static command analysis ----------
// Finds each addCommand({...}) block, follows one level of this.method() calls, and says what the command does.
function balancedBlock(text, openIdx) {
  // openIdx points at '{'; returns the substring up to and including the matching '}' (string/template/comment aware, good enough for bundled code)
  let depth = 0, i = openIdx, inStr = null, inLine = false, inBlock = false;
  for (; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
    if (i - openIdx > 60000) break;
  }
  return text.slice(openIdx, Math.min(text.length, openIdx + 4000));
}
function methodBodies(js) {
  // name -> body text for `name(...) {` and `name = (...) => {` and `async name(`
  const out = {}; const re = /(?:^|[\s;{])(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g; let m;
  while ((m = re.exec(js))) { const name = m[1]; if (/^(if|for|while|switch|catch|function|return|constructor)$/.test(name)) continue; if (!out[name]) out[name] = balancedBlock(js, m.index + m[0].length - 1).slice(0, 8000); }
  return out;
}
function classify(body, modalNames, bodies, depth = 0) {
  const r = { dialog: false, view: false, editor: false, writes: false, network: false, external: false };
  const test = (b) => {
    if (/\.open\(\)/.test(b) || (modalNames.length && new RegExp('new\\s+(' + modalNames.join('|') + ')\\b').test(b)) || /new\s+(?:\w+\.)?(Modal|SuggestModal|FuzzySuggestModal)\b/.test(b)) r.dialog = true;
    if (/setViewState\(|revealLeaf\(|openFile\(|openLinkText\(|getLeaf\(/.test(b)) r.view = true;
    if (/editorCallback|editorCheckCallback|\.editor\b|getActiveViewOfType\(\s*(?:\w+\.)?MarkdownView/.test(b)) r.editor = true;
    if (/vault\.(modify|create|createBinary|delete|trash|rename|append|process)\(|adapter\.(write|writeBinary|remove|rename|mkdir|rmdir)\(|saveData\(|fileManager\.(renameFile|trashFile)|processFrontMatter\(/.test(b)) r.writes = true;
    if (/fetch\(|requestUrl\(|XMLHttpRequest|WebSocket\(/.test(b)) r.network = true;
    if (/window\.open\(|shell\.openExternal|openPath\(/.test(b)) r.external = true;
  };
  test(body);
  if (depth < 2) for (const call of findAll(body, /this\.([A-Za-z_$][\w$]*)\s*\(/)) { const nm = call.groups[0]; if (bodies[nm]) { const sub = classify(bodies[nm], modalNames, bodies, depth + 1); for (const k of Object.keys(r)) r[k] = r[k] || sub[k]; } }
  return r;
}
function analyzeCommands(js) {
  const modalNames = findAll(js, /class\s+(\w+)\s+extends\s+(?:\w+\.)?(?:Modal|SuggestModal|FuzzySuggestModal)\b/).map((h) => h.groups[0]);
  const bodies = methodBodies(js);
  const out = {};
  for (const h of findAll(js, /addCommand\s*\(\s*\{/)) {
    const block = balancedBlock(js, h.index + h.match.length - 1);
    const id = (block.match(/\bid\s*:\s*['"`]([^'"`]+)['"`]/) || [])[1]; if (!id) continue;
    const name = (block.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/) || [])[1] || '';
    out[id] = Object.assign({ name }, classify(block, modalNames, bodies));
  }
  return out;
}
function describeCommand(a) {
  if (!a) return '';
  const t = [];
  if (a.dialog) t.push('dialog'); if (a.view) t.push('view'); if (a.editor) t.push('editor'); if (a.writes) t.push('writes'); if (a.network) t.push('network'); if (a.external) t.push('external');
  return t.join(' · ');
}
function commandIsSafeToSweep(a) { return !!a && (a.dialog || a.view) && !a.writes && !a.network && !a.external; }

// ---------- inventory ----------
function inventoryPlugin(app, plugin, files) {
  const js = files['main.js'] || '';
  const cmds = Object.values((app.commands && app.commands.commands) || {}).filter((c) => c.id.startsWith(plugin.id + ':'));
  const hotkeyOf = (c) => {
    const custom = app.hotkeyManager && app.hotkeyManager.customKeys && app.hotkeyManager.customKeys[c.id];
    const keys = custom || c.hotkeys || [];
    return keys.map((k) => [...(k.modifiers || []).map((mm) => ({ Mod: 'Ctrl/Cmd', Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Cmd' }[mm] || mm)), k.key].join(' + ')).join(', ');
  };
  const ribbons = extractStrings(js, 'addRibbonIcon').map((s) => s.text);
  const ribbonLabels = findAll(js, /addRibbonIcon\(\s*['"`][^'"`]*['"`]\s*,\s*['"`]([^'"`]*)['"`]/).map((h) => h.groups[0]);
  const views = findAll(js, /registerView\(\s*([A-Za-z_$][\w$]*|['"`][^'"`]+['"`])/).map((h) => h.groups[0].replace(/['"`]/g, ''));
  const viewConsts = {}; for (const h of findAll(js, /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"`]([^'"`]+)['"`]/)) viewConsts[h.groups[0]] = h.groups[1];
  const viewTypes = views.map((v) => viewConsts[v] || v);
  const processors = findAll(js, /registerMarkdownCodeBlockProcessor\(\s*['"`]([^'"`]+)['"`]/).map((h) => h.groups[0]);
  const postProcessors = findAll(js, /registerMarkdownPostProcessor\(/).length;
  const editorExt = findAll(js, /registerEditorExtension\(/).length;
  const protocol = findAll(js, /registerObsidianProtocolHandler\(\s*['"`]([^'"`]+)['"`]/).map((h) => h.groups[0]);
  const extensions = findAll(js, /registerExtensions\(\s*\[([^\]]*)\]/).map((h) => h.groups[0].replace(/['"`\s]/g, ''));
  const fileMenu = /['"]file-menu['"]/.test(js), editorMenu = /['"]editor-menu['"]/.test(js);
  // settings, in source order, with headings
  const settings = []; const re = /\.setName\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)([\s\S]{0,400}?)(?=new\s+Setting\(|$)/g; let mm;
  while ((mm = re.exec(js))) {
    const tail = mm[3];
    const isHeading = /\.setHeading\(\)/.test(tail);
    const type = isHeading ? 'heading' : /addToggle/.test(tail) ? 'toggle' : /addDropdown/.test(tail) ? 'dropdown' : /addSlider/.test(tail) ? 'slider' : /addTextArea/.test(tail) ? 'text area' : /addText/.test(tail) ? 'text' : /addButton/.test(tail) ? 'button' : /addExtraButton/.test(tail) ? 'icon button' : /addColorPicker/.test(tail) ? 'colour' : /addMomentFormat/.test(tail) ? 'date format' : /addSearch/.test(tail) ? 'search' : /addProgressBar/.test(tail) ? 'progress' : '';
    const descM = tail.match(/\.setDesc\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
    settings.push({ name: mm[2], type, desc: descM ? descM[2] : '', heading: isHeading });
  }
  let data = null; try { data = files['data.json'] ? JSON.parse(files['data.json']) : null; } catch (e) { data = null; }
  const modals = findAll(js, /class\s+(\w+)\s+extends\s+(?:\w+\.)?(Modal|SuggestModal|FuzzySuggestModal|PopoverSuggest|EditorSuggest|AbstractInputSuggest)\b/).map((h) => ({ name: h.groups[0], base: h.groups[1] }));
  const analysis = analyzeCommands(js);
  return { analysis, modals, cmds, hotkeyOf, ribbons, ribbonLabels, viewTypes, processors, postProcessors, editorExt, protocol, extensions, fileMenu, editorMenu, settings, data };
}
function inventoryNote(plugin, dir, inv) {
  const when = new Date(); const out = [];
  out.push('---', `plugin: ${plugin.name}`, `plugin_id: ${plugin.id}`, `plugin_version: ${plugin.version}`, `date: ${when.toISOString().slice(0, 10)}`, `commands: ${inv.cmds.length}`, `settings: ${inv.settings.filter((s) => !s.heading).length}`, 'tags: [plugin-lab, inventory]', '---', '');
  out.push(`# ${plugin.name} — inventory`, '', `\`${dir}\` · ${plugin.version} · ${when.toLocaleString()} · ${plugin.enabled ? 'enabled' : 'disabled (commands and hotkeys need it enabled)'}`, '');
  out.push('## Commands', '');
  if (!inv.cmds.length) out.push('_No commands registered (is the plugin enabled?)._', '');
  else {
    out.push('| Command | Default hotkey | Does | Id |', '|---|---|---|---|');
    for (const c of inv.cmds) { const local = c.id.slice(plugin.id.length + 1); out.push(`| ${esc(c.name.replace(/^[^:]+:\s*/, ''))} | ${esc(inv.hotkeyOf(c)) || '—'} | ${describeCommand(inv.analysis[local]) || '—'} | \`${c.id}\` |`); }
    out.push('');
  }
  out.push('## Settings', '');
  if (!inv.settings.length) out.push('_No settings tab found in main.js._', '');
  else {
    out.push('| Setting | Type | Description |', '|---|---|---|');
    for (const s of inv.settings) out.push(s.heading ? `| **${esc(s.name)}** | heading | |` : `| ${esc(s.name)} | ${s.type || '—'} | ${esc(s.desc)} |`);
    out.push('');
  }
  const surf = [];
  if (inv.ribbons.length) surf.push(`- **Ribbon icons:** ${inv.ribbons.map((r, i) => `\`${r}\`${inv.ribbonLabels[i] ? ' — ' + inv.ribbonLabels[i] : ''}`).join(', ')}`);
  if (inv.viewTypes.length) surf.push(`- **Views:** ${inv.viewTypes.map((v) => '`' + v + '`').join(', ')}`);
  if (inv.processors.length) surf.push(`- **Code blocks:** ${inv.processors.map((v) => '```' + v + '```').join(', ')}`);
  if (inv.postProcessors) surf.push(`- **Markdown post-processors:** ${inv.postProcessors}`);
  if (inv.editorExt) surf.push(`- **Editor extensions:** ${inv.editorExt}`);
  if (inv.protocol.length) surf.push(`- **URI handlers:** ${inv.protocol.map((v) => '`obsidian://' + v + '`').join(', ')}`);
  if (inv.extensions.length) surf.push(`- **File extensions:** ${inv.extensions.join(', ')}`);
  if (inv.modals.length) surf.push(`- **Dialogs:** ${inv.modals.map((mo) => `${mo.name} (${mo.base})`).join(', ')} — open these by hand or via the command sweep to capture them`);
  if (inv.fileMenu) surf.push('- Adds items to the **file menu**');
  if (inv.editorMenu) surf.push('- Adds items to the **editor menu**');
  out.push('## Surfaces', '', ...(surf.length ? surf : ['_Commands only._']), '');
  if (inv.data && typeof inv.data === 'object') {
    const keys = Object.keys(inv.data);
    out.push('## Stored settings (data.json)', '', `${keys.length} key${keys.length === 1 ? '' : 's'}: ${keys.map((k) => '`' + k + '`').join(', ')}`, '');
  }
  out.push('## README snippet', '', 'Copy into the README:', '', '```markdown', '## Commands', '');
  for (const c of inv.cmds) out.push(`- **${c.name.replace(/^[^:]+:\s*/, '')}**${inv.hotkeyOf(c) ? ' (' + inv.hotkeyOf(c) + ')' : ''}`);
  if (inv.settings.some((s) => !s.heading)) { out.push('', '## Settings', ''); for (const s of inv.settings) if (!s.heading) out.push(`- **${s.name}** — ${s.desc || s.type}`); }
  out.push('```', '');
  return out.join('\n');
}

// ---------- the plugin ----------
class PluginLabPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new PluginLabSettingTab(this.app, this));
    this.statusEl = this.addStatusBarItem(); this.statusEl.addClass('plugin-lab-status'); this.statusEl.hide();
    this.registerView(VIEW_TYPE, (leaf) => new PluginLabView(leaf, this));
    this.addRibbonIcon('microscope', 'Open Plugin Lab', () => this.openPanel());
    this.addCommand({ id: 'open-panel', name: 'Open panel', callback: () => this.openPanel() });
    this.addCommand({ id: 'review', name: 'Review a plugin (pre-flight for the community review)', callback: () => this.pick('Review', (p) => this.review(p)) });
    this.addCommand({ id: 'inventory', name: 'Write a plugin inventory (commands, settings, surfaces)', callback: () => this.pick('Inventory', (p) => this.inventory(p)) });
    this.addCommand({ id: 'matrix', name: 'Capture a plugin\'s UI under every theme', callback: () => this.pick('Capture', (p) => new MatrixModal(this.app, this, p).open()) });
    this.addCommand({ id: 'capture-one', name: 'Capture one screenshot now', callback: () => this.captureOne() });
    this.addCommand({ id: 'review-all', name: 'Review every installed plugin (summary note)', callback: () => this.reviewAll() });
  }
  onunload() { /* views are detached by Obsidian; no timers, no DOM outside modals */ }
  async openPanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
  targetPlugin() { const id = this.settings.lastPlugin; return installedPlugins(this.app).find((p) => p.id === id) || null; }
  refreshPanels() { this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => l.view && l.view.refresh && l.view.refresh()); }
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); for (const k of ['captures', 'schemes', 'themes', 'commandPicks', 'ribbonPicks']) this.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], this.settings[k]); }
  async saveSettings() { await this.saveData(this.settings); }

  // ----- files -----
  async ensureFolder(path) {
    const p = normalizePath(path); const parts = p.split('/'); let cur = '';
    for (const part of parts) { cur = cur ? `${cur}/${part}` : part; if (!(await this.app.vault.adapter.exists(cur))) await this.app.vault.createFolder(cur); }
    return p;
  }
  pluginDir(p) { return `${this.settings.outputFolder}/${p.name}`; }
  async writeNote(name, text, dir) {
    const folder = await this.ensureFolder(dir); const path = normalizePath(`${folder}/${name}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, text); else await this.app.vault.create(path, text);
    return path;
  }
  async openNote(path) { const f = this.app.vault.getAbstractFileByPath(path); if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f); }

  // ----- picker -----
  pick(verb, fn) {
    const plugins = installedPlugins(this.app).filter((p) => p.id !== 'plugin-lab');
    if (!plugins.length) { new Notice('Plugin Lab: no community plugins installed'); return; }
    new PluginPicker(this.app, this, plugins, verb, async (p) => { this.settings.lastPlugin = p.id; await this.saveSettings(); this.refreshPanels(); await fn(p); }).open();
  }

  // ----- review -----
  async review(p) {
    const { dir, files } = await loadPluginFiles(this.app, p);
    if (!files['main.js']) { new Notice(`Plugin Lab: ${p.name} has no main.js in ${dir}`); return; }
    const r = reviewPlugin(p, files);
    const path = await this.writeNote(`Review ${stamp()}`, reviewNote(p, dir, files, r), this.pluginDir(p));
    await this.openNote(path);
    new Notice(`Plugin Lab: ${p.name} — ${r.counts.error} errors, ${r.counts.warning} warnings`); this.refreshPanels();
  }
  async reviewAll() {
    const plugins = installedPlugins(this.app);
    const rows = []; const batch = stamp();
    this.statusEl.setText('Plugin Lab: reviewing…'); this.statusEl.show();
    for (const p of plugins) {
      const { dir, files } = await loadPluginFiles(this.app, p); if (!files['main.js']) continue;
      const r = reviewPlugin(p, files);
      const note = await this.writeNote(`Review ${batch}`, reviewNote(p, dir, files, r), this.pluginDir(p));
      const firstErr = r.sections.flatMap((s) => s.items).find((i) => i.blocks) || r.sections.flatMap((s) => s.items).find((i) => i.level === L.error);
      rows.push({ p, r, firstErr, note });
      this.statusEl.setText(`Plugin Lab: reviewed ${rows.length}/${plugins.length}`);
    }
    this.statusEl.hide();
    const when = new Date();
    const out = ['---', `date: ${when.toISOString().slice(0, 10)}`, `plugins: ${rows.length}`, `would_fail: ${rows.filter((x) => x.r.counts.blocking).length}`, 'tags: [plugin-lab, review, summary]', '---', '', '# Installed plugins — pre-flight summary', '', `${rows.length} plugins · ${when.toLocaleString()} · each row links to that plugin's full review note.`, '', '| Plugin | Version | Community review | Linter errors | Warnings | Recs | First finding |', '|---|---|---|---|---|---|---|'];
    rows.sort((a, b) => b.r.counts.blocking - a.r.counts.blocking || b.r.counts.error - a.r.counts.error || b.r.counts.warning - a.r.counts.warning || a.p.name.localeCompare(b.p.name));
    for (const { p, r, firstErr, note } of rows) out.push(`| [[${note.replace(/\.md$/, '')}\\|${esc(p.name)}]] | ${p.version} | ${r.counts.blocking ? '✗ would fail' : '✓ would pass'} | ${r.counts.error - r.counts.blocking} | ${r.counts.warning} | ${r.counts.rec} | ${firstErr ? esc(firstErr.text.slice(0, 90)) : '—'} |`);
    out.push('');
    for (const { p, r, note } of rows) {
      const items = r.sections.flatMap((sec) => sec.items.filter((i) => i.level === L.error || i.level === L.warning).map((i) => Object.assign({ section: sec.name }, i)));
      if (!items.length) continue;
      out.push(`## [[${note.replace(/\.md$/, '')}|${p.name}]]`, '');
      for (const i of items) out.push(`- ${i.level === L.error ? '✗' : '⚠'} **${i.level}** — ${i.text}${i.file ? ` <small>${i.file}${i.line ? ':' + i.line : ''}</small>` : ''}${i.rule ? ` <small>${i.rule}</small>` : ''}`);
      out.push('');
    }
    const path = await this.writeNote(`Summary ${batch}`, out.join('\n'), this.settings.outputFolder);
    await this.openNote(path); this.refreshPanels();
    new Notice(`Plugin Lab: ${rows.length} plugins reviewed, ${rows.filter((x) => x.r.counts.blocking).length} would fail`);
  }
  // ----- inventory -----
  async inventory(p) {
    const { dir, files } = await loadPluginFiles(this.app, p);
    const inv = inventoryPlugin(this.app, p, files);
    const path = await this.writeNote(`Inventory ${stamp()}`, inventoryNote(p, dir, inv), this.pluginDir(p));
    await this.openNote(path);
  }

  async listRuns(p) {
    const dir = this.pluginDir(p); if (!(await this.app.vault.adapter.exists(dir))) return { runs: [], notes: [] };
    const { folders, files } = await this.app.vault.adapter.list(dir);
    return { runs: folders.filter((f) => /\d{4}-\d{2}-\d{2} \d{6}$/.test(f)).sort().reverse(), notes: files.filter((f) => /\/(Review|Inventory) .*\.md$/.test(f)).sort().reverse() };
  }
  // ----- themes and schemes -----
  isDark() { return document.body.classList.contains('theme-dark'); }
  async setScheme(dark) {
    if (this.isDark() === dark) return true;
    try { if (typeof this.app.changeTheme === 'function') this.app.changeTheme(dark ? 'obsidian' : 'moonstone'); } catch (e) { /* fall through */ }
    await sleep(150);
    if (this.isDark() !== dark) { try { this.app.commands.executeCommandById('theme:switch'); } catch (e) { /* ignore */ } await sleep(150); }
    await sleep(this.settings.settleMs);
    return this.isDark() === dark;
  }
  installedThemes() {
    const cc = this.app.customCss; const names = cc && cc.themes ? Object.keys(cc.themes) : [];
    return names.sort((a, b) => a.localeCompare(b));
  }
  currentTheme() { const cc = this.app.customCss; return (cc && cc.theme) || ''; }
  async setTheme(name) {
    const cc = this.app.customCss; if (!cc || typeof cc.setTheme !== 'function') return false;
    if (this.currentTheme() === name) return true;
    try { cc.setTheme(name); } catch (e) { return false; }
    await sleep(this.settings.settleMs + 300);
    return this.currentTheme() === name;
  }

  // ----- capture -----
  electronWebContents() {
    try {
      const el = window.require ? window.require('electron') : window.electron;
      if (el && el.remote && el.remote.getCurrentWebContents) return el.remote.getCurrentWebContents();
      if (window.electron && window.electron.remote) return window.electron.remote.getCurrentWebContents();
    } catch (e) { /* fall through */ }
    return null;
  }
  async capture(name, dir, focusEl, focusPad = 24, opts = {}) {
    const wc = this.electronWebContents();
    if (!wc) { new Notice('Plugin Lab: screenshots need Obsidian desktop.'); throw new Error('no webContents'); }
    const shown = this.statusEl.isShown(); if (shown) this.statusEl.hide();
    document.querySelectorAll(opts.keepNotices ? '.tooltip' : '.notice, .tooltip').forEach((n) => n.remove());
    await sleep(60);
    const img = await wc.capturePage();
    if (shown) this.statusEl.show();
    const dpr = window.devicePixelRatio || 1; const size = img.getSize();
    let focus = null;
    if (focusEl) {
      const r = focusEl.getBoundingClientRect();
      const x0 = Math.max(0, Math.round((r.left - focusPad) * dpr)), y0 = Math.max(0, Math.round((r.top - focusPad) * dpr));
      const x1 = Math.min(size.width, Math.round((r.right + focusPad) * dpr)), y1 = Math.min(size.height, Math.round((r.bottom + focusPad) * dpr));
      if (x1 - x0 > 40 && y1 - y0 > 20) focus = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const folder = await this.ensureFolder(dir); const base = normalizePath(`${folder}/${name}`);
    const png = img.toPNG(); await this.app.vault.adapter.writeBinary(base + '.png', png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    if (focus) { const crop = img.crop({ x: focus.x, y: focus.y, width: focus.w, height: focus.h }); const b = crop.toPNG(); await this.app.vault.adapter.writeBinary(base + '-focus.png', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    if (this.settings.cropHero && size.width !== 1920) { const hero = img.resize({ width: 1920 }); const b = hero.toPNG(); await this.app.vault.adapter.writeBinary(base + '-hero.png', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    return { path: base + '.png', focus };
  }
  async captureOne() {
    const name = `${this.isDark() ? 'dark' : 'light'}-${slug(this.currentTheme() || 'default')}-${stamp()}`;
    try { const r = await this.capture(name, `${this.settings.outputFolder}/captures`, null); new Notice('Plugin Lab: saved ' + r.path); } catch (e) { console.error(e); }
  }

  // ----- matrix -----
  async runMatrix(p, cfg) {
    const startTheme = this.currentTheme(), startDark = this.isDark();
    const runId = stamp(); const runDir = await this.ensureFolder(`${this.pluginDir(p)}/${runId}`); const shotDir = `${runDir}/shots`;
    const shots = []; const skipped = []; let n = 0;
    const total = cfg.themes.length * cfg.schemes.length * cfg.kinds.length;
    const progress = (m) => { this.statusEl.setText(m); this.statusEl.show(); };
    progress('Plugin Lab: capturing…');
    try {
      for (const theme of cfg.themes) {
        const okT = await this.setTheme(theme);
        if (!okT) { skipped.push(`theme "${theme || 'Default'}" could not be applied`); n += cfg.schemes.length * cfg.kinds.length; continue; }
        for (const dark of cfg.schemes) {
          const okS = await this.setScheme(dark);
          if (!okS) { skipped.push(`${dark ? 'dark' : 'light'} scheme could not be set under ${theme || 'Default'}`); n += cfg.kinds.length; continue; }
          const label = `${theme || 'Default'} · ${dark ? 'dark' : 'light'}`;
          for (const kind of cfg.kinds) {
            const name = `${slug(theme || 'default')}-${dark ? 'dark' : 'light'}-${kind.id}`;
            try {
              const shot = await this.captureKind(p, kind, name, shotDir);
              if (shot) shots.push(Object.assign(shot, { kind: kind.id, kindLabel: kind.label, label, theme, dark })); else skipped.push(`${kind.label} under ${label}: no modal, menu, popover or view appeared`);
            } catch (e) { console.error('Plugin Lab capture failed', kind, e); skipped.push(`${kind.label} under ${label}: ${e.message}`); }
            progress(`Plugin Lab: ${++n}/${total}`);
          }
        }
      }
    } finally {
      await this.setTheme(startTheme); await this.setScheme(startDark); this.app.setting.close();
    }
    progress('Plugin Lab: building contact sheets…');
    const sheets = [];
    try {
      const folder = await this.ensureFolder(`${runDir}/sheets`);
      for (const kind of cfg.kinds) {
        const g = shots.filter((s) => s.kind === kind.id); if (!g.length) continue;
        const cols = cfg.schemes.length;
        sheets.push({ path: await this.makeSheetFit(g.map((s) => s.path), g.map((s) => s.label), g.map((s) => s.focus), `${p.name} — ${kind.label}`, normalizePath(`${folder}/${slug(p.name)}-${slug(kind.id)}.png`), cols, cols === 1 ? 1100 : 760, runId), title: kind.label });
      }
    } catch (e) { console.error('Plugin Lab sheets failed', e); }
    this.statusEl.hide();
    const when = new Date();
    const md = ['---', `plugin: ${p.name}`, `plugin_id: ${p.id}`, `date: ${when.toISOString().slice(0, 10)}`, `themes: ${cfg.themes.length}`, `captures: ${shots.length}`, `sheets: ${sheets.length}`, 'tags: [plugin-lab, matrix]', '---', '', `# ${p.name} — UI under ${cfg.themes.length} theme${cfg.themes.length === 1 ? '' : 's'}`, '', `${when.toLocaleString()} · ${cfg.themes.map((t) => t || 'Default').join(', ')} · ${cfg.schemes.map((d) => d ? 'dark' : 'light').join(' + ')} · ${shots.length} captures`, '', '> [!tip] One row per theme, one column per scheme', `> Sheets are in \`${runDir}/sheets\`; every capture is in \`shots/\` as full window, \`-focus\` (the element) and \`-hero\` (1920 wide).`];
    if (skipped.length) md.push('', '## Skipped', '', ...skipped.map((s) => '- ' + s));
    for (const sh of sheets) md.push('', `## ${sh.title}`, '', `![[${sh.path}]]`);
    md.push('');
    const path = await this.writeNote('Matrix', md.join('\n'), runDir);
    await this.openNote(path);
    new Notice(`Plugin Lab: ${shots.length} captures, ${sheets.length} sheets`); this.refreshPanels();
  }
  async captureKind(p, kind, name, dir) {
    const wait = this.settings.settleMs;
    if (kind.id === 'settings') {
      this.app.setting.open(); this.app.setting.openTabById(p.id); await sleep(wait + 300);
      const modal = document.querySelector('.modal-container .modal');
      const tab = document.querySelector('.vertical-tab-content');
      if (!modal || !tab || !tab.textContent.trim()) { this.app.setting.close(); return null; }
      const r = await this.capture(name, dir, modal, 16); this.app.setting.close(); await sleep(250); return r;
    }
    if (kind.id === 'scene') {
      this.app.setting.close(); await sleep(wait);
      return this.capture(name, dir, null);
    }
    if (kind.id.startsWith('cmd:') || kind.id.startsWith('ribbon:')) {
      await this.ensureScratchNote();
      if (kind.editor) await this.prepareEditorSelection();
      this.closePopups(); await sleep(200);
      const before = this.app.workspace.getLeavesOfType('markdown').length + this.app.workspace.getLeavesOfType('empty').length;
      if (kind.id.startsWith('cmd:')) { const ok = this.app.commands.executeCommandById(kind.id.slice(4)); if (ok === false) return null; }
      else { const btn = [...document.querySelectorAll('.side-dock-ribbon-action')].find((b) => b.getAttribute('aria-label') === kind.id.slice(7)); if (!btn) return null; btn.click(); }
      await sleep(wait + 400);
      const pop = this.visiblePopup();
      if (pop) { const r = await this.capture(name, dir, pop.el, pop.pad, { keepNotices: pop.notice }); this.closePopups(); await sleep(250); return r; }
      // no popup: did a view of this plugin open?
      const opened = kind.viewTypes ? kind.viewTypes.flatMap((t) => this.app.workspace.getLeavesOfType(t)) : [];
      if (opened.length) { const el = opened[0].view.containerEl; await sleep(wait); return this.capture(name, dir, el, 12); }
      return null;
    }
    if (kind.id.startsWith('view:')) {
      const type = kind.id.slice(5);
      let leaves = this.app.workspace.getLeavesOfType(type);
      if (!leaves.length) { try { const leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type, active: true }); this.app.workspace.revealLeaf(leaf); await sleep(wait); leaves = this.app.workspace.getLeavesOfType(type); this._openedLeaves = (this._openedLeaves || []).concat(leaves); } catch (e) { return null; } }
      if (!leaves.length) return null;
      const leaf = leaves[0]; try { this.app.workspace.revealLeaf(leaf); } catch (e) { /* ignore */ }
      await sleep(wait);
      const el = leaf.view && leaf.view.containerEl; if (!el || el.getBoundingClientRect().width < 20) return null;
      return this.capture(name, dir, el, 12);
    }
    return null;
  }

  visiblePopup() {
    const vis = (el) => el && el.getBoundingClientRect().width > 20 && el.getBoundingClientRect().height > 10;
    for (const [sel, pad, notice] of [['.modal-container .modal', 16, false], ['.prompt', 40, false], ['.suggestion-container', 40, false], ['.menu', 120, false], ['.popover', 40, false], ['.notice-container .notice', 80, true]]) {
      const el = [...document.querySelectorAll(sel)].find(vis); if (el) return { el, pad, notice };
    }
    return null;
  }
  closePopups() {
    document.querySelectorAll('.modal-container .modal-bg').forEach((bg) => bg.click());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.querySelectorAll('.menu, .suggestion-container, .popover, .notice').forEach((n) => n.remove());
  }
  async prepareEditorSelection() {
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView); if (!view || !view.editor) return;
    const ed = view.editor; const sample = 'A sample paragraph for editor commands. It has **bold**, a [[link]] and a #tag so commands that act on the selection have something to work with.';
    if (!ed.getValue().includes(sample)) ed.setValue(`# Scratch\n\n${sample}\n\n- one\n- two\n`);
    ed.setSelection({ line: 2, ch: 0 }, { line: 2, ch: sample.length }); ed.focus(); await sleep(150);
  }
  async ensureScratchNote() {
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView); if (view) return;
    const path = normalizePath(`${this.settings.outputFolder}/Scratch.md`);
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { await this.ensureFolder(this.settings.outputFolder); f = await this.app.vault.create(path, '# Scratch\n\nPlugin Lab opens this note so editor commands have somewhere to run. Safe to delete.\n'); }
    await this.app.workspace.getLeaf(true).openFile(f); await sleep(this.settings.settleMs);
  }
  // ----- sheets (same chrome as Theme Lab) -----
  async loadImage(path) {
    const buf = await this.app.vault.adapter.readBinary(path);
    const url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
    try { return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async makeSheetFit(paths, labels, rects, title, outPath, cols = 2, cellW = 760, runId = '') {
    const imgs = []; for (const p of paths) { try { imgs.push(await this.loadImage(p)); } catch (e) { imgs.push(null); } }
    cols = Math.max(1, Math.min(cols, imgs.length));
    const aspects = imgs.map((im, i) => { const r = rects[i] || (im ? { w: im.width, h: im.height } : null); return r ? r.h / r.w : null; }).filter(Boolean).sort((a, b) => a - b);
    const aspect = aspects.length ? Math.min(1.5, Math.max(0.45, aspects[Math.floor(aspects.length / 2)])) : 0.72;
    const cellH = Math.round(cellW * aspect), pad = 20, lab = 34, head = 84, foot = 40; const rows = Math.ceil(imgs.length / cols);
    const c = createEl('canvas'); c.width = pad + cols * (cellW + pad); c.height = head + rows * (cellH + lab + pad) + foot; const g = c.getContext('2d');
    g.fillStyle = '#0f1013'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#16181d'; g.fillRect(0, 0, c.width, head - 16); g.fillStyle = '#2a2d35'; g.fillRect(0, head - 16, c.width, 1);
    g.fillStyle = '#f2f3f5'; g.font = '600 24px ui-sans-serif, system-ui, sans-serif'; g.fillText(title, pad, 42);
    g.fillStyle = '#8b909b'; g.font = '14px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(runId ? `run ${runId}` : '', c.width - pad, 42); g.textAlign = 'left';
    g.fillStyle = '#6b6f78'; g.font = '12px ui-sans-serif, system-ui, sans-serif'; g.fillText(`Plugin Lab · ${imgs.length} capture${imgs.length === 1 ? '' : 's'} · ${new Date().toLocaleString()}`, pad, c.height - 14);
    imgs.forEach((im, i) => {
      const x = pad + (i % cols) * (cellW + pad), y = head + Math.floor(i / cols) * (cellH + lab + pad);
      g.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'; g.fillStyle = '#6b6f78'; g.fillText(String(i + 1).padStart(2, '0'), x, y + 21);
      g.font = '14px ui-sans-serif, system-ui, sans-serif'; g.fillStyle = '#c9ccd3'; let t = labels[i]; while (g.measureText(t).width > cellW - 34 && t.length > 4) t = t.slice(0, -2) + '…'; g.fillText(t, x + 26, y + 21);
      g.fillStyle = '#1a1c22'; g.fillRect(x - 1, y + lab - 1, cellW + 2, cellH + 2); g.fillStyle = '#23262e'; g.fillRect(x, y + lab, cellW, cellH);
      if (!im) return;
      const r = rects[i] || { x: 0, y: 0, w: im.width, h: im.height };
      const sc = Math.min(cellW / r.w, cellH / r.h); const dw = Math.round(r.w * sc), dh = Math.round(r.h * sc);
      g.drawImage(im, r.x, r.y, r.w, r.h, x + Math.round((cellW - dw) / 2), y + lab + Math.round((cellH - dh) / 2), dw, dh);
    });
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await this.app.vault.adapter.writeBinary(outPath, await blob.arrayBuffer()); return outPath;
  }
}


// ---------- right-sidebar panel ----------
class PluginLabView extends obsidian.ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Plugin Lab'; }
  getIcon() { return 'microscope'; }
  async onOpen() {
    const root = this.contentEl; root.empty(); root.addClass('plugin-lab-panel');
    const p = this.plugin; const s = p.settings; s.panelOpen = s.panelOpen || {};
    // header: target plugin
    const head = root.createDiv({ cls: 'plugin-lab-head' });
    this.targetEl = head.createDiv({ cls: 'plugin-lab-head-target' });
    const change = head.createEl('button', { cls: 'plugin-lab-mini plugin-lab-mini-text' }); setIcon(change, 'replace'); change.createSpan({ text: 'Change' }); change.onclick = () => p.pick('Target', async () => {});
    // toolbar
    const tools = root.createDiv({ cls: 'plugin-lab-tools' });
    const tool = (parent, label, icon, fn, tip) => { const b = parent.createEl('button', { cls: 'plugin-lab-tool' }); const ic = b.createSpan({ cls: 'plugin-lab-tool-icon' }); setIcon(ic, icon); b.createSpan({ text: label, cls: 'plugin-lab-tool-label' }); b.setAttribute('aria-label', tip || label); b.onclick = () => { b.blur(); fn(); }; return b; };
    const withTarget = (fn) => { const t = p.targetPlugin(); if (t) fn(t); else p.pick('Target', (t2) => fn(t2)); };
    const seg = tools.createDiv({ cls: 'plugin-lab-seg' });
    tool(seg, 'Review', 'microscope', () => withTarget((t) => p.review(t)), 'Pre-flight review → note');
    tool(seg, 'Inventory', 'list-checks', () => withTarget((t) => p.inventory(t)), 'Commands, settings, surfaces → note');
    tool(seg, 'Matrix', 'layout-grid', () => withTarget((t) => new MatrixModal(p.app, p, t).open()), 'Capture UI under every theme');
    tool(seg, 'Capture', 'camera', () => p.captureOne(), 'Capture one screenshot now');
    tool(seg, 'All', 'clipboard-list', () => p.reviewAll(), 'Review every installed plugin');
    // sections
    const section = (key, title, right) => {
      const d = root.createDiv({ cls: 'plugin-lab-section' }); const h = d.createDiv({ cls: 'plugin-lab-section-head' });
      const chev = h.createSpan({ cls: 'plugin-lab-chevron' }); setIcon(chev, 'chevron-down'); h.createSpan({ text: title, cls: 'plugin-lab-section-title' });
      const r = h.createDiv({ cls: 'plugin-lab-section-right' }); const body = d.createDiv({ cls: 'plugin-lab-section-body' });
      const apply = () => d.toggleClass('is-collapsed', s.panelOpen[key] === false);
      h.onclick = (e) => { if (r.contains(e.target)) return; s.panelOpen[key] = s.panelOpen[key] === false; p.saveSettings(); apply(); };
      if (right) right(r); apply(); return body;
    };
    this.checkBody = section('check', 'Pre-flight', (r) => { const b = r.createEl('button', { cls: 'plugin-lab-mini' }); setIcon(b, 'refresh-cw'); b.setAttribute('aria-label', 'Re-check'); b.onclick = () => this.refreshCheck(); });
    this.cmdBody = section('commands', 'Commands');
    this.surfBody = section('surfaces', 'Surfaces');
    this.runsBody = section('runs', 'Notes and runs', (r) => { const b = r.createEl('button', { cls: 'plugin-lab-mini' }); setIcon(b, 'refresh-cw'); b.setAttribute('aria-label', 'Refresh'); b.onclick = () => this.refreshRuns(); });
    this.registerEvent(p.app.workspace.on('css-change', () => this.refreshHead()));
    this.refresh();
  }
  refresh() { this.refreshHead(); this.refreshCheck(); this.refreshCommands(); this.refreshRuns(); }
  refreshHead() {
    if (!this.targetEl) return; const t = this.plugin.targetPlugin(); this.targetEl.empty();
    if (!t) { this.targetEl.createDiv({ text: 'No plugin selected', cls: 'plugin-lab-head-name' }); this.targetEl.createDiv({ text: 'Pick one to review, inventory or capture.', cls: 'plugin-lab-head-meta' }); return; }
    const n = this.targetEl.createDiv({ cls: 'plugin-lab-head-name' }); n.createSpan({ text: t.name });
    n.createSpan({ text: t.enabled ? 'enabled' : 'disabled', cls: 'plugin-lab-badge' + (t.enabled ? ' is-on' : '') });
    this.targetEl.createDiv({ text: `${t.id} · ${t.version} · ${t.author || ''}`, cls: 'plugin-lab-head-meta' });
  }
  async refreshCheck() {
    const body = this.checkBody; if (!body) return; body.empty(); const p = this.plugin; const t = p.targetPlugin();
    if (!t) { body.createEl('p', { text: 'Select a plugin.', cls: 'plugin-lab-hint' }); return; }
    const { dir, files } = await loadPluginFiles(p.app, t);
    if (!files['main.js']) { body.createEl('p', { text: `No main.js in ${dir}.`, cls: 'plugin-lab-hint' }); return; }
    const r = reviewPlugin(t, files); this._lastFiles = files; this._lastInv = null;
    const lintErr = r.counts.error - r.counts.blocking;
    const sum = body.createDiv({ cls: 'plugin-lab-verdict ' + (r.counts.blocking ? 'is-fail' : 'is-pass') });
    const ic = sum.createSpan({ cls: 'plugin-lab-verdict-icon' }); setIcon(ic, r.counts.blocking ? 'x-circle' : 'check-circle');
    sum.createSpan({ text: r.counts.blocking ? `Community review: would fail (${r.counts.blocking})` : 'Community review: would pass' });
    const lint = body.createDiv({ cls: 'plugin-lab-verdict is-lint ' + (lintErr ? 'is-warn' : 'is-pass') });
    const ic2 = lint.createSpan({ cls: 'plugin-lab-verdict-icon' }); setIcon(ic2, lintErr ? 'alert-triangle' : 'check-circle');
    lint.createSpan({ text: `Official linter: ${lintErr} error${lintErr === 1 ? '' : 's'} · ${r.counts.warning} warning${r.counts.warning === 1 ? '' : 's'}` });
    body.createDiv({ text: `${r.counts.rec} recommendations · ${r.counts.pass} passes`, cls: 'plugin-lab-hint' });
    const items = r.sections.flatMap((sec) => sec.items.map((i) => Object.assign({ section: sec.name }, i))).filter((i) => i.level === L.error || i.level === L.warning || i.level === L.rec);
    const order = { Error: 0, Warning: 1, Recommendation: 2 }; items.sort((a, b) => order[a.level] - order[b.level]);
    const list = body.createDiv({ cls: 'plugin-lab-items' });
    for (const i of items.slice(0, 12)) {
      const row = list.createDiv({ cls: 'plugin-lab-item is-' + i.level.toLowerCase() });
      row.createSpan({ text: i.level === 'Error' ? '✗' : i.level === 'Warning' ? '⚠' : '△', cls: 'plugin-lab-item-mark' });
      const tx = row.createDiv({ cls: 'plugin-lab-item-text' }); tx.createSpan({ text: i.text.replace(/`/g, '') });
      tx.createDiv({ text: `${i.section}${i.file ? ' · ' + i.file + (i.line ? ':' + i.line : '') : ''}`, cls: 'plugin-lab-item-where' });
    }
    if (items.length > 12) body.createDiv({ text: `+ ${items.length - 12} more in the full note`, cls: 'plugin-lab-hint' });
    const foot = body.createDiv({ cls: 'plugin-lab-foot' }); foot.createSpan();
    const fb = foot.createDiv({ cls: 'plugin-lab-foot-buttons' });
    new obsidian.ButtonComponent(fb).setButtonText('Write full note').setCta().onClick(() => p.review(t));
  }
  async refreshCommands() {
    const body = this.cmdBody, sb = this.surfBody; if (!body) return; body.empty(); sb.empty(); const p = this.plugin; const t = p.targetPlugin();
    if (!t) { body.createEl('p', { text: 'Select a plugin.', cls: 'plugin-lab-hint' }); return; }
    const { files } = await loadPluginFiles(p.app, t); const inv = inventoryPlugin(p.app, t, files);
    if (!inv.cmds.length) body.createEl('p', { text: t.enabled ? 'No commands registered.' : 'Enable the plugin to see its commands.', cls: 'plugin-lab-hint' });
    for (const c of inv.cmds) {
      const row = body.createDiv({ cls: 'plugin-lab-cmd' });
      const name = row.createDiv({ cls: 'plugin-lab-cmd-name', text: c.name.replace(/^[^:]+:\s*/, '') });
      const d = describeCommand(inv.analysis[c.id.slice(t.id.length + 1)]); if (d) row.createSpan({ text: d, cls: 'plugin-lab-tag' });
      const hk = inv.hotkeyOf(c); if (hk) row.createSpan({ text: hk, cls: 'plugin-lab-kbd' });
      const run = row.createEl('button', { cls: 'plugin-lab-mini' }); setIcon(run, 'play'); run.setAttribute('aria-label', 'Run'); run.onclick = () => p.app.commands.executeCommandById(c.id);
      name.setAttribute('aria-label', c.id);
    }
    // surfaces
    const chip = (label, icon, fn) => { const b = sb.createEl('button', { cls: 'plugin-lab-chip' }); const ic = b.createSpan(); setIcon(ic, icon); b.createSpan({ text: label }); if (fn) b.onclick = fn; else b.disabled = true; return b; };
    chip('Settings tab', 'settings', () => { p.app.setting.open(); p.app.setting.openTabById(t.id); });
    for (const v of inv.viewTypes) chip(`View ${v}`, 'panel-right', async () => { let leaves = p.app.workspace.getLeavesOfType(v); if (!leaves.length) { const leaf = p.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: v, active: true }); leaves = [leaf]; } p.app.workspace.revealLeaf(leaves[0]); });
    for (const r of inv.ribbons) chip(`Ribbon ${r}`, r, null);
    for (const b of inv.processors) chip('```' + b, 'code', null);
    for (const u of inv.protocol) chip(`obsidian://${u}`, 'link', null);
    if (inv.fileMenu) chip('File menu', 'file', null); if (inv.editorMenu) chip('Editor menu', 'pencil', null);
    if (!sb.children.length) sb.createEl('p', { text: 'Commands only.', cls: 'plugin-lab-hint' });
  }
  async refreshRuns() {
    const body = this.runsBody; if (!body) return; body.empty(); const p = this.plugin; const t = p.targetPlugin();
    if (!t) { body.createEl('p', { text: 'Select a plugin.', cls: 'plugin-lab-hint' }); return; }
    const { runs, notes } = await p.listRuns(t);
    if (!runs.length && !notes.length) { body.createEl('p', { text: `Nothing written for ${t.name} yet.`, cls: 'plugin-lab-hint' }); return; }
    const open = async (path) => { const f = p.app.vault.getAbstractFileByPath(path); if (f instanceof TFile) await p.app.workspace.getLeaf(true).openFile(f); };
    for (const n of notes.slice(0, 6)) { const row = body.createDiv({ cls: 'plugin-lab-run' }); const nm = n.split('/').pop().replace(/\.md$/, ''); const m = nm.match(/^(\w+) (\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})/); row.createSpan({ text: m ? `${m[1]} · ${m[2]} ${m[3]}:${m[4]}` : nm, cls: 'plugin-lab-run-name' }); const b = row.createEl('button', { cls: 'plugin-lab-mini plugin-lab-mini-text' }); setIcon(b, 'file-text'); b.createSpan({ text: 'Open' }); b.onclick = () => open(n); }
    for (const r of runs.slice(0, 6)) { const row = body.createDiv({ cls: 'plugin-lab-run' }); const id = r.split('/').pop(); const m = id.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})/); row.createSpan({ text: m ? `Matrix · ${m[1]} ${m[2]}:${m[3]}` : id, cls: 'plugin-lab-run-name' }); const b = row.createEl('button', { cls: 'plugin-lab-mini plugin-lab-mini-text' }); setIcon(b, 'image'); b.createSpan({ text: 'Open' }); b.onclick = () => open(`${r}/Matrix.md`); }
  }
  async onClose() { this.contentEl.empty(); }
}

// ---------- plugin picker ----------
class PluginPicker extends SuggestModal {
  constructor(app, plugin, plugins, verb, onPick) { super(app); this.plugin = plugin; this.plugins = plugins; this.verb = verb; this.onPick = onPick; this.setPlaceholder(`${verb} which plugin?`); this.setInstructions([{ command: '↑↓', purpose: 'navigate' }, { command: '↵', purpose: verb.toLowerCase() }, { command: 'esc', purpose: 'dismiss' }]); }
  getSuggestions(q) {
    const s = q.trim().toLowerCase(); const last = this.plugin.settings.lastPlugin;
    const list = this.plugins.filter((p) => !s || p.name.toLowerCase().includes(s) || p.id.includes(s) || (p.author || '').toLowerCase().includes(s));
    return list.sort((a, b) => (b.id === last) - (a.id === last) || a.name.localeCompare(b.name));
  }
  renderSuggestion(p, el) {
    el.addClass('plugin-lab-pick');
    const n = el.createDiv({ cls: 'plugin-lab-pick-name' }); n.createEl('b', { text: p.name }); n.createSpan({ text: p.id, cls: 'plugin-lab-pick-id' });
    el.createDiv({ text: `${p.version} · ${p.author || ''}${p.enabled ? '' : ' · disabled'}`, cls: 'plugin-lab-pick-meta' + (p.enabled ? '' : ' plugin-lab-pick-off') });
  }
  onChooseSuggestion(p) { this.onPick(p); }
}

// ---------- matrix modal ----------
class MatrixModal extends Modal {
  constructor(app, plugin, target) { super(app); this.plugin = plugin; this.target = target; }
  onOpen() { this.modalEl.addClass('plugin-lab-modal'); this.render(); }
  render() {
    const s = this.plugin.settings; const p = this.plugin; const { contentEl } = this; contentEl.empty();
    this.titleEl.setText('Capture UI under every theme');
    contentEl.createEl('p', { text: 'Switches through the chosen themes and schemes, captures each surface, restores your theme, and tiles the results one theme per row. Keep the window in front.', cls: 'plugin-lab-modal-intro' });
    const t = contentEl.createDiv({ cls: 'plugin-lab-target' }); const ic = t.createSpan(); setIcon(ic, 'puzzle'); t.createEl('b', { text: this.target.name }); t.createSpan({ text: this.target.id });
    const group = (title, desc, items, get, set, allNone) => {
      const g = contentEl.createDiv({ cls: 'plugin-lab-group' }); const gh = g.createDiv({ cls: 'plugin-lab-group-head' });
      gh.createSpan({ text: title, cls: 'plugin-lab-group-title' }); if (desc) gh.createSpan({ text: desc, cls: 'plugin-lab-group-desc' });
      const toggles = [];
      if (allNone) { const an = gh.createDiv({ cls: 'plugin-lab-group-links' }); const setAll = (v) => { items.forEach((it) => set(it.key, v)); toggles.forEach((tg) => tg.setValue(v)); this.refresh(); }; an.createEl('a', { text: 'All' }).onclick = () => setAll(true); an.createEl('a', { text: 'None' }).onclick = () => setAll(false); }
      const grid = g.createDiv({ cls: 'plugin-lab-grid' });
      for (const it of items) {
        const item = grid.createDiv({ cls: 'plugin-lab-grid-item' }); item.createSpan({ text: it.label, cls: 'plugin-lab-grid-label' });
        const tg = new obsidian.ToggleComponent(item).setValue(get(it.key)).onChange((v) => { set(it.key, v); this.refresh(); }); toggles.push(tg);
        item.onclick = (e) => { if (e.target.closest('.checkbox-container')) return; tg.setValue(!tg.getValue()); set(it.key, tg.getValue()); this.refresh(); };
      }
    };
    const themes = p.installedThemes();
    group('Themes', `${themes.length} installed`, [{ key: '', label: 'Default' }, ...themes.map((n) => ({ key: n, label: n }))], (k) => k === '' ? s.includeDefaultTheme : s.themes[k] !== false, (k, v) => { if (k === '') s.includeDefaultTheme = v; else s.themes[k] = v; }, true);
    group('Schemes', null, [{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'Light' }], (k) => s.schemes[k], (k, v) => { s.schemes[k] = v; });
    const inv = this._inv || null;
    group('Surfaces', 'What to capture under each theme', [{ key: 'settings', label: 'Settings tab' }, { key: 'views', label: 'Registered views (below)' }, { key: 'scene', label: 'The scene as it is now' }], (k) => s.captures[k], (k, v) => { s.captures[k] = v; });
    const cmds = Object.values((this.app.commands && this.app.commands.commands) || {}).filter((c) => c.id.startsWith(this.target.id + ':'));
    s.commandPicks = s.commandPicks || {};
    const an = this._analysis || {};
    if (cmds.length && this._analysis && !s.commandPicks['__seeded:' + this.target.id]) { for (const c of cmds) { const a = an[c.id.slice(this.target.id.length + 1)]; if (commandIsSafeToSweep(a)) s.commandPicks[c.id] = true; } s.commandPicks['__seeded:' + this.target.id] = true; }
    if (cmds.length) group('Commands', 'Read from main.js: what each one does. Dialog- and view-openers that don\'t write are pre-ticked; the rest run for real, so tick them knowingly.', cmds.map((c) => { const d = describeCommand(an[c.id.slice(this.target.id.length + 1)]); return { key: c.id, label: c.name.replace(/^[^:]+:\s*/, '') + (d ? ` — ${d}` : '') }; }), (k) => !!s.commandPicks[k], (k, v) => { s.commandPicks[k] = v; }, true);
    else if (!this.target.enabled) contentEl.createEl('p', { text: 'Enable the plugin to sweep its commands and ribbon icons.', cls: 'plugin-lab-hint' });
    const ribbons = [...document.querySelectorAll('.side-dock-ribbon-action')].map((b) => b.getAttribute('aria-label')).filter((l) => l && (this._detectedRibbons || []).includes(l));
    s.ribbonPicks = s.ribbonPicks || {};
    if (ribbons.length) group('Ribbon icons', 'Click each and capture what opens.', ribbons.map((l) => ({ key: l, label: l })), (k) => !!s.ribbonPicks[k], (k, v) => { s.ribbonPicks[k] = v; }, true);
    new Setting(contentEl).setName('View types').setDesc('One per line. Leave empty to use the view types found in the plugin\'s main.js. Views that are not open get opened in the right sidebar.').addTextArea((ta) => { ta.setValue(s.viewTypes); ta.inputEl.rows = 2; ta.inputEl.placeholder = this._detectedViews ? this._detectedViews.join('\n') : 'my-plugin-view'; ta.onChange((v) => { s.viewTypes = v; this.refresh(); }); });
    const foot = contentEl.createDiv({ cls: 'plugin-lab-modal-foot' }); this.estimateEl = foot.createDiv({ cls: 'plugin-lab-estimate' });
    const fb = foot.createDiv({ cls: 'plugin-lab-foot-buttons' });
    new obsidian.ButtonComponent(fb).setButtonText('Cancel').onClick(() => this.close());
    new obsidian.ButtonComponent(fb).setButtonText('Capture').setCta().onClick(() => this.start());
    if (!this._detectedViews) loadPluginFiles(this.app, this.target).then(({ files }) => { const inv2 = inventoryPlugin(this.app, this.target, files); this._detectedViews = inv2.viewTypes; this._detectedRibbons = inv2.ribbonLabels; this._analysis = inv2.analysis; this.render(); });
    this.refresh();
  }
  config() {
    const s = this.plugin.settings; const p = this.plugin;
    const themes = [...(s.includeDefaultTheme ? [''] : []), ...p.installedThemes().filter((n) => s.themes[n] !== false)];
    const schemes = [...(s.schemes.dark ? [true] : []), ...(s.schemes.light ? [false] : [])];
    const kinds = [];
    if (s.captures.settings) kinds.push({ id: 'settings', label: 'Settings tab' });
    if (s.captures.views) { const types = (s.viewTypes.trim() ? s.viewTypes.split('\n') : (this._detectedViews || [])).map((x) => x.trim()).filter(Boolean); for (const ty of types) kinds.push({ id: 'view:' + ty, label: `View ${ty}` }); }
    const types = (s.viewTypes.trim() ? s.viewTypes.split('\n') : (this._detectedViews || [])).map((x) => x.trim()).filter(Boolean);
    const cmds = Object.values((this.app.commands && this.app.commands.commands) || {}).filter((c) => c.id.startsWith(this.target.id + ':') && s.commandPicks && s.commandPicks[c.id]);
    for (const c of cmds) { const a = (this._analysis || {})[c.id.slice(this.target.id.length + 1)]; kinds.push({ id: 'cmd:' + c.id, label: `Command: ${c.name.replace(/^[^:]+:\s*/, '')}`, viewTypes: types, editor: !!(a && a.editor) }); }
    for (const l of Object.keys(s.ribbonPicks || {}).filter((k) => s.ribbonPicks[k] && (this._detectedRibbons || []).includes(k))) kinds.push({ id: 'ribbon:' + l, label: `Ribbon: ${l}`, viewTypes: types });
    if (s.captures.scene) kinds.push({ id: 'scene', label: 'Scene' });
    return { themes, schemes, kinds };
  }
  refresh() {
    if (!this.estimateEl) return; const c = this.config(); const s = this.plugin.settings;
    const shots = c.themes.length * c.schemes.length * c.kinds.length;
    const ok = c.themes.length && c.schemes.length && c.kinds.length;
    this.estimateEl.setText(ok ? `≈ ${shots} captures · ${c.kinds.length} sheet${c.kinds.length === 1 ? '' : 's'} · ~${Math.max(1, Math.round(shots * (s.settleMs * 2 + 1200) / 60000))} min` : 'Pick at least one theme, one scheme and one surface.');
    this.estimateEl.toggleClass('is-warning', !ok);
  }
  async start() {
    const c = this.config(); if (!(c.themes.length && c.schemes.length && c.kinds.length)) { new Notice('Plugin Lab: pick at least one theme, scheme and surface.'); return; }
    await this.plugin.saveSettings(); this.close();
    try { await this.plugin.runMatrix(this.target, c); } catch (e) { console.error(e); new Notice('Plugin Lab: capture failed — see console'); }
  }
  onClose() { this.contentEl.empty(); }
}

// ---------- settings ----------
function iconButton(parent, label, icon, fn, cta) {
  const b = parent.createEl('button', { cls: 'plugin-lab-iconbtn' + (cta ? ' mod-cta' : '') });
  const ic = b.createSpan({ cls: 'plugin-lab-iconbtn-icon' }); setIcon(ic, icon); b.createSpan({ text: label }); b.onclick = fn; return b;
}
class PluginLabSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; const s = this.plugin.settings; const p = this.plugin; containerEl.empty(); containerEl.addClass('plugin-lab-settings');
    const save = () => p.saveSettings();
    const actions = containerEl.createDiv({ cls: 'plugin-lab-actions' });
    const act = (label, icon, cta, fn) => iconButton(actions, label, icon, async () => { this.app.setting.close(); await fn(); }, cta);
    act('Open panel', 'microscope', true, () => p.openPanel());
    act('Review a plugin', 'search-check', false, () => p.pick('Review', (t) => p.review(t)));
    act('Inventory', 'list-checks', false, () => p.pick('Inventory', (t) => p.inventory(t)));
    act('Capture UI matrix', 'layout-grid', false, () => p.pick('Capture', (t) => new MatrixModal(this.app, p, t).open()));
    act('Review all plugins', 'clipboard-list', false, () => p.reviewAll());

    new Setting(containerEl).setName('Capture').setHeading();
    new Setting(containerEl).setName('Settle time (ms)').setDesc('Wait after each theme or scheme change before capturing. Themes with transitions need more.').addSlider((sl) => sl.setLimits(200, 3000, 100).setValue(s.settleMs).setDynamicTooltip().onChange(async (v) => { s.settleMs = v; await save(); }));
    new Setting(containerEl).setName('Hero image').setDesc('Also write each capture resized to 1920 px wide, for READMEs and listing pages.').addToggle((t) => t.setValue(s.cropHero).onChange(async (v) => { s.cropHero = v; await save(); }));

    new Setting(containerEl).setName('Output').setHeading();
    new Setting(containerEl).setName('Folder').setDesc('Reviews, inventories and matrix runs are filed under this folder, then the plugin name.').addText((t) => t.setValue(s.outputFolder).setPlaceholder('Plugin Lab').onChange(async (v) => { s.outputFolder = v.trim() || 'Plugin Lab'; await save(); }));
  }
}

module.exports = PluginLabPlugin;
