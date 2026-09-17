# Changelog

All notable changes to Dev Lab are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

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

[1.1.1]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.1
[1.1.0]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.1.0
[1.0.4]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.4
[1.0.3]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.3
[1.0.2]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.2
[1.0.1]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.1
[1.0.0]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.0
