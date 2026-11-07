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
import { initialProject } from '../src/project'

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
      expect(desktop.openUrl).toHaveBeenCalledWith('https://github.com/decaritat/Mapvento')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves an edited opened project to its existing desktop path before creating a new project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    desktop.invoke.mockImplementation(async (command: string) => {
      if (command === 'open_project_file') return { path: '/chosen/project.json', content: JSON.stringify({ ...initialProject, name: 'Datei' }) }
      if (command === 'save_project_file') return '/chosen/project.json'
      return undefined
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const action = async (label: string) => {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === label)!.click())
    }
    try {
      await act(async () => root.render(<App />))
      await action('Projekt öffnen')
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Geändert')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await action('Neues Projekt')
      const saved = desktop.invoke.mock.calls.find(([command]) => command === 'save_project_file')!
      expect(saved[1].path).toBe('/chosen/project.json')
      expect(JSON.parse(saved[1].content).name).toBe('Geändert')
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('reports unavailable native dialogs without pretending to save or replacing the project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    desktop.invoke.mockRejectedValue(new Error('Command open_project_file not allowed by ACL'))
    const savePicker = vi.fn()
    vi.stubGlobal('showSaveFilePicker', savePicker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const action = async (label: string) => {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === label)!.click())
    }
    try {
      await act(async () => root.render(<App />))
      const input = container.querySelector<HTMLInputElement>('input[accept=".json,.mapvento.json"]')!
      const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {})
      await action('Projekt öffnen')
      expect(openPicker).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Dateidialog in dieser Umgebung nicht verfügbar.')
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const name = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Geändert')
        name.dispatchEvent(new Event('input', { bubbles: true }))
        name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      desktop.invoke.mockImplementation(async (command: string) => {
        if (command === 'save_project_file') throw new Error('Command save_project_file not allowed by ACL')
        return undefined
      })
      await action('Neues Projekt')
      expect(savePicker).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Geändert')
      expect(container.textContent).toContain('Dateidialog in dieser Umgebung nicht verfügbar.')
      expect(localStorage.getItem('mapvento-project')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
