# Orchestrator Connector for UiPath Studio

A UiPath Studio extension for switching the local Studio and Robot between Orchestrator tenants in one click, using saved presets. Each preset holds a name, an Orchestrator URL, a machine client ID and a client secret.

This is the in-Studio version of the [Orchestrator Connector](https://github.com/sorenbcoding/OrchestratorConnector) desktop app. **Both use the same preset store**, so a preset you create in one shows up in the other.

## Requirements
- UiPath Studio 26.0.195 or later on Windows, which supports extensions.
- A machine template (or standard machine) in Orchestrator with **client ID / client secret** credentials.

## Install
1. Download the `.vsix` from [Releases](https://github.com/sorenbcoding/OrchestratorConnector-Studio/releases), or from the latest CI run's artifacts.
2. In Studio, open **Extensions → Custom** and select the `.vsix` file.

## Use
- Open the **Orchestrator Connector** view from the activity bar.
- Click **+** to add a preset. A blank client secret when editing keeps the stored one.
- Use a preset's **plug** icon to connect it. Its right-click menu has **Test Credentials** and **Delete**.
- The **status bar** shows the tenant you are connected to. Click it to switch tenants.

## What a switch does
1. **Checks the credentials first.** It requests a `client_credentials` token from the tenant's Identity Server. If the credentials are wrong, the switch stops and nothing changes.
2. **Closes UiPath Assistant and runs `UiRobot disconnect`.**
3. **Runs `UiRobot connect --url … --clientId … --clientSecret …` and checks the exit code.** If the connect fails, the extension **reconnects the previously connected preset** automatically.
4. **Restarts the `UiPath Robot` Windows service, if this install has one** (service mode). This asks for elevation. Per-user installs have no service and skip this step.
5. **Starts Assistant again.**
6. **Optionally runs `uip login`** with the same client credentials, so the [UiPath CLI](https://docs.uipath.com/uipath-cli) used by Maestro, coding agents and others targets the same tenant. You enable this per preset.

Studio restarts its extension host when the tenant changes. For that reason, steps 2–6 run in a separate PowerShell process, launched through WMI so it lives outside Studio's process tree. The extension picks up the result after it restarts. Details are logged in the **Orchestrator Connector** output channel, and in `switch.log` in the extension's global storage folder.

## Where data is stored
| What | Where |
|---|---|
| Presets (name, URL, client ID) | `%AppData%\OrchestratorConnector\presets.json` (shared with the desktop app) |
| Client secrets | Windows Credential Manager, target `OrchestratorConnector:<preset id>` (shared with the desktop app) |
| Extension-only options (uip sync) | `preset-meta.json` in the extension's global storage |

Secrets never travel on a command line between the extension and its helper scripts. **One exception: `UiRobot.exe` accepts the client secret only as a command-line argument**, so the secret is briefly visible to local processes that can read other processes' command lines while `UiRobot connect` runs. The desktop app has the same limitation.

## Settings
| Setting | Default | |
|---|---|---|
| `orchestratorConnector.uiRobotPath` | *(auto)* | Full path to `UiRobot.exe`. |
| `orchestratorConnector.restartAssistant` | `true` | Close and restart Assistant around the switch. |
| `orchestratorConnector.validateBeforeSwitch` | `true` | Test the credentials against Identity Server before disconnecting. |
| `orchestratorConnector.confirmBeforeSwitch` | `true` | Ask for confirmation before switching. |
| `orchestratorConnector.uipCliPath` | `uip` | The `uip` command or its full path. |

## Development
```powershell
npm install
npm run build      # bundle to dist/ with esbuild
npm test           # vitest; includes Credential Manager and switch.ps1 end-to-end tests (Windows)
npm run package    # produce the .vsix
```
Press F5 in VS Code to try the views and forms in an Extension Development Host. To test the real switching, install the `.vsix` in Studio.

## License
MIT
