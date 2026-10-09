<p align="center">
  <img src="branding/tenant-switcher-studio-light-128.png#gh-light-mode-only" width="96" alt="Tenant Switcher for UiPath Studio logo">
  <img src="branding/tenant-switcher-studio-dark-128.png#gh-dark-mode-only" width="96" alt="Tenant Switcher for UiPath Studio logo">
</p>

<h1 align="center">Tenant Switcher for UiPath Studio</h1>
<p align="center">By Søren Schytz Birk</p>

Tenant Switcher switches the local UiPath Studio and Robot between Orchestrator tenants in one step. It uses saved presets, each with an Orchestrator URL, a machine client ID and a client secret.

## Install

- UiPath Studio 26.0.195 or later on Windows. That is the first version with extension support.
- Download `sorenb-studio-tenant-switcher-<version>.vsix` from [Releases](https://github.com/sorenbcoding/tenant-switcher-studio/releases).
- In Studio, open **Extensions → Custom** and select the file.
- You also need a machine in Orchestrator that uses **client ID / client secret** credentials, either a machine template or a standard machine.

Upgrading from *Orchestrator Connector* 0.1.0: uninstall it first. Your presets and secrets are kept.

## Quick example

1. Open **Tenant Switcher** in the activity bar.
2. Select **Add preset** and fill in the form:
   - Name: `Acme production`
   - URL: `https://cloud.uipath.com/acme/Production/orchestrator_`
   - The machine's client ID and client secret.
   - Select **Test** to check the credentials, then **Save**.
3. Select the tenant name in the status bar. Pick `Acme production`, and confirm.
4. The Robot reconnects. Studio reloads its extensions, then reports `Connected to 'Acme production'.`

## Reference

### Panel
The **Tenant Switcher** panel in the activity bar lists your presets. Each preset has its own card:

| Action | Where |
|---|---|
| Add a preset | **Add preset** at the top of the panel opens a form with all fields |
| Connect | **Connect** on a preset card, or the tenant name in the status bar |
| Edit | the pencil icon on a card. Leave the client secret blank to keep the stored one. |
| Test credentials | **Test** in the form. It requests a token with the values entered, without touching the Robot. |
| Delete | the bin icon on a card. The stored secret is removed too. |

Confirmations appear on the preset card, for example *Do you want to switch tenant to Staging?* with **Switch** and **Cancel**. Switch results appear as a banner at the top of the panel with **Show log** and **OK**. Studio titles every extension message box "Extension", so the panel is used wherever possible. Selecting a tenant from the status bar list counts as the confirmation.

The connected preset has a violet border and a green **Connected** label. Hover over a card to see the full URL and client ID.

### What a switch does
1. Checks the credentials: it requests a `client_credentials` token from the tenant's Identity Server. If the credentials are rejected, nothing changes.
2. Closes UiPath Assistant and runs `UiRobot disconnect`.
3. Runs `UiRobot connect --url … --clientId … --clientSecret …` and checks the exit code. If the connect fails, the previously connected preset is reconnected.
4. Restarts the `UiPath Robot` Windows service, but only if one exists (service-mode installs). This asks for elevation. Per-user installs skip this step.
5. Starts UiPath Assistant again.
6. Optionally, per preset, runs `uip login` with the same client credentials so the UiPath CLI targets the same tenant.

Studio restarts its extension host when the tenant changes. Steps 2–6 therefore run in a separate PowerShell process, started through WMI, outside Studio's process tree. The extension reports the result once it is running again. Each step is logged in the **Tenant Switcher** output channel and in `switch.log` in the extension's global storage folder.

### Settings
| Setting | Default | Description |
|---|---|---|
| `tenantSwitcher.uiRobotPath` | *(empty)* | Full path to `UiRobot.exe`. Empty: detect the per-user UiPath Platform install, then Program Files. |
| `tenantSwitcher.restartAssistant` | `true` | Closes UiPath Assistant before the switch and starts it afterwards. |
| `tenantSwitcher.validateBeforeSwitch` | `true` | Tests the credentials against Identity Server before disconnecting. |
| `tenantSwitcher.confirmBeforeSwitch` | `true` | Asks for confirmation before switching. |
| `tenantSwitcher.uipCliPath` | `uip` | The `uip` command or its full path. |

### Storage
| Data | Location |
|---|---|
| Presets (name, URL, client ID) | `%AppData%\OrchestratorConnector\presets.json` |
| Client secrets | Windows Credential Manager, target `OrchestratorConnector:<preset id>` |
| uip sync option per preset | `preset-meta.json` in the extension's global storage |

The preset and secret locations keep the `OrchestratorConnector` name on purpose. They are shared with the [Orchestrator Connector](https://github.com/sorenbcoding/OrchestratorConnector) desktop app, so a preset created in one tool appears in the other.

### Security
Secrets pass between the extension and its helper scripts over standard input, never on a command line. One exception: `UiRobot.exe` accepts the client secret only as a command-line argument. While `UiRobot connect` runs, any local process that can read other processes' command lines can see it.

### Development
```powershell
npm install
npm run build      # bundle to dist/ with esbuild
npm test           # vitest; Credential Manager and switch.ps1 end-to-end tests run on Windows
npm run package    # create the .vsix
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).

---

By Søren Schytz Birk · UiPath Community MVP · [github.com/sorenbcoding](https://github.com/sorenbcoding)

Tenant Switcher for UiPath Studio is an independent open-source project by Søren Schytz Birk (github.com/sorenbcoding) and is not affiliated with, endorsed by, or sponsored by UiPath. UiPath and related names are trademarks of UiPath Inc.
