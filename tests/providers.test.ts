import { describe, expect, it, vi } from 'vitest'
import {
  ALL_PROVIDER_ATTRIBUTIONS,
  GEOCODING_PROVIDER,
  getInspectorElevationStatus,
  getInspectorRouteStatus,
  LEAFLET_INFO,
} from '../src/providers'
import { DEFAULT_LAYER_ID, isPersistableLayerId, isPersistableOverlayId, layers, overlayLayers, OSM_COPYRIGHT_URL } from '../src/mapLayers'
import { ROUTING_PROVIDER } from '../src/routing'
import type { Route } from '../src/routeModel'
import { openExternalUrl } from '../src/externalUrl'

function createDummyRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-test',
    name: 'Test Route',
    description: '',
    type: 'hiking',
    editable: true,
    nodes: [
      { id: 'node-1', coordinate: [13.4, 52.5] },
      { id: 'node-2', coordinate: [13.5, 52.6] },
    ],
    routingState: 'ready',
    showDistanceMarkers: false,
    distanceMarkerMode: 'auto',
    distanceMarkerStepKm: 1,
    ...overrides,
  }
}

describe('provider definitions and attributions', () => {
  it('defines valid OpenStreetMap copyright URL', () => {
    expect(OSM_COPYRIGHT_URL).toBe('https://www.openstreetmap.org/copyright')
  })

  it('defines valid map layer providers with attribution links', () => {
    expect(layers.length).toBeGreaterThanOrEqual(2)

    const osmLayer = layers.find((l) => l.id === 'osm')
    expect(osmLayer).toBeDefined()
    expect(osmLayer?.provider).toBe('OpenStreetMap')
    expect(osmLayer?.attributionUrl).toBe(OSM_COPYRIGHT_URL)
    expect(osmLayer?.attribution).toContain('https://www.openstreetmap.org/copyright')

    const topoLayer = layers.find((l) => l.id === 'opentopomap')
    expect(topoLayer).toBeDefined()
    expect(topoLayer?.provider).toBe('OpenTopoMap')
    expect(topoLayer?.attributionUrl).toBe('https://opentopomap.org/about')
    expect(topoLayer?.attribution).toContain('https://opentopomap.org/about')
    expect(topoLayer?.attribution).toContain('https://www.openstreetmap.org/copyright')
  })

  it('has unique layer IDs and a persistable default layer', () => {
    const allLayers = [...layers, ...overlayLayers]
    expect(new Set(allLayers.map((layer) => layer.id)).size).toBe(allLayers.length)
    expect(DEFAULT_LAYER_ID).toBe('osm')
    expect(isPersistableLayerId(DEFAULT_LAYER_ID)).toBe(true)
    expect(isPersistableLayerId('unknown-layer')).toBe(false)
  })

  it('defines attributed hiking and cycling overlays with supported tile zooms', () => {
    expect(overlayLayers.map((layer) => layer.id)).toEqual(['waymarked-hiking', 'waymarked-cycling'])
    for (const layer of overlayLayers) {
      expect(layer.tiles).toMatch(/^https:\/\/tile\.waymarkedtrails\.org\/(hiking|cycling)\/\{z\}\/\{x\}\/\{y\}\.png$/)
      expect(layer.maxNativeZoom).toBe(18)
      expect(layer.attribution).toContain('waymarkedtrails.org')
      expect(layer.attribution).toContain('creativecommons.org/licenses/by-sa/3.0/de/')
      expect(layer.attribution).toContain(OSM_COPYRIGHT_URL)
      expect(isPersistableOverlayId(layer.id)).toBe(true)
      expect(isPersistableLayerId(layer.id)).toBe(false)
    }
    expect(isPersistableOverlayId('unknown')).toBe(false)
  })

  it('defines routing provider with attribution URL', () => {
    expect(ROUTING_PROVIDER.label).toBe('BRouter')
    expect(ROUTING_PROVIDER.attributionUrl).toBe('https://brouter.de/brouter-web/')
  })

  it('defines geocoding and library providers with valid URLs', () => {
    expect(GEOCODING_PROVIDER.label).toBe('Nominatim')
    expect(GEOCODING_PROVIDER.url).toContain('nominatim')

    expect(LEAFLET_INFO.label).toBe('Leaflet')
    expect(LEAFLET_INFO.url).toBe('https://leafletjs.com/')
  })

  it('includes all providers in ALL_PROVIDER_ATTRIBUTIONS for the About dialog', () => {
    const names = ALL_PROVIDER_ATTRIBUTIONS.map((a) => a.name)
    expect(names).toContain('OpenStreetMap')
    expect(names).toContain('OpenTopoMap')
    expect(names).toContain('Waymarked Trails')
    expect(names).toContain('Nominatim')
    expect(names).toContain('BRouter')
    expect(names).toContain('Leaflet')

    for (const attr of ALL_PROVIDER_ATTRIBUTIONS) {
      expect(attr.name).toBeTruthy()
      expect(attr.text).toBeTruthy()
      expect(attr.url).toMatch(/^https?:\/\//)
    }
  })
})

describe('inspector route status and tooltips', () => {
  it('returns appropriate text and tooltip when no route is active', () => {
    const status = getInspectorRouteStatus(undefined)
    expect(status.text).toBe('Keine aktive Route')
    expect(status.tooltip).toContain('Wähle eine Route')
    expect(status.isError).toBeFalsy()
  })

  it('returns appropriate text and tooltip when routing is loading', () => {
    const route = createDummyRoute({ routingState: 'loading' })
    const status = getInspectorRouteStatus(route)
    expect(status.text).toBe('Route wird berechnet …')
    expect(status.tooltip).toContain('BRouter')
  })

  it('returns error styling, text, and tooltip when in fallback routing', () => {
    const route = createDummyRoute({ routingState: 'fallback' })
    const status = getInspectorRouteStatus(route)
    expect(status.text).toBe('Direkter Fallback')
    expect(status.tooltip).toContain('Luftlinie')
    expect(status.isError).toBe(true)
  })

  it('indicates when fewer than 2 points are present', () => {
    const route = createDummyRoute({ nodes: [{ id: 'n1', coordinate: [13.4, 52.5] }] })
    const status = getInspectorRouteStatus(route)
    expect(status.text).toBe('Mindestens zwei Punkte erforderlich')
    expect(status.tooltip).toContain('mindestens zwei Punkte')
  })

  it('indicates when routing is idle', () => {
    const route = createDummyRoute({ routingState: 'idle' })
    const status = getInspectorRouteStatus(route)
    expect(status.text).toBe('Routing wird vorbereitet …')
    expect(status.tooltip).toContain('vorbereitet')
  })

  it('indicates when routing is active', () => {
    const route = createDummyRoute({ routingState: 'ready' })
    const status = getInspectorRouteStatus(route)
    expect(status.text).toBe('Routing aktiv')
    expect(status.tooltip).toContain('BRouter')
    expect(status.tooltip).toContain('erfolgreich')
  })
})

describe('inspector elevation status and tooltips', () => {
  it('returns inactive status when no route is active', () => {
    const status = getInspectorElevationStatus(undefined, 0)
    expect(status.text).toBe('Kein Höhenprofil')
    expect(status.active).toBe(false)
    expect(status.tooltip).toContain('Keine Route aktiv')
  })

  it('returns active status when elevations exist', () => {
    const route = createDummyRoute()
    const status = getInspectorElevationStatus(route, 25)
    expect(status.text).toBe('Höhenprofil aktiv')
    expect(status.active).toBe(true)
    expect(status.tooltip).toContain('Höhenprofil aktiv')
  })

  it('returns missing data status when elevations are empty', () => {
    const route = createDummyRoute()
    const status = getInspectorElevationStatus(route, 0)
    expect(status.text).toBe('Keine Höhendaten')
    expect(status.active).toBe(false)
    expect(status.tooltip).toContain('keine Höhendaten')
  })
})

describe('openExternalUrl helper', () => {
  it('opens URL in a new window/tab in browser mode', async () => {
    const openMock = vi.fn()
    vi.stubGlobal('window', { ...window, open: openMock })

    await openExternalUrl('https://www.openstreetmap.org/copyright')
    expect(openMock).toHaveBeenCalledWith(
      'https://www.openstreetmap.org/copyright',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
