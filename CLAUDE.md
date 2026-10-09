# Tenant Switcher for UiPath Studio

Brand: sorenb-brand
Brand category: extension (violet accent, ID pattern `SorenB.Studio.TenantSwitcher` → extension name `sorenb-studio-tenant-switcher`)

UiPath Studio 26 extension (VS Code-compatible extension host, TypeScript, packaged as `.vsix`) for switching the local Studio and Robot between Orchestrator tenants.

## Layout
- `src/`: extension code. `switcher.ts` drives a switch; `presetPanel.ts` (webview view, UI in `media/panel.js` + `panel.css` on the brand tokens in `media/sorenb-tokens.css`) and `statusBar.ts` are the UI; `presetForm.ts` validates the form; `presetStore.ts` and `credentialStore.ts` handle storage.
- `scripts/switch.ps1`: the switch runner, launched via WMI so it survives Studio's extension-host restart on tenant change. `scripts/credman.ps1`: Credential Manager helper.
- `test/`: vitest. The Credential Manager and `switch.ps1` end-to-end tests are Windows-only.
- `branding/`: product logo (generated with the sorenb-brand `make_logo.py`; glyph in `branding/glyphs/`).

## Constraints
- **Do not rename the shared store.** Keep `%AppData%\OrchestratorConnector\presets.json` (bare array, PascalCase keys) and the Credential Manager target `OrchestratorConnector:<guid>`. They are shared with the Orchestrator Connector desktop app.
- Studio ignores `view/title` buttons, does not truncate tree labels and asks every tree row for children. The UI is a webview view for that reason. Don't go back to a tree view.
- Studio fills icon geometry instead of stroking it, so `media/icon.svg` must be built from filled shapes.
- Webview: nonce CSP, no inline styles or scripts, user data only through `textContent`/`value`, and secrets never sent to the webview.
- Commit small steps and push straight to `main`. Tag `v*` only after the change has been tested in Studio; CI then publishes the release.

## Commands
`npm run typecheck`, `npm test`, `npm run build`, `npm run package`. Brand check: `python ~/.claude/skills/sorenb-brand/scripts/brand_check.py . --category extension`.
