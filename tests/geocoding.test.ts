import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GEOCODING_PROVIDER } from '../src/providers'

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

import { parseGeocodingResponse, searchPlaces } from '../src/geocoding'

const result = {
  place_id: 1,
  display_name: 'Berlin',
  lat: '52.52',
  lon: '13.405',
}

beforeEach(() => {
  isTauriMock.mockReturnValue(false)
  invokeMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('geocoding response validation', () => {
  it('accepts valid results and supported GeoJSON geometries', () => {
    const parsed = parseGeocodingResponse([{
      ...result,
      boundingbox: ['52.4', '52.6', '13.3', '13.5'],
      geojson: {
        type: 'Polygon',
        coordinates: [[[13, 52], [14, 52], [14, 53], [13, 52]]],
      },
    }])

    expect(parsed[0]).toMatchObject({
      ...result,
      boundingbox: ['52.4', '52.6', '13.3', '13.5'],
      geojson: {
        type: 'Polygon',
        coordinates: [[[13, 52], [14, 52], [14, 53], [13, 52]]],
      },
    })
  })

  it.each([
    null,
    {},
    { ...result, place_id: '1' },
    { ...result, display_name: '' },
    { ...result, lat: '91' },
    { ...result, lon: '181' },
    { ...result, boundingbox: ['52', '91', '13', '14'] },
    { ...result, geojson: { type: 'Polygon', coordinates: 'invalid' } },
    { ...result, geojson: { type: 'Point', coordinates: [181, 52] } },
    { ...result, geojson: { type: 'Polygon', coordinates: [] } },
  ])('rejects malformed result data: %j', (invalid) => {
    expect(() => parseGeocodingResponse([invalid])).toThrow('Invalid geocoding response')
  })
})

describe('geocoding platform adapters', () => {
  it('uses shared Nominatim configuration for browser requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [result],
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(searchPlaces('Berlin', controller.signal)).resolves.toEqual([result])

    const [request, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const url = new URL(request.toString())
    expect(url.origin + url.pathname).toBe(GEOCODING_PROVIDER.endpoint)
    expect(url.searchParams.get('q')).toBe('Berlin')
    for (const [key, value] of Object.entries(GEOCODING_PROVIDER.searchParameters)) {
      expect(url.searchParams.get(key)).toBe(value)
    }
    expect(options.signal).toBe(controller.signal)
    expect(options.referrerPolicy).toBe('strict-origin-when-cross-origin')
  })

  it('uses the Tauri command and validates its JSON response', async () => {
    isTauriMock.mockReturnValue(true)
    invokeMock.mockResolvedValue(JSON.stringify([result]))

    await expect(searchPlaces('Berlin', new AbortController().signal)).resolves.toEqual([result])
    expect(invokeMock).toHaveBeenCalledWith('search_places', { query: 'Berlin' })
  })

  it('does not use a Tauri response after its request is aborted', async () => {
    isTauriMock.mockReturnValue(true)
    let resolveResponse!: (value: string) => void
    invokeMock.mockReturnValue(new Promise<string>((resolve) => { resolveResponse = resolve }))
    const controller = new AbortController()
    const request = searchPlaces('Berlin', controller.signal)
    controller.abort()
    resolveResponse(JSON.stringify([result]))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})
