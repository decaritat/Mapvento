import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  isTauri: () => true,
  invoke: desktop.invoke,
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: desktop.openUrl }))

import App from '../src/App'

describe('desktop header', () => {
  afterEach(() => {
    localStorage.clear()
    desktop.invoke.mockReset()
    desktop.openUrl.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('invokes application exit and reports a failure', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    desktop.invoke.mockRejectedValue(new Error('Desktopfehler'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      const exit = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Beenden')!
      await act(async () => exit.click())
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
      expect(container.textContent).toContain('Beenden fehlgeschlagen: Error: Desktopfehler')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('opens About dialog links only once in the system browser', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      const info = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Info')!
      await act(async () => info.click())
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('.about-link-list a'))
        .find((item) => item.textContent === 'GitHub-Projekt')!
      await act(async () => link.click())
      expect(desktop.openUrl).toHaveBeenCalledTimes(1)
      expect(desktop.openUrl).toHaveBeenCalledWith('https://github.com/decaritat/Trailforge')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
