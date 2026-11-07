import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileDiagnosticsControl } from '../src/TileDiagnosticsControl'
import { tileDiagnostics } from '../src/tileDiagnostics'
import * as projectFiles from '../src/useProjectFiles'

describe('tile diagnostic controls', () => {
  afterEach(() => {
    if (tileDiagnostics.isRecording()) tileDiagnostics.stop()
  })

  it('records across dialog unmounts and presents a stopped measurement', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    let root = createRoot(container)
    const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === text)!
    try {
      await act(async () => root.render(<TileDiagnosticsControl />))
      await act(async () => button('Messung starten').click())
      expect(tileDiagnostics.isRecording()).toBe(true)
      await act(async () => root.unmount())
      const handle = tileDiagnostics.begin('osm', 8)!
      handle.event.cache = 'hit'
      handle.finish()
      root = createRoot(container)
      await act(async () => root.render(<TileDiagnosticsControl />))
      expect(container.textContent).toContain('Messung läuft')
      await act(async () => button('Messung stoppen').click())
      expect(container.textContent).toContain('1 Treffer')
      expect(container.textContent).toContain('osm: 8')
      expect(button('Diagnose speichern').disabled).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('imports both measurements, exports the selected log, and reports invalid files', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const save = vi.spyOn(projectFiles, 'saveTextFile').mockResolvedValue()
    tileDiagnostics.start()
    tileDiagnostics.begin('osm', 8)!.finish()
    const current = tileDiagnostics.stop()!
    const reference = { ...current, environment: 'desktop' as const }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const load = async (index: number, content: string) => {
      const input = container.querySelectorAll('input')[index]
      const file = { size: content.length, text: async () => content }
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    }
    try {
      await act(async () => root.render(<TileDiagnosticsControl />))
      await load(0, JSON.stringify(current))
      await load(1, JSON.stringify(reference))
      expect(container.textContent).toContain('Messung: Browser')
      expect(container.textContent).toContain('Vergleich: Desktop')
      const exportButton = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Diagnose speichern')!
      await act(async () => exportButton.click())
      expect(save).toHaveBeenCalledWith(expect.stringMatching(/mapvento-cache-browser-.*\.json/), JSON.stringify(current, null, 2), 'application/json')
      await load(1, '{}')
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('konnte nicht gelesen werden')
      expect(container.textContent).toContain('Vergleich: Desktop')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
