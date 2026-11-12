import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  requestRouteGeometry,
  RoutingError,
  routingProfileLabel,
} from '../src/domain/routing'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BRouter integration', () => {
  it('selects and labels the route-specific profiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: true,
        json: async () => ({
          features: [{ geometry: { type: 'LineString', coordinates: [[13.4, 52.5, 35], [13.5, 52.6, 40]] } }],
        }),
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal)
    await requestRouteGeometry('cycling', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal)

    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('profile')).toBe('hiking-beta')
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('profile')).toBe('trekking')
    expect(routingProfileLabel('hiking')).toContain('Wandern')
    expect(routingProfileLabel('cycling')).toContain('Radfahren')
  })

  it('rejects requests with fewer than two waypoints before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestRouteGeometry('hiking', [[13.4, 52.5]], new AbortController().signal))
      .rejects.toThrow('Mindestens zwei Routenpunkte erforderlich')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes valid route coordinates and includes elevations only when complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        {
          ok: true,
          json: async () => ({
            features: [{
              geometry: {
                coordinates: [[13.4, 52.5, 35], [Number.NaN, 52.6, 40], [13.5, 52.6, 42]],
              },
            }],
          }),
        },
      ),
    )

    await expect(
      requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).resolves.toEqual({
      coordinates: [[13.4, 52.5], [13.5, 52.6]],
      elevations: [35, 42],
    })
  })

  it.each([[181, 52], [-181, 52], [13, 91], [13, -91]])(
    'rejects out-of-range provider coordinates: %s, %s',
    async (longitude, latitude) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [{ geometry: { coordinates: [[13, 52], [longitude, latitude]] } }],
        }),
      }))
      await expect(
        requestRouteGeometry('hiking', [[13, 52], [14, 53]], new AbortController().signal),
      ).rejects.toMatchObject({ kind: 'invalid-response' })
    },
  )

  it('surfaces provider and invalid-response errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'provider down',
      }),
    )
    await expect(
      requestRouteGeometry('cycling', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'provider',
      message: 'BRouter ist vorübergehend nicht verfügbar (HTTP 503): provider down',
      status: 503,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('invalid JSON')
        },
      }),
    )
    await expect(
      requestRouteGeometry('cycling', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toThrow('BRouter hat keine gültige Routingantwort geliefert')
  })

  it('classifies rate-limit and authentication responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => '',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => 'blocked',
        }),
    )

    await expect(
      requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'rate-limit',
      message: expect.stringContaining('Rate-Limit'),
    })
    await expect(
      requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'authentication',
      message: expect.stringContaining('verweigert'),
    })
  })

  it('classifies network failures without hiding the provider context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(
      requestRouteGeometry('cycling', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'network',
      message: 'BRouter ist nicht erreichbar. Prüfe die Internetverbindung.',
    })
  })

  it('returns typed no-route errors for empty provider geometry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ features: [] }),
      }),
    )

    await expect(
      requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toBeInstanceOf(RoutingError)
    await expect(
      requestRouteGeometry('hiking', [[13.4, 52.5], [13.5, 52.6]], new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'no-route' })
  })
})
