import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'
import { initialProject } from '../src/domain/project'

describe('project loading in the app', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects invalid project files without replacing the new project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const invalid = JSON.stringify({ ...initialProject, routes: ['broken'] })
    localStorage.setItem('mapvento-project', invalid)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<App />))
      const title = container.querySelector<HTMLElement>('[aria-label="Projektname"]')
      expect(title?.textContent).toBe(initialProject.name)

      const input = container.querySelector<HTMLInputElement>('input[accept=".json,.mapvento.json"]')
      expect(input).not.toBeNull()
      const openPicker = vi.spyOn(input!, 'click').mockImplementation(() => {})
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Projekt öffnen')!.click())
      expect(openPicker).toHaveBeenCalledOnce()
      Object.defineProperty(input!, 'files', {
        configurable: true,
        value: [{ text: async () => invalid }],
      })
      await act(async () => input!.dispatchEvent(new Event('change', { bubbles: true })))

      expect(container.textContent).toContain('Die Projektdatei konnte nicht gelesen werden.')
      expect(title?.textContent).toBe(initialProject.name)
      expect(localStorage.getItem('mapvento-project')).toBe(invalid)

      const valid = { ...initialProject, name: 'Geöffnetes Projekt', mapLayerId: 'opentopomap' }
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Projekt öffnen')!.click())
      Object.defineProperty(input!, 'files', {
        configurable: true,
        value: [{ text: async () => JSON.stringify(valid) }],
      })
      await act(async () => input!.dispatchEvent(new Event('change', { bubbles: true })))
      expect(title?.textContent).toBe(valid.name)
      expect(container.textContent).toContain('Projekt geöffnet.')
      expect(JSON.parse(localStorage.getItem('mapvento-project')!)).toEqual(valid)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('starts with a new project and reports unavailable layers when opening a project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const saved = {
      ...initialProject,
      name: 'EineTourMitEinemSehrLangenProjektNamenOhneLeerzeichen',
      mapLayerId: 'retired-layer',
    }
    localStorage.setItem('mapvento-project', JSON.stringify(saved))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<App />))
      const title = container.querySelector<HTMLElement>('[aria-label="Projektname"]')
      expect(title?.textContent).toBe(initialProject.name)
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Kartenlayer auswählen"]')!.click())
      expect(container.querySelector<HTMLInputElement>('input[value="osm"]')?.checked).toBe(true)
      expect(container.textContent).not.toContain('Der gespeicherte Kartenlayer ist nicht verfügbar.')

      const input = container.querySelector<HTMLInputElement>('input[accept=".json,.mapvento.json"]')!
      const opened = { ...saved, name: 'Geöffnete Tour' }
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Projekt öffnen')!.click())
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ text: async () => JSON.stringify(opened) }],
      })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(opened.name)
      expect(container.textContent).toContain('Projekt geöffnet. Der gespeicherte Kartenlayer ist nicht verfügbar.')
      expect(JSON.parse(localStorage.getItem('mapvento-project')!)).toEqual({ ...opened, mapLayerId: 'osm' })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
