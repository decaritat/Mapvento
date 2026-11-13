import { describe, expect, it, vi } from 'vitest'
import { buildPlacesQuery, fetchPlaces, OverpassHttpError, OverpassSizeError, parsePlaces, placeKind } from '../src/features/osm-places/places'

describe('OSM places provider', () => {
  it('combines only selected categories within the requested bounds', () => {
    const query = buildPlacesQuery({ south: 50, west: 8, north: 51, east: 9 }, ['water', 'food'])
    expect(query).toContain('nwr["natural"="spring"](50,8,51,9)')
    expect(query).toContain('nwr["shop"="supermarket"](50,8,51,9)')
    expect(query).not.toContain('nwr["amenity"="parking"]')
    expect(() => buildPlacesQuery({ south: 50, west: 8, north: 51, east: 9 }, [])).toThrow()
  })

  it('preserves tags and object identity while excluding explicitly inaccessible places', () => {
    const places = parsePlaces({ elements: [
      { type: 'node', id: 1, lat: 50, lon: 8, tags: { natural: 'spring', name: 'Quelle', access: 'yes' } },
      { type: 'way', id: 1, center: { lat: 50.1, lon: 8.1 }, tags: { tourism: 'museum' } },
      { type: 'node', id: 2, lat: 50, lon: 8, tags: { amenity: 'parking', access: 'private' } },
    ] })
    expect(places).toHaveLength(2)
    expect(places[0].tags.name).toBe('Quelle')
    expect(places[1]).toMatchObject({ type: 'way', id: 1, latitude: 50.1, longitude: 8.1 })
    expect(placeKind(places[1], ['info'])?.icon).toBe('museum')
    expect(placeKind(places[1], ['water'])).toBeUndefined()
  })

  it('rejects incomplete or invalid responses rather than caching them as complete', () => {
    expect(() => parsePlaces({ remark: 'runtime error', elements: [] })).toThrow()
    expect(() => parsePlaces({ elements: [{ type: 'way', id: 1, tags: {} }] })).toThrow()
    expect(() => parsePlaces({ elements: [{ type: 'node', id: 1, lat: 100, lon: 0, tags: {} }] })).toThrow()
  })

  it('uses a bounded POST and accepts a complete Overpass response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(fetchPlaces({ south: 50, west: 8, north: 51, east: 9 }, ['water'], signal)).resolves.toEqual([])
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', signal })
  })

  it('preserves rate-limit errors and rejects incomplete or excessive responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '45' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: 'runtime error', elements: [] })))
      .mockResolvedValueOnce(new Response('', { headers: { 'Content-Length': '5000000' } }))
    vi.stubGlobal('fetch', fetch)
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    const signal = new AbortController().signal
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toMatchObject<Partial<OverpassHttpError>>({ status: 429, retryAfterMs: 45_000 })
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toBeInstanceOf(OverpassSizeError)
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toBeInstanceOf(OverpassSizeError)
  })
})
