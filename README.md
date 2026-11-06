# Trailforge

Trailforge is a locally installable open-source application for planning hikes and cycling tours. It is intended as a clear alternative to online outdoor platforms for tour planning and navigation: routes are created, edited, analyzed, and exported as GPX files on an OpenStreetMap-based map.

Trailforge is intended to run on Windows 11 and Linux. The desktop application is based on Tauri 2, React, TypeScript, and Leaflet. Map data is loaded online; previously viewed map tiles are cached locally, but complete offline areas are not provided.

## Current status

- OpenStreetMap Carto and OpenTopoMap base maps, with independently selectable
  Waymarked Trails hiking and cycling overlays in the map's layer tool
- Manually triggered place search for towns, landmarks, and other locations, with map highlighting
- Multiple independently editable hiking and cycling routes
- Routing through BRouter with separate hiking-beta and trekking profiles and a
  direct fallback when the provider fails; routing failures are shown per route
  with provider-specific messages, a retry action, and a dismissible error
  banner. Calculations run independently per route: changing route properties
  does not interrupt an unrelated or still-valid calculation, while changing
  its routing inputs or retrying replaces the affected calculation.
- Visible map-layer errors with a consistent retry banner when tile providers
  are unavailable; the banner can be dismissed with its close button
- A persistent, size-limited cache for visited base and overlay tiles, with
  layer-specific refresh, removal, and project coverage information
- Route waypoints created by clicking, deleted through the context menu or Delete
  key, and inserted by clicking or dragging the route. A drag keeps the two
  neighboring waypoints of the routed segment where it started, even when the
  pointer moves closer to another segment.
- Route name, description, type, and color
- Elevation profile with distance, elevation, and time information
- Distance, ascent, descent, duration, highest-point, and lowest-point metrics
- A keyboard-accessible header menu for opening and saving projects, configuring
  settings, managing caches, viewing application information, and exiting the desktop app
- GPX export for editable routes and read-only GPX import; imported routes can
  change color and distance markers while geometry, name, and description stay
  locked; available GPX route types are shown read-only, timestamps/elevations
  feed statistics, and imported routes cannot be re-exported as GPX. GPX
  waypoints are imported as read-only POIs.
- Independent points and POIs on the map with categorized symbols
- Zoom-dependent map scale and north arrow
- About dialog (Info) with version, project links, data attributions, and a
  filterable list of third-party components with license texts

Project files use the current version 1 format. Opening a file validates its
required fields, route and point IDs, coordinates, optional geometry, elevations
and timestamps, POI symbols, the base layer and optional overlay IDs. Older
version 1 files without overlay IDs open with no overlays enabled. Files with an unsupported
version or invalid data are rejected as a whole; unsupported or incomplete older
files are not migrated. An unavailable map-layer ID falls back to OpenStreetMap
Carto with a visible notice and a console warning; unavailable overlays are
disabled with a notice. Invalid locally stored
projects fall back to a new project.

The **Einstellungen** dialog stores application-wide preferences separately
from project files. Start settings select the base map, overlays, and a fixed
center and zoom, either entered manually or copied from the current view.
Once saved, they apply on the next launch; opening a project afterwards uses
the layers from that project. Before any settings are saved, the existing
project's layers are restored as before. Distance (km or mi), elevation
(m or ft), and duration display (hours and minutes, hh:mm, minutes, or decimal
hours) are independently configurable and apply
immediately to the map scale, distance labels, statistics, and profile.
The map scale uses Leaflet's metric or imperial subdivisions. Stored route
measurements, GPX exports, and internally stored manual distance-marker
intervals remain in their original metric units. Each settings category can be reset separately;
changes take effect only after choosing **Übernehmen**.

The React app coordinates project state and composes the route list, editors,
map toolbar and elevation profile. Leaflet map creation, layers and map events
are encapsulated in `useLeafletMap`; routing and project file operations have
separate hooks. Component styles are split into ordered CSS files imported by
`App.css` to preserve the shared cascade.

`src/mapLayers.ts` is the UI-independent registry for map-layer definitions.
The map, layer tool, and project validation use the same registry; layers
requiring an API key cannot be restored from a project.

`src/elevation.ts` defines the synchronous elevation fallback provider used by
route metrics, profile details, and GPX export. Complete finite elevations
stored on a route, including imported GPX and BRouter elevations, take
precedence; otherwise the synthetic provider supplies values for the displayed
geometry. The default fallback is selected in that module and can also be
supplied explicitly to the consumers. A future asynchronous DEM provider can
populate `route.elevations` at the routing or project-update boundary, aligned
with the current displayed geometry and guarded against stale results;
consumers then use those values without changing metric calculations.

### Map providers and tile usage

The layer tool selects one base map and any combination of overlays. Overlays
are drawn below editable routes and points; their attribution appears on the
map while enabled. All currently configured providers are keyless. Tile
requests go directly to the respective provider, which can observe the
requester's IP address. Zoom levels beyond a provider's available tiles use
the highest available tiles enlarged locally.

| Provider | Attribution and terms | Limits |
| --- | --- | --- |
| OpenStreetMap Carto | [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL; [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) | No published numeric quota. Normal interactive viewing only; no bulk download, prefetch or offline archives. HTTP caching and application identification required. |
| OpenTopoMap | © OpenTopoMap, CC BY-SA 3.0; © OpenStreetMap contributors, SRTM; [usage and FAQ](https://opentopomap.org/about#faq) | No published numeric quota. Avoid bulk downloads and excessive server load; availability is not guaranteed. |
| Waymarked Trails hiking/cycling | © Waymarked Trails, CC BY-SA 3.0 DE; © OpenStreetMap contributors, ODbL; [legal and usage terms](https://hiking.waymarkedtrails.org/#help-legal) | No published numeric quota. Moderate access, cache tiles as often as possible, correct referrer; mass downloads strongly discouraged. The published policy describes use on websites and does not explicitly address native applications. Therefore we follow the OSM guidelines. |

### Local tile cache

The header menu's **Cache verwalten** dialog shows the application tile cache,
its 100 MiB image-data limit,
provider counts, zoom levels and expired entries. It reports coverage of the
rectangle enclosing the current project's route geometry and points at the
current map zoom (limited to each provider's native zoom). This is not a
guarantee that the actual route or any offline region is complete. Empty
projects have no coverage estimate. The cache is shared between projects and
is not included in project files. Least-recently-used entries are evicted
when the limit is reached. The cache keeps its total size in IndexedDB and
uses an access-time index for eviction, avoiding a full metadata scan on
every tile write. To avoid a write transaction on every cache hit, the
last-access timestamp of a tile is updated at most once every 30 seconds. LRU
ordering is therefore approximate within that interval: a more recently viewed
tile may be evicted before another tile accessed within the same interval.
Existing caches are upgraded in place on first use; while
an older application window keeps the cache open, the upgrade may be blocked.

Only tiles requested for interactive display are stored; Trailforge does not
prefetch tiles or download offline areas. Refresh marks one layer's entries
for revalidation and immediately redraws that layer if active. Other entries
are revalidated only when subsequently viewed. Deleting a layer or the entire
application cache does not clear the browser or webview's separate HTTP cache.
Expired tiles are not displayed if revalidation fails. Cache failures are
reported and the browser's normal HTTP image loading is used if persistent
storage is unavailable.

IndexedDB provides the bounded application cache in supported browser and
Tauri webviews. Browser-managed storage can still be evicted, cleared by the
user or unavailable due to platform settings. Cache-Control and Expires are
honoured, including no-store and no-cache; where freshness information is
unavailable, the fallback is seven days. The browser/webview HTTP cache handles
conditional ETag/Last-Modified requests; these providers do not generally
expose ETag or permit custom conditional headers cross-origin. The explicit
refresh action requests revalidation; ordinary browsing does not bypass HTTP
caches. If a max-age response lacks enough exposed timing information to
determine its remaining freshness, it is revalidated rather than assumed fresh.
Browser and webview storage behaviour may differ across platforms.
Waymarked Trails' published policy requires a correct referrer and discusses
use on websites, but does not explicitly state terms for native applications.

### Comparing browser and desktop tile performance

The opt-in diagnostic is available in **Einstellungen → Entwicklung**. Enable
**Cache-Diagnose** to show its controls under **Cache verwalten**; recording
still starts only when explicitly requested. Disabling the option stops any
active recording and discards its in-memory log. The recording and log logic
is in `src/tileDiagnostics.ts`; instrumentation is in
`src/tileCache.ts`, and the controls and import/export are in
`src/TileDiagnosticsControl.tsx`.

To run it from a checkout, install Node.js and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (including
Rust and the platform build tools), then run `npm ci` once:

- **Browser:** run `npm run dev`, then open the local address printed by Vite
  in your browser. Leave the terminal running.
- **Desktop webview:** in a separate terminal run `npm run desktop:dev`.
  This builds and opens the Tauri application. Leave the terminal running.
  To create an installer instead, run `npm run desktop:build`.

Use the same Trailforge revision, screen/window size, network, base layer and
overlay selection in both. Choose the same map area and starting zoom; avoid
other activity during the measurements. The browser and desktop have separate
application and HTTP caches. For a cold **application-cache** comparison,
clear the application tile cache in each via **Gesamten Kachelcache löschen**,
then restart each application at the same starting view. This does **not** clear
the separate HTTP cache. For a warm comparison, first perform the same map
movement in each, then record the same movement again. Compare cold and warm
measurements separately. Tiles already displayed when recording begins do not
count until they are requested again.

1. In the first application, open **Cache verwalten**, select **Messung starten**,
   close the dialog and perform the agreed sequence of pans and zoom changes.
2. Wait until visible tiles have finished loading, reopen the dialog and select
   **Messung stoppen**, then **Diagnose speichern**. In the browser the file
   picker or downloads directory is used; on desktop select a location in the
   native save dialog.
3. Repeat the same sequence in the other application and save its JSON file.
   The dialog can load one file with **Messung laden** and the other with
   **Vergleichsmessung laden** to display their summaries together in the
   same dialog.
4. Attach **both JSON files** to the conversation when requesting analysis.
   Include which run was cold or warm, the operating system and a brief
   description of the steps. Do not send project files, screenshots of private
   locations or other personal data unless needed and deliberately shared.

Recording is off by default, held only in memory until explicitly saved, and
lost on closing the application. Starting a new recording replaces the previous
one. Logs contain times, application version, browser/desktop environment,
layer IDs, zooms, cache outcomes, HTTP response status and durations, but no
tile coordinates, URLs or project data. Review the JSON before sharing.
Only completed application-cache tile loads are included; the count still in
flight at stop and any events dropped after the 20,000-event limit are reported.
The summaries show mean elapsed times for measured IndexedDB operations,
including waiting for queued transactions, and fetch/body processing.
Only actual access-update attempts contribute to their mean duration; newer
logs also report how many updates were attempted. A fetch
may be served by the webview's HTTP cache: these logs cannot determine whether
it caused network traffic or how long rendering or decoding took. Direct image
loads used when IndexedDB is unavailable or fails are not counted as fetches;
storage errors in the cache path are recorded. Developer tools or a network
trace would be needed to distinguish real network transfers.

The cache is specific to tile imagery and separate from project data. Future
Overpass data caching should use a separate provider-aware namespace and its
own request keys, response validation, freshness and storage limits; it must
not assume tile coordinates or reuse tile-provider policies.

For future offline-map work, [OpenAndroMaps](https://www.openandromaps.org/en/)
offers Mapsforge vector maps rather than Leaflet raster tiles;
[Geofabrik](https://download.geofabrik.de/) provides regional OSM data
extracts rather than rendered tiles; and
[osmhike-tileserver](https://github.com/bmgru/osmhike-tileserver) is a
self-hosted Linux/Docker rendering stack. Each would require separate format,
licensing, update and resource evaluation before integration.

## Development

```text
npm install
npm run dev
npm run build
npm run lint
npm test
```

The Vitest suite exercises React and Leaflet interactions in jsdom. It uses
inline tile images and explicit routing and search responses; unexpected
network requests fail the tests.

The Tauri desktop shell requires Rust and the platform-specific prerequisites for Tauri 2:

```text
npm run desktop:dev
npm run desktop:build
```

Architecture and development rules are documented in [.github/copilot-instructions.md](.github/copilot-instructions.md).

The About dialog lists third-party components from
`src/generated/third-party.json`, which `npm run dev` and `npm run build`
generate with `scripts/generate-third-party.mjs` (npm packages from
`package-lock.json` after `npm ci`, Rust crates through `cargo about`). Without
`cargo-about` the Rust crates are left out and the dialog says so; release
builds require them.

## Releases

Pushing a tag starting with `v` runs `.github/workflows/release.yml`. It
builds a Windows NSIS installer (`.exe`) and a Linux AppImage (on Ubuntu 22.04
for broad glibc compatibility). The tag is the single source of truth for the
version: the workflow writes it into `package.json` and `src-tauri/Cargo.toml`
and the bundle configuration during the build, so the versions committed in the
repository are placeholders and need no manual update. Development builds show
`-dev` after the version in the About dialog.
Nothing is published unless both builds succeed.

- Final tag, e.g. `v0.2.0`: creates a **draft** GitHub Release with both
  assets. The description is taken from the `## [0.2.0]` section of
  `Changelog.md`, which must exist and be non-empty (checked before building).
  Review the draft and publish it manually on GitHub.
- Pre-release, i.e. `vX.Y.Z-<anything>` such as `v0.2.0-rc.1` or
  `v0.2.0-nightly`: no GitHub Release is created. The
  installers are pushed to GitHub Packages as an OCI artifact
  (`ghcr.io/<owner>/trailforge/installers:v0.2.0-rc.1`; characters not allowed
  in OCI tags become `-`), downloadable with
  `oras pull`).

```text
git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1
git tag v0.2.0 && git push origin v0.2.0
```

### Licenses and SBOM

Trailforge is GPL-3.0-or-later. `.github/workflows/licenses.yml` (on every
dependency change and before every release build) generates
`THIRD-PARTY-NOTICES.md` (package, version, origin, license, copyright, full
license texts) for production npm dependencies and Rust crates, plus CycloneDX
SBOMs (`sbom-npm.cdx.json`, `sbom-rust.cdx.json`). The job fails if a lock file
is out of sync or a dependency has an unknown license or one not on the
allowlist (`.github/scripts/npm_notices.py`, `src-tauri/about.toml`). The
notices and `LICENSE` are bundled into the installers and attached to the
release/package. Binary distribution under GPLv3 requires offering the
corresponding source: the tagged GitHub repository serves as that source.

## Development with AI assistance

Trailforge is developed with the assistance of AI. AI is used for requirements analysis, architectural decisions, implementation, documentation, and quality assurance. Decisions, code reviews, and responsibility for the results remain with the project team.

## Data, attribution, and license

Map data and map tiles are currently loaded online and are not bundled with the application. OpenStreetMap attribution is displayed in the application. Before using additional providers, their terms of use, tile limits, API requirements, and attribution requirements must be checked.

### Place search

Place search uses the public Nominatim service. Searches are sent only after
the user submits the search field; there is no autocomplete. Results include
OpenStreetMap attribution. Search results with area geometry are outlined and
fitted to the map; point results receive a temporary pin. The Tauri desktop
application identifies its request with a `Trailforge` User-Agent.

The public Nominatim service has limited capacity. Its policy requires
identifying the application, visible attribution, no more than one request per
second across the application, and the ability to switch services if requested.
Trailforge caches results for the current app session and prevents searches
more frequent than once per second in that session. This client-side limit
cannot enforce the aggregate limit across all Trailforge installations; usage
must remain moderate, and a configurable provider or proxy is needed before
relying on the public service at larger scale. See the
[Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).

### Routing provider

Trailforge currently uses the public BRouter instance at
`https://brouter.de/brouter`. It does not require an API key and
selects the routing mode from the route type:

| Route type | BRouter profile | Routing behavior |
| --- | --- | --- |
| Hiking | `hiking-beta` | Hiking profile for foot routes and trails |
| Cycling | `trekking` | Elevation-aware cycling profile with a preference for routes away from car traffic |

The public endpoint currently returns a successful route for `hiking-beta`;
the `hiking` profile currently responds with an HTTP 500 error and is
therefore not used. BRouter was selected because its profiles are configurable,
elevation-aware, and available without an API key. The public service is subject to its
availability and fair-use policies; self-hosting BRouter remains an option for
predictable capacity and custom profiles. GraphHopper and OpenRouteService
provide strong hiking and cycling profiles, but their hosted APIs normally
require an API key. OSRM is fast and its public demo currently accepts `foot`
and `cycling`, but its profiles are statically prepared by the server.

The project is licensed under [GNU GPL-3.0-or-later](LICENSE). Derived projects and forks must comply with the applicable copyleft obligations.
