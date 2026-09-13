# Changelog

All notable changes to Plugin Lab are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-13

### Added
- **Pre-flight review** of any installed plugin, with a community-review verdict (what blocks a listing) kept separate from an official-linter score (eslint-plugin-obsidianmd, 35 of 40 rules mirrored as static checks, with the linter's brand and acronym lists for sentence case). Every finding carries its rule id, file and line. Comments, regex literals and string contents are masked before scanning.
- **Review every installed plugin**: a full note per plugin plus a linked summary table.
- **Inventory**: commands with hotkeys and what each does, settings with types and descriptions, ribbon icons, views, processors, URI handlers, menu hooks, dialog classes, `data.json` keys, and a README snippet.
- **UI under every theme**: settings tab, views, ribbon icons, commands (pre-ticked when the code shows they open something without writing) and the current scene, captured under every installed theme × dark/light, tiled one theme per row; theme and scheme restored afterwards.
- **Panel** with the target plugin, live pre-flight, commands with run buttons, surface chips, and the notes and runs list.

[1.0.0]: https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/releases/tag/1.0.0
