import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'
import { initialProject } from '../src/domain/project'

async function action(container: HTMLElement, label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!.click())
  const item = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((button) => button.textContent === label)!
  await act(async () => item.click())
}

async function changeName(container: HTMLElement, name: string, commit = true) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Projektnamen bearbeiten"]')!.click())
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (commit) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

async function chooseProjectChange(container: HTMLElement, choice: 'save' | 'discard' | 'cancel') {
  const label = { save: 'Speichern', discard: 'Nicht speichern', cancel: 'Abbrechen' }[choice]
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.exit-actions button'))
    .find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`Project change action not found: ${label}`)
  await act(async () => button.click())
}

describe('new project', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts with the standard empty project instead of restoring the last project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const savedProject = {
      ...initialProject,
      name: 'Letztes Projekt',
      routes: [{
        ...initialProject.routes[0],
        nodes: [{ id: 'one', coordinate: [13, 52] }, { id: 'two', coordinate: [14, 53] }],
      }],
    }
    localStorage.setItem('mapvento-project', JSON.stringify(savedProject))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
      expect(container.querySelectorAll('.route-node')).toHaveLength(0)
      expect(localStorage.getItem('mapvento-project')).toBe(JSON.stringify(savedProject))
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('creates a default project without prompting when unchanged, and offers an explicit discard choice', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await action(container, 'Neues Projekt')
      expect(confirm).not.toHaveBeenCalled()
      await changeName(container, 'Geändert')
      await action(container, 'Neues Projekt')
      expect(confirm).not.toHaveBeenCalled()
      expect(document.querySelector('.exit-dialog')?.textContent).toContain('Soll das aktuelle Projekt vor dem Erstellen')
      await chooseProjectChange(container, 'cancel')
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Geändert')
      await action(container, 'Neues Projekt')
      await chooseProjectChange(container, 'discard')
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
      expect(JSON.parse(localStorage.getItem('mapvento-project')!)).toEqual(initialProject)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves an unfinished title edit through Save As before replacing the project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close }) })
    vi.stubGlobal('showSaveFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Entwurf', false)
      await action(container, 'Neues Projekt')
      await chooseProjectChange(container, 'save')
      expect(picker).toHaveBeenCalledOnce()
      expect(JSON.parse(write.mock.calls[0][0]).name).toBe('Entwurf')
      expect(close).toHaveBeenCalledOnce()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('cancels opening another project without opening the picker or replacing current work', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const picker = vi.fn()
    vi.stubGlobal('showOpenFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Ungespeichert')
      await action(container, 'Projekt öffnen')
      expect(document.querySelector('.exit-dialog')?.textContent).toContain('vor dem Öffnen')
      await chooseProjectChange(container, 'cancel')
      expect(picker).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Ungespeichert')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('opens another project only after explicitly discarding current changes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const openedProject = { ...initialProject, name: 'Geöffnetes Projekt' }
    const picker = vi.fn().mockResolvedValue([{
      getFile: async () => ({ text: async () => JSON.stringify(openedProject) }),
    }])
    vi.stubGlobal('showOpenFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Zu verwerfen')
      await action(container, 'Projekt öffnen')
      await chooseProjectChange(container, 'discard')
      expect(picker).toHaveBeenCalledOnce()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Geöffnetes Projekt')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps current work when the replacement file picker is cancelled', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue(null))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Behalten')
      await action(container, 'Projekt öffnen')
      await chooseProjectChange(container, 'discard')
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Behalten')
      expect(container.textContent).not.toContain('Projekt geöffnet.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('applies the same replacement guard to the browser file-input fallback', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Zu verwerfen')
      const input = container.querySelector<HTMLInputElement>('input[accept=".json,.mapvento.json"]')!
      vi.spyOn(input, 'click').mockImplementation(() => {})
      await action(container, 'Projekt öffnen')
      await chooseProjectChange(container, 'discard')
      expect(input.click).toHaveBeenCalledOnce()

      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{
          text: async () => JSON.stringify({ ...initialProject, name: 'Fallback-Datei' }),
        }],
      })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Fallback-Datei')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not open a replacement file when saving current changes fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new Error('write failed')))
    const openPicker = vi.fn()
    vi.stubGlobal('showOpenFilePicker', openPicker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Behalten')
      await action(container, 'Projekt öffnen')
      await chooseProjectChange(container, 'save')
      expect(openPicker).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Behalten')
      expect(container.textContent).toContain('Projekt konnte nicht gespeichert werden:')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not replace edits made while the replacement file picker is open', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let finishOpen!: (handles: unknown[]) => void
    vi.stubGlobal('showOpenFilePicker', vi.fn(() => new Promise((resolve) => { finishOpen = resolve })))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Erste Änderung')
      await action(container, 'Projekt öffnen')
      await chooseProjectChange(container, 'discard')
      await changeName(container, 'Spätere Änderung')
      await act(async () => finishOpen([{
        getFile: async () => ({ text: async () => JSON.stringify({ ...initialProject, name: 'Verspätet' }) }),
      }]))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Spätere Änderung')
      expect(container.textContent).toContain('während des Öffnens geändert')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('warns before closing the browser tab when project changes are unsaved', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Ungespeichert')
      const event = new Event('beforeunload', { bubbles: true, cancelable: true })
      await act(async () => window.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each([
    new DOMException('cancelled', 'AbortError'),
    new Error('write failed'),
  ])('keeps the modified project when saving fails or is cancelled: %s', async (error) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(error))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Unersetzt')
      await action(container, 'Neues Projekt')
      await chooseProjectChange(container, 'save')
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Unersetzt')
      expect(container.textContent).toContain(error.name === 'AbortError' ? 'Speichern abgebrochen.' : 'Projekt konnte nicht gespeichert werden:')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves changes to the previously opened browser file without another picker', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const write = vi.fn().mockResolvedValue(undefined)
    const handle = {
      getFile: async () => ({ text: async () => JSON.stringify({ ...initialProject, name: 'Datei' }) }),
      createWritable: async () => ({ write, close: async () => {} }),
    }
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]))
    const savePicker = vi.fn()
    vi.stubGlobal('showSaveFilePicker', savePicker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await action(container, 'Projekt öffnen')
      await changeName(container, 'Datei geändert')
      await action(container, 'Neues Projekt')
      await chooseProjectChange(container, 'save')
      expect(JSON.parse(write.mock.calls[0][0]).name).toBe('Datei geändert')
      expect(savePicker).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves under a new browser handle and uses it for subsequent saves', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const oldWrite = vi.fn().mockResolvedValue(undefined)
    const newWrite = vi.fn().mockResolvedValue(undefined)
    const oldHandle = {
      getFile: async () => ({ text: async () => JSON.stringify(initialProject) }),
      createWritable: async () => ({ write: oldWrite, close: async () => {} }),
    }
    const newHandle = { createWritable: async () => ({ write: newWrite, close: async () => {} }) }
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([oldHandle]))
    const picker = vi.fn().mockResolvedValue(newHandle)
    vi.stubGlobal('showSaveFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await action(container, 'Projekt öffnen')
      await changeName(container, 'Entwurf', false)
      await action(container, 'Projekt speichern unter')
      expect(picker).toHaveBeenCalledOnce()
      expect(JSON.parse(newWrite.mock.calls[0][0]).name).toBe('Entwurf')
      await action(container, 'Projekt speichern')
      expect(picker).toHaveBeenCalledOnce()
      expect(newWrite).toHaveBeenCalledTimes(2)
      expect(oldWrite).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('saves the latest project draft with Ctrl+S and reuses the selected file', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const write = vi.fn().mockResolvedValue(undefined)
    const picker = vi.fn().mockResolvedValue({
      createWritable: async () => ({ write, close: async () => {} }),
    })
    vi.stubGlobal('showSaveFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Erster Entwurf', false)
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Projektname"]')!
      const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
      await act(async () => input.dispatchEvent(shortcut))
      expect(shortcut.defaultPrevented).toBe(true)
      expect(JSON.parse(write.mock.calls[0][0]).name).toBe('Erster Entwurf')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Neuer Entwurf')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })))
      expect(picker).toHaveBeenCalledOnce()
      expect(JSON.parse(write.mock.calls[1][0]).name).toBe('Neuer Entwurf')
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true })))
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, repeat: true, bubbles: true })))
      expect(write).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not save behind an open dialog when Ctrl+S is pressed', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const picker = vi.fn()
    vi.stubGlobal('showSaveFilePicker', picker)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await action(container, 'Einstellungen')
      const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
      await act(async () => window.dispatchEvent(shortcut))
      expect(shortcut.defaultPrevented).toBe(true)
      expect(picker).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each([new DOMException('cancelled', 'AbortError'), new Error('write failed')])(
    'retains the old browser handle and unsaved state when Save As fails: %s', async (error) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      const oldWrite = vi.fn().mockResolvedValue(undefined)
      const handle = {
        getFile: async () => ({ text: async () => JSON.stringify(initialProject) }),
        createWritable: async () => ({ write: oldWrite, close: async () => {} }),
      }
      vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]))
      vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(error))
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () => root.render(<App />))
        await action(container, 'Projekt öffnen')
        await changeName(container, 'Geändert')
        await action(container, 'Projekt speichern unter')
        await action(container, 'Neues Projekt')
        await chooseProjectChange(container, 'save')
        expect(oldWrite).toHaveBeenCalledOnce()
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    },
  )

  it('does not replace changes made while the save dialog is open', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let finishPicker!: (handle: { createWritable: () => Promise<{ write: () => Promise<void>; close: () => Promise<void> }> }) => void
    vi.stubGlobal('showSaveFilePicker', vi.fn(() => new Promise((resolve) => { finishPicker = resolve })))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await changeName(container, 'Erste Änderung')
      await action(container, 'Neues Projekt')
      await chooseProjectChange(container, 'save')
      await changeName(container, 'Spätere Änderung')
      await act(async () => finishPicker({
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      }))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe('Spätere Änderung')
      expect(container.textContent).toContain('Das Projekt wurde während des Speicherns geändert.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('ignores a delayed file open after creating a new project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let finishOpen!: (handles: unknown[]) => void
    vi.stubGlobal('showOpenFilePicker', vi.fn(() => new Promise((resolve) => { finishOpen = resolve })))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      await action(container, 'Projekt öffnen')
      await action(container, 'Neues Projekt')
      await act(async () => finishOpen([{
        getFile: async () => ({ text: async () => JSON.stringify({ ...initialProject, name: 'Verspätet' }) }),
      }]))
      expect(container.querySelector('[aria-label="Projektname"]')?.textContent).toBe(initialProject.name)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not import a pending GPX into the new project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let finishRead!: (content: string) => void
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<App />))
      const input = container.querySelector<HTMLInputElement>('input[accept=".gpx,application/gpx+xml"]')!
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ text: () => new Promise((resolve) => { finishRead = resolve }) }],
      })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      await action(container, 'Neues Projekt')
      await act(async () => finishRead('<gpx><trk><name>Verspätet</name><trkseg><trkpt lat="48" lon="11"/></trkseg></trk></gpx>'))
      expect(container.textContent).not.toContain('Verspätet')
      expect(container.textContent).not.toContain('GPX schreibgeschützt importiert.')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
