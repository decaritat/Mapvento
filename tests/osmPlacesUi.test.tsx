import { act } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlacesControl } from '../src/components/map/PlacesControl'
import { useOsmPlaces } from '../src/features/osm-places/useOsmPlaces'
import { placesCache, type CachedPlaces } from '../src/features/osm-places/placesCache'

function Harness({ map }: { map: L.Map }) {
  const places = useOsmPlaces(map)
  return <PlacesControl places={places} disabled={false} />
}

describe('OSM places map interaction', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads selected categories, displays status and markers, and reuses the cache', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    const stored = new Map<string, CachedPlaces>()
    vi.spyOn(placesCache, 'get').mockImplementation(async (keys) =>
      new Map(keys.flatMap((key) => stored.has(key) ? [[key, stored.get(key)!] as const] : [])))
    vi.spyOn(placesCache, 'put').mockImplementation(async (entries) => {
      for (const entry of entries) stored.set(entry.key, entry)
    })
    const clear = vi.spyOn(placesCache, 'clear').mockImplementation(async () => { stored.clear() })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 50, lon: 8, tags: { natural: 'spring', name: 'Quelle' } },
    ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const mapElement = document.createElement('div')
    Object.defineProperties(mapElement, { clientWidth: { value: 700 }, clientHeight: { value: 500 } })
    document.body.append(mapElement)
    const map = L.map(mapElement).setView([50, 8], 15)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness map={map} />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      await act(async () => container.querySelectorAll<HTMLInputElement>('#osm-places-panel input[type=checkbox]')[1].click())
      await act(async () => inputs[0].click())
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0][1].body.toString()).toContain('natural')
      expect(container.textContent).toContain('Orte sind aktuell')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(1)
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Quelle')

      await act(async () => { map.fire('moveend'); await vi.advanceTimersByTimeAsync(700) })
      expect(fetch).toHaveBeenCalledOnce()
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte schließen"]')!.click())
      expect(container.querySelector('.osm-places-status a')?.textContent).toBe('© OpenStreetMap')
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('#osm-places-panel button'))
      await act(async () => buttons.find((item) => item.textContent === 'Sichtbare Orte aktualisieren')!.click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledTimes(2)
      await act(async () => buttons.find((item) => item.textContent === 'Orte-Cache löschen')!.click())
      expect(clear).toHaveBeenCalledOnce()
      expect(stored.size).toBe(0)
      expect(container.textContent).toContain('Orte-Cache gelöscht')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      await act(async () => container.querySelectorAll<HTMLInputElement>('#osm-places-panel input[type=checkbox]')[1].click())
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      expect(container.textContent).toContain('Keine Kategorien ausgewählt')
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('cancels a running request when its category is disabled', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 60_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    const fetch = vi.fn().mockImplementation((_url, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetch)
    const mapElement = document.createElement('div')
    Object.defineProperties(mapElement, { clientWidth: { value: 700 }, clientHeight: { value: 500 } })
    document.body.append(mapElement)
    const map = L.map(mapElement).setView([50, 8], 15)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness map={map} />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const inputs = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      await act(async () => inputs[1].click())
      await act(async () => inputs[0].click())
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(fetch).toHaveBeenCalledOnce()
      const signal: AbortSignal = fetch.mock.calls[0][1].signal
      await act(async () => inputs[1].click())
      expect(signal.aborted).toBe(true)
      expect(container.textContent).toContain('Keine Kategorien ausgewählt')
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('explains the minimum zoom before issuing any request', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 60_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const mapElement = document.createElement('div')
    Object.defineProperties(mapElement, { clientWidth: { value: 700 }, clientHeight: { value: 500 } })
    document.body.append(mapElement)
    const map = L.map(mapElement).setView([50, 8], 7)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness map={map} />))
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const inputs = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      await act(async () => inputs[1].click())
      await act(async () => inputs[0].click())
      expect(container.textContent).toContain('mindestens auf Zoomstufe 14')
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Sichtbare Orte aktualisieren')?.disabled).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })
})
