import { act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacesControl } from '../src/components/map/PlacesControl'
import { useOsmPlaces } from '../src/features/osm-places/useOsmPlaces'
import { placesCache, type CachedPlaces } from '../src/features/osm-places/placesCache'

function Harness({ map, diagnosticsEnabled = false, onPlaceSelected }: {
  map: L.Map
  diagnosticsEnabled?: boolean
  onPlaceSelected?: () => void
}) {
  const places = useOsmPlaces(map, diagnosticsEnabled, onPlaceSelected)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <PlacesControl places={places} disabled={false} open={open} onToggle={() => setOpen(!open)}
    onClose={(restoreFocus) => { setOpen(false); if (restoreFocus) button.current?.focus() }}
    onCreatePoi={() => false} />
}

function kindInput(container: HTMLElement, label: string): HTMLInputElement {
  const option = Array.from(container.querySelectorAll<HTMLLabelElement>('.osm-places-option'))
    .find((item) => item.textContent?.trim() === label)
  if (!option) throw new Error(`Missing place kind: ${label}`)
  return option.querySelector('input')!
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function selectAndLoad(container: HTMLElement) {
  await act(async () => kindInput(container, 'Wasserquellen').click())
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  await act(async () => button(container, 'Orte laden').click())
  await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
}

describe('OSM places map interaction', () => {
  beforeEach(() => {
    vi.spyOn(placesCache, 'getVisible').mockResolvedValue(new Map())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects each type independently or as a group without issuing requests', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    const fetch = vi.fn()
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
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      expect(container.textContent).not.toContain('Orte auf der Karte anzeigen')
      expect(container.textContent).not.toContain('Beim Laden wird der Kartenausschnitt')
      expect(container.textContent).toContain('OpenStreetMap-Mitwirkende')
      await act(async () => kindInput(container, 'Wasserquellen').click())
      expect(kindInput(container, 'Wasserquellen').checked).toBe(true)
      expect(kindInput(container, 'Trinkwasser').checked).toBe(false)
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Wasser: alle auswählen"]')!.click())
      expect(kindInput(container, 'Wasserquellen').checked).toBe(true)
      expect(kindInput(container, 'Trinkwasser').checked).toBe(true)
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Wasser: alle abwählen"]')!.click())
      expect(kindInput(container, 'Wasserquellen').checked).toBe(false)
      expect(kindInput(container, 'Trinkwasser').checked).toBe(false)
      await act(async () => kindInput(container, 'Bäckereien').click())
      expect(kindInput(container, 'Bäckereien').checked).toBe(true)
      expect(kindInput(container, 'Metzgereien').checked).toBe(false)
      expect(kindInput(container, 'Supermärkte').checked).toBe(false)
      await act(async () => kindInput(container, 'Metzgereien').click())
      expect(kindInput(container, 'Metzgereien').checked).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('loads the selected food shops with their matching marker symbols', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue(undefined)
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 50, lon: 8, tags: { shop: 'convenience', name: 'Laden' } },
      { type: 'node', id: 2, lat: 50, lon: 8, tags: { shop: 'bakery', name: 'Brot' } },
      { type: 'node', id: 3, lat: 50, lon: 8, tags: { shop: 'butcher', name: 'Fleisch' } },
      { type: 'node', id: 4, lat: 50, lon: 8, tags: { shop: 'bakery', disused: 'yes', name: 'Stillgelegt' } },
      { type: 'node', id: 5, lat: 50, lon: 8, tags: { shop: 'bakery', opening_hours: 'closed', name: 'Geschlossen' } },
      { type: 'node', id: 6, lat: 50, lon: 8, tags: { shop: 'butcher', 'abandoned:shop': 'butcher', name: 'Verlassen' } },
    ] })))
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
      for (const label of ['Supermärkte', 'Bäckereien', 'Metzgereien']) {
        await act(async () => kindInput(container, label).click())
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      await act(async () => button(container, 'Orte laden').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(mapElement.querySelector('[title="Supermarkt: Laden"] svg')).not.toBeNull()
      expect(mapElement.querySelector('[title="Bäckerei: Brot"] svg')).not.toBeNull()
      expect(mapElement.querySelector('[title="Metzgerei: Fleisch"] svg')).not.toBeNull()
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(3)
      await act(async () => kindInput(container, 'Metzgereien').click())
      expect(mapElement.querySelector('[title="Metzgerei: Fleisch"]')).toBeNull()
      expect(mapElement.querySelector('[title="Bäckerei: Brot"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('loads only on request, reuses the cache, and keeps status inside the panel', async () => {
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
      { type: 'node', id: 1, lat: 50, lon: 8, tags: { natural: 'spring', name: 'Quelle', access: 'customers' } },
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
      const placesButton = container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!
      expect(placesButton.classList.contains('active')).toBe(false)
      await act(async () => placesButton.click())
      expect(placesButton.classList.contains('active')).toBe(true)
      await act(async () => kindInput(container, 'Wasserquellen').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(fetch).not.toHaveBeenCalled()
      const loadButton = button(container, 'Orte laden')
      expect(loadButton.querySelector('svg')).not.toBeNull()
      expect(loadButton.textContent?.trim()).toBe('')
      expect(loadButton.title).toBe('Orte laden')
      expect(container.querySelector('.osm-places-panel-status')?.textContent).toContain('Neue Ortstypen mit dem Symbol laden.')
      await act(async () => button(container, 'Orte laden').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledOnce()
      expect(container.querySelector('[aria-label="Orte laden"]')).toBeNull()
      expect(fetch.mock.calls[0][1].body.toString()).toContain('natural')
      expect(container.textContent).toContain('Orte sind aktuell')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(1)
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Quelle')

      await act(async () => { map.fire('moveend'); await vi.advanceTimersByTimeAsync(700) })
      expect(fetch).toHaveBeenCalledOnce()
      expect(container.querySelector('[aria-label="Orte laden"]')).toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte schließen"]')!.click())
      expect(placesButton.classList.contains('active')).toBe(false)
      expect(container.querySelector('[role="status"]')).toBeNull()
      await act(async () => placesButton.click())
      expect(placesButton.classList.contains('active')).toBe(true)
      await act(async () => button(container, 'Bereich um Kartenmitte aktualisieren').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledTimes(2)
      await act(async () => button(container, 'Orte-Cache löschen').click())
      expect(clear).toHaveBeenCalledOnce()
      expect(stored.size).toBe(0)
      expect(container.textContent).toContain('Orte-Cache gelöscht')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      await act(async () => kindInput(container, 'Wasserquellen').click())
      expect(container.querySelector('[aria-label="Orte laden"]')).toBeNull()
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('hides deselected types immediately and loads newly selected types only on request', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 30_000)
    const stored = new Map<string, CachedPlaces>()
    vi.spyOn(placesCache, 'get').mockImplementation(async (keys) =>
      new Map(keys.flatMap((key) => stored.has(key) ? [[key, stored.get(key)!] as const] : [])))
    vi.spyOn(placesCache, 'put').mockImplementation(async (entries) => {
      for (const entry of entries) stored.set(entry.key, entry)
    })
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 50, lon: 8, tags: { natural: 'spring', name: 'Quelle' } },
      { type: 'node', id: 2, lat: 50, lon: 8, tags: { amenity: 'drinking_water', name: 'Brunnen' } },
    ] })))
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
      await selectAndLoad(container)
      const firstQuery = new URLSearchParams(fetch.mock.calls[0][1].body).get('data')
      expect(firstQuery).toContain('"natural"="spring"')
      expect(firstQuery).not.toContain('"amenity"="drinking_water"')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(1)
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Quelle')

      await act(async () => kindInput(container, 'Wasserquellen').click())
      await act(async () => kindInput(container, 'Trinkwasser').click())
      expect(fetch).toHaveBeenCalledOnce()
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      await act(async () => button(container, 'Orte laden').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      const secondQuery = new URLSearchParams(fetch.mock.calls[1][1].body).get('data')
      expect(secondQuery).toContain('"amenity"="drinking_water"')
      expect(secondQuery).not.toContain('"natural"="spring"')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(1)
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Brunnen')
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('automatically loads active types after moving to an uncached area', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 40_000)
    const stored = new Map<string, CachedPlaces>()
    vi.spyOn(placesCache, 'get').mockImplementation(async (keys) =>
      new Map(keys.flatMap((key) => stored.has(key) ? [[key, stored.get(key)!] as const] : [])))
    vi.spyOn(placesCache, 'put').mockImplementation(async (entries) => {
      for (const entry of entries) stored.set(entry.key, entry)
    })
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ elements: [] })))
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
      await selectAndLoad(container)
      expect(fetch).toHaveBeenCalledOnce()
      await act(async () => kindInput(container, 'Trinkwasser').click())
      await act(async () => { map.panBy([1000, 0], { animate: false }); await vi.advanceTimersByTimeAsync(1700) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledTimes(2)
      const query = new URLSearchParams(fetch.mock.calls[1][1].body).get('data')
      expect(query).toContain('"natural"="spring"')
      expect(query).not.toContain('drinking_water')
      expect(button(container, 'Orte laden')).not.toBeNull()
      await act(async () => { map.setView([50, 8], 15, { animate: false }); await vi.advanceTimersByTimeAsync(700) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('displays cached places throughout the visible area when zoomed out', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 50_000)
    vi.mocked(placesCache.getVisible).mockResolvedValue(new Map([['distant', {
      key: 'distant', downloadedAt: Date.now(),
      places: [{ type: 'node', id: 8, latitude: 50, longitude: 8.5, tags: { natural: 'spring', name: 'Ferne Quelle' } }],
    }]]))
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }))))
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
      await selectAndLoad(container)
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(0)
      await act(async () => { map.setZoom(7, { animate: false }); await vi.advanceTimersByTimeAsync(700) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Ferne Quelle')
      expect(container.querySelector('[aria-label="Orte laden"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('ignores a cache read that completes after the map has moved', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 55_000)
    let resolveOld: (value: Map<string, CachedPlaces>) => void = () => {}
    const newEntry: CachedPlaces = { key: 'new', downloadedAt: Date.now(),
      places: [{ type: 'node', id: 2, latitude: 50, longitude: 8.1, tags: { natural: 'spring', name: 'Neue Quelle' } }] }
    vi.mocked(placesCache.getVisible)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValue(new Map([['new', newEntry]]))
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }))))
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
      await selectAndLoad(container)
      await act(async () => { map.setView([50, 8.1], 15, { animate: false }); await vi.advanceTimersByTimeAsync(700) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Neue Quelle')
      await act(async () => resolveOld(new Map([['old', { ...newEntry, key: 'old',
        places: [{ ...newEntry.places[0], id: 1, tags: { natural: 'spring', name: 'Veraltete Quelle' } }] }]])))
      expect(mapElement.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toContain('Neue Quelle')
      expect(mapElement.querySelectorAll('.osm-place-marker')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('keeps the active request until an added type is applied', async () => {
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
      await selectAndLoad(container)
      expect(fetch).toHaveBeenCalledOnce()
      const signal: AbortSignal = fetch.mock.calls[0][1].signal
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Info: alle auswählen"]')!.click())
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Info: alle abwählen"]')!.click())
      expect(signal.aborted).toBe(false)
      await act(async () => kindInput(container, 'Trinkwasser').click())
      expect(signal.aborted).toBe(false)
      await act(async () => button(container, 'Orte laden').click())
      expect(signal.aborted).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('loads a bounded zoom-14 area even when the map is zoomed out', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 70_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] })))
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
      await act(async () => kindInput(container, 'Wasserquellen').click())
      expect(button(container, 'Orte laden').disabled).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
      await act(async () => button(container, 'Orte laden').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledOnce()
      const query = new URLSearchParams(fetch.mock.calls[0][1].body).get('data')!
      const bounds = /\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(query)!
      expect(Number(bounds[3]) - Number(bounds[1])).toBeLessThan(0.1)
      expect(Number(bounds[4]) - Number(bounds[2])).toBeLessThan(0.15)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })

  it('offers a retry after a load failure without requiring a new type selection', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 90_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ elements: [] })))
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
      await selectAndLoad(container)
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(container.textContent).toContain('Orte konnten nicht geladen werden')
      expect(container.querySelector('[aria-label="Orte laden"]')).toBeNull()
      await act(async () => button(container, 'Erneut versuchen').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(container.textContent).toContain('Orte sind aktuell')
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
      await selectAndLoad(container)
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
      await selectAndLoad(container)
      expect(fetch).toHaveBeenCalledOnce()
      const signal: AbortSignal = fetch.mock.calls[0][1].signal
      await act(async () => {
        if (trigger === 'map-movement') map.fire('movestart')
        if (trigger === 'manual-refresh') {
          kindInput(container, 'Trinkwasser').click()
        }
        if (trigger === 'cache-clear') Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Orte-Cache löschen')!.click()
      })
      if (trigger === 'manual-refresh') await act(async () => button(container, 'Orte laden').click())
      expect(signal.aborted).toBe(true)
      expect(signal.reason.message).toBe(trigger)
      expect(container.textContent).toContain(label)

      const write = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close: async () => {} }) }))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Overpass-Diagnose"] button')!.click())
      const log: unknown = JSON.parse(write.mock.calls[0][0])
      expect(log).toMatchObject({ format: 'mapvento-overpass-diagnostics', version: 4, environment: 'browser',
        events: expect.arrayContaining([expect.objectContaining({ abortReason: trigger, outcome: 'aborted', kindCount: 1 })]) })
      expect(JSON.stringify(log)).not.toContain('categoryCount')
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
      await act(async () => kindInput(container, 'Wasserquellen').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      await act(async () => button(container, 'Orte laden').click())
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

  it('opens complete read-only place details and loads only safe image previews on request', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2_000_000)
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    const longValue = 'Langbeschreibung '.repeat(80)
    const clearRouteNodeFocus = vi.fn()
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [{
      type: 'node', id: 268390610, lat: 50, lon: 8, tags: {
        natural: 'spring',
        description: longValue,
        empty: '',
        website: 'https://example.org/place',
        image: 'File:https://upload.wikimedia.org/wikipedia/commons/d/dc/Hasemann-H%C3%BCtte.jpg',
        'image:1': 'https://images.example.org/place.svg',
        wikimedia_commons: 'File:Hasemann-Hütte.jpg',
        unsafe: 'javascript:alert(1)',
      },
    }] })))
    vi.stubGlobal('fetch', fetch)
    const mapElement = document.createElement('div')
    Object.defineProperties(mapElement, { clientWidth: { value: 700 }, clientHeight: { value: 500 } })
    document.body.append(mapElement)
    const map = L.map(mapElement).setView([50, 8], 15)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Harness map={map} onPlaceSelected={clearRouteNodeFocus} />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!.click())
      await selectAndLoad(container)
      const marker = mapElement.querySelector<HTMLElement>('.leaflet-marker-icon')
      expect(marker).not.toBeNull()
      vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 700, 500))
      vi.spyOn(marker!, 'getBoundingClientRect').mockReturnValue(new DOMRect(180, 130, 40, 40))
      await act(async () => marker!.click())
      expect(clearRouteNodeFocus).toHaveBeenCalledOnce()

      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog?.getAttribute('aria-modal')).toBe('true')
      expect(dialog?.textContent).toContain('OSM-Ort')
      expect(dialog?.textContent).toContain('node 268390610')
      expect(dialog?.textContent).toContain('Kein Wert angegeben')
      expect(dialog?.textContent).toContain(longValue)
      expect(dialog?.querySelectorAll('tbody tr')).toHaveLength(8)
      expect(dialog?.style.left).toBe('214px')
      expect(dialog?.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
      expect(marker?.classList.contains('osm-place-marker-selected')).toBe(true)
      expect(marker?.getAttribute('aria-pressed')).toBe('true')

      const website = Array.from(dialog?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
        .find((link) => link.href === 'https://example.org/place')
      expect(website?.target).toBe('_blank')
      expect(website?.rel).toContain('noopener')
      expect(Array.from(dialog?.querySelectorAll('a') ?? []).some((link) =>
        link.textContent?.includes('javascript:alert'))).toBe(false)
      expect(dialog?.querySelector('img')).toBeNull()
      expect(Array.from(dialog?.querySelectorAll('button') ?? []).some((button) =>
        button.textContent === 'Bildvorschau laden')).toBe(true)
      const wikimediaLink = Array.from(dialog?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
        .find((link) => link.textContent?.startsWith('File:https://upload.wikimedia.org'))
      expect(wikimediaLink?.href)
        .toBe('https://upload.wikimedia.org/wikipedia/commons/d/dc/Hasemann-H%C3%BCtte.jpg')
      const commonsLink = Array.from(dialog?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
        .find((link) => link.textContent === 'File:Hasemann-Hütte.jpg')
      expect(commonsLink?.href).toBe('https://commons.wikimedia.org/wiki/File:Hasemann-H%C3%BCtte.jpg')

      const imageRow = Array.from(dialog?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? [])
        .find((row) => row.querySelector('th')?.textContent === 'image')
      await act(async () => button(imageRow!, 'Bildvorschau laden').click())
      const preview = dialog?.querySelector<HTMLImageElement>('img')
      expect(preview?.getAttribute('src'))
        .toBe('https://upload.wikimedia.org/wikipedia/commons/d/dc/Hasemann-H%C3%BCtte.jpg')
      expect(preview?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
      await act(async () => preview?.dispatchEvent(new Event('error')))
      expect(dialog?.textContent).toContain('Bildvorschau konnte nicht geladen werden.')
      await act(async () => dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(marker?.classList.contains('osm-place-marker-selected')).toBe(false)
      expect(marker?.getAttribute('aria-pressed')).toBe('false')
      await act(async () => vi.advanceTimersByTime(0))
      expect(document.activeElement).toBe(marker)
    } finally {
      await act(async () => root.unmount())
      map.remove()
      mapElement.remove()
      container.remove()
    }
  })
})
