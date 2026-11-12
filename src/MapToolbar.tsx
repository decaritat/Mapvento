import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react'
import type { PlaceSearchResult, ToolMode } from './appTypes'
import { ExternalLink } from './ExternalLink'
import { OSM_COPYRIGHT_URL } from './mapLayers'
import { GEOCODING_PROVIDER } from './providers'
import { getDisplayedRouteCoordinates, type Route } from './routeModel'
import { LayerControl } from './LayerControl'

type MapToolIconName = 'search' | 'pan' | 'route' | 'point' | 'focus'
function MapToolIcon({ name }: { name: MapToolIconName }) {
  if (name === 'search') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m12.5 12.5 4 4" />
      </svg>
    )
  }

  if (name === 'pan') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M6 10V5.5a1 1 0 0 1 2 0V9V4.5a1 1 0 0 1 2 0V9V5a1 1 0 0 1 2 0v4l.8-.9a1 1 0 0 1 1.5 1.3l-2.5 3.1A3 3 0 0 1 9.5 14H8a3 3 0 0 1-2.1-.9l-1.3-1.3a1 1 0 0 1 1.4-1.4Z" />
      </svg>
    )
  }

  if (name === 'route') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M4 14C5 6 15 6 16 14" strokeDasharray="1.5 2" />
        <circle cx="4" cy="14" r="2" fill="currentColor" />
        <circle cx="16" cy="14" r="2" fill="currentColor" />
      </svg>
    )
  }

  if (name === 'point') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M10 18s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z" />
        <path d="M10 5.5v5M7.5 8h5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
    </svg>
  )
}


export function MapToolbar({ searchOpen, routePropertiesOpen, closeSearch, setSearchOpen, searchPlaces,
  searchInput, searchQuery, setSearchQuery, searchLoading, searchMessage, searchResults,
  focusSearchResultOnMap, setSearchMessage, toolMode, activateToolMode, activeRoute, focusRoute,
  layerId, overlayIds, changeLayer, toggleOverlay }: {
  searchOpen: boolean
  routePropertiesOpen: boolean
  closeSearch: () => void
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  searchPlaces: (event: FormEvent<HTMLFormElement>) => void
  searchInput: RefObject<HTMLInputElement | null>
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchLoading: boolean
  searchMessage: string
  searchResults: PlaceSearchResult[]
  focusSearchResultOnMap: (result: PlaceSearchResult) => void
  setSearchMessage: Dispatch<SetStateAction<string>>
  toolMode: ToolMode
  activateToolMode: (mode: ToolMode) => void
  activeRoute: Route | undefined
  focusRoute: (route: Route) => void
  layerId: string
  overlayIds: string[]
  changeLayer: (id: string) => void
  toggleOverlay: (id: string, enabled: boolean) => void
}) {
  return (
            <div className="map-tools" role="toolbar" aria-label="Kartenwerkzeuge">
              <div className="map-search">
                <button
                  type="button"
                  className={`map-tool-button ${searchOpen ? 'active' : ''}`}
                  disabled={routePropertiesOpen}
                  onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                  aria-label="Orte suchen"
                  aria-expanded={searchOpen}
                  aria-controls="map-place-search"
                  data-tooltip="Ort suchen"
                  title="Ort suchen"
                >
                  <MapToolIcon name="search" />
                </button>
                {searchOpen && (
                  <section
                    className="map-search-panel"
                    id="map-place-search"
                    aria-label="Ortssuche"
                  >
                    <form className="map-search-form" onSubmit={searchPlaces}>
                      <input
                        ref={searchInput}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Stadt, Ort oder Sehenswürdigkeit"
                        aria-label="Suchbegriff"
                      />
                      <button type="submit" disabled={searchLoading}>
                        Suchen
                      </button>
                      <button
                        type="button"
                        className="map-search-close"
                        onClick={closeSearch}
                        aria-label="Suche schließen"
                        title="Schließen"
                      >
                        ×
                      </button>
                    </form>
                    {searchLoading && <p className="map-search-message" role="status">Suche läuft …</p>}
                    {!searchLoading && searchMessage && (
                      <p className="map-search-message" role="status">{searchMessage}</p>
                    )}
                    {searchResults.length > 0 && (
                      <ul className="map-search-results" aria-label="Suchergebnisse">
                        {searchResults.map((result) => (
                          <li key={result.place_id}>
                            <button
                              type="button"
                              onClick={() => {
                                focusSearchResultOnMap(result)
                                setSearchMessage('')
                              }}
                            >
                              {result.display_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="map-search-attribution-bar">
                      <ExternalLink
                        className="map-search-attribution"
                        url={GEOCODING_PROVIDER.url}
                        title="Nominatim Nutzungsbedingungen und Richtlinien öffnen"
                      >
                        Nominatim
                      </ExternalLink>
                      <span className="map-search-attribution-sep">·</span>
                      <ExternalLink
                        className="map-search-attribution"
                        url={OSM_COPYRIGHT_URL}
                        title="OpenStreetMap Copyright & Lizenz (ODbL) öffnen"
                      >
                        Geocoding-Daten © OpenStreetMap
                      </ExternalLink>
                    </div>
                  </section>
                )}
              </div>
              <LayerControl layerId={layerId} overlayIds={overlayIds} disabled={routePropertiesOpen}
                changeLayer={changeLayer} toggleOverlay={toggleOverlay} />
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'pan' ? 'active' : ''}`}
                onClick={() => activateToolMode('pan')}
                aria-label="Karte verschieben, schreibgeschützt"
                aria-pressed={toolMode === 'pan'}
                data-tooltip="Karte verschieben (schreibgeschützt)"
                title="Karte verschieben (schreibgeschützt)"
              >
                <MapToolIcon name="pan" />
              </button>
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'route' ? 'active' : ''}`}
                disabled={routePropertiesOpen}
                onClick={() => activateToolMode('route')}
                aria-label="Routenbearbeitung"
                aria-pressed={toolMode === 'route'}
                data-tooltip="Routenbearbeitung"
                title="Routenbearbeitung"
              >
                <MapToolIcon name="route" />
              </button>
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'point' ? 'active' : ''}`}
                disabled={routePropertiesOpen}
                onClick={() => activateToolMode('point')}
                aria-label="Punkt oder POI setzen"
                aria-pressed={toolMode === 'point'}
                data-tooltip="Punkt / POI setzen"
                title="Punkt / POI setzen"
              >
                <MapToolIcon name="point" />
              </button>
              <button
                type="button"
                className="map-tool-button"
                disabled={routePropertiesOpen || !activeRoute || getDisplayedRouteCoordinates(activeRoute).length === 0}
                onClick={() => activeRoute && focusRoute(activeRoute)}
                aria-label="Aktive Route fokussieren und vollständig einpassen"
                data-tooltip="Route fokussieren"
                title="Route fokussieren und vollständig einpassen"
              >
                <MapToolIcon name="focus" />
              </button>
            </div>
  )
}
