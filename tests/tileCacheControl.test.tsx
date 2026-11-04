import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileCacheControl } from '../src/TileCacheControl'
import { tileCache } from '../src/tileCache'
import { initialProject } from '../src/project'

describe('tile cache controls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows selected and inactive providers, refreshes the selected layer and clears another', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(tileCache, 'stats').mockResolvedValue({
      bytes: 200, count: 2, stale: 1,
      layers: {
        osm: { bytes: 100, count: 1, stale: 0, zooms: [7], tiles: [] },
        'waymarked-hiking': { bytes: 100, count: 1, stale: 1, zooms: [7], tiles: [] },
      },
    })
    const refresh = vi.spyOn(tileCache, 'revalidate').mockResolvedValue()
    const clear = vi.spyOn(tileCache, 'clear').mockResolvedValue()
    const retry = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(<TileCacheControl layerIds={['osm']} retry={retry} project={initialProject} mapZoom={7} />)
        await new Promise((resolve) => setTimeout(resolve, 150))
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(container.textContent).toContain('Waymarked Trails')
      expect(container.textContent).toContain('Wanderwege Nicht aktiv')
      expect(container.textContent).not.toContain('Projektabdeckung')
      expect(container.textContent).not.toContain('Projekt-Rechteck')
      const providers = container.querySelectorAll('.tile-cache-provider')
      await act(async () => providers[0].querySelector<HTMLButtonElement>('button')!.click())
      expect(refresh).toHaveBeenCalledWith('osm')
      expect(retry).toHaveBeenCalledWith('osm')
      await act(async () => providers[1].querySelectorAll<HTMLButtonElement>('button')[1].click())
      expect(clear).toHaveBeenCalledWith('waymarked-hiking')
      await act(async () => container.querySelector<HTMLButtonElement>('.cache-clear')!.click())
      expect(clear).toHaveBeenCalledWith()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('shows coverage and keeps action errors visible after a stats update', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let update = () => {}
    vi.spyOn(tileCache, 'subscribe').mockImplementation((listener) => {
      update = listener
      return () => {}
    })
    const stats = vi.spyOn(tileCache, 'stats').mockResolvedValue({
      bytes: 1048576, count: 1, stale: 1,
      layers: { osm: { bytes: 1048576, count: 1, stale: 1, zooms: [7], tiles: [{ z: 7, x: 68, y: 42, stale: true }] } },
    })
    vi.spyOn(tileCache, 'clear').mockRejectedValue(new Error('Speicherfehler'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<TileCacheControl layerIds={['osm']} retry={vi.fn()}
        project={{ ...initialProject, points: [{ id: 'p', name: 'P', description: '', coordinate: [13, 52], source: 'manual' }] }}
        mapZoom={7} />))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(container.textContent).toContain('1.0 MiB von 100.0 MiB')
      expect(container.textContent).toContain('Projekt-Rechteck bei Zoom 7: 1/1, davon 1 veraltet')
      await act(async () => container.querySelector<HTMLButtonElement>('.cache-clear')!.click())
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Speicherfehler')
      await act(async () => {
        update()
        await new Promise((resolve) => setTimeout(resolve, 150))
      })
      expect(stats).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Speicherfehler')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
