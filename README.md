[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

# Privitty Desktop <a id="privitty-desktop"></a>

**Desktop application for [Privitty](https://privittytech.com)** — take control of your shared data with guaranteed encryption and revocable access.

<center><img src="README_ASSETS/desktop.png" style="min-height: 600px;" /></center>

## Editions

| [`Electron`](https://www.electronjs.org/) :electron:                                       | [`Tauri`](https://tauri.app/) <img src="README_ASSETS/TAURI_Glyph_Color.svg" width="16px" height="16px" style="vertical-align:middle" /> | Browser 🦊🧭🏐                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| <img src="README_ASSETS/desktop.png" style="max-width:256px;min-hight:200px" />            | <img src="README_ASSETS/desktop.png" style="max-width:256px" />                                                                          | <img src="README_ASSETS/browser-screenshot.png" style="max-width:256px;min-hight:200px" /> |
| Default application. Based on Electron. Used for production builds and distribution.       | WIP client using Tauri (modern alternative to Electron: less disk/RAM, better performance).                                              | Experimental version with webserver and web UI. For developers and automated testing.      |
| [Project Folder](./packages/target-electron) <br /> [Build & Release](./PRIVITTY_BUILD.md) | [Project Folder](./packages/target-tauri)                                                                                                | [Project Folder](./packages/target-browser)                                                |

## Documentation Links <a id="docs"></a>

### For Users

- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [CLI flags](./docs/CLI_FLAGS.md)
- [Keybindings](./docs/KEYBINDINGS.md)
- [How to make custom Themes](./docs/THEMES.md)

### For Developers

- [Contribution Guidelines](./CONTRIBUTING.md)
- [Logging](./docs/LOGGING.md)
- [Documentation for Developers](./docs/DEVELOPMENT.md)
- [Styling Guidelines](./docs/STYLES.md)
- [How to update core](./docs/UPDATE_CORE.md)
- [How to do end to end testing](./docs/E2E-TESTING.md)
- [Privitty build & release](./PRIVITTY_BUILD.md)
- [Release process](./RELEASE.md)

## Table of Contents

<details><summary>Click to expand</summary>

- [Privitty Desktop](#privitty-desktop-)
  - [Editions](#editions)
  - [Documentation Links](#documentation-links-)
    - [For Users](#for-users)
    - [For Developers](#for-developers)
  - [Table of Contents](#table-of-contents)
  - [Install](#install-)
    - [Linux](#linux-)
    - [macOS](#mac-os-)
    - [Windows](#windows-)
    - [From Source](#from-source-)
    - [Troubleshooting](#troubleshooting-)
  - [Configuration and Databases](#configuration-and-databases-)
  - [How to Contribute](#how-to-contribute-)
  - [Logging](#logging-)
  - [License](#license-)

</details>

## Install <a id="install"></a>

Installers and builds are produced via CI or locally; see [PRIVITTY_BUILD.md](./PRIVITTY_BUILD.md) for build and release instructions. Platform-specific notes are below.

### Linux <a id="linux"></a>

- **From source:** See [From Source](#from-source-) and [PRIVITTY_BUILD.md](./PRIVITTY_BUILD.md).
- Distribution packages (Flatpak, AUR, etc.) may be available separately; check Privitty documentation or releases.

### macOS <a id="mac"></a>

- **DMG:** Use the `.dmg` from [releases](https://github.com/Privitty/privitty-desktop/releases) (or your build output). Open and drag Privitty to Applications.
- **Homebrew:** If a cask is published, `brew install --cask privitty-chat`.

### Windows <a id="windows"></a>

- Installers are built via GitHub Actions or locally; see [PRIVITTY_BUILD.md](./PRIVITTY_BUILD.md). Download the installer from [releases](https://github.com/Privitty/privitty-desktop/releases) when available.

### From Source <a id="source"></a>

> ⚠ Primarily for development. This does not install Privitty system-wide. For end users, prefer official installers when available.

```sh
# Clone the repository
git clone https://github.com/Privitty/privitty-desktop.git
cd privitty-desktop

# Install pnpm (if not already installed)
npm i -g pnpm

# Install dependencies
pnpm install

# Build the Electron app (first time or after code changes)
pnpm -w build:electron

# Run the application
pnpm -w start:electron
```

> The `-w` flag runs the command at the workspace root; you can run it from any folder in the repo.

For details on building installers (DMG, Windows, Linux) and signing, see [PRIVITTY_BUILD.md](./PRIVITTY_BUILD.md). For working with a local core/RPC server, see [docs/UPDATE_CORE.md](docs/UPDATE_CORE.md).

### Troubleshooting <a id="troubleshooting"></a>

- The app is built on top of a messaging core and the Privitty security layer. Dependencies and setup are described in [PRIVITTY_BUILD.md](./PRIVITTY_BUILD.md) and [docs/UPDATE_CORE.md](docs/UPDATE_CORE.md).
- Use Node.js **20.0.0** or newer.
- If you hit build or runtime errors, check the docs above or open an issue in this repository.

## Configuration and Databases <a id="config-and-db"></a>

Configuration and account databases use [application-config's default paths](https://www.npmjs.com/package/application-config#config-location). Each account is represented by a SQLite database file.

## How to Contribute <a id="how-to-contribute"></a>

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- For other ways to contribute, see [Privitty](https://privittytech.com) or this repo’s issue tracker.

## Logging <a id="logging"></a>

Open the log folder and current log file from **View → Developer** in the app. For how logging works, see [docs/LOGGING.md](docs/LOGGING.md).

## License <a id="license"></a>

Licensed under **GPL-3.0-or-later**. See the [LICENSE](./LICENSE) file for details.

> Copyright © Privitty contributors.

> This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

> This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

> You should have received a copy of the GNU General Public License
> along with this program. If not, see <http://www.gnu.org/licenses/>.

# Building for Production Vs Development:
At time we might need both Production and Development build to run in parallel, unless we segregate their data, else we might break one another. Therefore for production it create `Privitty` data directory where as for development it creates `Privitty-test`, this can be achieved using runtime option. 

## For Production:
```
pnpm -w dev:electron
```

## For Development
```
pnpm -w build:electron && pnpm --filter=@deltachat-desktop/target-electron exec electron . --disable-http-cache
```

# Build DMG for macOS

```sh
cd /Users/milinddeore/PROJECTS/delta/privitty-desktop
pnpm -w build:electron
cd /Users/milinddeore/PROJECTS/delta/privitty-desktop/packages/target-electron
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm pack:generate_config
pnpm pack:patch-node-modules
rm -rf dist
# arm64
electron-builder --config ./electron-builder.json5 --mac dmg --arm64 --publish never
# OR x86_64
electron-builder --config ./electron-builder.json5 --mac dmg --x64 --publish never
# OR universal
electron-builder --config ./electron-builder.json5 --mac dmg --universal --publish never
```
