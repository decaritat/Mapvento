import { describe, expect, it, vi } from 'vitest'
import { parseGpx } from '../src/gpx'
import { DEFAULT_LAYER_ID, layers, overlayLayers } from '../src/mapLayers'
import { initialProject, normalizeProject, readInitialProject } from '../src/project'
import { POI_ICON_IDS } from '../src/poiIconIds'

const route = {
  ...initialProject.routes[0],
  nodes: [
    { id: 'node-1', coordinate: [13, 52] },
    { id: 'node-2', coordinate: [14, 53] },
  ],
  geometry: [[13, 52], [14, 53]],
  elevations: [10, 20],
  timestamps: ['2025-05-01T10:00:00Z', null],
}

const point = {
  id: 'point-1',
  name: 'Gipfel',
  description: '',
  coordinate: [13, 52],
  source: 'poi',
  editable: false,
  icon: 'summit',
}

const project = { ...initialProject, routes: [route], points: [point] }
const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('project validation', () => {
  it('starts a new project with one empty editable route', () => {
    expect(initialProject.routes).toHaveLength(1)
    expect(initialProject.routes[0]).toMatchObject({
      id: initialProject.activeRouteId,
      type: 'hiking',
      editable: true,
      nodes: [],
    })
    expect(initialProject.routes[0].color).toBeUndefined()
    expect(roundTrip(normalizeProject(roundTrip(initialProject)))).toEqual(initialProject)
  })

  it('preserves valid project, route, geometry, GPX, point and layer data', () => {
    const saved = {
      ...project,
      name: 'Meine Tour',
      mapLayerId: 'opentopomap',
      routes: [{
        ...route,
        editable: false,
        gpxType: 'cycling',
        type: 'cycling',
        color: '#123456',
        customColor: '#123456',
        routingState: 'ready',
        routingError: '',
        showDistanceMarkers: true,
        distanceMarkerMode: 'manual',
        distanceMarkerStepKm: 0.5,
      }],
    }
    expect(roundTrip(normalizeProject(roundTrip(saved)))).toEqual(saved)
  })

  it('preserves every registered POI icon ID and rejects unknown IDs', () => {
    const iconIds = Object.values(POI_ICON_IDS)
    const points = iconIds.map((icon, index) => ({ ...point, id: `point-${index}`, icon }))

    expect(normalizeProject({ ...project, points }).points.map(({ icon }) => icon)).toEqual(iconIds)
    expect(() => normalizeProject({
      ...project,
      points: [{ ...point, icon: 'unrecognized' }],
    })).toThrow('enthält ein unbekanntes POI-Symbol')
  })

  it.each(layers.filter((layer) => !layer.requiresKey))('preserves the registered layer $id', ({ id }) => {
    expect(normalizeProject({ ...project, mapLayerId: id }).mapLayerId).toBe(id)
  })

  it('round-trips optional overlay selections and preserves older version 1 projects', () => {
    const saved = { ...project, mapOverlayIds: overlayLayers.map((layer) => layer.id) }
    expect(roundTrip(normalizeProject(roundTrip(saved)))).toEqual(roundTrip(saved))
    expect(normalizeProject(project).mapOverlayIds).toBeUndefined()
    expect(normalizeProject({ ...project, mapOverlayIds: [] }).mapOverlayIds).toEqual([])
  })

  it('rejects malformed or duplicate overlays and reports unavailable providers', () => {
    for (const mapOverlayIds of [null, 'waymarked-hiking', [null], [''], Array(1), ['waymarked-hiking', 'waymarked-hiking']]) {
      expect(() => normalizeProject({ ...project, mapOverlayIds })).toThrow('Ungültiges Projekt')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notice = vi.fn()
    try {
      expect(normalizeProject({ ...project, mapOverlayIds: ['retired', 'waymarked-hiking'] }, notice).mapOverlayIds)
        .toEqual(['waymarked-hiking'])
      expect(notice).toHaveBeenCalledWith(expect.stringContaining('Karten-Overlays'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('retired'))
    } finally {
      warn.mockRestore()
    }
  })

  it('falls back to the default layer for an unknown layer without losing project data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onLayerFallback = vi.fn()
    try {
      const saved = { ...project, mapLayerId: 'retired-layer' }
      expect(roundTrip(normalizeProject(saved, onLayerFallback))).toEqual(roundTrip({ ...saved, mapLayerId: DEFAULT_LAYER_ID }))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('retired-layer'))
      expect(onLayerFallback).toHaveBeenCalledWith(expect.stringContaining('OpenStreetMap Carto'))
      expect(roundTrip(readInitialProject({ getItem: () => JSON.stringify(saved) }, onLayerFallback)))
        .toEqual(roundTrip({ ...saved, mapLayerId: DEFAULT_LAYER_ID }))
      expect(onLayerFallback).toHaveBeenCalledTimes(2)
      expect(() => normalizeProject({ ...saved, name: null }, onLayerFallback)).toThrow('Ungültiges Projekt')
      expect(onLayerFallback).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('does not restore registered layers requiring an API key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    layers.push({ ...layers[0], id: 'keyed-layer', requiresKey: true })
    try {
      expect(normalizeProject({ ...project, mapLayerId: 'keyed-layer' }).mapLayerId).toBe(DEFAULT_LAYER_ID)
    } finally {
      layers.pop()
      warn.mockRestore()
    }
  })

  it('accepts empty projects and the optional fields omitted by the application', () => {
    const empty = { ...initialProject, routes: [], activeRouteId: '' }
    expect(roundTrip(normalizeProject(empty))).toEqual(empty)
    const minimalRoute = { id: 'route-1', name: '', description: '', type: 'hiking', editable: true, nodes: [] }
    const minimalPoint = { id: 'point-1', name: '', description: '', coordinate: [-180, 90], source: 'manual' }
    const saved = { ...initialProject, routes: [minimalRoute], points: [minimalPoint] }
    expect(roundTrip(normalizeProject(saved))).toEqual(saved)
  })

  it('round-trips an actual imported GPX route and waypoints', () => {
    const imported = parseGpx(
      '<gpx><wpt lat="52.5" lon="13.4"><name>Gipfel</name></wpt><trk><trkseg><trkpt lat="52.5" lon="13.4"><ele>100</ele><time>2025-05-01T10:00:00Z</time></trkpt><trkpt lat="52.6" lon="13.5"><ele>200</ele></trkpt></trkseg></trk></gpx>',
    )
    expect(imported).not.toBeNull()
    const saved = {
      ...initialProject,
      routes: [imported!.route],
      points: imported!.waypoints,
      activeRouteId: imported!.route.id,
    }
    expect(roundTrip(normalizeProject(roundTrip(saved)))).toEqual(roundTrip(saved))
  })

  it('retains the existing 180-character project and route description limit', () => {
    const saved = { ...project, description: 'p'.repeat(200), routes: [{ ...route, description: 'r'.repeat(200) }] }
    const restored = normalizeProject(saved)
    expect(restored.description).toHaveLength(180)
    expect(restored.routes[0].description).toHaveLength(180)
  })

  it.each([
    null,
    'project',
    [],
    { ...project, version: 2 },
    { ...project, version: '1' },
    { ...project, version: undefined },
    { ...project, name: null },
    { ...project, description: undefined },
    { ...project, routes: {} },
    { ...project, points: null },
    { ...project, mapLayerId: undefined },
    { ...project, mapLayerId: null },
    { ...project, activeRouteId: 'missing' },
    { ...project, activeRouteId: '' },
    { ...project, routes: [], activeRouteId: 'route-1' },
    { ...project, routes: [route, route] },
    { ...project, points: [point, point] },
  ])('rejects invalid project structure or references: %#', (invalid) => {
    expect(() => normalizeProject(invalid)).toThrow('Ungültiges Projekt')
  })

  it.each([
    null, 'route', 1, [], {},
    { ...route, id: '' },
    { ...route, id: 1 },
    { ...route, name: null },
    { ...route, description: undefined },
    { ...route, type: 'driving' },
    { ...route, editable: 'true' },
    { ...route, nodes: null },
    { ...route, nodes: ['node'] },
    { ...route, nodes: [{ id: '', coordinate: [0, 0] }] },
    { ...route, nodes: [route.nodes[0], route.nodes[0]] },
    { ...route, geometry: 'line' },
    { ...route, geometry: [] },
    { ...route, geometry: [[13, 52], 'invalid'] },
    { ...route, elevations: [1] },
    { ...route, elevations: [1, null] },
    { ...route, elevations: [1, Infinity] },
    { ...route, timestamps: ['2025-05-01T10:00:00Z'] },
    { ...route, timestamps: ['invalid', null] },
    { ...route, timestamps: [1, null] },
    { ...route, routingState: 'broken' },
    { ...route, routingError: false },
    { ...route, gpxType: 1 },
    { ...route, color: null },
    { ...route, customColor: 12 },
    { ...route, showDistanceMarkers: 1 },
    { ...route, distanceMarkerMode: 'fixed' },
    { ...route, distanceMarkerStepKm: NaN },
  ])('rejects invalid routes and optional route data: %#', (invalid) => {
    expect(() => normalizeProject({ ...project, routes: [invalid] })).toThrow('Ungültiges Projekt')
  })

  it.each([
    null, 'point', 1, [], {},
    { ...point, id: '' },
    { ...point, name: 1 },
    { ...point, description: undefined },
    { ...point, source: 'route' },
    { ...point, editable: 'false' },
    { ...point, icon: 'unknown' },
    { ...point, icon: null },
  ])('rejects invalid points: %#', (invalid) => {
    expect(() => normalizeProject({ ...project, points: [invalid] })).toThrow('Ungültiges Projekt')
  })

  it.each([
    null, '13,52', [], [13], [13, 52, 10], ['13', 52],
    [NaN, 52], [Infinity, 52], [-181, 0], [181, 0], [0, -91], [0, 91],
  ])('rejects invalid node, geometry and point coordinates: %#', (coordinate) => {
    expect(() => normalizeProject({
      ...project,
      routes: [{ ...route, nodes: [{ id: 'node', coordinate }] }],
    })).toThrow('Ungültiges Projekt')
    expect(() => normalizeProject({
      ...project,
      routes: [{ ...route, geometry: [coordinate] }],
    })).toThrow('Ungültiges Projekt')
    expect(() => normalizeProject({
      ...project,
      points: [{ ...point, coordinate }],
    })).toThrow('Ungültiges Projekt')
  })

  it('rejects sparse arrays rather than skipping entries', () => {
    expect(() => normalizeProject({ ...project, routes: Array(1) })).toThrow('Ungültiges Projekt')
    expect(() => normalizeProject({ ...project, points: Array(1) })).toThrow('Ungültiges Projekt')
  })

  it('accepts heights and timestamps matching the generated geometry without stored geometry', () => {
    const saved = {
      ...project,
      routes: [{ ...route, geometry: undefined, elevations: Array(13).fill(10), timestamps: Array(13).fill(null) }],
    }
    expect(normalizeProject(saved).routes[0].elevations).toHaveLength(13)
    expect(() => normalizeProject({
      ...saved,
      routes: [{ ...saved.routes[0], elevations: [10, 20] }],
    })).toThrow('Ungültiges Projekt')
  })

  it('falls back safely when storage is empty, malformed, invalid, or inaccessible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(readInitialProject({ getItem: () => null })).toBe(initialProject)
      expect(readInitialProject({ getItem: () => '{' })).toBe(initialProject)
      expect(readInitialProject({ getItem: () => JSON.stringify({ ...project, routes: ['broken'] }) })).toBe(initialProject)
      expect(readInitialProject({ getItem: () => JSON.stringify({ ...project, mapLayerId: null }) })).toBe(initialProject)
      expect(readInitialProject({ getItem: () => { throw new Error('Storage unavailable') } })).toBe(initialProject)
      expect(warn).toHaveBeenCalledTimes(4)
      expect(roundTrip(readInitialProject({ getItem: () => JSON.stringify(project) }))).toEqual(project)
    } finally {
      warn.mockRestore()
    }
  })
})
