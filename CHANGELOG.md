# Changelog

All notable changes to Dev Lab are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [1.1.8] - 2026-09-17

### Fixed
- The last three contrast misses in the panel: the command list's "does" tag dropped `--text-faint` for `--text-muted`, and the accessibility verdict row used raw palette colours (2.74:1 in light) instead of the theme's text colours mixed toward the body colour, like the other two verdict rows.

## [1.1.7] - 2026-09-17

### Fixed
- Dev Lab's own accessibility audit, run on Dev Lab. Every clickable thing in the panel — the change button, the section refresh buttons, the surface chips, *Write full note*, *Run*, *Open* — was under the 24 × 24 px minimum; all of them clear it now.
- The finding's file and line used `--text-faint` (3.94:1 dark, 3.07:1 light) and now uses `--text-muted`; the enabled badge and the toolbar labels are mixed toward the body colour so they clear AA in light mode too.

## [1.1.6] - 2026-09-17

### Fixed
- The toolbar was laid out for five tools, so the sixth wrapped onto a row of its own. It is two rows of three now, which holds at any sidebar width.

## [1.1.5] - 2026-09-17

### Fixed
- Auditing Dev Lab itself did nothing: a flag was set one line before it was declared, so the sweep threw before it started. Only the self-target path was affected.
- Auditing Dev Lab now includes its own panel, not just its settings tab.

## [1.1.4] - 2026-09-17

### Changed
- Dev Lab can now be picked as its own target, so you can review, inventory and audit it like any other plugin. It still never runs its own commands in a sweep — an audit that executed *Audit accessibility* would recurse — so for itself only the settings tab and the panel are opened, and the note says so.

## [1.1.3] - 2026-09-17

### Fixed
- `a11y/focus-visible` reported every control, because the stylesheet walk found no rules at all: since CSS nesting, a `CSSStyleRule` also carries a `cssRules` list, so the recursion branch swallowed every ordinary rule before its selector was read. The walk now reads a rule's selector and recurses into nested rules.
- Selector lists are split on top-level commas only, so `:is(a, b):focus-visible` survives; `:not()`, `:is()` and `:where()` are kept while pseudo-elements and `:hover`/`:active` are stripped.
- If no focus rules can be read at all, the check reports nothing rather than blaming every control.

## [1.1.2] - 2026-09-17

### Fixed
- `a11y/focus-visible` no longer tries to trigger a focus ring by focusing the control. `:focus-visible` does not match programmatic focus, so every control looked unstyled however the keypress was faked. It now reads the loaded stylesheets, collects every selector that paints on `:focus` or `:focus-visible`, and reports only controls no such rule matches — deterministic, and it no longer moves focus around the plugin while auditing.
- Obsidian's settings rows are no longer treated as the plugin's controls, and elements with `tabindex="-1"` are skipped.

## [1.1.1] - 2026-09-17

### Fixed
- The accessibility audit probed the whole settings dialog, so Obsidian's own tab rail and header were reported as the plugin's problems. It now audits the plugin's tab body only.
- Obsidian's own toggle, slider, tab rail and modal header buttons are no longer charged against the plugin for target size or control name — the author cannot resize them.
- `a11y/focus-visible` sent no key press before focusing, so `:focus-visible` rules never matched and almost every control looked unstyled. It now sends a Tab keydown first, reports one finding per distinct control rather than one per element, and says plainly that the theme is often the cause.
- Findings from rules that do not depend on the colour scheme are no longer listed once per scheme.

## [1.1.0] - 2026-09-17

### Added
- **Accessibility audit.** A third verdict beside the community review and the official linter, from a live sweep: Dev Lab opens the plugin's settings tab, its views and its safe commands in both schemes and probes the DOM that appears. It writes a note grouped by rule, with the surface, the scheme and the element for every finding.
- Checks: `a11y/control-name` (an icon-only button with no accessible name, an input with no label), `a11y/control-focusable` (a control the keyboard cannot reach), `a11y/focus-visible` (focusing a control changes nothing on screen), `a11y/target-size` (under 24 × 24 px), `a11y/text-contrast` (below 4.5:1, or 3:1 for large text, against the resolved background under the theme in use), `a11y/aria-hidden-focusable`, `a11y/aria-role`, `a11y/img-alt` and `a11y/heading-order`.
- **Audit** in the panel toolbar and an *Audit accessibility* command. Commands that write, use the network or call out to another app are never run unless you tick them, exactly as in the capture matrix.

## [1.0.4] - 2026-09-17

### Fixed
- Inventory no longer drops a setting whose description and handlers run past 400 characters; each setting is read up to the next `new Setting(`.
- Inventory renders `${…}` in template-literal names and descriptions as an ellipsis instead of raw source.

## [1.0.3] - 2026-09-17

### Fixed
- `no-static-styles-assignment`: a `setCssProps` value written as a template literal with `${…}` is dynamic and is no longer flagged.

## [1.0.2] - 2026-09-13

### Fixed
- `no-static-styles-assignment` no longer flags `setCssProps` / `setCssStyles` calls whose values are computed — that is the linter's recommended form. Only a literal with nothing but static values is reported, matching the official rule.
- Test harness covers the static/dynamic distinction.

## [1.0.1] - 2026-09-13

### Changed
- Renamed to Dev Lab: the community review rejects "Plugin" in a plugin name. The id, folder and commands are unchanged; the output folder default is now `Dev Lab/`.
- The review's own rule now marks "Plugin" in a manifest name as blocking, since the review does.

## [1.0.0] - 2026-09-13

### Added
- **Pre-flight review** of any installed plugin, with a community-review verdict (what blocks a listing) kept separate from an official-linter score (eslint-plugin-obsidianmd, 35 of 40 rules mirrored as static checks, with the linter's brand and acronym lists for sentence case). Every finding carries its rule id, file and line. Comments, regex literals and string contents are masked before scanning.
- **Review every installed plugin**: a full note per plugin plus a linked summary table.
- **Inventory**: commands with hotkeys and what each does, settings with types and descriptions, ribbon icons, views, processors, URI handlers, menu hooks, dialog classes, `data.json` keys, and a README snippet.
- **UI under every theme**: settings tab, views, ribbon icons, commands (pre-ticked when the code shows they open something without writing) and the current scene, captured under every installed theme × dark/light, tiled one theme per row; theme and scheme restored afterwards.
- **Panel** with the target plugin, live pre-flight, commands with run buttons, surface chips, and the notes and runs list.

[1.1.8]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.8
[1.1.7]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.7
[1.1.6]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.6
[1.1.5]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.5
[1.1.4]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.4
[1.1.3]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.3
[1.1.2]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.2
[1.1.1]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.1
[1.1.0]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.0
[1.0.4]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.4
[1.0.3]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.3
[1.0.2]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.2
[1.0.1]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.1
[1.0.0]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.0
