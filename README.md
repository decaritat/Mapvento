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

### OpenStreetMap places

Use the OSM places button on the map toolbar to choose categories and enable
their display. Places are loaded only for the visible area at zoom level 14
or higher. The download status, waiting periods and errors remain visible
while the layer is enabled. Explicitly private or inaccessible places are
excluded; places with unspecified access are included.

The app uses the public [Dresel Overpass service](https://ovp.dresel.systems/)
for covered areas in Europe and North America, without an API key. The worldwide
[Private.coffee Overpass service](https://overpass.private.coffee/) is used
outside those areas or if Dresel is unavailable; the current provider and any
switch are shown while loading. An area must fit completely inside one regional
extract, including a safety margin, to use Dresel. Requests are batched,
sequential and rate-limited, and rate-limit responses are respected rather than
bypassed. Loading places sends the map area and IP address to the selected
provider. Dresel documents 14-day API and query logs in its
[privacy information](https://ovp.dresel.systems/impressum.html#datenschutz);
see also [Private.coffee's privacy information](https://private.coffee/privacy).
The regional coverage uses a snapshot of Geofabrik's
[extract boundaries](https://download.geofabrik.de/technical.html), retrieved
on 2026-11-14 (© OpenStreetMap contributors, ODbL). It must be updated if
Geofabrik changes the extract boundaries; neither public service guarantees
availability.
Cached places are shared between providers and projects and
persist across restarts. Entries are refreshed after 14 days; outdated entries
remain visible while refreshing or if the service fails. The cache is bounded
to approximately 20 MiB and old entries can be evicted. Browser or application
storage may also be cleared by the user or operating system.

Use **Sichtbare Orte aktualisieren** to refresh the selected categories in the
current view without first deleting their cached data. **Orte-Cache löschen**
removes the stored place data instead. OSM places are separate from editable
project POIs and are not saved in project files.

For troubleshooting, enable **Overpass-Diagnose** under Einstellungen →
Entwicklung. The OSM places menu shows recent request and cache outcomes, phases,
HTTP statuses, recognized server errors and cancellation causes, with an option
to save the log. A map movement event may also be triggered programmatically;
network and CORS errors cannot always be distinguished by the browser. The log
contains no coordinates, URLs, API keys, response text or place data. It stays
in memory until disabled or the app closes and keeps at most 100 events. When
enabled, up to 4 KiB of an HTTP error response are inspected for one second at
most; only recognized error categories are recorded, never the response text.

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
