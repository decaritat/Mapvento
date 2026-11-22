import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileCacheControl } from '../src/components/map/cache/TileCacheControl'
import { tileCache } from '../src/integrations/map/tileCache'
import { initialProject } from '../src/domain/project'
import { CacheDialog } from '../src/components/cache/CacheDialog'

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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const retry = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(<TileCacheControl layerIds={['osm']} retry={retry} project={initialProject} mapZoom={7}
          diagnosticsEnabled={false} reportProblem={vi.fn()} onBusyChange={vi.fn()} />)
        await new Promise((resolve) => setTimeout(resolve, 150))
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(container.textContent).toContain('Waymarked Trails')
      expect(container.textContent).not.toContain('Cache-Diagnose')
      expect(container.textContent).toContain('Wanderwege Nicht aktiv')
      expect(container.textContent).not.toContain('Projektabdeckung')
      expect(container.textContent).not.toContain('Projekt-Rechteck')
      const providers = container.querySelectorAll('.tile-cache-provider')
      await act(async () => providers[0].querySelector<HTMLButtonElement>('button')!.click())
      expect(refresh).toHaveBeenCalledWith('osm')
      expect(retry).toHaveBeenCalledWith('osm')
      await act(async () => providers[1].querySelectorAll<HTMLButtonElement>('button')[1].click())
      expect(clear).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Löschen des Kachelcaches abgebrochen.')
      expect(confirm.mock.calls[0][0]).toContain('Wanderwege')
      expect(confirm.mock.calls[0][0]).toContain('Orte-Cache bleibt unverändert')
      confirm.mockReturnValue(true)
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const reportProblem = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<TileCacheControl layerIds={['osm']} retry={vi.fn()}
        project={{ ...initialProject, points: [{ id: 'p', name: 'P', description: '', coordinate: [13, 52], source: 'manual' }] }}
        mapZoom={7} diagnosticsEnabled={false} reportProblem={reportProblem} onBusyChange={vi.fn()} />))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(container.textContent).toContain('1,0 MiB von 100,0 MiB')
      expect(container.textContent).toContain('Projekt-Rechteck bei Zoom 7: 1/1, davon 1 veraltet')
      await act(async () => container.querySelector<HTMLButtonElement>('.cache-clear')!.click())
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Speicherfehler')
      expect(reportProblem).toHaveBeenCalledWith(expect.stringContaining('Speicherfehler'))
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

  it('keeps the cache dialog open and prevents repeated actions while deletion is running', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(tileCache, 'stats').mockResolvedValue({
      bytes: 100, count: 1, stale: 0,
      layers: { osm: { bytes: 100, count: 1, stale: 0, zooms: [7], tiles: [] } },
    })
    let finish!: () => void
    const clear = vi.spyOn(tileCache, 'clear').mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<CacheDialog onClose={onClose} layerIds={['osm']} retry={vi.fn()}
        project={initialProject} mapZoom={7} diagnosticsEnabled={false} reportProblem={vi.fn()} />))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      const dialog = document.querySelector<HTMLElement>('.cache-dialog')!
      const clearButton = dialog.querySelector<HTMLButtonElement>('.cache-clear')!
      await act(async () => clearButton.click())
      expect(confirm.mock.calls[0][0]).toContain('alle gespeicherten Kartenkacheln')
      expect(dialog.textContent).toContain('Kachelcache wird gelöscht')
      expect(clearButton.disabled).toBe(true)
      expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Schließen"]')?.disabled).toBe(true)
      await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(onClose).not.toHaveBeenCalled()
      expect(clear).toHaveBeenCalledOnce()
      await act(async () => finish())
      expect(dialog.textContent).toContain('Kachelcache gelöscht.')
      await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Schließen"]')!.click())
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
