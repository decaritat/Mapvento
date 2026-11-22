import { act, StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AboutDialog from '../src/components/about/AboutDialog'
import { CacheDialog } from '../src/components/cache/CacheDialog'
import { ExitDialog } from '../src/components/exit/ExitDialog'
import { SettingsDialog } from '../src/components/settings/SettingsDialog'
import { UpdateDialog } from '../src/components/update/UpdateDialog'
import { initialProject } from '../src/domain/project'
import { DEFAULT_SETTINGS } from '../src/domain/settings'

function Harness({ renderDialog }: { renderDialog: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Öffnen</button>
    {open && renderDialog(() => setOpen(false))}
  </>
}

function NestedDialogs() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  return <>
    <button type="button" onClick={() => setOuter(true)}>Öffnen</button>
    {outer && <UpdateDialog currentVersion="1" availableVersion="2" onClose={() => setOuter(false)} />}
    {outer && <button type="button" onClick={() => setInner(true)}>Zweiten Dialog öffnen</button>}
    {inner && <ExitDialog onChoose={() => setInner(false)} />}
  </>
}

function RemovedOpener() {
  const [open, setOpen] = useState(false)
  const [removed, setRemoved] = useState(false)
  return <>
    <button type="button" aria-label="Hauptmenü">Menü</button>
    {!removed && <button type="button" onClick={() => setOpen(true)}>Öffnen</button>}
    {open && <ExitDialog onChoose={() => { setOpen(false); setRemoved(true) }} />}
  </>
}

const dialogs: Array<[string, (close: () => void) => ReactNode]> = [
  ['Info', (close) => <AboutDialog onClose={close} />],
  ['Cache', (close) => <CacheDialog onClose={close} layerIds={[]} retry={() => {}}
    project={initialProject} mapZoom={10} diagnosticsEnabled={false} />],
  ['Einstellungen', (close) => <SettingsDialog settings={DEFAULT_SETTINGS} getMapView={() => null}
    onSave={() => null} onClose={close} />],
  ['Update', (close) => <UpdateDialog currentVersion="1" availableVersion="2" onClose={close} />],
  ['Beenden', (close) => <ExitDialog onChoose={close} />],
]

describe('modal focus contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('orders destructive, cancel and primary choices consistently', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      const choose = vi.fn()
      await act(async () => root.render(<ExitDialog onChoose={choose} />))
      const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('.exit-actions button'))
      expect(actions.map((button) => button.textContent)).toEqual(['Beenden ohne Speichern', 'Abbrechen', 'Speichern'])
      expect(actions[0].classList.contains('delete')).toBe(true)
      expect(actions[2].classList.contains('save')).toBe(true)
      await act(async () => actions[0].click())
      expect(choose).toHaveBeenCalledWith('discard')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each(dialogs)('%s keeps focus inside and restores its opener', async (_name, renderDialog) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StrictMode><Harness renderDialog={renderDialog} /></StrictMode>))
      const opener = container.querySelector('button')!
      await act(async () => { opener.focus(); opener.click() })
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(dialog.contains(document.activeElement)).toBe(true)
      if (_name === 'Info') {
        await act(async () => {
          await import('../src/generated/third-party.json')
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
      ))
      const first = controls[0]
      const last = controls.at(-1)!
      await act(async () => { first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })) })
      expect(document.activeElement).toBe(last)
      await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
      expect(document.activeElement).toBe(first)
      await act(async () => dialog.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(document.querySelector('[role="dialog"]')).toBe(dialog)
      await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('only closes the topmost dialog and restores the underlying dialog', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StrictMode><NestedDialogs /></StrictMode>))
      await act(async () => container.querySelector('button')!.click())
      const outer = document.querySelector<HTMLElement>('.update-dialog')!
      await act(async () => container.querySelectorAll('button')[1].click())
      const inner = document.querySelector<HTMLElement>('.exit-dialog')!
      expect(outer.parentElement?.inert).toBe(true)
      expect(inner.contains(document.activeElement)).toBe(true)
      await act(async () => inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.querySelector('.exit-dialog')).toBeNull()
      expect(document.querySelector('.update-dialog')).toBe(outer)
      expect(outer.parentElement?.inert).toBe(false)
      expect(outer.contains(document.activeElement)).toBe(true)
      await act(async () => outer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('.update-dialog')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('uses the main menu when the opener no longer exists', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StrictMode><RemovedOpener /></StrictMode>))
      const opener = container.querySelectorAll('button')[1]
      await act(async () => { opener.focus(); opener.click() })
      const cancel = document.querySelector<HTMLButtonElement>('[data-cancel]')!
      await act(async () => cancel.click())
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.activeElement).toBe(container.querySelector('[aria-label="Hauptmenü"]'))
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
