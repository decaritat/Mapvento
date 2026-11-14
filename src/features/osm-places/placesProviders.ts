import regions from './geofabrikRegions.json'
import type { Bounds } from './places'

export type PlacesProvider = {
  id: string
  name: string
  endpoint: string
  url: string
}

export const PRIVATE_COFFEE: PlacesProvider = {
  id: 'private-coffee', name: 'Private.coffee',
  endpoint: 'https://overpass.private.coffee/api/interpreter', url: 'https://overpass.private.coffee/',
}

export const DRESEL_EUROPE: PlacesProvider = {
  id: 'dresel-europe', name: 'Dresel (Europa)',
  endpoint: 'https://ovp.dresel.systems/api/interpreter', url: 'https://ovp.dresel.systems/',
}

export const DRESEL_NORTH_AMERICA: PlacesProvider = {
  id: 'dresel-north-america', name: 'Dresel (Nordamerika)',
  endpoint: 'https://ovp.dresel.systems/api-na/interpreter', url: 'https://ovp.dresel.systems/',
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segmentIntersectsBounds(a: number[], b: number[], bounds: Bounds): boolean {
  let min = 0
  let max = 1
  for (const [start, delta, low, high] of [
    [a[0], b[0] - a[0], bounds.west, bounds.east],
    [a[1], b[1] - a[1], bounds.south, bounds.north],
  ]) {
    if (delta === 0) {
      if (start < low || start > high) return false
      continue
    }
    const t1 = (low - start) / delta
    const t2 = (high - start) / delta
    min = Math.max(min, Math.min(t1, t2))
    max = Math.min(max, Math.max(t1, t2))
    if (min > max) return false
  }
  return true
}

export function fullyCovered(bounds: Bounds, polygons: number[][][][]): boolean {
  const corners = [
    [bounds.west, bounds.south], [bounds.west, bounds.north],
    [bounds.east, bounds.south], [bounds.east, bounds.north],
  ]
  return polygons.some((rings) => {
    if (!rings.length || !corners.every(([x, y]) =>
      pointInRing(x, y, rings[0]) && !rings.slice(1).some((ring) => pointInRing(x, y, ring)))) return false
    return rings.every((ring) => ring.every((point, index) =>
      !segmentIntersectsBounds(point, ring[(index + 1) % ring.length], bounds)))
  })
}

export function providersForBounds(bounds: Bounds): PlacesProvider[] {
  // Leave a margin around extract boundaries; batches crossing them use the worldwide provider.
  const margin = 0.01
  const expanded = {
    south: bounds.south - margin, north: bounds.north + margin,
    west: bounds.west - margin, east: bounds.east + margin,
  }
  if (expanded.west >= -180 && expanded.east <= 180 && expanded.south >= -90 && expanded.north <= 90) {
    if (fullyCovered(expanded, regions.regions.europe)) return [DRESEL_EUROPE, PRIVATE_COFFEE]
    if (fullyCovered(expanded, regions.regions['north-america'])) return [DRESEL_NORTH_AMERICA, PRIVATE_COFFEE]
  }
  return [PRIVATE_COFFEE]
}
