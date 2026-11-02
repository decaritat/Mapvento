import { act } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { initialProject } from '../src/project'

function button(container: ParentNode, label: string) {
  const result = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!result) throw new Error(`Button not found: ${label}`)
  return result
}

describe('application interactions', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates and removes a route node and creates an editable POI through the map', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value
      expect(map).toBeDefined()
      await act(async () => map.fire('click', {
        latlng: L.latLng(52, 13),
        originalEvent: new MouseEvent('click', { clientX: 100, clientY: 100 }),
      }))
      expect(container.querySelectorAll('.route-node')).toHaveLength(1)
      const node = container.querySelector<HTMLElement>('.route-node')!
      await act(async () => node.click())
      expect(node.classList.contains('selected') || container.querySelector('.route-node.selected')).toBeTruthy()
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })))
      expect(container.querySelectorAll('.route-node')).toHaveLength(0)

      await act(async () => button(container, 'Punkt oder POI setzen').click())
      await act(async () => map.fire('click', {
        latlng: L.latLng(52, 181),
        originalEvent: new MouseEvent('click', { clientX: 200, clientY: 200 }),
      }))
      expect(document.querySelector('[aria-label="Neuen POI anlegen"]')).not.toBeNull()
      await act(async () => button(document, 'POI-Eigenschaften übernehmen').click())
      expect(container.querySelectorAll('.point-marker')).toHaveLength(1)
      expect(container.textContent).toContain('POI angelegt.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('inserts and drags route nodes while preserving the map editing workflow', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const saved = {
      ...initialProject,
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]],
        routingState: 'ready',
      }],
    }
    localStorage.setItem('trailforge-project', JSON.stringify(saved))
    const mapSpy = vi.spyOn(L, 'map')
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({
      createWritable: async () => ({ write, close: async () => {} }),
    }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      expect(line).toBeDefined()
      await act(async () => line!.fire('click', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('click'),
      }))
      expect(container.querySelectorAll('.route-node')).toHaveLength(3)

      let marker: L.Marker | undefined
      map.eachLayer((layer) => {
        if (layer instanceof L.Marker && layer.options.draggable && layer.getLatLng().lng === 13.5) {
          marker = layer
        }
      })
      expect(marker).toBeDefined()
      await act(async () => {
        marker!.setLatLng([52.6, 13.6])
        marker!.fire('dragend')
      })
      const save = Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.trim() === 'Projekt speichern')!
      await act(async () => save.click())
      const project = JSON.parse(write.mock.calls[0][0])
      const coordinates = project.routes[0].nodes.map((node: { coordinate: number[] }) => node.coordinate)
      expect(coordinates[0]).toEqual([13, 52])
      expect(coordinates[1][0]).toBeCloseTo(13.6)
      expect(coordinates[1][1]).toBeCloseTo(52.6)
      expect(coordinates[2]).toEqual([14, 53])
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('restores map dragging when a line drag is interrupted by opening the editor', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.setItem('trailforge-project', JSON.stringify({
      ...initialProject,
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]],
        routingState: 'ready',
      }],
    }))
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      expect(map.dragging.enabled()).toBe(true)
      await act(async () => line!.fire('mousedown', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('mousedown', { clientX: 100, clientY: 100 }),
      }))
      expect(map.dragging.enabled()).toBe(false)
      await act(async () => button(container, `Aktionen für ${initialProject.routes[0].name}`).click())
      const properties = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Eigenschaften'))!
      await act(async () => properties.click())
      expect(map.dragging.enabled()).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('imports a GPX route and waypoints as read-only through the route dialog', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Neue Route erstellen oder GPX importieren').click())
      const radio = document.querySelector<HTMLInputElement>('input[name="route-creation-mode"][value="gpx"]')!
      await act(async () => radio.click())
      const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('.route-creation-dialog button'))
        .find((item) => item.textContent?.includes('Weiter'))!
      await act(async () => confirm.click())
      const input = container.querySelector<HTMLInputElement>('input[accept=".gpx,application/gpx+xml"]')!
      const xml = '<gpx><wpt lat="52" lon="13"><name>Gipfel</name></wpt><trk><name>Testtour</name><trkseg><trkpt lat="52" lon="13"/></trkseg></trk></gpx>'
      Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => xml }] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.textContent).toContain('Testtour')
      expect(container.textContent).toContain('GPX schreibgeschützt importiert.')
      expect(container.textContent).toContain('READ-ONLY')
      expect(container.querySelectorAll('.point-marker')).toHaveLength(1)
      await act(async () => button(container, 'Aktionen für Testtour').click())
      expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('GPX exportieren')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('exports the editable route and saves the project through the file picker', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close }) })
    vi.stubGlobal('showSaveFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, `Aktionen für ${initialProject.routes[0].name}`).click())
      const exportButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('GPX exportieren'))!
      await act(async () => exportButton.click())
      expect(write.mock.calls[0][0]).toContain('<gpx')
      expect(write.mock.calls[0][0]).toContain(initialProject.routes[0].name)
      const saveButton = Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.trim() === 'Projekt speichern')!
      await act(async () => saveButton.click())
      expect(JSON.parse(write.mock.calls[1][0])).toEqual(initialProject)
      expect(picker).toHaveBeenCalledTimes(2)
      expect(close).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('restores a map layer, switches it, and removes the map on unmount', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const tiles = vi.spyOn(L, 'tileLayer')
    const removeMap = vi.spyOn(L.Map.prototype, 'remove')
    localStorage.setItem('trailforge-project', JSON.stringify({ ...initialProject, mapLayerId: 'opentopomap' }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      expect(tiles.mock.calls[0][0]).toContain('opentopomap.org')
      const dropdown = container.querySelector<HTMLButtonElement>('.dropdown-trigger')!
      await act(async () => dropdown.click())
      const osm = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((item) => item.textContent?.includes('OpenStreetMap Carto'))!
      await act(async () => osm.click())
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('tile.openstreetmap.org')
      expect(dropdown.textContent).toContain('OpenStreetMap Carto')
      const currentTiles = tiles.mock.results.at(-1)!.value
      await act(async () => currentTiles.fire('tileerror'))
      expect(container.textContent).toContain('Kartenlayer nicht erreichbar')
      const retry = container.querySelector<HTMLButtonElement>('.status-banner-action')!
      await act(async () => retry.click())
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
      expect(tiles).toHaveBeenCalledTimes(3)
      await act(async () => currentTiles.fire('tileerror'))
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
    } finally {
      await act(async () => root.unmount())
      expect(removeMap).toHaveBeenCalledOnce()
      container.remove()
    }
  })

  it('searches for a place and removes its map marker when the search closes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ place_id: 1, display_name: 'Berlin', lat: '52.52', lon: '13.405' }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Orte suchen').click())
      const input = container.querySelector<HTMLInputElement>('[aria-label="Suchbegriff"]')!
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => {
        setValue.call(input, 'Berlin')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const form = container.querySelector<HTMLFormElement>('.map-search-form')!
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(fetchMock).toHaveBeenCalledOnce()
      const result = container.querySelector<HTMLButtonElement>('.map-search-results button')!
      expect(result.textContent).toBe('Berlin')
      await act(async () => result.click())
      expect(container.querySelector('.search-result-pin')).not.toBeNull()
      await act(async () => button(container, 'Suche schließen').click())
      expect(container.querySelector('.search-result-pin')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('updates and clears the expanded elevation profile at chart edges', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const route = {
      ...initialProject.routes[0],
      editable: false,
      nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
      geometry: [[13, 52], [14, 53]],
      elevations: [100, 200],
      routingState: 'ready',
    }
    localStorage.setItem('trailforge-project', JSON.stringify({ ...initialProject, routes: [route] }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen').click())
      const chart = container.querySelector<SVGElement>('.elevation-chart')!
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 190,
        width: 560, height: 190, toJSON: () => ({}),
      })
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 42 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('100 m Höhe')
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 550 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('200 m Höhe')
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 551 })))
      expect(container.querySelector('.profile-selection')).toBeNull()
      await act(async () => button(container, 'Höhenprofil schließen').click())
      expect(container.querySelector('.elevation-chart')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
