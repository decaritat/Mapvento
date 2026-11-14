import { act } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlacesControl } from '../src/components/map/PlacesControl'
import { useOsmPlaces } from '../src/features/osm-places/useOsmPlaces'
import { placesCache, type CachedPlaces } from '../src/features/osm-places/placesCache'

function Harness({ map, diagnosticsEnabled = false }: { map: L.Map; diagnosticsEnabled?: boolean }) {
  const places = useOsmPlaces(map, diagnosticsEnabled)
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

  it('records HTTP outcomes only while diagnostics are enabled without restarting an active request', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 120_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    let respond: (response: Response) => void = () => {}
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve }))
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
      const inputs = container.querySelectorAll<HTMLInputElement>('#osm-places-panel input[type=checkbox]')
      await act(async () => inputs[1].click())
      await act(async () => inputs[0].click())
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(fetch).toHaveBeenCalledOnce()
      const signal: AbortSignal = fetch.mock.calls[0][1].signal
      await act(async () => root.render(<Harness map={map} diagnosticsEnabled />))
      expect(signal.aborted).toBe(false)
      expect(fetch).toHaveBeenCalledOnce()
      expect(container.textContent).toContain('Noch keine Diagnoseereignisse.')
      await act(async () => respond(new Response('', { status: 503 })))
      expect(container.textContent).toContain('HTTP 503')
      expect(container.textContent).toContain('http-error')
      expect(container.querySelector<HTMLButtonElement>('section[aria-label="Overpass-Diagnose"] button')?.disabled).toBe(false)
      await act(async () => root.render(<Harness map={map} />))
      expect(container.querySelector('[aria-label="Overpass-Diagnose"]')).toBeNull()
      await act(async () => root.render(<Harness map={map} diagnosticsEnabled />))
      expect(container.textContent).toContain('Noch keine Diagnoseereignisse.')
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it.each([
    ['map-movement', 'Kartenbewegung oder Zoom', 0],
    ['category-change', 'Kategorie geändert', 1],
    ['visibility-change', 'Orte-Anzeige geändert', 2],
    ['manual-refresh', 'Manuelle Aktualisierung', 3],
    ['cache-clear', 'Cache gelöscht', 4],
  ] as const)('reports the %s cancellation trigger', async (trigger, label, index) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 180_000 + index * 10_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'clear').mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = vi.fn().mockImplementation((_url, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
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
      await act(async () => root.render(<Harness map={map} diagnosticsEnabled />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const inputs = container.querySelectorAll<HTMLInputElement>('#osm-places-panel input[type=checkbox]')
      await act(async () => inputs[1].click())
      await act(async () => inputs[0].click())
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(fetch).toHaveBeenCalledOnce()
      const signal: AbortSignal = fetch.mock.calls[0][1].signal
      await act(async () => {
        if (trigger === 'map-movement') map.fire('movestart')
        if (trigger === 'category-change') inputs[1].click()
        if (trigger === 'visibility-change') inputs[0].click()
        if (trigger === 'manual-refresh') Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Sichtbare Orte aktualisieren')!.click()
        if (trigger === 'cache-clear') Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Orte-Cache löschen')!.click()
      })
      expect(signal.aborted).toBe(true)
      expect(signal.reason.message).toBe(trigger)
      expect(container.textContent).toContain(label)

      const write = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close: async () => {} }) }))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Overpass-Diagnose"] button')!.click())
      const log: unknown = JSON.parse(write.mock.calls[0][0])
      expect(log).toMatchObject({ format: 'mapvento-overpass-diagnostics', version: 3, environment: 'browser',
        events: expect.arrayContaining([expect.objectContaining({ abortReason: trigger, outcome: 'aborted' })]) })
      expect(JSON.stringify(log)).not.toContain('50,8')
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('shows the provider switch and fallback while loading', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 1_000_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockImplementation((_url, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason))))
    vi.stubGlobal('fetch', fetch)
    const mapElement = document.createElement('div')
    Object.defineProperties(mapElement, { clientWidth: { value: 700 }, clientHeight: { value: 500 } })
    document.body.append(mapElement)
    const map = L.map(mapElement).setView([50, 8], 15)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness map={map} diagnosticsEnabled />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      const inputs = container.querySelectorAll<HTMLInputElement>('#osm-places-panel input[type=checkbox]')
      await act(async () => inputs[1].click())
      await act(async () => inputs[0].click())
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(container.textContent).toContain('Wechsel zu Private.coffee')
      expect(container.textContent).toContain('dresel-europe')
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(container.textContent).toContain('Fallback für Dresel (Europa)')
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })
})
