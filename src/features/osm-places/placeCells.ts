import { PLACE_CATEGORIES, type Bounds, type PlaceCategory } from './places'
import { isPlacesEntryFresh, type CachedPlaces } from './placesCache'

export const PLACES_ZOOM = 14
export const PLACES_MAX_CELLS = 64
const SIZE = 2 ** PLACES_ZOOM
const MAX_LATITUDE = 85.05112878

export type PlaceCell = { x: number; y: number; bounds: Bounds }
export type PlaceBatch = { cells: PlaceCell[]; categories: PlaceCategory[]; bounds: Bounds }

function latitudeToY(latitude: number): number {
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180
  return (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * SIZE
}

function yToLatitude(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / SIZE))) * 180 / Math.PI
}

function makeCell(x: number, y: number): PlaceCell {
  return { x, y, bounds: {
    south: yToLatitude(y + 1), north: yToLatitude(y),
    west: x / SIZE * 360 - 180, east: (x + 1) / SIZE * 360 - 180,
  } }
}

export function cellsForBounds(bounds: Bounds): PlaceCell[] {
  if (![bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite) ||
    bounds.south >= bounds.north || bounds.east <= bounds.west || bounds.east - bounds.west >= 360) {
    throw new Error('Ungültiger oder zu großer Kartenausschnitt')
  }
  const minX = Math.floor((bounds.west + 180) / 360 * SIZE)
  const maxX = Math.ceil((bounds.east + 180) / 360 * SIZE) - 1
  const minY = Math.max(0, Math.min(SIZE - 1, Math.floor(latitudeToY(bounds.north))))
  const maxY = Math.max(0, Math.min(SIZE - 1, Math.ceil(latitudeToY(bounds.south)) - 1))
  if ((maxX - minX + 1) * (maxY - minY + 1) > PLACES_MAX_CELLS) {
    throw new Error('Kartenausschnitt zu groß. Bitte weiter hineinzoomen.')
  }
  const cells: PlaceCell[] = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) cells.push(makeCell(((x % SIZE) + SIZE) % SIZE, y))
  }
  return cells
}

export function cellForPosition(latitude: number, longitude: number): PlaceCell {
  const x = Math.min(SIZE - 1, Math.max(0, Math.floor((longitude + 180) / 360 * SIZE)))
  const y = Math.min(SIZE - 1, Math.max(0, Math.floor(latitudeToY(latitude))))
  return makeCell(x, y)
}

export function cellKey(cell: PlaceCell, category: PlaceCategory): string {
  // Preserve the original cache namespace across provider changes.
  return `v1:private-coffee:${PLACES_ZOOM}:${cell.x}:${cell.y}:${category}`
}

export function batchesForCells(cells: readonly PlaceCell[], categories: readonly PlaceCategory[],
  cached: ReadonlyMap<string, CachedPlaces>, force = false, now = Date.now()): PlaceBatch[] {
  const selected = PLACE_CATEGORIES.map((item) => item.id).filter((id) => categories.includes(id))
  const pending = new Map<string, { cell: PlaceCell; categories: PlaceCategory[] }>()
  for (const cell of cells) {
    const needed = selected.filter((category) => {
      const entry = cached.get(cellKey(cell, category))
      return force || !entry || !isPlacesEntryFresh(entry, now)
    })
    if (needed.length) pending.set(`${cell.x}:${cell.y}`, { cell, categories: needed })
  }
  const batches: PlaceBatch[] = []
  const sorted = Array.from(pending.values()).sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x)
  for (const first of sorted) {
    const id = `${first.cell.x}:${first.cell.y}`
    if (!pending.has(id)) continue
    const signature = first.categories.join(',')
    let endX = first.cell.x
    while (pending.get(`${endX + 1}:${first.cell.y}`)?.categories.join(',') === signature) endX++
    let endY = first.cell.y
    for (;;) {
      const nextY = endY + 1
      let complete = true
      for (let x = first.cell.x; x <= endX; x++) {
        if (pending.get(`${x}:${nextY}`)?.categories.join(',') !== signature) complete = false
      }
      if (!complete) break
      endY = nextY
    }
    const grouped: PlaceCell[] = []
    for (let y = first.cell.y; y <= endY; y++) {
      for (let x = first.cell.x; x <= endX; x++) {
        const key = `${x}:${y}`
        const item = pending.get(key)
        if (item) grouped.push(item.cell)
        pending.delete(key)
      }
    }
    batches.push({
      cells: grouped, categories: first.categories,
      bounds: {
        south: yToLatitude(endY + 1), north: yToLatitude(first.cell.y),
        west: first.cell.x / SIZE * 360 - 180, east: (endX + 1) / SIZE * 360 - 180,
      },
    })
  }
  return batches
}
