import { describe, expect, it } from 'vitest'
import { DRESEL_EUROPE, DRESEL_NORTH_AMERICA, PRIVATE_COFFEE, fullyCovered, providersForBounds } from '../src/features/osm-places/placesProviders'

describe('Overpass regional coverage', () => {
  it('selects the correct regional database or the worldwide provider', () => {
    const area = (lat: number, lon: number) => ({ south: lat, north: lat + 0.02, west: lon, east: lon + 0.02 })
    expect(providersForBounds(area(48.13, 11.57))).toEqual([DRESEL_EUROPE, PRIVATE_COFFEE])
    expect(providersForBounds(area(40.75, -73.99))).toEqual([DRESEL_NORTH_AMERICA, PRIVATE_COFFEE])
    expect(providersForBounds(area(-33.87, 151.2))).toEqual([PRIVATE_COFFEE])
    expect(providersForBounds(area(35.68, 139.69))).toEqual([PRIVATE_COFFEE])
    expect(providersForBounds({ south: 35.75, north: 35.78, west: -5.28, east: -5.24 })).toEqual([PRIVATE_COFFEE])
    expect(providersForBounds({ south: 0, north: 1, west: 179, east: 180 })).toEqual([PRIVATE_COFFEE])
  })

  it('rejects areas crossing an extract edge or enclosing a hole, even if all corners are inside', () => {
    const uShape = [[[[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4], [0, 0]]]]
    const area = { west: 0.5, east: 3.5, south: 0.5, north: 3.5 }
    expect(fullyCovered(area, uShape)).toBe(false)
    const hole = [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]]
    expect(fullyCovered(area, hole)).toBe(false)
    expect(fullyCovered({ west: 2.5, east: 3, south: 2.5, north: 3 }, hole)).toBe(true)
    expect(fullyCovered({ west: 0, east: 0.5, south: 0.5, north: 1 }, hole)).toBe(false)
  })
})
