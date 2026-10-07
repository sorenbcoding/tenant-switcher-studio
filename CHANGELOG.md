# Changelog

## 0.1.0 (unreleased)
- Tenant presets are shared with the Orchestrator Connector desktop app: same `presets.json` and Credential Manager entries.
- Tree view and status bar switcher for Studio 26.
- Credentials are checked against Identity Server before the Robot is disconnected.
- Switching uses the documented `UiRobot connect` syntax and checks exit codes. If the connect fails, the extension reconnects the previous preset.
- Detects user-mode and service-mode installs. The Robot service is restarted, with elevation, only when it exists.
- Optional per-preset `uip login` sync.
- The switch runs outside Studio's extension host, so it survives the host restart on tenant change.
