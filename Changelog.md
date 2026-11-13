# Changelog

All notable changes to Mapvento are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
Mapvento follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once released versions are maintained.

## [Unreleased]

### Added

- Optional OpenStreetMap places with category filters, a persistent 14-day
  cache, download status, and manual refresh through Private.coffee Overpass.

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
