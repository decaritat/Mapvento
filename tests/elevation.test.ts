import { describe, expect, it, vi } from 'vitest'
import {
  getDisplayedRouteElevations,
  syntheticElevationProvider,
  type ElevationProvider,
} from '../src/domain/elevation'
import type { Route } from '../src/domain/routeModel'

const route: Route = {
  id: 'route-1',
  name: 'Test',
  description: '',
  type: 'hiking',
  editable: true,
  nodes: [],
  geometry: [[0, 0], [0.01, 0], [0.02, 0]],
}

describe('elevation providers', () => {
  it('preserves the existing synthetic elevation values', () => {
    expect(syntheticElevationProvider.elevationAt([0, 0])).toBe(588)
    expect(getDisplayedRouteElevations(route)).toEqual([588, 594, 600])
  })

  it('prefers complete finite stored elevations without calling the fallback', () => {
    const fallback: ElevationProvider = { elevationAt: vi.fn(() => 999) }
    const elevations = [-10, 0, 5]

    expect(getDisplayedRouteElevations({ ...route, elevations }, fallback)).toBe(elevations)
    expect(fallback.elevationAt).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    [],
    [1, 2],
    [1, Number.NaN, 3],
    [1, Number.POSITIVE_INFINITY, 3],
  ])('uses the replaceable fallback for missing or inconsistent elevations: %s', (elevations) => {
    const fallback: ElevationProvider = {
      elevationAt: vi.fn(([lon]) => lon * 1000),
    }

    expect(getDisplayedRouteElevations({ ...route, elevations }, fallback)).toEqual([0, 10, 20])
    expect(fallback.elevationAt).toHaveBeenCalledTimes(3)
  })

  it('handles an empty route without invoking the fallback', () => {
    const fallback: ElevationProvider = { elevationAt: vi.fn(() => 999) }

    expect(getDisplayedRouteElevations({ ...route, geometry: undefined }, fallback)).toEqual([])
    expect(fallback.elevationAt).not.toHaveBeenCalled()
  })
})
