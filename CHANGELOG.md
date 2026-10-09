# Changelog

All notable changes to Tenant Switcher for UiPath Studio are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-09

### Changed
- The preset tree is replaced by a side panel with a preset card for each preset. Each card has **Connect**, edit and delete actions, and long names are truncated.
- Adding or editing a preset uses one form with all fields, inline validation and a **Test** button, instead of five consecutive input boxes.
- Confirmations (switch, delete, unverified credentials) and switch results appear in the panel instead of Studio message boxes, which are always titled "Extension". Results have **Show log** and **OK** buttons. When the panel is closed, a message box with **OK** is used instead.
- While a switch runs, the panel and the status bar show the target tenant and the current step.
- The activity bar icon is redrawn as filled, rounded switch arrows. Studio fills icon shapes, so the stroked arrow shafts were invisible.

### Fixed
- The preset list repeated itself under every row in Studio.

## [0.2.0] - 2026-10-09

### Added
- **Add preset…** row at the top of the preset list. Studio does not show view title buttons.
- Product logo (light/dark SVG, PNG 16–128 px) and a theme-tinted activity bar icon.

### Changed
- Renamed from *Orchestrator Connector* to *Tenant Switcher for UiPath Studio*.
  - Extension ID is now `sorenbcoding.sorenb-studio-tenant-switcher`. Uninstall 0.1.0 before installing 0.2.0. Presets and secrets are kept.
  - Commands, views and settings use the `tenantSwitcher.` prefix instead of `orchestratorConnector.`. Set any changed settings again.
  - Repository moved to `sorenbcoding/tenant-switcher-studio`.
- Preset rows show only the name, so the inline Connect and Edit icons stay visible. The URL is in the tooltip.
- Error messages now state what failed, the likely cause and the next step.

## [0.1.0] - 2026-10-07

### Added
- Tenant presets shared with the Orchestrator Connector desktop app, using the same `presets.json` and Credential Manager entries.
- Preset tree view and a status bar tenant switcher for Studio 26.
- Credential check against Identity Server before the Robot is disconnected.
- Switch using the documented `UiRobot connect` syntax, with exit-code checks. A failed connect reconnects the previous preset.
- Detection of user-mode and service-mode installs. The Robot service is restarted, with elevation, only when it exists.
- Optional per-preset `uip login` sync.
- Switch runner that survives the extension host restart on tenant change.
