import { act } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'
import { initialProject } from '../src/domain/project'
import { tileCache } from '../src/integrations/map/tileCache'
import { placesCache } from '../src/features/osm-places/placesCache'
import { importStoredProject } from './projectTestHelpers'

function button(container: ParentNode, label: string) {
  const result = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!result) throw new Error(`Button not found: ${label}`)
  return result
}

async function headerAction(container: HTMLElement, label: string) {
  await act(async () => button(container, 'Hauptmenü').click())
  const action = Array.from(container.querySelectorAll<HTMLButtonElement>('.header-menu button'))
    .find((item) => item.textContent?.trim() === label)
  if (!action) throw new Error(`Menu action not found: ${label}`)
  await act(async () => action.click())
}

async function changeText(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('application interactions', () => {
  afterEach(() => {
    vi.useRealTimers()
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

  it('prepares an OSM POI draft without saving until the user accepts it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.spyOn(placesCache, 'getVisible').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'get').mockResolvedValue(new Map())
    vi.spyOn(placesCache, 'put').mockResolvedValue()
    let placePosition = { latitude: 51.1657, longitude: 10.4515 }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ elements: [
      { type: 'node', id: 501, lat: placePosition.latitude, lon: placePosition.longitude, tags: {
        amenity: 'restaurant', name: 'Waldschänke', description: 'Kleine Gaststätte', cuisine: 'regional',
      } },
    ] }))))
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value
      Object.defineProperties(map.getContainer(), {
        clientWidth: { configurable: true, value: 700 },
        clientHeight: { configurable: true, value: 500 },
      })
      await act(async () => map.invalidateSize({ pan: false }))
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      const center = map.getCenter()
      placePosition = { latitude: center.lat, longitude: center.lng }
      await act(async () => button(container, 'OSM-Orte und Filter').click())
      const restaurantOption = Array.from(container.querySelectorAll<HTMLLabelElement>('.osm-places-option'))
        .find((item) => item.textContent?.trim() === 'Restaurants')!.querySelector('input')!
      await act(async () => restaurantOption.click())
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      await act(async () => button(container, 'Orte laden').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })

      let marker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.getElement()?.classList.contains('osm-place-marker-wrapper')) marker = layer
      })
      expect(marker).toBeDefined()
      await act(async () => marker!.fire('click', { originalEvent: new MouseEvent('click') }))
      const createButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent?.trim() === 'Einen POI erstellen')!
      await act(async () => createButton.click())

      const editor = document.querySelector<HTMLElement>('[aria-label="Neuen POI anlegen"]')!
      expect(editor.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')?.value).toBe('Waldschänke')
      expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="POI-Beschreibung"]')?.value).toBe('Kleine Gaststätte')
      expect(editor.querySelector('.poi-icon-picker-current')?.textContent).toContain('Restaurant')
      expect(editor.querySelector('[aria-label="POI-Breitengrad"]')).toBeNull()
      expect(editor.querySelector('[aria-label="POI-Längengrad"]')).toBeNull()
      expect(editor.textContent).not.toContain('OpenStreetMap')
      expect(container.querySelectorAll('.point-marker')).toHaveLength(0)

      await changeText(editor.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!, 'Entwurf behalten')
      await act(async () => marker!.fire('click', { originalEvent: new MouseEvent('click') }))
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const replaceButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent?.trim() === 'Einen POI erstellen')!
      await act(async () => replaceButton.click())
      expect(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')?.value).toBe('Entwurf behalten')
      await act(async () => button(document, 'Ortsdetails schließen').click())
      await act(async () => button(document, 'POI-Eigenschaften verwerfen und schließen').click())
      expect(container.querySelectorAll('.point-marker')).toHaveLength(0)

      let currentMarker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.getElement()?.classList.contains('osm-place-marker-wrapper')) currentMarker = layer
      })
      await act(async () => currentMarker!.fire('click', { originalEvent: new MouseEvent('click') }))
      const secondCreateButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent?.trim() === 'Einen POI erstellen')!
      await act(async () => secondCreateButton.click())
      await changeText(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!, 'Rastplatz')
      await act(async () => button(document, 'POI-Eigenschaften übernehmen').click())
      expect(container.querySelectorAll('.point-marker')).toHaveLength(1)
      expect(container.querySelector('.point-marker-label')?.textContent).toBe('Rastplatz')
      let savedMarker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.getElement()?.classList.contains('point-marker-wrapper')) savedMarker = layer
      })
      expect(savedMarker?.getLatLng().lat).toBe(placePosition.latitude)
      expect(savedMarker?.getLatLng().lng).toBe(placePosition.longitude)
      await act(async () => savedMarker!.fire('click', { originalEvent: new MouseEvent('click') }))
      expect(document.querySelector('[aria-label="POI Rastplatz bearbeiten"]')).not.toBeNull()
      const savedEditor = document.querySelector<HTMLElement>('[aria-label="POI Rastplatz bearbeiten"]')!
      expect(savedEditor.querySelector('[aria-label="POI-Breitengrad"]')).toBeNull()
      expect(savedEditor.querySelector('[aria-label="POI-Längengrad"]')).toBeNull()
      expect(savedEditor.textContent).not.toContain('OpenStreetMap')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('distinguishes route start, end, and intermediate nodes and exposes keyboard focus', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value
      const addNode = async (longitude: number) => {
        await act(async () => map.fire('click', {
          latlng: L.latLng(52, longitude),
          originalEvent: new MouseEvent('click', { clientX: 100, clientY: 100 }),
        }))
      }

      await addNode(13)
      expect(container.querySelector('.route-node.start')).not.toBeNull()
      expect(container.querySelector('.route-node.end')).toBeNull()

      await addNode(14)
      expect(container.querySelector('.route-node.start')).not.toBeNull()
      expect(container.querySelector('.route-node.end')).not.toBeNull()
      expect(container.querySelector('.route-node.waypoint')).toBeNull()

      await addNode(15)
      const nodes = container.querySelectorAll<HTMLElement>('.route-node')
      expect(nodes).toHaveLength(3)
      expect(container.querySelector('.route-node-number')?.textContent).toBe('1')
      const marker = container.querySelector<HTMLElement>('.route-node.end')!
      const markerElement = marker.closest<HTMLElement>('.leaflet-marker-icon')!
      await act(async () => markerElement.focus())
      expect(container.querySelector('.route-node.end.selected')).not.toBeNull()
      expect(markerElement.getAttribute('tabindex')).toBe('0')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('selects a route point on the first mouse click and shows it in the elevation profile', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    localStorage.setItem('mapvento-project', JSON.stringify({
      ...initialProject,
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]],
        elevations: [100, 200],
        routingState: 'ready',
      }],
    }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await importStoredProject(container)
      await act(async () => button(container, 'Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen').click())
      const marker = () => container.querySelector<HTMLElement>('.route-node.end')!.closest<HTMLElement>('.leaflet-marker-icon')!
      const clickMarker = async () => {
        const element = marker()
        await act(async () => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
        await act(async () => element.focus())
        await act(async () => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })))
        await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
      }

      await clickMarker()
      expect(container.querySelector('.route-node.end.selected')).not.toBeNull()
      expect(container.querySelector('.profile-chart-area.has-selection')).not.toBeNull()
      expect(container.querySelector('.profile-chart-area line[stroke="#ffb86c"]')).not.toBeNull()
      await act(async () => button(container, 'Höhenprofil schließen').focus())
      expect(container.querySelector('.route-node.end.selected')).not.toBeNull()
      expect(container.querySelector('.profile-chart-area.has-selection')).not.toBeNull()

      await clickMarker()
      expect(container.querySelector('.route-node.selected')).toBeNull()
      expect(container.querySelector('.profile-chart-area.has-selection')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('shows a non-interactive insertion cursor while hovering an editable route line', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    localStorage.setItem('mapvento-project', JSON.stringify({
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      expect(line).toBeDefined()

      const getInsertionCursor = () => {
        let cursor: L.CircleMarker | undefined
        map.eachLayer((layer: L.Layer) => {
          if (layer instanceof L.CircleMarker && layer.options.className === 'route-insertion-cursor') {
            cursor = layer
          }
        })
        return cursor
      }
      await act(async () => line!.fire('mousemove', { latlng: L.latLng(52.4, 13.4) }))
      const cursor = getInsertionCursor()
      expect(cursor).toBeDefined()
      expect(cursor!.options.interactive).toBe(false)
      expect(cursor!.options.radius).toBe(3)
      expect(cursor!.getLatLng().equals(L.latLng(52.4, 13.4))).toBe(true)

      await act(async () => line!.fire('mousemove', { latlng: L.latLng(52.6, 13.6) }))
      expect(cursor!.getLatLng().equals(L.latLng(52.6, 13.6))).toBe(true)
      await act(async () => line!.fire('mouseout'))
      expect(map.hasLayer(cursor!)).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('clears route-node focus when the map moves, a node is added, Escape is pressed, a tool changes, or the node is clicked again', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    localStorage.setItem('mapvento-project', JSON.stringify({
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      const focusEndNode = async () => {
        const node = container.querySelector<HTMLElement>('.route-node.end')!
        const marker = node.closest<HTMLElement>('.leaflet-marker-icon')!
        await act(async () => marker.focus())
        expect(container.querySelector('.route-node.end.selected')).not.toBeNull()
        return marker
      }

      await focusEndNode()
      await act(async () => map.fire('dragstart'))
      expect(container.querySelector('.route-node.selected')).toBeNull()
      expect(document.activeElement?.closest('.route-node-wrapper')).toBeNull()

      await focusEndNode()
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(container.querySelector('.route-node.selected')).toBeNull()

      await focusEndNode()
      const selectedMarker = container.querySelector<HTMLElement>('.route-node.end')!.closest<HTMLElement>('.leaflet-marker-icon')!
      let leafletMarker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.getElement() === selectedMarker) leafletMarker = layer
      })
      expect(leafletMarker).toBeDefined()
      await act(async () => leafletMarker!.fire('click', { originalEvent: new MouseEvent('click') }))
      expect(container.querySelector('.route-node.selected')).toBeNull()

      await focusEndNode()
      await act(async () => map.fire('click', {
        latlng: L.latLng(52.5, 14.5),
        originalEvent: new MouseEvent('click', { clientX: 100, clientY: 100 }),
      }))
      expect(container.querySelector('.route-node.selected')).toBeNull()

      await focusEndNode()
      await act(async () => button(container, 'Karte verschieben, schreibgeschützt').click())
      expect(container.querySelector('.route-node.selected')).toBeNull()
      expect(document.activeElement?.closest('.route-node-wrapper')).toBeNull()
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
    localStorage.setItem('mapvento-project', JSON.stringify(saved))
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      expect(line).toBeDefined()
      await act(async () => line!.fire('click', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('click'),
      }))
      expect(container.querySelectorAll('.route-node')).toHaveLength(3)

      let marker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.options.draggable && layer.getLatLng().lng === 13.5) {
          marker = layer
        }
      })
      expect(marker).toBeDefined()
      await act(async () => {
        marker!.setLatLng([52.6, 13.6])
        marker!.fire('dragend')
      })
      await headerAction(container, 'Projekt speichern')
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

  it('cancels a waypoint drag with Escape without changing the saved route', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('scrollTo', vi.fn())
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    localStorage.setItem('mapvento-project', JSON.stringify({
      ...initialProject,
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]], routingState: 'ready',
      }],
    }))
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let marker: L.Marker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker && layer.options.draggable && layer.getLatLng().lng === 13) marker = layer
      })
      const element = marker!.getElement()!
      const downBeforeMovement = new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: 100, clientY: 100 })
      Object.defineProperty(downBeforeMovement, 'which', { value: 1 })
      await act(async () => {
        element.dispatchEvent(downBeforeMovement)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 140, clientY: 140 }))
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 140, clientY: 140 }))
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 140, clientY: 140 }))
      })
      expect(marker!.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      expect(container.querySelector('.route-node.selected')).toBeNull()
      await act(async () => {
        const down = new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: 100, clientY: 100 })
        Object.defineProperty(down, 'which', { value: 1 })
        element.dispatchEvent(down)
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 140, clientY: 140 }))
      })
      expect(marker!.getLatLng().equals(L.latLng(52, 13))).toBe(false)
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(marker!.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      expect(marker!.dragging?.enabled()).toBe(true)
      await act(async () => {
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 160, clientY: 160 }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 160, clientY: 160 }))
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 160, clientY: 160 }))
      })
      expect(marker!.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      await headerAction(container, 'Projekt speichern')
      const project = JSON.parse(write.mock.calls[0][0])
      expect(project.routes[0].nodes.map((node: { coordinate: number[] }) => node.coordinate)).toEqual([[13, 52], [14, 53]])
      expect(project.routes[0].geometry).toEqual([[13, 52], [14, 53]])
      const down = new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: 100, clientY: 100 })
      Object.defineProperty(down, 'which', { value: 1 })
      await act(async () => {
        element.dispatchEvent(down)
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 150, clientY: 150 }))
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 150, clientY: 150 }))
      })
      await headerAction(container, 'Projekt speichern')
      expect(JSON.parse(write.mock.calls[1][0]).routes[0].nodes[0].coordinate).not.toEqual([13, 52])
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('cancels a route-line drag with Escape and suppresses its release click', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    localStorage.setItem('mapvento-project', JSON.stringify({
      ...initialProject,
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]], routingState: 'ready',
      }],
    }))
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      for (const moved of [false, true]) {
        await act(async () => {
          line!.fire('mousedown', {
            latlng: L.latLng(52.5, 13.5),
            originalEvent: new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100 }),
          })
          if (moved) document.dispatchEvent(new MouseEvent('mousemove', { clientX: 130, clientY: 130 }))
        })
        expect(map.dragging.enabled()).toBe(false)
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
        expect(map.dragging.enabled()).toBe(true)
        const guides: L.Polyline[] = []
        map.eachLayer((layer: L.Layer) => {
          if (layer instanceof L.Polyline && layer.options.dashArray === '4 6') guides.push(layer)
        })
        expect(guides).toHaveLength(0)
        await act(async () => {
          document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 150 }))
          document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 150 }))
          line!.fire('click', { latlng: L.latLng(52.5, 13.5), originalEvent: new MouseEvent('click') })
        })
        expect(container.querySelectorAll('.route-node')).toHaveLength(2)
      }
      await act(async () => line!.fire('click', { latlng: L.latLng(52.5, 13.5), originalEvent: new MouseEvent('click') }))
      expect(container.querySelectorAll('.route-node')).toHaveLength(3)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps the original routed segment throughout a drag and suppresses the release click', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    localStorage.setItem('mapvento-project', JSON.stringify({
      ...initialProject,
      mapOverlayIds: ['waymarked-hiking'],
      routes: [{
        ...initialProject.routes[0],
        nodes: [
          { id: 'one', coordinate: [0, 0] },
          { id: 'two', coordinate: [1, 0] },
          { id: 'three', coordinate: [2, 0] },
          { id: 'four', coordinate: [3, 0] },
        ],
        geometry: [[0, 0], [2.5, 2], [1, 0], [2, 0], [3, 0]],
        routingState: 'ready',
      }],
    }))
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0,
        toJSON: () => ({}),
      })
      vi.spyOn(map, 'containerPointToLatLng').mockImplementation((point: L.Point) =>
        L.latLng(0, point.x / 100),
      )
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      await act(async () => line!.fire('mousedown', {
        latlng: L.latLng(1, 1.25),
        originalEvent: new MouseEvent('mousedown', { clientX: 125, clientY: 100 }),
      }))
      expect(map.dragging.enabled()).toBe(false)
      const image = document.createElement('img')
      map.getPane('routeOverlays')!.append(image)
      const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
      image.dispatchEvent(dragStart)
      expect(dragStart.defaultPrevented).toBe(true)

      await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 280, clientY: 100 })))
      const guides: L.Polyline[] = []
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.dashArray === '4 6') guides.push(layer)
      })
      expect(guides).toHaveLength(2)
      expect(guides.map((guide) => (guide.getLatLngs() as L.LatLng[])[1].lng)).toEqual([0, 1])

      await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { clientX: 280, clientY: 100 })))
      expect(map.dragging.enabled()).toBe(true)
      const afterDrag = new Event('dragstart', { bubbles: true, cancelable: true })
      image.dispatchEvent(afterDrag)
      expect(afterDrag.defaultPrevented).toBe(false)
      await act(async () => map.fire('click', {
        latlng: L.latLng(0, 2.8),
        originalEvent: new MouseEvent('click'),
      }))
      expect(container.querySelectorAll('.route-node')).toHaveLength(5)
      await headerAction(container, 'Projekt speichern')
      const project = JSON.parse(write.mock.calls[0][0])
      const coordinates = project.routes[0].nodes.map((node: { coordinate: number[] }) => node.coordinate)
      expect(coordinates[1][0]).toBeCloseTo(2.8)
      expect(coordinates[1][1]).toBe(0)
      expect([coordinates[0], ...coordinates.slice(2)]).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
      await act(async () => {
        map.getContainer().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        map.fire('click', {
          latlng: L.latLng(0, 4),
          originalEvent: new MouseEvent('click'),
        })
      })
      expect(container.querySelectorAll('.route-node')).toHaveLength(6)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('handles a route-line DOM click once without also appending a map waypoint', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    localStorage.setItem('mapvento-project', JSON.stringify({
      ...initialProject,
      mapOverlayIds: ['waymarked-hiking'],
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      const path = line!.getElement()
      expect(path).toBeDefined()
      await act(async () => {
        path!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        path!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
        path!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      })
      expect(container.querySelectorAll('.route-node')).toHaveLength(3)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('restores map dragging when a line drag is interrupted by opening the editor', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.setItem('mapvento-project', JSON.stringify({
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      expect(map.dragging.enabled()).toBe(true)
      await act(async () => line!.fire('mousedown', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('mousedown', { clientX: 100, clientY: 100 }),
      }))
      expect(map.dragging.enabled()).toBe(false)
      const image = document.createElement('img')
      map.getPane('routeOverlays')!.append(image)
      await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 120 })))
      const duringDrag = new Event('dragstart', { bubbles: true, cancelable: true })
      image.dispatchEvent(duringDrag)
      expect(duringDrag.defaultPrevented).toBe(true)
      await act(async () => button(container, `Aktionen für ${initialProject.routes[0].name}`).click())
      const properties = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Eigenschaften'))!
      await act(async () => properties.click())
      expect(map.dragging.enabled()).toBe(true)
      const afterCancel = new Event('dragstart', { bubbles: true, cancelable: true })
      image.dispatchEvent(afterCancel)
      expect(afterCancel.defaultPrevented).toBe(false)
      await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 120 })))
      expect(container.querySelectorAll('.route-node')).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('cancels a line drag on window blur and cleans up an active drag on unmount', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.setItem('mapvento-project', JSON.stringify({
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
    let unmounted = false
    try {
      await act(async () => root.render(<App />))
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      const startDrag = () => line!.fire('mousedown', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('mousedown', { clientX: 100, clientY: 100 }),
      })
      await act(async () => {
        startDrag()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 120 }))
        window.dispatchEvent(new Event('blur'))
      })
      expect(map.dragging.enabled()).toBe(true)
      await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 120 })))
      expect(container.querySelectorAll('.route-node')).toHaveLength(2)
      await act(async () => {
        startDrag()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 120 }))
        root.unmount()
      })
      unmounted = true
      expect(map.dragging.enabled()).toBe(false)
      const dragStart = new Event('dragstart', { cancelable: true })
      window.dispatchEvent(dragStart)
      expect(dragStart.defaultPrevented).toBe(false)
    } finally {
      if (!unmounted) await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not insert a waypoint when a drag ends outside the map', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.setItem('mapvento-project', JSON.stringify({
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
      await importStoredProject(container)
      const map = mapSpy.mock.results[0].value
      vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0,
        toJSON: () => ({}),
      })
      let line: L.Polyline | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Polyline && layer.options.interactive) line = layer
      })
      await act(async () => line!.fire('mousedown', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100 }),
      }))
      expect(map.dragging.enabled()).toBe(true)
      await act(async () => {
        line!.fire('mousedown', {
          latlng: L.latLng(52.5, 13.5),
          originalEvent: new MouseEvent('mousedown', { clientX: 100, clientY: 100 }),
        })
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 210, clientY: 100 }))
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 210, clientY: 100 }))
      })
      expect(map.dragging.enabled()).toBe(true)
      expect(container.querySelectorAll('.route-node')).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('imports a GPX route and waypoints as read-only through the route dialog', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mapSpy = vi.spyOn(L, 'map')
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
      const xml = '<gpx><wpt lat="52" lon="13"><name>Gipfel</name></wpt><trk><name>Testtour</name><trkseg><trkpt lat="52" lon="13"/><trkpt lat="53" lon="14"/></trkseg></trk></gpx>'
      Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => xml }] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.textContent).toContain('Testtour')
      expect(container.textContent).toContain('GPX schreibgeschützt importiert.')
      expect(container.textContent).toContain('READ-ONLY')
      expect(container.querySelectorAll('.point-marker')).toHaveLength(1)
      expect(container.querySelectorAll('.route-node')).toHaveLength(0)
      await act(async () => mapSpy.mock.results[0].value.fire('click', {
        latlng: L.latLng(52.5, 13.5),
        originalEvent: new MouseEvent('click'),
      }))
      expect(container.textContent).toContain('Diese Route ist schreibgeschützt.')
      expect(container.querySelectorAll('.route-node')).toHaveLength(0)
      await act(async () => button(container, 'Aktionen für Testtour').click())
      expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('GPX exportieren')
      const properties = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
      await act(async () => properties.click())
      expect(document.querySelector<HTMLInputElement>('[aria-label="Routenname"]')?.disabled).toBe(true)
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Routenbeschreibung"]')?.disabled).toBe(true)
      const readOnlyRoute = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(document.activeElement).toBe(readOnlyRoute)
      await act(async () => readOnlyRoute.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
      expect(document.activeElement).toBe(button(document, 'Routeneigenschaften verwerfen und schließen'))
      await act(async () => button(document, 'Routeneigenschaften verwerfen und schließen').click())
      await act(async () => container.querySelector<HTMLElement>('.point-marker')!.click())
      expect(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')?.disabled).toBe(true)
      expect(document.activeElement).toBe(button(document, 'POI-Ansicht schließen'))
      expect(document.querySelector('[aria-label="POI löschen"]')).toBeNull()
      expect(document.querySelector('[aria-label="POI-Eigenschaften übernehmen"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves route and POI edits and discards cancelled drafts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
      const openProperties = async (name: string) => {
        await act(async () => button(container, `Aktionen für ${name}`).click())
        await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
      }

      await openProperties(initialProject.routes[0].name)
      const routeName = document.querySelector<HTMLInputElement>('[aria-label="Routenname"]')!
      expect(document.activeElement).toBe(routeName)
      await act(async () => routeName.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
      expect(document.activeElement).toBe(button(document, 'Routeneigenschaften verwerfen und schließen'))
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
      expect(document.activeElement).toBe(routeName)
      await changeText(routeName, 'Neue Tour')
      await changeText(document.querySelector<HTMLTextAreaElement>('[aria-label="Routenbeschreibung"]')!, 'Am See')
      await act(async () => button(document, 'Routeneigenschaften übernehmen').click())
      expect(container.textContent).toContain('Neue Tour')
      await openProperties('Neue Tour')
      await changeText(document.querySelector<HTMLInputElement>('[aria-label="Routenname"]')!, 'Verworfene Tour')
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('[aria-label="Routenname"]')).toBeNull()
      expect(container.textContent).toContain('Neue Tour')
      expect(container.textContent).not.toContain('Verworfene Tour')

      await act(async () => button(container, 'Punkt oder POI setzen').click())
      await act(async () => mapSpy.mock.results[0].value.fire('click', {
        latlng: L.latLng(52, 13),
        originalEvent: new MouseEvent('click', { clientX: 100, clientY: 100 }),
      }))
      await changeText(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!, 'Hütte')
      await act(async () => button(document, 'POI-Eigenschaften übernehmen').click())
      expect(container.querySelector('.point-marker-label')?.textContent).toBe('Hütte')
      await act(async () => container.querySelector<HTMLElement>('.point-marker')!.click())
      await changeText(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!, 'Rastplatz')
      await changeText(document.querySelector<HTMLTextAreaElement>('[aria-label="POI-Beschreibung"]')!, 'Am Wasser')
      await act(async () => button(document, 'POI-Eigenschaften übernehmen').click())
      expect(container.querySelector('.point-marker-label')?.textContent).toBe('Rastplatz')
      expect(container.textContent).toContain('POI aktualisiert.')
      await act(async () => container.querySelector<HTMLElement>('.point-marker')!.click())
      await changeText(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!, 'Verworfen')
      const iconPicker = document.querySelector<HTMLButtonElement>('.poi-icon-picker-toggle')!
      await act(async () => iconPicker.click())
      expect(iconPicker.getAttribute('aria-expanded')).toBe('true')
      const iconOption = document.querySelector<HTMLButtonElement>('.poi-icon-option')!
      await act(async () => iconOption.focus())
      await act(async () => iconOption.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(iconPicker.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(iconPicker)
      expect(document.querySelector('[aria-label="POI-Titel"]')).not.toBeNull()
      await act(async () => iconPicker.click())
      await act(async () => document.querySelectorAll<HTMLButtonElement>('.poi-icon-option').item(0).focus())
      const pointTitle = document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!
      await act(async () => pointTitle.focus())
      expect(iconPicker.getAttribute('aria-expanded')).toBe('false')
      expect(document.querySelector('.poi-icon-picker-options')).toBeNull()
      expect(document.activeElement).toBe(pointTitle)
      await act(async () => document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(container.querySelector('.point-marker-label')?.textContent).toBe('Rastplatz')

      await headerAction(container, 'Projekt speichern')
      const saved = JSON.parse(write.mock.calls[0][0])
      expect(saved.routes[0]).toMatchObject({ name: 'Neue Tour', description: 'Am See' })
      expect(saved.points).toHaveLength(1)
      expect(saved.points[0]).toMatchObject({ name: 'Rastplatz', description: 'Am Wasser', coordinate: [13, 52] })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('handles Escape and focus in the creation dialog and route menu', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const open = button(container, 'Neue Route erstellen oder GPX importieren')
      await act(async () => open.focus())
      await act(async () => open.click())
      const radio = document.querySelector<HTMLInputElement>('input[name="route-creation-mode"][value="new"]')!
      expect(document.activeElement).toBe(radio)
      await act(async () => radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
      expect(document.activeElement?.textContent).toBe('Weiter')
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
      expect(document.activeElement).toBe(radio)
      await act(async () => document.querySelector<HTMLElement>('.route-editor-backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(document.querySelector('.route-creation-dialog')).not.toBeNull()
      await act(async () => radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('.route-creation-dialog')).toBeNull()
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.activeElement).toBe(open)
      expect(container.querySelectorAll('.route-card')).toHaveLength(1)

      const trigger = button(container, `Aktionen für ${initialProject.routes[0].name}`)
      await act(async () => trigger.click())
      const firstAction = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
      expect(document.activeElement).toBe(firstAction)
      await act(async () => firstAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('traps focus in the About dialog and restores it after Escape', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const trigger = button(container, 'Hauptmenü')
      await headerAction(container, 'Info')
      const dialog = document.querySelector<HTMLElement>('.about-dialog')!
      expect(document.activeElement).toBe(dialog)
      await vi.waitFor(() =>
        expect(dialog.querySelector('input[type="search"]')).not.toBeNull(),
      )
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, summary, [tabindex="0"]',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      first.focus()
      await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(last)
      await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(first)
      await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('.about-dialog')).toBeNull()
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(document.activeElement).toBe(trigger)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('opens the cache dialog from the header and restores focus after Escape', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(tileCache, 'stats').mockResolvedValue({
      bytes: 100, count: 1, stale: 0,
      layers: { osm: { bytes: 100, count: 1, stale: 0, zooms: [7], tiles: [] } },
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const trigger = button(container, 'Hauptmenü')
      await headerAction(container, 'Cache verwalten')
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="cache-title"]')!
      expect(document.activeElement).toBe(dialog)
      expect(container.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(dialog.textContent).toContain('OpenStreetMap')
      expect(dialog.textContent).toContain('Gesamten Kachelcache löschen')
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
      controls[0].focus()
      await act(async () => controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(controls[controls.length - 1])
      await act(async () => controls[controls.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(controls[0])
      await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('[aria-labelledby="cache-title"]')).toBeNull()
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(document.activeElement).toBe(trigger)
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
      await headerAction(container, 'Projekt speichern')
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
    const mapSpy = vi.spyOn(L, 'map')
    const tiles = vi.spyOn(L, 'tileLayer')
    const removeMap = vi.spyOn(L.Map.prototype, 'remove')
    localStorage.setItem('mapvento-project', JSON.stringify({ ...initialProject, mapLayerId: 'opentopomap' }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await importStoredProject(container)
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('opentopomap.org')
      const map = mapSpy.mock.results[0].value
      const initialTiles = tiles.mock.results.at(-1)!.value
      expect(map.hasLayer(initialTiles)).toBe(true)
      await act(async () => button(container, 'Kartenlayer auswählen').click())
      const osm = container.querySelector<HTMLInputElement>('input[value="osm"]')!
      await act(async () => osm.click())
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('tile.openstreetmap.org')
      expect(osm.checked).toBe(true)
      const currentTiles = tiles.mock.results.at(-1)!.value
      expect(map.hasLayer(initialTiles)).toBe(false)
      expect(map.hasLayer(currentTiles)).toBe(true)
      await act(async () => initialTiles.fire('tileerror'))
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
      await act(async () => currentTiles.fire('tileerror'))
      expect(container.textContent).toContain('Kartenlayer nicht erreichbar')
      const retry = container.querySelector<HTMLButtonElement>('.status-banner-action')!
      await act(async () => retry.click())
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
      expect(tiles).toHaveBeenCalledTimes(4)
      await act(async () => currentTiles.fire('tileerror'))
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
    } finally {
      await act(async () => root.unmount())
      expect(removeMap).toHaveBeenCalledOnce()
      container.remove()
    }
  })

  it('closes the map layer panel with its close button and restores focus', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const trigger = button(container, 'Kartenlayer auswählen')
      await act(async () => trigger.click())
      expect(Array.from(container.querySelectorAll('.map-layer-panel legend')).map((legend) => legend.textContent))
        .toEqual(['Basiskarte', 'Kartenebenen'])
      const close = button(container, 'Kartenlayer schließen')
      close.focus()
      await act(async () => close.click())
      expect(container.querySelector('.map-layer-panel')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('combines and saves overlays, restoring them only when opened, with per-layer error handling', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const tiles = vi.spyOn(L, 'tileLayer')
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
      const base = tiles.mock.results[0].value
      const trigger = button(container, 'Kartenlayer auswählen')
      await act(async () => trigger.click())
      const hiking = container.querySelector<HTMLInputElement>('.map-layer-panel input[type="checkbox"]')!
      const cycling = container.querySelectorAll<HTMLInputElement>('.map-layer-panel input[type="checkbox"]')[1]
      await act(async () => hiking.click())
      const hikingTiles = tiles.mock.results.at(-1)!.value
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('/hiking/')
      expect(hikingTiles.options.pane).toBe('routeOverlays')
      expect(hikingTiles.options.maxNativeZoom).toBe(18)
      expect(map.hasLayer(base)).toBe(true)
      expect(map.hasLayer(hikingTiles)).toBe(true)
      expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('Waymarked Trails')
      await act(async () => cycling.click())
      const cyclingTiles = tiles.mock.results.at(-1)!.value
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('/cycling/')
      expect(map.hasLayer(hikingTiles)).toBe(true)
      expect(map.hasLayer(cyclingTiles)).toBe(true)
      await act(async () => container.querySelector<HTMLInputElement>('input[value="opentopomap"]')!.click())
      expect(map.hasLayer(base)).toBe(false)
      expect(map.hasLayer(hikingTiles)).toBe(true)
      expect(map.hasLayer(cyclingTiles)).toBe(true)
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('opentopomap.org')

      await act(async () => hikingTiles.fire('tileerror'))
      expect(container.textContent).toContain('Waymarked Trails – Wanderwege')
      await act(async () => cyclingTiles.fire('tileerror'))
      await act(async () => cyclingTiles.fire('load'))
      await act(async () => hikingTiles.fire('load'))
      expect(container.textContent).toContain('Waymarked Trails – Wanderwege')
      await act(async () => container.querySelector<HTMLButtonElement>('.status-banner-action')!.click())
      const retriedHiking = tiles.mock.results.at(-1)!.value
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('/hiking/')
      expect(map.hasLayer(hikingTiles)).toBe(false)
      expect(map.hasLayer(cyclingTiles)).toBe(true)
      await act(async () => hikingTiles.fire('tileerror'))
      expect(container.textContent).toContain('Waymarked Trails – Fahrradrouten')
      await act(async () => container.querySelector<HTMLButtonElement>('.status-banner-action')!.click())
      expect(tiles.mock.calls.at(-1)?.[0]).toContain('/cycling/')
      expect(map.hasLayer(cyclingTiles)).toBe(false)
      expect(map.hasLayer(retriedHiking)).toBe(true)
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
      await act(async () => retriedHiking.fire('tileerror'))
      expect(container.textContent).toContain('Waymarked Trails – Wanderwege')
      await act(async () => hiking.click())
      expect(map.hasLayer(retriedHiking)).toBe(false)
      expect(container.textContent).not.toContain('Kartenlayer nicht erreichbar')
      await act(async () => hiking.click())
      await headerAction(container, 'Projekt speichern')
      const saved = JSON.parse(write.mock.calls[0][0])
      expect(saved.mapOverlayIds).toEqual(['waymarked-cycling', 'waymarked-hiking'])
      expect(saved.mapLayerId).toBe('opentopomap')

      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger)
      await act(async () => root.unmount())
      localStorage.setItem('mapvento-project', JSON.stringify(saved))
      const restored = createRoot(container)
      try {
        await act(async () => restored.render(<App />))
        await importStoredProject(container)
        await act(async () => button(container, 'Kartenlayer auswählen').click())
        expect(Array.from(container.querySelectorAll<HTMLInputElement>('.map-layer-panel input[type="checkbox"]'))
          .map((input) => input.checked)).toEqual([true, true])
      } finally {
        await act(async () => restored.unmount())
      }
    } finally {
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
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(fetchMock).toHaveBeenCalledOnce()
      await act(async () => result.click())
      expect(container.querySelector('.search-result-pin')).not.toBeNull()
      await act(async () => button(container, 'Suche schließen').click())
      expect(container.querySelector('.search-result-pin')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('shows a useful error when the geocoding provider returns malformed data', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ place_id: 1, display_name: 'Invalid place', lat: 'not-a-coordinate', lon: '13' }],
    }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Orte suchen').click())
      const input = container.querySelector<HTMLInputElement>('[aria-label="Suchbegriff"]')!
      await changeText(input, 'Invalid place')
      await act(async () => container.querySelector<HTMLFormElement>('.map-search-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

      expect(container.textContent).toContain(
        'Die Ortssuche ist fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.',
      )
      expect(container.querySelector('.map-search-results')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('cancels the active search when its query changes and ignores its late result', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let resolveResponse!: (response: Response) => void
    const fetchMock = vi.fn((_input: RequestInfo | URL, init: RequestInit) => {
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve
        expect(init.signal?.aborted).toBe(false)
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Orte suchen').click())
      const input = container.querySelector<HTMLInputElement>('[aria-label="Suchbegriff"]')!
      await changeText(input, 'First query')
      await act(async () => container.querySelector<HTMLFormElement>('.map-search-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      const signal = fetchMock.mock.calls[0][1].signal
      expect(signal?.aborted).toBe(false)

      await changeText(input, 'Updated query')
      expect(signal?.aborted).toBe(true)
      await act(async () => resolveResponse({
        ok: true,
        json: async () => [{ place_id: 1, display_name: 'Stale result', lat: '52.5', lon: '13.4' }],
      } as Response))

      expect(container.querySelector('.map-search-results')).toBeNull()
      expect(container.textContent).not.toContain('Stale result')
      expect(input.value).toBe('Updated query')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('closes place search on Escape, aborts its request and restores focus', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init: RequestInit) =>
      new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const trigger = button(container, 'Orte suchen')
      await act(async () => trigger.click())
      const input = container.querySelector<HTMLInputElement>('[aria-label="Suchbegriff"]')!
      await changeText(input, 'Berlin')
      await act(async () => container.querySelector<HTMLFormElement>('.map-search-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      const signal = fetchMock.mock.calls[0][1].signal
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(signal?.aborted).toBe(true)
      expect(container.querySelector('.map-search-panel')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('aborts the active browser request when the application unmounts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init: RequestInit) =>
      new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<App />))
    await act(async () => button(container, 'Orte suchen').click())
    const input = container.querySelector<HTMLInputElement>('[aria-label="Suchbegriff"]')!
    await changeText(input, 'Unmount test')
    await act(async () => container.querySelector<HTMLFormElement>('.map-search-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const signal = fetchMock.mock.calls[0][1].signal

    await act(async () => root.unmount())
    expect(signal?.aborted).toBe(true)
    container.remove()
  })

  it('updates and clears the expanded elevation profile at chart edges', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mapSpy = vi.spyOn(L, 'map')
    const route = {
      ...initialProject.routes[0],
      editable: false,
      nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
      geometry: [[13, 52], [14, 53]],
      elevations: [100, 200],
      routingState: 'ready',
    }
    localStorage.setItem('mapvento-project', JSON.stringify({ ...initialProject, routes: [route] }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await importStoredProject(container)
      await act(async () => button(container, 'Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen').click())
      const chart = container.querySelector<SVGElement>('.elevation-chart')!
      const axisLabels = [...container.querySelectorAll<HTMLElement>('.elevation-axis-label-x')]
      expect(axisLabels.at(-1)?.classList.contains('align-end')).toBe(true)
      expect(parseFloat(axisLabels.at(-1)!.style.left) - parseFloat(axisLabels.at(-2)!.style.left)).toBeGreaterThanOrEqual(9)
      const help = button(container, 'Hilfe zur Höhenprofilbedienung')
      const tooltip = container.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(help.getAttribute('aria-describedby')).toBe(tooltip.id)
      expect(chart.getAttribute('aria-describedby')).toBe(tooltip.id)
      expect(tooltip.textContent).toContain('Pfeiltasten')
      await act(async () => help.focus())
      await act(async () => help.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
      expect(tooltip.classList.contains('dismissed')).toBe(true)
      expect(document.activeElement).toBe(help)
      await act(async () => help.blur())
      await act(async () => help.focus())
      expect(tooltip.classList.contains('dismissed')).toBe(false)
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 190,
        width: 560, height: 190, toJSON: () => ({}),
      })
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 42 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('100 m Höhe')
      const map = mapSpy.mock.results[0].value
      let profileMarker: L.CircleMarker | undefined
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.CircleMarker && layer.options.radius === 8) profileMarker = layer
      })
      expect(profileMarker?.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 550 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('200 m Höhe')
      expect(profileMarker?.getLatLng().equals(L.latLng(53, 14))).toBe(true)
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 551 })))
      expect(container.querySelector('.profile-selection')).toBeNull()
      expect(map.hasLayer(profileMarker!)).toBe(false)
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 0, left: 100, top: 0, right: 1220, bottom: 190,
        width: 1120, height: 190, toJSON: () => ({}),
      })
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 184 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('100 m Höhe')
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1200 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('200 m Höhe')
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1201 })))
      expect(container.querySelector('.profile-selection')).toBeNull()

      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' })))
      expect(chart.getAttribute('aria-valuetext')).toContain('100 m Höhe')
      expect(container.querySelector('.profile-live-status')?.textContent).toContain('100 m Höhe')
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.CircleMarker && layer.options.radius === 8) profileMarker = layer
      })
      expect(profileMarker?.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })))
      expect(chart.getAttribute('aria-valuetext')).toContain('200 m Höhe')
      expect(profileMarker?.getLatLng().equals(L.latLng(53, 14))).toBe(true)
      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })))
      expect(chart.getAttribute('aria-valuetext')).toContain('100 m Höhe')
      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })))
      expect(chart.getAttribute('aria-valuetext')).toContain('200 m Höhe')
      expect(chart.getAttribute('aria-valuetext')).toContain('ab Start')

      await act(async () => chart.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1200 })))
      expect(profileMarker?.getLatLng().equals(L.latLng(53, 14))).toBe(true)
      await act(async () => chart.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 184 })))
      await act(async () => chart.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('100 m Höhe')
      expect(profileMarker?.getLatLng().equals(L.latLng(52, 13))).toBe(true)
      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
      expect(container.querySelector('.profile-selection')).toBeNull()
      expect(chart.getAttribute('aria-valuetext')).toBe('Keine Position ausgewählt')
      expect(map.hasLayer(profileMarker!)).toBe(false)
      await act(async () => button(container, 'Höhenprofil schließen').click())
      expect(container.querySelector('.elevation-chart')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('expands and collapses the profile using its corner button', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const toggle = button(container, 'Höhenprofil ausklappen')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await act(async () => toggle.focus())
      await act(async () => toggle.click())
      expect(container.querySelector('.inspector.expanded')).not.toBeNull()
      expect(button(container, 'Höhenprofil schließen')).toBe(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(toggle)
      await act(async () => toggle.click())
      expect(container.querySelector('.inspector.compact')).not.toBeNull()
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(toggle)
      await act(async () => button(container, 'Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen').click())
      expect(container.querySelector('.inspector.expanded')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('explains empty profiles and calculated fallback heights', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => button(container, 'Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen').click())
      expect(container.textContent).toContain('mindestens zwei unterschiedlichen Punkten')
      expect(container.querySelector('[role="slider"]')).toBeNull()

      const route = {
        ...initialProject.routes[0], editable: false,
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
        geometry: [[13, 52], [14, 53]], routingState: 'ready',
      }
      localStorage.setItem('mapvento-project', JSON.stringify({ ...initialProject, routes: [route] }))
      await importStoredProject(container)
      expect(container.textContent).toContain('Keine vollständigen Höhenwerte vorhanden. Das Profil verwendet synthetische Ersatzwerte.')
      const chart = container.querySelector<SVGElement>('[role="slider"]')!
      await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })))
      expect(chart.getAttribute('aria-valuetext')).toContain('Höhe')
      expect(container.querySelector('.profile-selection')?.textContent).toContain('ab Start')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
