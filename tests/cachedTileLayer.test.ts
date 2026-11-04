import L from 'leaflet'
import { describe, expect, it, vi } from 'vitest'
import { CachedTileLayer } from '../src/cachedTileLayer'
import { tileCache, TileCacheStorageError } from '../src/tileCache'

const coords = Object.assign(L.point(3, 4), { z: 5 })

describe('cached Leaflet tiles', () => {
  it('displays cached blobs and releases their object URLs on unload', async () => {
    const createObjectURL = vi.fn(() => 'blob:tile')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const load = vi.spyOn(tileCache, 'load').mockResolvedValue(new Blob(['tile'], { type: 'image/png' }))
    const layer = new CachedTileLayer('https://example.test/{z}/{x}/{y}', {}, 'osm', vi.fn())
    const done = vi.fn()
    const image = layer.createTile(coords, done) as HTMLImageElement
    await vi.waitFor(() => expect(image.src).toBe('blob:tile'))
    image.dispatchEvent(new Event('load'))
    expect(done).toHaveBeenCalledWith(undefined, image)
    expect(load).toHaveBeenCalledWith('osm', 5, 3, 4, expect.any(String), expect.any(AbortSignal))
    layer.fire('tileunload', { tile: image })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tile')
  })

  it('aborts removed tiles and ignores late responses', async () => {
    let finish!: (value: Blob) => void
    const createObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    const load = vi.spyOn(tileCache, 'load').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const layer = new CachedTileLayer('https://example.test/{z}/{x}/{y}', {}, 'osm', vi.fn())
    const done = vi.fn()
    const image = layer.createTile(coords, done)
    const signal = load.mock.calls[0][5]
    layer.fire('tileunload', { tile: image })
    expect(signal.aborted).toBe(true)
    finish(new Blob(['tile']))
    await Promise.resolve()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
  })

  it('reports storage failure and falls back to the webview HTTP cache', async () => {
    vi.spyOn(tileCache, 'load').mockRejectedValue(new TileCacheStorageError('Speicher voll'))
    const report = vi.fn()
    const done = vi.fn()
    const layer = new CachedTileLayer('https://example.test/{z}/{x}/{y}', {}, 'osm', report)
    const image = layer.createTile(coords, done) as HTMLImageElement
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringContaining('Speicher voll')))
    expect(image.src).toMatch(/^data:image/)
    image.dispatchEvent(new Event('load'))
    expect(done).toHaveBeenCalledWith(undefined, image)
  })
})
