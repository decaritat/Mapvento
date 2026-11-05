import { describe, expect, it } from 'vitest'
import {
  getCumulativeDistances,
  getDisplayedRouteCoordinates,
  getRouteInsertionIndex,
  type Route,
} from '../src/routeModel'
import {
  getAutomaticDistanceMarkerStepKm,
  formatDuration,
  getDistanceMarkers,
  getDistanceScale,
  getElevationScale,
  isValidDistanceMarkerStepKm,
  profileDetailsAtFraction,
  profileDetailsAtIndex,
  routeMetrics,
  selectedRoutePointDetails,
} from '../src/routeMetrics'

function createRoute(type: Route['type'] = 'hiking'): Route {
  return {
    id: 'route-1',
    name: 'Teststrecke',
    description: '',
    type,
    color: '#000000',
    editable: true,
    nodes: [
      { id: 'node-1', coordinate: [0, 0] },
      { id: 'node-2', coordinate: [0.02, 0] },
    ],
    geometry: [[0, 0], [0.01, 0], [0.02, 0]],
    elevations: [100, 150, 120],
  }
}

describe('route geometry and metrics', () => {
  it('finds the route segment nearest to a new point', () => {
    const route = createRoute()
    const nodes: Route['nodes'] = [
      ...route.nodes,
      { id: 'node-3', coordinate: [0.04, 0] },
    ]

    expect(getRouteInsertionIndex(nodes, [0.005, 0.001])).toBe(1)
    expect(getRouteInsertionIndex(nodes, [0.038, 0.001])).toBe(2)
    expect(getRouteInsertionIndex([route.nodes[0]], [0.005, 0])).toBeNull()
  })

  it('identifies the waypoint segment from the displayed routed geometry', () => {
    const nodes: Route['nodes'] = [
      { id: 'one', coordinate: [0, 0] },
      { id: 'two', coordinate: [1, 0] },
      { id: 'three', coordinate: [2, 0] },
      { id: 'four', coordinate: [3, 0] },
    ]
    const geometry: Route['geometry'] = [[0, 0], [2.5, 2], [1, 0], [2, 0], [3, 0]]

    expect(getRouteInsertionIndex(nodes, [1.25, 1], geometry)).toBe(1)
    expect(getRouteInsertionIndex(nodes, [1.5, 0], geometry)).toBe(2)
    expect(getRouteInsertionIndex(nodes, [2.5, 0], geometry)).toBe(3)
  })

  it('matches snapped waypoints in route order when the geometry revisits a waypoint', () => {
    const nodes: Route['nodes'] = [
      { id: 'one', coordinate: [0, 0] },
      { id: 'two', coordinate: [1, 1.01] },
      { id: 'three', coordinate: [2, 0.01] },
      { id: 'four', coordinate: [3, 0] },
    ]
    const geometry: Route['geometry'] = [[0, 0], [2, 0], [1, 0.2], [1, 1], [2, 0], [3, 0]]

    expect(getRouteInsertionIndex(nodes, [1.5, 0.5], geometry)).toBe(2)
    expect(getRouteInsertionIndex(nodes, [2.5, 0], geometry)).toBe(3)
  })

  it('handles multiple and coincident waypoints on a single geometry segment', () => {
    const nodes: Route['nodes'] = [
      { id: 'one', coordinate: [0, 0] },
      { id: 'two', coordinate: [0.8, 0] },
      { id: 'three', coordinate: [0.2, 0] },
      { id: 'four', coordinate: [1, 0] },
    ]

    expect(getRouteInsertionIndex(nodes, [0.9, 0], [[0, 0], [1, 0]])).toBe(3)
    expect(getRouteInsertionIndex(nodes, [0, 0], [[0, 0], [0, 0]])).toBe(3)
  })

  it('uses the routed geometry and accumulates segment distances', () => {
    const route = createRoute()
    const coordinates = getDisplayedRouteCoordinates(route)
    const distances = getCumulativeDistances(coordinates)

    expect(coordinates).toEqual(route.geometry)
    expect(distances).toHaveLength(3)
    expect(distances[0]).toBe(0)
    expect(distances[1]).toBeCloseTo(1.1119, 3)
    expect(distances[2]).toBeCloseTo(distances[1] * 2, 3)
  })

  it('calculates ascent, descent, extrema, and hiking duration from route elevations', () => {
    const metrics = routeMetrics(createRoute())

    expect(metrics.ascent).toBe(50)
    expect(metrics.descent).toBe(30)
    expect(metrics.high).toBe(150)
    expect(metrics.low).toBe(100)
    expect(metrics.length).toBeCloseTo(2.2239, 3)
    expect(metrics.durationMinutes).toBe(35)
  })

  it('uses the cycling speed when estimating duration', () => {
    expect(routeMetrics(createRoute('cycling')).durationMinutes).toBe(14)
  })

  it('uses imported GPX timestamps for duration when available', () => {
    const route = createRoute()
    route.timestamps = [
      '2025-05-01T10:00:00Z',
      '2025-05-01T10:30:00Z',
      '2025-05-01T11:30:00Z',
    ]

    expect(routeMetrics(route).durationMinutes).toBe(90)
    expect(profileDetailsAtFraction(route, 0.5)?.elapsedMinutes).toBe(30)
  })

  it('falls back to generated geometry and elevations when routed data is unavailable', () => {
    const route = createRoute()
    delete route.geometry
    delete route.elevations

    expect(getDisplayedRouteCoordinates(route)).toHaveLength(13)
    expect(routeMetrics(route).elevations).toHaveLength(13)
  })

  it('keeps synthetic metrics and profile values for geometry without stored elevations', () => {
    const route = createRoute()
    delete route.elevations

    const metrics = routeMetrics(route)
    expect(metrics.elevations).toEqual([588, 594, 600])
    expect(metrics.ascent).toBe(12)
    expect(metrics.descent).toBe(0)
    expect(metrics.high).toBe(600)
    expect(metrics.low).toBe(588)
    expect(profileDetailsAtFraction(route, 0.5)?.elevation).toBe(594)
  })

  it('uses a replacement fallback consistently in metrics and profile details', () => {
    const route = createRoute()
    delete route.elevations
    const fallback = { elevationAt: ([lon]: [number, number]) => 100 + lon * 1000 }

    expect(routeMetrics(route, fallback).elevations).toEqual([100, 110, 120])
    expect(profileDetailsAtFraction(route, 0.5, fallback)?.elevation).toBe(110)
    expect(selectedRoutePointDetails(route, 'node-2', fallback)?.elevation).toBe(120)
    expect(
      profileDetailsAtIndex({ ...route, nodes: [], geometry: undefined }, 0, undefined, fallback)
        .elevation,
    ).toBe(100)
  })

  it('resolves profile fractions to the nearest sampled point and clamps the ends', () => {
    const route = createRoute()
    const midpoint = profileDetailsAtFraction(route, 0.5)

    expect(midpoint).toMatchObject({
      coordinate: [0.01, 0],
      elevation: 150,
      profileFraction: 0.5,
      elapsedMinutes: 20,
    })
    expect(profileDetailsAtFraction(route, -1)?.coordinate).toEqual([0, 0])
    expect(profileDetailsAtFraction(route, 2)?.coordinate).toEqual([0.02, 0])
    expect(profileDetailsAtFraction(route, Number.NaN)).toBeNull()
  })

  it('finds the profile location for a selected route waypoint', () => {
    const details = selectedRoutePointDetails(createRoute(), 'node-2')

    expect(details?.nodeIndex).toBe(1)
    expect(details?.coordinate).toEqual([0.02, 0])
    expect(selectedRoutePointDetails(createRoute(), 'missing')).toBeNull()
  })

  it('creates usable distance and elevation scales for zero and varied values', () => {
    expect(getDistanceScale(0)).toEqual({ max: 1, step: 1, ticks: [0, 1] })
    expect(getDistanceScale(10).ticks.at(-1)).toBe(10)
    expect(getElevationScale([])).toEqual({ min: 0, max: 50, step: 50 })
    expect(getElevationScale([101, 249])).toEqual({ min: 100, max: 250, step: 50 })
  })

  it('creates distance markers at interpolated route positions', () => {
    const markers = getDistanceMarkers(createRoute(), 1)

    expect(markers.map((marker) => marker.distance)).toHaveLength(3)
    expect(markers.map((marker) => marker.distance).slice(0, 2)).toEqual([1, 2])
    expect(markers.at(-1)?.distance).toBeCloseTo(2.2239, 3)
    expect(markers[0].coordinate[0]).toBeCloseTo(0.00899, 3)
    expect(getDistanceMarkers(createRoute(), 0)).toEqual([])
    expect(isValidDistanceMarkerStepKm(-1)).toBe(false)
    expect(isValidDistanceMarkerStepKm(0.1)).toBe(true)
  })

  it('chooses a rounded automatic marker step from the map scale', () => {
    expect(getAutomaticDistanceMarkerStepKm(7, 51)).toBe(100)
    expect(getAutomaticDistanceMarkerStepKm(14, 51)).toBe(1)
  })

  it('formats route durations in minutes or hours', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(125)).toBe('2 h 5 min')
  })
})
