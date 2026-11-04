import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { TileCacheControl } from '../src/TileCacheControl'
import { tileCache } from '../src/tileCache'
import { initialProject } from '../src/project'

describe('tile cache controls', () => {
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
      expect(container.textContent).toContain('Waymarked Trails – Wanderwege (nicht aktiv)')
      expect(container.textContent).toContain('Projektabdeckung: keine Routen- oder Punktkoordinaten')
      const providers = container.querySelectorAll('.tile-cache-provider')
      await act(async () => providers[0].querySelector<HTMLButtonElement>('button')!.click())
      expect(refresh).toHaveBeenCalledWith('osm')
      expect(retry).toHaveBeenCalledWith('osm')
      await act(async () => providers[1].querySelectorAll<HTMLButtonElement>('button')[1].click())
      expect(clear).toHaveBeenCalledWith('waymarked-hiking')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
