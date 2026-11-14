import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'
import { initialProject } from '../src/domain/project'
import { DEFAULT_SETTINGS, distanceInUnit, durationInUnit, elevationInUnit, parseSettings, readSettings, SETTINGS_KEY } from '../src/domain/settings'
import { profileDetailsAtIndex, routeMetrics } from '../src/domain/routeMetrics'
import { RouteEditor } from '../src/components/routes/RouteEditor'
import { tileDiagnostics } from '../src/integrations/map/tileDiagnostics'

function button(root: ParentNode, text: string) {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
  if (!found) throw new Error(`Button not found: ${text}`)
  return found
}

async function click(element: HTMLElement) { await act(async () => element.click()) }

async function select(label: string, value: string) {
  const field = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.startsWith(label))?.querySelector('select')
  if (!field) throw new Error(`Select not found: ${label}`)
  await act(async () => { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })) })
}

async function input(label: string, value: string) {
  const field = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.startsWith(label))?.querySelector('input')
  if (!field) throw new Error(`Input not found: ${label}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function openSettings(container: HTMLElement) {
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!)
  await click(button(container, 'Einstellungen'))
}

describe('settings and units', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('converts measurements independently and validates persisted settings', () => {
    expect(distanceInUnit(1.609344, 'mi')).toBeCloseTo(1)
    expect(elevationInUnit(304.8, 'ft')).toBeCloseTo(1000)
    expect(durationInUnit(90, 'hours-minutes')).toBe('1 h 30 min')
    expect(durationInUnit(90, 'minutes')).toBe('90 min')
    expect(durationInUnit(402, 'hours')).toBe('6,7 h')
    expect(durationInUnit(402, 'minutes')).toBe('402 min')
    expect(durationInUnit(402, 'clock')).toBe('6:42')
    expect(durationInUnit(402, 'hours-minutes')).toBe('6 h 42 min')
    expect(durationInUnit(0, 'clock')).toBe('0:00')
    expect(durationInUnit(5, 'clock')).toBe('0:05')
    expect(durationInUnit(60, 'clock')).toBe('1:00')
    expect(durationInUnit(1501, 'clock')).toBe('25:01')
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    const oldSettings = { version: 1, start: DEFAULT_SETTINGS.start, units: DEFAULT_SETTINGS.units }
    expect(parseSettings(oldSettings).developer.cacheDiagnostics).toBe(false)
    expect(parseSettings(oldSettings).developer.placesDiagnostics).toBe(false)
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, start: { ...DEFAULT_SETTINGS.start, latitude: 90 } })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, start: { ...DEFAULT_SETTINGS.start, overlayIds: ['invalid'] } })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, units: { ...DEFAULT_SETTINGS.units, distance: 'invalid' } })).toThrow()
    expect(parseSettings({ ...DEFAULT_SETTINGS, units: { ...DEFAULT_SETTINGS.units, duration: 'clock' } }).units.duration).toBe('clock')
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, units: { ...DEFAULT_SETTINGS.units, duration: 'invalid' } })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, developer: { cacheDiagnostics: 'yes' } })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, developer: { placesDiagnostics: 'yes' } })).toThrow()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(SETTINGS_KEY, '{bad')
    expect(readSettings(localStorage)).toMatchObject({ settings: DEFAULT_SETTINGS, saved: false })
    expect(warning).toHaveBeenCalledOnce()
  })

  it('keeps short-route selection at the correct profile position', () => {
    const route = { ...initialProject.routes[0], nodes: [{ id: 'a', coordinate: [0, 0] as [number, number] }, { id: 'b', coordinate: [0.001, 0] as [number, number] }], geometry: [[0, 0], [0.001, 0]] as [number, number][] }
    expect(profileDetailsAtIndex(route, 1).profileFraction).toBe(1)
  })

  it('converts manual marker intervals to and from the selected distance unit', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const update = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<RouteEditor route={{ ...initialProject.routes[0], showDistanceMarkers: true, distanceMarkerMode: 'manual', distanceMarkerStepKm: 1.609344 }}
        units={{ ...DEFAULT_SETTINGS.units, distance: 'mi' }} routeEditorRef={createRef()} top={0} left={0}
        updateRouteDraft={update} saveRouteProperties={vi.fn()} close={vi.fn()} />))
      const field = container.querySelector<HTMLInputElement>('[aria-label="Manuelle Schrittweite in Meilen"]')!
      expect(field.value).toBe('1')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => { setter.call(field, '2'); field.dispatchEvent(new Event('input', { bubbles: true })) })
      expect(update.mock.calls.at(-1)?.[0].distanceMarkerStepKm).toBeCloseTo(3.218688)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('applies and persists units across statistics, profile and map scale; resets and cancellation are isolated', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const scale = vi.spyOn(L.control, 'scale')
    const route = {
      ...initialProject.routes[0], editable: false, showDistanceMarkers: true,
      nodes: [{ id: 'a', coordinate: [0, 0] }, { id: 'b', coordinate: [0.02, 0] }],
      geometry: [[0, 0], [0.01, 0], [0.02, 0]], elevations: [100, 150, 120],
      timestamps: ['2020-01-01T00:00:00Z', null, '2020-01-01T01:30:00Z'],
    }
    localStorage.setItem('mapvento-project', JSON.stringify({ ...initialProject, routes: [route] }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await openSettings(container)
      const position = document.querySelector<HTMLElement>('[aria-labelledby="settings-position-title"]')!
      expect(position.textContent).toContain('Kartenposition beim Start')
      expect(position.querySelectorAll('input')).toHaveLength(3)
      await click(button(document, 'Einheiten'))
      expect(Array.from(document.querySelectorAll('option')).map((option) => option.textContent)).toEqual(expect.arrayContaining([
        'h min (6 h 42 min)', 'hh:mm (6:42)', 'min (402 min)', 'h (6,7 h)',
      ]))
      await select('Distanz', 'mi')
      await select('Höhe', 'ft')
      await select('Dauer', 'minutes')
      await click(button(document, 'Abbrechen'))
      expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
      await openSettings(container)
      await click(button(document, 'Einheiten'))
      await select('Distanz', 'mi')
      await select('Höhe', 'ft')
      await select('Dauer', 'minutes')
      await click(button(document, 'Übernehmen'))
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).units).toEqual({ distance: 'mi', elevation: 'ft', duration: 'minutes' })
      const metrics = routeMetrics({ ...route, nodes: initialProject.routes[0].nodes, geometry: [[0, 0], [0.01, 0], [0.02, 0]] })
      expect(container.querySelector('.route-card-stats')?.textContent).toContain(`${distanceInUnit(metrics.length, 'mi').toFixed(1)} mi`)
      expect(container.querySelector('.route-card-stats')?.textContent).toContain('90 min')
      expect(container.querySelector('.compact-metric-grid')?.textContent).toContain('492 ft höchster')
      expect(scale.mock.calls.at(-1)?.[0]).toMatchObject({ metric: false, imperial: true })
      expect(container.querySelector('.distance-marker-label')?.textContent).toContain('mi')
      await click(container.querySelector<HTMLButtonElement>('[aria-label^="Höhenprofil ausklappen"]')!)
      expect(container.querySelector('.elevation-axis-title-x')?.textContent).toContain('(mi)')
      expect(container.querySelector('.elevation-axis-title-y')?.textContent).toContain('(ft)')
      expect(container.querySelector('.metric-grid')?.textContent).toContain('492 ft')
      const chart = container.querySelector<SVGElement>('.elevation-chart')!
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 560, height: 190, right: 560, bottom: 190, x: 0, y: 0, toJSON: () => ({}) })
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 550 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('394 ft Höhe')
      expect(container.querySelector('.profile-selection')?.textContent).toContain(`${distanceInUnit(metrics.length, 'mi').toFixed(2)} mi ab Start`)
      expect(container.querySelector('.profile-selection')?.textContent).toContain('90 min ab Start')
      await openSettings(container)
      await input('Breitengrad', '50')
      await click(button(document, 'Einheiten'))
      await click(button(document, 'Standardeinstellungen wiederherstellen'))
      await click(button(document, 'Übernehmen'))
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)!)
      expect(saved.units).toEqual(DEFAULT_SETTINGS.units)
      expect(saved.start.latitude).toBe(50)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('persists clock duration and displays it consistently in the route and profile', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const route = {
      ...initialProject.routes[0], editable: false,
      nodes: [{ id: 'a', coordinate: [0, 0] }, { id: 'b', coordinate: [0.02, 0] }],
      geometry: [[0, 0], [0.02, 0]], elevations: [100, 120],
      timestamps: ['2020-01-01T00:00:00Z', '2020-01-01T06:42:00Z'],
    }
    localStorage.setItem('mapvento-project', JSON.stringify({ ...initialProject, routes: [route] }))
    const container = document.createElement('div')
    document.body.append(container)
    let root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await openSettings(container)
      await click(button(document, 'Einheiten'))
      await select('Dauer', 'clock')
      await click(button(document, 'Übernehmen'))
      expect(container.querySelector('.route-card-stats')?.textContent).toContain('6:42')
      expect(container.querySelector('.compact-metric-grid')?.textContent).toContain('6:42')
      await click(container.querySelector<HTMLButtonElement>('[aria-label^="Höhenprofil ausklappen"]')!)
      expect(container.querySelector('.metric-grid')?.textContent).toContain('6:42')
      const chart = container.querySelector<SVGElement>('.elevation-chart')!
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 560, height: 190, right: 560, bottom: 190, x: 0, y: 0, toJSON: () => ({}) })
      await act(async () => chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 550 })))
      expect(container.querySelector('.profile-selection')?.textContent).toContain('6:42 ab Start')
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => root.render(<App />))
      expect(container.querySelector('.route-card-stats')?.textContent).toContain('6:42')
      expect(readSettings(localStorage).settings.units.duration).toBe('clock')
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('captures map view and applies saved start settings only on the next launch', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mapSpy = vi.spyOn(L, 'map')
    const container = document.createElement('div')
    document.body.append(container)
    let root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const map = mapSpy.mock.results[0].value as L.Map
      await act(async () => map.setView([48, 11], 9))
      await openSettings(container)
      await select('Basiskarte', 'opentopomap')
      const overlay = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes('Wanderwege'))!.querySelector('input')!
      await click(overlay)
      await click(button(document, 'Aktuelle Kartenposition übernehmen'))
      expect(document.querySelector<HTMLInputElement>('input[aria-label="Breitengrad"]')?.value ??
        Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.startsWith('Breitengrad'))?.querySelector('input')?.value).toBe('48')
      expect(Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.startsWith('Längengrad'))?.querySelector('input')?.value).toBe('11')
      expect(Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.startsWith('Zoom'))?.querySelector('input')?.value).toBe('9')
      expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
      await click(button(document, 'Übernehmen'))
      expect(localStorage.getItem(SETTINGS_KEY)).toContain('"latitude":48')
      expect(container.querySelector('.leaflet-control-attribution')?.textContent).not.toContain('OpenTopoMap')
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => root.render(<App />))
      const restored = mapSpy.mock.results.at(-1)!.value as L.Map
      expect(restored.getCenter().lat).toBeCloseTo(48)
      expect(restored.getCenter().lng).toBeCloseTo(11)
      expect(restored.getZoom()).toBe(9)
      expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('OpenTopoMap')
      expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('Waymarked Trails')
      await openSettings(container)
      await click(button(document, 'Standardeinstellungen wiederherstellen'))
      await click(button(document, 'Übernehmen'))
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).start).toEqual(DEFAULT_SETTINGS.start)
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('keeps the dialog open when settings cannot be persisted', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await openSettings(container)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
      await click(button(document, 'Übernehmen'))
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('konnten nicht gespeichert')
    } finally { await act(async () => root.unmount()); container.remove() }
  })

  it('gates cache diagnostics behind the opt-in development setting and clears recording when disabled', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const openCache = async () => {
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!)
      await click(button(container, 'Cache verwalten'))
    }
    const closeCache = async () => click(document.querySelector<HTMLButtonElement>('[aria-label="Schließen"]')!)
    try {
      await act(async () => root.render(<App />))
      expect(readSettings(localStorage).settings.developer.cacheDiagnostics).toBe(false)
      await openCache()
      expect(document.body.textContent).not.toContain('Cache-Diagnose')
      await closeCache()

      await openSettings(container)
      await click(button(document, 'Entwicklung'))
      const checkbox = Array.from(document.querySelectorAll('label'))
        .find((label) => label.textContent?.includes('Cache-Diagnose'))
        ?.querySelector<HTMLInputElement>('input')
      expect(checkbox?.checked).toBe(false)
      await click(checkbox!)
      await click(button(document, 'Übernehmen'))
      expect(readSettings(localStorage).settings.developer.cacheDiagnostics).toBe(true)

      await openCache()
      expect(document.body.textContent).toContain('Cache-Diagnose')
      await click(button(document, 'Messung starten'))
      expect(tileDiagnostics.isRecording()).toBe(true)
      await closeCache()
      await openSettings(container)
      await click(button(document, 'Entwicklung'))
      const enabledCheckbox = Array.from(document.querySelectorAll('label'))
        .find((label) => label.textContent?.includes('Cache-Diagnose'))
        ?.querySelector<HTMLInputElement>('input')
      await click(enabledCheckbox!)
      await click(button(document, 'Übernehmen'))
      expect(tileDiagnostics.isRecording()).toBe(false)
      expect(tileDiagnostics.lastLog()).toBeNull()
      await openCache()
      expect(document.body.textContent).not.toContain('Cache-Diagnose')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      tileDiagnostics.clear()
    }
  })

  it('persists the opt-in Overpass diagnostics setting', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await openSettings(container)
      await click(button(document, 'Entwicklung'))
      const checkbox = Array.from(document.querySelectorAll('label'))
        .find((label) => label.textContent?.includes('Overpass-Diagnose'))
        ?.querySelector<HTMLInputElement>('input')
      expect(checkbox?.checked).toBe(false)
      await click(checkbox!)
      await click(button(document, 'Übernehmen'))
      expect(readSettings(localStorage).settings.developer.placesDiagnostics).toBe(true)
      await click(container.querySelector<HTMLButtonElement>('[aria-label="OSM-Orte und Filter"]')!)
      expect(container.querySelector('[aria-label="Overpass-Diagnose"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); container.remove() }
  })
})
