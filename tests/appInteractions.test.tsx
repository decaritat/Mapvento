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
      map.eachLayer((layer: L.Layer) => {
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
      await act(async () => button(document, 'Routeneigenschaften verwerfen und schließen').click())
      await act(async () => container.querySelector<HTMLElement>('.point-marker')!.click())
      expect(document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')?.disabled).toBe(true)
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
      await act(async () => iconPicker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(iconPicker.getAttribute('aria-expanded')).toBe('false')
      expect(document.querySelector('[aria-label="POI-Titel"]')).not.toBeNull()
      await act(async () => document.querySelector<HTMLInputElement>('[aria-label="POI-Titel"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(container.querySelector('.point-marker-label')?.textContent).toBe('Rastplatz')

      const save = Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.trim() === 'Projekt speichern')!
      await act(async () => save.click())
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
      await act(async () => button(container, 'Neue Route erstellen oder GPX importieren').click())
      const radio = document.querySelector<HTMLInputElement>('input[name="route-creation-mode"][value="new"]')!
      expect(document.activeElement).toBe(radio)
      await act(async () => radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('.route-creation-dialog')).toBeNull()
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
      const info = Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.trim() === 'Info')!
      info.focus()
      await act(async () => info.click())
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
      expect(document.activeElement).toBe(info)
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
    const mapSpy = vi.spyOn(L, 'map')
    const tiles = vi.spyOn(L, 'tileLayer')
    const removeMap = vi.spyOn(L.Map.prototype, 'remove')
    localStorage.setItem('trailforge-project', JSON.stringify({ ...initialProject, mapLayerId: 'opentopomap' }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      expect(tiles.mock.calls[0][0]).toContain('opentopomap.org')
      const map = mapSpy.mock.results[0].value
      const initialTiles = tiles.mock.results[0].value
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
      expect(tiles).toHaveBeenCalledTimes(3)
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
        .toEqual(['Basiskarte', 'Kartenebenen', 'Kachelcache'])
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

  it('combines, saves and restores overlays independently with per-layer error handling', async () => {
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
      await act(async () => container.querySelector<HTMLButtonElement>('.solid-button')!.click())
      const saved = JSON.parse(write.mock.calls[0][0])
      expect(saved.mapOverlayIds).toEqual(['waymarked-cycling', 'waymarked-hiking'])
      expect(saved.mapLayerId).toBe('opentopomap')

      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger)
      await act(async () => root.unmount())
      localStorage.setItem('trailforge-project', JSON.stringify(saved))
      const restored = createRoot(container)
      try {
        await act(async () => restored.render(<App />))
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
