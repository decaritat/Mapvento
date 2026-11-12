import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn(), onCloseRequested: vi.fn(), unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  isTauri: () => true,
  invoke: desktop.invoke,
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: desktop.openUrl }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: desktop.onCloseRequested }) }))

import App from '../src/app/App'
import { initialProject } from '../src/domain/project'

async function chooseExit(label: string) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="exit-title"]')!
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.textContent === label)!
  await act(async () => button.click())
}

describe('desktop header', () => {
  beforeEach(() => {
    desktop.onCloseRequested.mockResolvedValue(desktop.unlisten)
  })
  afterEach(() => {
    localStorage.clear()
    desktop.invoke.mockReset()
    desktop.openUrl.mockReset()
    desktop.onCloseRequested.mockReset()
    desktop.unlisten.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the newly selected desktop path for subsequent saves and retains it after cancellation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const results = ['/new/project.json', null, '/new/project.json']
    desktop.invoke.mockImplementation(async (command: string) => {
      if (command === 'open_project_file') return { path: '/old/project.json', content: JSON.stringify(initialProject) }
      if (command === 'save_project_file') return results.shift()
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
      await action('Projekt speichern unter')
      await action('Projekt speichern unter')
      expect(container.textContent).toContain('Speichern abgebrochen.')
      await action('Projekt speichern')
      const saves = desktop.invoke.mock.calls.filter(([command]) => command === 'save_project_file')
      expect(saves.map(([, args]) => args.path)).toEqual([null, null, '/new/project.json'])
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each(['menu', 'window'])('protects unsaved changes on %s close, including an unfinished title edit', async (source) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    desktop.invoke.mockImplementation(async (command: string) => command === 'save_project_file' ? '/saved.json' : undefined)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Entwurf')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      if (source === 'window') {
        const preventDefault = vi.fn()
        await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault }))
        expect(preventDefault).toHaveBeenCalledOnce()
      } else {
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
        await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          .find((item) => item.textContent === 'Beenden')!.click())
      }
      expect(document.querySelector('[aria-labelledby="exit-title"]')).not.toBeNull()
      expect(desktop.invoke.mock.calls.some(([command]) => command === 'save_project_file' || command === 'exit_app')).toBe(false)
      await chooseExit('Speichern')
      const saved = desktop.invoke.mock.calls.find(([command]) => command === 'save_project_file')!
      expect(JSON.parse(saved[1].content).name).toBe('Entwurf')
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
    } finally {
      await act(async () => root.unmount())
      expect(desktop.unlisten).toHaveBeenCalledOnce()
      container.remove()
    }
  })

  it.each([null, new Error('write failed')])('keeps the window open when saving on close fails: %s', async (result) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    desktop.invoke.mockImplementation(async (command: string) => {
      if (command === 'save_project_file') {
        if (result instanceof Error) throw result
        return result
      }
      return undefined
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Ungespeichert')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      await chooseExit('Speichern')
      expect(desktop.invoke).not.toHaveBeenCalledWith('exit_app')
      expect(container.textContent).toContain(result ? 'Projekt konnte nicht gespeichert werden:' : 'Speichern abgebrochen.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps the window open if the draft changes while saving on close', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let finishSave!: (path: string) => void
    desktop.invoke.mockImplementation((command: string) => command === 'save_project_file'
      ? new Promise((resolve) => { finishSave = resolve }) : Promise.resolve())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      const change = async (value: string) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }
      await change('Erste Änderung')
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      await chooseExit('Speichern')
      const preventAgain = vi.fn()
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: preventAgain }))
      expect(preventAgain).toHaveBeenCalledOnce()
      expect(desktop.invoke.mock.calls.filter(([command]) => command === 'save_project_file')).toHaveLength(1)
      await change('Spätere Änderung')
      await act(async () => finishSave('/saved.json'))
      expect(desktop.invoke).not.toHaveBeenCalledWith('exit_app')
      expect(container.textContent).toContain('Das Projekt wurde während des Speicherns geändert.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each([false, true])('closes without saving when %s changes are discarded', async (modified) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      if (modified) {
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Geändert')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      if (modified) {
        expect(desktop.invoke).not.toHaveBeenCalledWith('exit_app')
        await chooseExit('Beenden ohne Speichern')
      } else {
        expect(document.querySelector('[aria-labelledby="exit-title"]')).toBeNull()
      }
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
      expect(desktop.invoke.mock.calls.some(([command]) => command === 'save_project_file')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each(['button', 'escape'])('cancels the exit via %s and permits retry', async (method) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Änderung')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      const dialog = document.querySelector<HTMLElement>('[aria-labelledby="exit-title"]')!
      expect((document.activeElement as HTMLElement).textContent).toBe('Abbrechen')
      if (method === 'button') await chooseExit('Abbrechen')
      else await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(document.querySelector('[aria-labelledby="exit-title"]')).toBeNull()
      expect(desktop.invoke.mock.calls.some(([command]) => command === 'save_project_file' || command === 'exit_app')).toBe(false)
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      expect(document.querySelector('[aria-labelledby="exit-title"]')).not.toBeNull()
      await chooseExit('Beenden ohne Speichern')
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves to the existing desktop file only after the user chooses save', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    desktop.invoke.mockImplementation(async (command: string) => {
      if (command === 'open_project_file') return { path: '/chosen/project.json', content: JSON.stringify(initialProject) }
      if (command === 'save_project_file') return '/chosen/project.json'
      return undefined
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Projekt öffnen')!.click())
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Geändert')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => desktop.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }))
      expect(desktop.invoke.mock.calls.some(([command]) => command === 'save_project_file')).toBe(false)
      const dialog = document.querySelector<HTMLElement>('[aria-labelledby="exit-title"]')!
      const buttons = dialog.querySelectorAll<HTMLButtonElement>('button')
      await act(async () => buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(buttons[0])
      await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(buttons[2])
      await chooseExit('Speichern')
      const saved = desktop.invoke.mock.calls.find(([command]) => command === 'save_project_file')!
      expect(saved[1].path).toBe('/chosen/project.json')
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
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
