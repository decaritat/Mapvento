# Changelog

All notable changes to Trailforge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
Trailforge follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once released versions are maintained.

## [Unreleased]

### Added

- Added explanatory tooltips to inspector status displays (routing and
  elevation profile state), metric cards, and profile actions. Added direct,
  context-sensitive attribution links for map tile providers (OpenStreetMap
  Carto, OpenTopoMap) beside the layer dropdown, routing provider (BRouter) in
  the sidebar and route properties, geocoding provider (Nominatim) in place
  search. Preserved visible Leaflet attribution on the map with system browser
  link opening across desktop and web.
- Added an About dialog (Info button) showing the Trailforge version, links to
  the GitHub project, documentation, changelog, and license, data and service
  attributions (OpenStreetMap, OpenTopoMap, Nominatim, BRouter, Leaflet), and a
  filterable list of npm and Rust third-party components with their license
  texts. External links open in the system browser in the desktop app. The
  version comes from the Git tag in release builds and is marked `-dev`
  otherwise.
- Added a themed Kartenlayer dropdown matching the dark UI, replacing the
  native select with a white popup.
- Added a native file dialog for GPX export and project saving in the desktop
  app. In the browser, a failing file picker falls back to a normal download.
- Added a CI workflow that runs lint, unit tests, the web build, and a Tauri
  build without installer on Linux and Windows for every pull request and push
  to `main`.
- Added a license workflow that generates `THIRD-PARTY-NOTICES.md` and
  CycloneDX SBOMs for npm and Rust dependencies, fails on unknown or
  disallowed licenses, and ships the notices with installers and releases.
- Added a tag-triggered release workflow that builds a Windows NSIS installer
  and a Linux AppImage and takes the version from the tag. Final
  `vX.Y.Z` tags create a draft GitHub Release whose notes come from the matching
  `Changelog.md` section; any `vX.Y.Z-<suffix>` tag is published to GitHub
  Packages only.
- Added an editable project title and description, plus accessible route-card
  actions for properties, GPX export, and confirmed route removal.
- Extracted route geometry, metrics, elevation-profile calculations, GPX handling,
  elevation-provider fallback, and project validation into independently testable
  modules with Vitest unit coverage. Opening a project validates the complete
  current-version format, rejects invalid files, and safely falls back for invalid
  local storage. Map rendering, the layer selector, and project restoration share
  one layer registry; unavailable saved layer IDs fall back to OpenStreetMap Carto.
  Separated Leaflet integration, file operations, route and point editors,
  route list, toolbar, header, elevation profile and their styles from the
  application coordinator. Added network-independent React and Leaflet
  interaction coverage for project and GPX imports, routing retry, route and
  POI edits, and dialog keyboard and focus behavior.
- Restricted project title and description fields to edit mode, hid the project
  description counter outside that mode, and auto-sized the description field
  without exceeding a quarter of the sidebar.
- Made project and route descriptions editable in bounded, 180-character drafts
  with explicit apply/cancel actions; route properties now open in a separate
  panel beside the route list.
- Added GPX export to editable routes' action menus and a plus-button flow for
  creating a route or importing GPX. GPX imports are always read-only, retain
  that state in project files, allow color and distance-marker changes, hide
  route points, display any GPX route type as read-only, import GPX waypoints as
  read-only POIs, cannot be re-exported as GPX, and use available timestamps and
  elevations for route statistics.
- Use elevation samples returned by BRouter and GPX files for route metrics,
  profiles, and GPX exports.
- Added the map tool selection into a Leaflet-style control rail under the zoom
  buttons. The rail now provides read-only map panning, route editing,
  point/POI placement, and fitting the active route to the map.
- Added mode-specific map cursors and protected route nodes from editing,
  dragging, insertion, and deletion while read-only panning is active.
- Added routing provider BRouter. Hiking routes use `hiking-beta` and cycling
  routes use `trekking`; BRouter GeoJSON geometry is normalized before it is 
  displayed. Each route has an independent cancellable routing request, with
  a visible loading state, stale-result protection, and targeted retry; editing
  route properties does not interrupt or overwrite an active calculation.
- Added consistent error-banner handling for unavailable map layers and
  routing failures, with provider-specific BRouter messages, retry actions,
  a close button, and the existing direct route fallback.
- Added a unified Trailforge route-and-mountain app icon for the application
  header, browser favicon, and Tauri platform icons.
- Added optional route outlines and zoom-aware distance markers with compact
  map labels and configurable manual spacing persisted in project files.
- New projects now start with one empty editable route ready for route-point entry.
- Added a manually submitted place search beside the map toolbar, with an
  attributed result list, zoom-to-area behavior, temporary area outlines, and
  pins for point results.
- Synchronized the expanded elevation profile with the active route by showing
  a route-colored, white position marker during profile hover and ignoring
  invalid chart-edge positions.
- Unified route statistics and elevation-profile presentation with a compact
  collapsed view, an expanded interactive view, consistent metric ordering,
  distance-based axis scaling, a clickable mini-profile opener, and an
  in-panel close button.
- Support for separate hiking and cycling routes with a name, description,
  independent preset/custom colors, and route type.
- Routing through the configured routing provider with a direct fallback.
- Route waypoint editing, including selection, deletion, and insertion with a
  live drag preview showing the new point and affected neighboring segments.
- Elevation profile and route statistics for the active route.
- GPX export for editable routes, and saving and opening project files.
- Interactive map points and POIs with symbols from OpenStreetMap Carto (CC0)
  plus a few custom ones, a symbol dropdown that overlays the editor,
  labeled white map markers anchored exactly at their coordinates,
  side-positioned property editing, editable titles and descriptions,
  deletion, and a zoom-dependent map scale.
- Tauri desktop shell based on React, TypeScript, and Vite.

<!--
Categories from Keep a Changelog:
Added, Changed, Deprecated, Removed, Fixed, Security.

Add new changes only under [Unreleased]. When a release is published, assign
the changes to a version and add the release date.
-->
