import { describe, expect, it, vi } from 'vitest'
import {
  ALL_PROVIDER_ATTRIBUTIONS,
  GEOCODING_PROVIDER,
  LEAFLET_INFO,
} from '../src/config/providers'
import { DEFAULT_LAYER_ID, isPersistableLayerId, isPersistableOverlayId, layers, overlayLayers, OSM_COPYRIGHT_URL } from '../src/domain/mapLayers'
import { ROUTING_PROVIDER } from '../src/domain/routing'
import { openExternalUrl } from '../src/integrations/desktop/externalUrl'

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
    expect(GEOCODING_PROVIDER.endpoint).toBe('https://nominatim.openstreetmap.org/search')
    expect(GEOCODING_PROVIDER.searchParameters).toEqual({
      format: 'jsonv2',
      limit: '5',
      polygon_geojson: '1',
    })

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
