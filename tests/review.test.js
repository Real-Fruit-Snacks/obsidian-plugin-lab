// Runs the review engine outside Obsidian: `node tests/review.test.js`
// Reviews this plugin (must be clean), optionally another plugin folder (PLUGIN_DIR=...), and a deliberately broken plugin
// in which every mirrored rule has a planted case. Exits non-zero if the clean plugin has errors or the broken one misses a rule.
const fs = require('fs'); const path = require('path'); const os = require('os');
const Module = require('module'); const origLoad = Module._load;
Module._load = function (req, ...a) { if (req === 'obsidian') return new Proxy({}, { get: () => class {} }); return origLoad.call(this, req, ...a); };
global.document = { body: { classList: { contains: () => true } } };
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace('module.exports = PluginLabPlugin;', 'module.exports = { reviewPlugin, sentenceCaseSuggestion, isSkippableString, a11yContrast, a11yColour, a11ySummary };');
const tmp = path.join(os.tmpdir(), 'plugin-lab-review-lib.js'); fs.writeFileSync(tmp, src); const lib = require(tmp);

let failed = 0; const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
const load = (dir) => ({ 'main.js': fs.readFileSync(path.join(dir, 'main.js'), 'utf8'), 'styles.css': fs.existsSync(path.join(dir, 'styles.css')) ? fs.readFileSync(path.join(dir, 'styles.css'), 'utf8') : '', 'manifest.json': fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'), 'README.md': null, 'versions.json': null, 'data.json': null, 'LICENSE': null });

console.log('sentence case');
for (const [t, expect] of [['Open Theme Lab panel', 'Open theme lab panel'], ['Create or open the showcase note', 'Create or open the showcase note'], ['Sync with Google Drive', 'Sync with Google Drive'], ['Export as PDF file', 'Export as PDF file'], ['Enable Fancy Mode', 'Enable fancy mode'], ['Show AutoReveal on hover', 'Show AutoReveal on hover'], ['Text, e.g. a default tag like #inbox.', 'Text, e.g. a default tag like #inbox.'], ['0 disables collapsing.', '0 disables collapsing.'], ['#inbox', '#inbox']]) check(lib.sentenceCaseSuggestion(t) === expect, `${JSON.stringify(t)} → ${JSON.stringify(lib.sentenceCaseSuggestion(t))}`);
check(lib.isSkippableString('YYYY-MM-DD HHmmss'), 'date format is skipped');
check(lib.isSkippableString('Ctrl+P to open'), 'keyboard shortcut is skipped');

console.log('\nthis plugin');
const selfFiles = load(path.join(__dirname, '..')); const self = lib.reviewPlugin(JSON.parse(selfFiles['manifest.json']), selfFiles);
check(self.counts.blocking === 0, `community review would pass (${self.counts.blocking} blocking)`);
check(self.counts.error === 0, `linter errors: ${self.counts.error}`);
for (const s of self.sections) for (const i of s.items) if (i.level === 'Error' || i.level === 'Warning') console.log(`       ${s.name} | ${i.level} | ${i.rule} | ${i.text.slice(0, 100)}`);

if (process.env.PLUGIN_DIR) { console.log(`\n${process.env.PLUGIN_DIR}`); const f = load(process.env.PLUGIN_DIR); const r = lib.reviewPlugin(JSON.parse(f['manifest.json']), f); console.log('  ', r.counts); for (const s of r.sections) for (const i of s.items) if (i.level === 'Error' || i.level === 'Warning') console.log(`       ${s.name} | ${i.level} | ${i.rule} | ${i.text.slice(0, 100)}`); }

console.log('\nbroken plugin');
const bad = {
  'manifest.json': JSON.stringify({ id: 'obsidian-super-plugin', name: 'Super Obsidian Plugin', version: 'v1.0', minAppVersion: '1.4.0', description: 'An Obsidian plugin that does stuff', author: 'x', isDesktopOnly: 'no', extra: 1 }),
  'main.js': `const { Plugin, Setting } = require('obsidian');
class MyPlugin extends Plugin { onload() { this.addCommand({ id: 'obsidian-super-plugin-do-command', name: 'Super Obsidian Plugin: Do The Thing Now', hotkeys: [{modifiers:['Mod'],key:'k'}], callback: () => new SampleModal(this.app).open() }); app.vault.getFiles().find(f => f.path === 'x'); const el = document.createElement('div'); el.innerHTML = '<b>x</b>'; el.style.color = 'red'; document.addEventListener('click', () => {}); setInterval(() => {}, 100); fetch('https://api.example.com/x'); eval('1'); localStorage.setItem('a','b'); localStorage.getItem('language'); console.log(1); this.app.workspace.activeLeaf; if (navigator.platform.includes('Mac')) {} this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000)); const re = /(?<=a)b/; this.registerView('x', (leaf) => (this.view = new XView(leaf))); globalThis.x = 1; if (el instanceof HTMLElement) {} Object.assign(this.settings, data); this.app.vault.trash(file); MarkdownRenderer.render(this.app, 'x', el, '', this); const p = '.obsidian/plugins/x'; this.registerEvent(this.app.workspace.on('editor-paste', (evt) => {})); Sentry.init({}); }
 onunload() { this.app.workspace.detachLeavesOfType('x'); } }
class SampleModal {}
class TextInputSuggest {}
class Copied extends TextInputSuggest {}
class T extends PluginSettingTab { display() { new Setting(this.containerEl).setName('General').setHeading(); new Setting(this.containerEl).setName('Super Obsidian Plugin Settings').setHeading(); new Setting(this.containerEl).setName('Enable Fancy Mode').setDesc('x').addToggle(t=>t); this.containerEl.createEl('h2', {text:'x'}); this.containerEl.createEl('style'); } }
module.exports = MyPlugin;`,
  'styles.css': '.workspace { color: red !important; }', 'README.md': null, 'versions.json': '{"1.0.0":"1.4.0"}', 'data.json': null, 'LICENSE': 'Copyright (c) 2020 Dynalist Inc.' };
const r = lib.reviewPlugin({ id: 'obsidian-super-plugin', name: 'Super Obsidian Plugin', version: 'v1.0' }, bad);
const rules = new Set(r.sections.flatMap((s) => s.items.map((i) => i.rule)));
for (const rule of ['obsidianmd/validate-manifest', 'review/releases', 'obsidianmd/validate-license', 'review/policy', 'obsidianmd/no-forbidden-elements', 'obsidianmd/no-static-styles-assignment', 'obsidianmd/platform', 'obsidianmd/no-sample-code', 'obsidianmd/sample-names', 'obsidianmd/detach-leaves', 'obsidianmd/no-view-references-in-plugin', 'obsidianmd/no-plugin-as-component', 'obsidianmd/regex-lookbehind', 'obsidianmd/no-global-this', 'obsidianmd/prefer-window-timers', 'obsidianmd/prefer-create-el', 'obsidianmd/prefer-file-manager-trash-file', 'obsidianmd/prefer-get-language', 'obsidianmd/prefer-instanceof', 'obsidianmd/prefer-abstract-input-suggest', 'obsidianmd/object-assign', 'obsidianmd/vault/iterate', 'obsidianmd/hardcoded-config-path', 'obsidianmd/editor-drop-paste', 'no-console', 'obsidianmd/commands/no-command-in-command-id', 'obsidianmd/commands/no-plugin-id-in-command-id', 'obsidianmd/commands/no-plugin-name-in-command-name', 'obsidianmd/commands/no-default-hotkeys', 'obsidianmd/settings-tab/no-manual-html-headings', 'obsidianmd/settings-tab/no-problematic-settings-headings', 'obsidianmd/ui/sentence-case', 'review/css', 'review/behavior']) check(rules.has(rule), rule);
check(r.counts.blocking >= 3, `blocking: ${r.counts.blocking}`);

console.log('\nstyles: static vs dynamic');
const styleCase = (body) => lib.reviewPlugin({ id: 'x', name: 'X', version: '1.0.0', description: 'A plugin that does something useful.' }, { 'main.js': `const { Plugin } = require('obsidian'); class P extends Plugin { onload() { const el = createDiv(); const v = 12; ${body} } } module.exports = P;`, 'styles.css': '', 'README.md': null, 'versions.json': '{"1.0.0":"1.4.0"}', 'data.json': null, 'LICENSE': null }).sections.flatMap((s) => s.items).some((i) => i.rule === 'obsidianmd/no-static-styles-assignment');
check(styleCase("el.setCssProps({ '--x': v + 'px' });") === false, 'setCssProps with a dynamic value is allowed');
check(styleCase("el.setCssStyles({ height: h });") === false, 'setCssStyles with a variable is allowed');
check(styleCase("el.setCssProps({ color: 'red' });") === true, 'setCssProps with only static values is flagged');
check(styleCase("el.style.removeProperty('height');") === false, 'style.removeProperty is allowed');
check(styleCase("el.setCssProps({ '--w': `${v}px` });") === false, 'setCssProps with a template literal interpolation is allowed');
check(styleCase("el.setCssProps({ '--w': `12px` });") === true, 'setCssProps with a plain template literal is flagged');
check(styleCase("el.style.color = 'red';") === true, 'style property assignment is flagged');

console.log('\nlicence years');
const lic = (text) => lib.reviewPlugin({ id: 'x', name: 'X', version: '1.0.0', description: 'A plugin that does something useful.' }, { 'main.js': 'const { Plugin } = require("obsidian"); class P extends Plugin {} module.exports = P;', 'styles.css': '', 'README.md': null, 'versions.json': '{"1.0.0":"1.4.0"}', 'data.json': null, 'LICENSE': text }).sections.flatMap((s) => s.items).some((i) => /Copyright year/.test(i.text));
const yr = new Date().getFullYear();
check(lic(`Copyright (c) 2024-${yr} Someone`) === false, 'a range ending this year is fine');
check(lic(`Copyright (c) ${yr} Someone`) === false, 'this year is fine');
check(lic('Copyright (c) 2019 Someone') === true, 'a stale single year is flagged');
check(lic(`Copyright (c) 2019-${yr - 5} Someone`) === true, 'a range ending long ago is flagged');

console.log('\naccessibility helpers');
check(Math.round(lib.a11yContrast([255, 255, 255], [0, 0, 0])) === 21, 'white on black is 21:1');
check(lib.a11yContrast([255, 255, 255], [255, 255, 255]) === 1, 'white on white is 1:1');
check(Math.abs(lib.a11yContrast(lib.a11yColour('rgb(119, 119, 119)'), [255, 255, 255]) - 4.48) < 0.05, '#777 on white is about 4.48:1');
check(lib.a11yColour('rgba(0, 0, 0, 0.5)')[3] === 0.5, 'alpha is parsed');
check(lib.a11yColour('not a colour') === null, 'a non-colour returns null');
const sum = lib.a11ySummary([{ level: 'Error' }, { level: 'Warning' }, { level: 'Warning' }, { level: 'Info' }]);
check(sum.error === 1 && sum.warning === 2 && sum.info === 1, 'findings are counted by level');

console.log(`\n${failed ? failed + ' failure(s)' : 'all good'}`); process.exit(failed ? 1 : 0);
