# Tenant Switcher for UiPath Studio

Brand: sorenb-brand
Brand category: extension (violet accent, ID pattern `SorenB.Studio.TenantSwitcher` → extension name `sorenb-studio-tenant-switcher`)

UiPath Studio 26 extension (VS Code-compatible extension host, TypeScript, packaged as `.vsix`) for switching the local Studio and Robot between Orchestrator tenants.

## Layout
- `src/`: extension code. `switcher.ts` drives a switch; `presetTree.ts` and `statusBar.ts` are the UI; `presetStore.ts` and `credentialStore.ts` handle storage.
- `scripts/switch.ps1`: the switch runner, launched via WMI so it survives Studio's extension-host restart on tenant change. `scripts/credman.ps1`: Credential Manager helper.
- `test/`: vitest. The Credential Manager and `switch.ps1` end-to-end tests are Windows-only.
- `branding/`: product logo (generated with the sorenb-brand `make_logo.py`; glyph in `branding/glyphs/`).

## Constraints
- **Do not rename the shared store.** Keep `%AppData%\OrchestratorConnector\presets.json` (bare array, PascalCase keys) and the Credential Manager target `OrchestratorConnector:<guid>`. They are shared with the Orchestrator Connector desktop app.
- Studio ignores `view/title` buttons and has no command palette. Every action needs a tree row, an inline or context menu entry, or the status bar.
- Studio does not truncate tree labels, so keep preset rows short. Put details in tooltips.
- Commit small steps and push straight to `main`. Tag `v*` only after the change has been tested in Studio; CI then publishes the release.

## Commands
`npm run typecheck`, `npm test`, `npm run build`, `npm run package`. Brand check: `python ~/.claude/skills/sorenb-brand/scripts/brand_check.py . --category extension`.
