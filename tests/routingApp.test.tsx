import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { initialProject } from '../src/project'

describe('routing and route properties in the app', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['before', 'after'])(
    'preserves a routing result when properties are saved %s the response',
    async (saveTiming) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      const saved = {
        ...initialProject,
        routes: [{
          ...initialProject.routes[0],
          nodes: [
            { id: 'one', coordinate: [13, 52] },
            { id: 'two', coordinate: [14, 53] },
          ],
          routingState: 'idle',
        }],
      }
      localStorage.setItem('trailforge-project', JSON.stringify(saved))
      let finish!: (response: Response) => void
      let signal!: AbortSignal
      const fetchMock = vi.fn((_url: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          if (!(options.signal instanceof AbortSignal)) throw new Error('Missing signal')
          signal = options.signal
          finish = resolve
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)

      try {
        await act(async () => root.render(<App />))
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(container.textContent).toContain('Route wird berechnet')

        const trigger = container.querySelector<HTMLButtonElement>('.route-menu-trigger')
        expect(trigger).not.toBeNull()
        await act(async () => trigger!.click())
        const properties = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          .find((button) => button.textContent?.includes('Eigenschaften'))
        expect(properties).toBeDefined()
        await act(async () => properties!.click())
        const color = document.querySelector<HTMLButtonElement>('.route-editor .color-swatch')
        expect(color).not.toBeNull()
        await act(async () => color!.click())

        const save = document.querySelector<HTMLButtonElement>('[aria-label="Routeneigenschaften übernehmen"]')
        expect(save).not.toBeNull()
        const finishRequest = async () => {
          await act(async () => finish(new Response(JSON.stringify({
            features: [{ geometry: { coordinates: [[13, 52, 50], [14, 53, 100]] } }],
          }), { status: 200 })))
        }

        if (saveTiming === 'before') {
          await act(async () => save!.click())
          expect(signal.aborted).toBe(false)
          await finishRequest()
        } else {
          await finishRequest()
          await act(async () => save!.click())
        }
        expect(container.textContent).toContain('Routing aktiv')
        expect(container.textContent).not.toContain('Route wird berechnet')
        expect(fetchMock).toHaveBeenCalledOnce()
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    },
  )

  it('keeps one route’s error visible when another succeeds and retries only the failed route', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const route = {
      ...initialProject.routes[0],
      nodes: [
        { id: 'one', coordinate: [13, 52] },
        { id: 'two', coordinate: [14, 53] },
      ],
      routingState: 'idle',
    }
    localStorage.setItem('trailforge-project', JSON.stringify({
      ...initialProject,
      routes: [route, { ...route, id: 'other', name: 'Other' }],
    }))
    const requests: Array<{ resolve: (value: Response) => void; reject: (error: Error) => void }> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve, reject) => {
      requests.push({ resolve, reject })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const result = () => new Response(JSON.stringify({
      features: [{ geometry: { coordinates: [[13, 52], [14, 53]] } }],
    }), { status: 200 })

    try {
      await act(async () => root.render(<App />))
      expect(requests).toHaveLength(2)
      await act(async () => requests[0].reject(new TypeError('network')))
      expect(container.textContent).toContain('Routing fehlgeschlagen')
      expect(container.textContent).toContain('direkte Verbindung bleibt als Fallback sichtbar')
      await act(async () => requests[1].resolve(result()))
      expect(container.textContent).toContain('Routing fehlgeschlagen')
      const retry = container.querySelector<HTMLButtonElement>('.status-banner-action')
      expect(retry).not.toBeNull()
      await act(async () => retry!.click())
      expect(requests).toHaveLength(3)
      await act(async () => requests[2].resolve(result()))
      expect(container.textContent).not.toContain('Routing fehlgeschlagen')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
