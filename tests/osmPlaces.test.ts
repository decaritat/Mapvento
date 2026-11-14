import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPlacesQuery, fetchPlaces, OverpassHttpError, OverpassSizeError, parsePlaces, placeKind } from '../src/features/osm-places/places'
import { abortPlaces } from '../src/features/osm-places/placesDiagnostics'

describe('OSM places provider', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: 'runtime error: Query timed out', elements: [] })))
      .mockResolvedValueOnce(new Response('', { headers: { 'Content-Length': '5000000' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: 'other runtime error', elements: [] })))
    vi.stubGlobal('fetch', fetch)
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    const signal = new AbortController().signal
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toMatchObject<Partial<OverpassHttpError>>({ status: 429, retryAfterMs: 45_000 })
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toThrow('Zeitlimit des Servers')
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toBeInstanceOf(OverpassSizeError)
    await expect(fetchPlaces(bounds, ['water'], signal)).rejects.toThrow('unvollständige Antwort')
  })

  it('records HTTP errors and distinguishes timeouts from requests without an HTTP response', async () => {
    const diagnostic = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce((_url, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
      }))
    vi.stubGlobal('fetch', fetch)
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    await expect(fetchPlaces(bounds, ['water'], new AbortController().signal, diagnostic)).rejects.toBeInstanceOf(OverpassHttpError)
    await expect(fetchPlaces(bounds, ['water'], new AbortController().signal, diagnostic)).rejects.toThrow('Netzwerk- oder CORS-Fehler')
    const controller = new AbortController()
    const pending = fetchPlaces(bounds, ['water'], controller.signal, diagnostic)
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    await expect(pending).rejects.toBeDefined()
    expect(diagnostic.mock.calls.map(([event]) => [event.outcome, event.httpStatus])).toEqual([
      ['http-error', 503], ['network-error', null], ['timeout', null],
    ])
    expect(diagnostic.mock.calls[1][0]).toMatchObject({ phase: 'request', detail: 'network-or-cors' })
    expect(diagnostic.mock.calls[2][0]).toMatchObject({ phase: 'request', abortReason: null, errorName: 'TimeoutError' })
  })

  it('records safe server classifications without recording response text or credentials', async () => {
    const secret = 'https://example.test/api/secret-key?bbox=50,8,51,9'
    const busy = `runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy. ${secret}`
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(busy, { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: busy, elements: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: `unknown ${secret}`, elements: [] })))
      .mockResolvedValueOnce(new Response('{bad json'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [{ id: 1 }] })))
      .mockResolvedValueOnce(new Response(`<html>${busy}</html>`)))
    const events = vi.fn()
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    for (let i = 0; i < 6; i++) {
      await expect(fetchPlaces(bounds, ['water'], new AbortController().signal, events)).rejects.toBeDefined()
    }
    expect(events.mock.calls.map(([event]) => [event.outcome, event.phase, event.detail])).toEqual([
      ['http-error', 'body', 'server-busy'],
      ['invalid-response', 'parse', 'server-busy'],
      ['invalid-response', 'parse', 'overpass-error'],
      ['invalid-response', 'parse', 'invalid-json'],
      ['invalid-response', 'parse', 'invalid-data'],
      ['invalid-response', 'parse', 'server-busy'],
    ])
    expect(JSON.stringify(events.mock.calls)).not.toContain('secret-key')
    expect(JSON.stringify(events.mock.calls)).not.toContain('50,8,51,9')
  })

  it('records a typed cancellation cause without accepting arbitrary abort messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options: RequestInit) =>
      new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason)))))
    const events = vi.fn()
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    const controller = new AbortController()
    const pending = fetchPlaces(bounds, ['water'], controller.signal, events)
    abortPlaces(controller, 'map-movement')
    await expect(pending).rejects.toBeDefined()
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'aborted', abortReason: 'map-movement' }))
    const other = new AbortController()
    const otherPending = fetchPlaces(bounds, ['water'], other.signal, events)
    other.abort(new DOMException('secret-key', 'AbortError'))
    await expect(otherPending).rejects.toBeDefined()
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'aborted', abortReason: 'unknown' }))
    expect(JSON.stringify(events.mock.calls)).not.toContain('secret-key')
  })

  it('bounds HTTP error inspection and does not read error bodies when diagnostics are disabled', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }), { status: 503 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('secret', { status: 503 })))
    const events = vi.fn()
    const bounds = { south: 50, west: 8, north: 51, east: 9 }
    const pending = fetchPlaces(bounds, ['water'], new AbortController().signal, events)
    const rejected = expect(pending).rejects.toBeInstanceOf(OverpassHttpError)
    await vi.advanceTimersByTimeAsync(1001)
    await rejected
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'http-error', detail: 'body-unavailable' }))
    expect(cancel).toHaveBeenCalled()
    await expect(fetchPlaces(bounds, ['water'], new AbortController().signal, events, () => false))
      .rejects.toBeInstanceOf(OverpassHttpError)
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'request', detail: null }))
  })

  it('preserves the HTTP error if the diagnostic response body cannot be opened', async () => {
    const response = new Response('unavailable', { status: 503 })
    const reader = response.body!.getReader()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const events = vi.fn()
    await expect(fetchPlaces({ south: 50, west: 8, north: 51, east: 9 }, ['water'],
      new AbortController().signal, events)).rejects.toMatchObject({ status: 503 })
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'http-error', detail: 'body-unavailable' }))
    reader.releaseLock()
  })

  it('reports invalid local inputs separately from network failures', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const diagnostic = vi.fn()
    await expect(fetchPlaces({ south: 50, west: 8, north: 51, east: 9 }, [], new AbortController().signal, diagnostic)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'prepare', outcome: 'client-error', detail: 'invalid-request' }))
  })
})
