# Mapvento

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Mapvento Icon" width="112">
</p>

**Mapvento** is a locally installable, open-source application for planning,
editing, and analyzing hiking and cycling routes. Routes and projects stay on
your device; map data is loaded online.

## Features

- Plan and edit multiple hiking and cycling routes on an interactive map
- Calculate routes with BRouter and precisely edit route waypoints
- View elevation profiles, distance, elevation gain, and duration
- Import GPX routes and export your own routes
- Select map layers and overlays, and manage points and POIs
- Save projects locally and continue working on them later

Visited map tiles are cached locally. Full offline maps are not currently
available.

## Platforms and requirements

Mapvento provides a desktop application for **Linux and Windows**. The web
UI can be run in a current browser during development. Releases are provided
as Linux AppImage (Linux builds target Ubuntu 24.04 compatibility) and a
Windows installer.

Development and builds require:

- Node.js 22 and npm
- Rust stable (1.90 or later) for the desktop application
- Tauri 2 platform dependencies and a C/C++ compiler

## Development

### Clone the repository

**Linux (Ubuntu):**

```bash
git clone https://github.com/decaritat/Mapvento.git
cd Mapvento
npm ci
```

### Run or build the web UI

The development server prints its local address in the terminal.

```bash
npm run dev
npm run build
```

### Run or build the Tauri desktop application

Install the Tauri system packages and Rust first:

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libxdo-dev libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
```

Install Rust with [rustup](https://rustup.rs/). Then use the following
commands to run or build the desktop application:

```bash
npm run desktop:dev
npm run desktop:build
```

## License

Mapvento is licensed under the
[GNU General Public License, version 3 or later](LICENSE).
