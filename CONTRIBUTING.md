# Contributing to Plugin Lab

Thanks for taking the time. Bug reports, feature ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/Real-Fruit-Snacks/obsidian-plugin-lab/issues/new/choose) using the bug template. Please include:

- Obsidian version and operating system (Plugin Lab is desktop only)
- Plugin Lab version (Settings → Community plugins)
- Which plugin was being reviewed or captured, and its version
- Steps to reproduce, and what you expected instead
- Anything from the developer console (Ctrl/Cmd+Shift+I) that mentions Plugin Lab

If a review rule is wrong, paste the review line and the code it points at. If a capture came out wrong, attach the contact sheet rather than individual shots.

## Suggesting a feature

Open an issue with the feature template. Describe the problem you hit while building or reviewing a plugin rather than only the solution — it makes it easier to find the right fit for the plugin.

## Working on the code

There is no build step. The plugin is a single `main.js` plus `styles.css` and `manifest.json`.

1. Fork and clone the repo into `<your vault>/.obsidian/plugins/plugin-lab/`.
2. Enable the plugin in Obsidian.
3. Edit `main.js` or `styles.css`, then reload the plugin (toggle it off and on, or use the "Reload app without saving" command).
4. `node --check main.js` before you commit.
5. If you touch a review rule, run the test harness (`tests/review.test.js`) — it reviews two clean plugins and one deliberately broken one, and every rule has a planted case in the broken one.

Guidelines:

- Use only the public Obsidian API. No private `app` internals beyond what's already used for capture (`electron` via `window.require`), and no hardcoded workspace class names where a public API exists.
- Register everything with `this.register*` so it's cleaned up on unload.
- Anything that touches the screen (scheme, view, sidebars, scroll, pointer) must restore the previous state when it's done, even on error.
- UI uses Obsidian's own components (`Setting`, `ToggleComponent`, `ButtonComponent`) and CSS variables, so it follows whatever theme is active — including the one being built.
- Match the existing style: 2-space indent, single quotes, semicolons.
- New review rules should mirror an official rule where one exists (eslint-plugin-obsidianmd or the community scorecard) and carry its id; write the check against the masked code (`code` for string-aware checks, `bare` for API checks) so comments and messages can't trip it.
- Don't commit `data.json`.

## Pull requests

- One change per PR; keep them small enough to review.
- Describe what changed and why, and which command you exercised to test it.
- Don't bump `manifest.json` or `versions.json` — that happens at release time.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and the site's changelog section in `docs/index.html`.
2. Bump `version` in `manifest.json` and add the entry to `versions.json`.
3. Commit, then tag with the bare version number (no `v` prefix) and push the tag:
   ```bash
   git tag -a 1.1.0 -m '1.1.0' && git push origin 1.1.0
   ```
4. The release workflow checks the tag against `manifest.json` and `versions.json`, attests the files, and creates the GitHub release with `main.js`, `styles.css` and `manifest.json` attached.
