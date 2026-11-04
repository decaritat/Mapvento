# Trailforge - Copilot Instructions

## Project goal

Trailforge is a locally installable, cross-platform open-source application for creating, editing, analyzing, and exporting hiking and cycling routes. The application is intended to run on Windows 11 and Ubuntu and to provide capabilities commonly expected from online outdoor platforms for tour planning and navigation.

## Architecture

- Desktop shell: Tauri 2.
- UI: React with TypeScript and Vite.
- Map: Leaflet. MapLibre was not used because of worker issues in the target webview.
- Maps: replaceable raster tile providers with Leaflet layer control and visible attribution.
- Routing: provider abstraction; currently the public BRouter service without
  an API key, using the `hiking-beta` profile for hiking and `trekking` for
  cycling with an explicit direct fallback on failure.
- Elevation: currently calculated or synthetic values; the provider boundary must be preserved for future DEM data.
- Data model: serializable project file with map layers, routes, waypoints, geometries, independent points, and editing states.
- File operations: browser- and Tauri-compatible file APIs with clean cancellation behavior and a download fallback.
- Styling: continue using the existing React/CSS structure and established UI patterns.

### Architecture and maintainability

- Keep `App` as the composition and application-coordination layer. Put
  independently changeable UI areas, domain logic, and side-effect
  orchestration in focused components, hooks, or modules with clear typed
  inputs and outputs.
- Keep domain and persistence logic independent of React and Leaflet. Confine
  Leaflet objects and lifecycle management to the map integration; do not pass
  Leaflet objects into general UI components.
- Put external services and replaceable capabilities behind small typed
  provider or adapter boundaries. Keep provider-specific behavior out of
  domain models, and keep each capability's configuration in one source of
  truth shared by persistence and UI.
- Treat asynchronous work as an explicit lifecycle: identify requests by the
  inputs that determine their result, cancel them when those inputs change or
  their owner unmounts, and prevent stale results from overwriting newer
  state. Unrelated metadata changes must not cancel valid work. Represent
  loading, success, fallback, cancellation, and failure states deliberately.
- Treat imported and persisted data as `unknown` at the boundary. Validate it
  before using it as a domain type; preserve the required versioning and
  backward-compatible migration behavior, then validate the migrated current
  format. Do not use unchecked type assertions or silently discard invalid
  data. Invalid local persistence must recover safely, while invalid user
  imports must show a useful error.
- Prefer existing module boundaries and the simplest abstraction that makes
  responsibilities clearer or behavior independently testable. Avoid
  speculative frameworks, duplicate registries, and growing a central
  component with unrelated responsibilities.

## Development rules

- Keep changes small, understandable, and limited to the requirement.
- Never make changes directly on `main`. Create a separate branch with a clear, descriptive name for every new feature.
- Each commit must be as small and focused as possible while containing one complete, functional change.
- A branch may be merged into `main` only after its work is complete and tested.
- After the changes are available in the remote `main` branch, the feature branch may be deleted.
- Search existing code and provider boundaries before introducing new abstractions.
- Do not include API keys, credentials, or private data in the source code.
- Add providers only when their URL, attribution, terms of use, and any API key requirements have been clarified.
- Handle errors visibly; do not use silent success fallbacks except for the explicitly intended routing fallback.
- Version project files and normalize them backward-compatibly when the data model changes.
- Interactive map and profile features must work with the mouse, keyboard, and relevant edge positions.
- Validate Tauri and web development separately: `npm run build`, `npm run lint`; build Tauri only when the Rust toolchain is available.
- Do not change unrelated files or provider attributions without a technical justification.
- Update documentation when the architecture, providers, data format, or user interaction changes.
- Maintain a `Changelog.md`. Document all notable changes under the
  `[Unreleased]` category following the
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Suitable
  categories are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and
  `Security`. When a release is published, assign the changes to a version
  with a date; do not silently overwrite existing entries.

### Changelog management rules

- Entries in `Changed` and `Fixed` sections **must always refer to changes since the last published release**. They describe adjustments or bug fixes to previously released features.
- If a change or fix is made to a feature that is **currently in `[Unreleased]` under `Added`**, do not create separate entries in `Changed` or `Fixed`. Instead:
  - Rewrite or refine the existing `Added` entry to reflect the current state of that feature.
  - Keep all work on an unreleased feature consolidated under `Added`.
- Example: If a new feature "Export as PNG" is added to `[Unreleased] Added`, and then improvements or bug fixes are made to it before release, update the `Added` entry itself rather than adding entries to `Changed` or `Fixed`.
- Once a version is released (moved from `[Unreleased]` to a numbered version), any subsequent modifications to those features belong in the next `[Unreleased] Changed` or `[Unreleased] Fixed` section.

## Quality criteria

Before completing a change, verify the affected functionality. The following areas are particularly important:

1. Map layer selection and restoration from project files.
2. Routing and visible geometry rather than simply connecting waypoints.
3. Selecting, deleting, and inserting route waypoints.
4. Consistency between the route, elevation profile, and route metrics.
5. GPX and project import and export, including names and descriptions.
6. Readability and clear identification of read-only imports.
7. Build and lint capability without TypeScript or lint errors.
8. Validate project and GPX data at import boundaries; cover malformed input,
   supported-version migration, and safe recovery from invalid persisted data.
9. Keep routing and other asynchronous provider work cancellable, retryable,
   and protected against stale results; test input changes, retries, and
   cleanup behavior.
10. Keep map behavior behind the Leaflet integration and test user-visible
    interactions without real network services, tile servers, or provider
    calls.
11. Add focused tests for changed behavior at the appropriate level: pure unit
    tests for domain logic and interaction tests for UI or side-effect
    orchestration. Prefer assertions about observable behavior and lifecycle
    outcomes over whole-application snapshots.
