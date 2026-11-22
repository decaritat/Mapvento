# Changelog

All notable changes to Mapvento are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
Mapvento follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once released versions are maintained.

## [Unreleased]

### Changed

- Use consistent German read-only labels and localized measurement formats.
- Support a 1024 × 600 minimum desktop window with scrollable content at larger text sizes.
- Keep project file and cache action problems visible and confirm cache deletions.
- Show unavailable route statistics as placeholders and identify estimated durations.
- Clarify icon states and make route color selection accessible.
- Consolidate action colors and states and remove symbols from text buttons.
- Harmonize keyboard navigation and dismissal behavior across menus and map panels.
- Declare the interface language and improve visible keyboard focus across controls.
- Improve text contrast and scalable typography in route details, editors and elevation profiles.
- Keep dialog focus and cancellation behavior consistent.
- Expand the elevation profile via a dedicated button and inspect it using clicks and keyboard navigation.

### Fixed

- Close the POI icon picker when focus leaves it so it does not cover the next field.
- Close place search and cancel waypoint and route-line drags with Escape.
- Protect unsaved project changes when opening or creating a project.

## [0.2.0] - 2026-11-20

### Added

- Show OpenStreetMap places (customer-accessible) with automatic
  bounded viewport loading and 14-day cache; using Dresel Overpass and
  Private.coffee as fallback.
- Show details of OpenStreetMap places in a popup window and provide quick
  acces to linked images and weblinks.
- OSM place details can prepare an editable POI draft with its OSM name when
  available (otherwise blank), description, icon, coordinates and OSM reference.
- Check for newer GitHub releases at startup and offer the latest download.

### Changed

- Start every launch with a new, empty project instead of restoring the last one.

## [0.1.0] - 2026-11-12

### Added

- Cross-platform desktop route-planning application built with Tauri, React,
  TypeScript, and Leaflet.
- Interactive hiking and cycling route planning with BRouter, editable
  waypoints, route properties, and a direct-routing fallback.
- Elevation profiles and route statistics based on available routing and GPX
  elevation data.
- Map layers for OpenStreetMap Carto and OpenTopoMap, with hiking and cycling
  overlays, visible attribution, and a bounded persistent tile cache.
- Project and GPX import and export, including validated project data and
  read-only GPX imports.
- Map points and POIs with editable properties, plus place search.
- Application settings, project and route editing, and an About dialog with
  provider and third-party license information.
- Automated CI, dependency license checks, and release workflows for Linux and
  Windows.

<!--
Categories from Keep a Changelog:
Added, Changed, Deprecated, Removed, Fixed, Security.

Add new changes only under [Unreleased]. When a release is published, assign
the changes to a version and add the release date.
-->