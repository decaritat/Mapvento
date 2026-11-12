import { indexedDB } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileCache } from '../src/integrations/map/tileCache'
import { TileDiagnostics, parseTileLog, summarizeTileLog, tileDiagnostics } from '../src/integrations/map/tileDiagnostics'

const signal = () => new AbortController().signal
let id = 0

function response(body: string, headers = { expires: new Date(Date.now() + 60000).toUTCString() }) {
  return {
    ok: true, status: 200, headers: new Headers(headers),
    blob: async () => new Blob([body], { type: 'image/png' }),
  } as Response
}

describe('tile diagnostics', () => {
  afterEach(() => {
    if (tileDiagnostics.isRecording()) tileDiagnostics.stop()
  })

  it('records cache hits, misses, stale loads, requests, errors and evictions without locations', async () => {
    vi.stubGlobal('indexedDB', indexedDB)
    vi.stubGlobal('Blob', NodeBlob)
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('one'))
      .mockResolvedValueOnce(response('two', { expires: 'Thu, 01 Jan 1970 00:00:00 GMT' }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    const cache = new TileCache(3, `diagnostics-${id++}`)
    tileDiagnostics.start()
    await cache.load('osm', 8, 123, 456, 'https://example.test/secret/1', signal())
    await cache.load('osm', 8, 123, 456, 'https://example.test/secret/1', signal())
    await cache.load('osm', 9, 124, 456, 'https://example.test/secret/2', signal())
    await expect(cache.load('osm', 9, 124, 456, 'https://example.test/secret/2', signal())).rejects.toThrow('offline')
    const log = tileDiagnostics.stop()!
    expect(summarizeTileLog(log)).toMatchObject({ count: 4, hits: 1, misses: 2, stale: 1, requests: 3, errors: 1, evicted: 1 })
    expect(log.events.map((event) => event.zoom)).toEqual([8, 8, 9, 9])
    expect(log.events[0]).toMatchObject({ cache: 'miss', outcome: 'success', httpStatus: 200 })
    expect(log.events[1]).toMatchObject({ cache: 'hit', fetchAttempted: false })
    expect(log.events[1].touchAttempted).toBe(false)
    expect(summarizeTileLog(log)).toMatchObject({ touchAttempts: 0, hasTouchAttempts: true })
    expect(log.events[3]).toMatchObject({ cache: 'stale', outcome: 'error', httpStatus: null })
    const json = JSON.stringify(log)
    expect(json).not.toContain('example.test')
    expect(log.events[0]).not.toHaveProperty('x')
    expect(log.events[0]).not.toHaveProperty('y')
    expect(parseTileLog(json)).toEqual(log)
    const older = { ...log, events: log.events.map((event) => ({ ...event, touchAttempted: undefined })) }
    expect(summarizeTileLog(parseTileLog(JSON.stringify(older))).hasTouchAttempts).toBe(false)
  })

  it('counts in-flight work at stop and never mixes it into a later session', async () => {
    const diagnostics = new TileDiagnostics()
    diagnostics.start()
    const first = diagnostics.begin('osm', 3)!
    const stopped = diagnostics.stop()!
    diagnostics.start()
    const second = diagnostics.begin('opentopomap', 5)!
    first.finish()
    second.finish()
    expect(stopped).toMatchObject({ incomplete: 1, events: [] })
    expect(diagnostics.stop()!.events.map((event) => event.layer)).toEqual(['opentopomap'])
  })

  it('records an access-update attempt after the throttle interval', async () => {
    vi.stubGlobal('indexedDB', indexedDB)
    vi.stubGlobal('Blob', NodeBlob)
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('tile')))
    const cache = new TileCache(100, `diagnostics-${id++}`)
    await cache.load('osm', 8, 1, 1, '/1', signal())
    tileDiagnostics.start()
    await cache.load('osm', 8, 1, 1, '/1', signal())
    time.mockReturnValue(1_800_000_030_000)
    await cache.load('osm', 8, 1, 1, '/1', signal())
    const log = tileDiagnostics.stop()!
    expect(log.events.map((event) => event.touchAttempted)).toEqual([false, true])
    expect(summarizeTileLog(log)).toMatchObject({ hits: 2, touchAttempts: 1 })
  })

  it('distinguishes aborted work and validates imported logs', () => {
    const diagnostics = new TileDiagnostics()
    expect(diagnostics.begin('osm', 1)).toBeNull()
    diagnostics.start()
    const handle = diagnostics.begin('osm', 1)!
    handle.finish(new DOMException('cancelled', 'AbortError'))
    const log = diagnostics.stop()!
    expect(summarizeTileLog(log).aborted).toBe(1)
    expect(() => parseTileLog('{}')).toThrow('Diagnoseformat')
    expect(() => parseTileLog(JSON.stringify({ ...log, events: [{ ...log.events[0], readMs: -1 }] }))).toThrow('Diagnoseereignis')
    expect(() => parseTileLog(JSON.stringify({ ...log, events: [{ ...log.events[0], touchAttempted: 'yes' }] }))).toThrow('Diagnoseereignis')
    expect(() => parseTileLog('not JSON')).toThrow()
  })
})
