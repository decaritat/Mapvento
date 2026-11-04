import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectHeader } from '../src/ProjectHeader'

describe('header menu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('supports keyboard navigation, Escape, Tab, and outside dismissal in the browser', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const save = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ProjectHeader projectInput={createRef()} openProject={vi.fn()} saveProject={save}
        importProject={vi.fn()} openCache={vi.fn()} openAbout={vi.fn()} exitApp={vi.fn()} desktop={false} />))
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!
      expect(container.textContent).not.toContain('Projekt speichern')
      await act(async () => trigger.click())
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      expect(items.map((item) => item.textContent)).toEqual([
        'Projekt öffnen', 'Projekt speichern', 'Einstellungen', 'Cache verwalten', 'Info',
      ])
      expect(items[2].disabled).toBe(true)
      expect(document.activeElement).toBe(items[0])
      await act(async () => items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(items[1])
      await act(async () => items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(items[3])
      await act(async () => items[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(container.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      await act(async () => trigger.click())
      await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
      expect(container.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      await act(async () => trigger.click())
      const current = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!
      await act(async () => current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
      expect(container.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      await act(async () => trigger.click())
      const saveItem = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Projekt speichern')!
      await act(async () => saveItem.click())
      expect(save).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('exposes desktop exit and delegates file opening', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const exit = vi.fn()
    const openProject = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ProjectHeader projectInput={createRef()} openProject={openProject} saveProject={vi.fn()}
        importProject={vi.fn()} openCache={vi.fn()} openAbout={vi.fn()} exitApp={exit} desktop />))
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')!
      await act(async () => trigger.click())
      await act(async () => container.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
      expect(openProject).toHaveBeenCalledOnce()
      await act(async () => trigger.click())
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      expect(items.at(-1)?.textContent).toBe('Beenden')
      await act(async () => items.at(-1)!.click())
      expect(exit).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
