import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { initialProject } from '../src/project'

describe('project loading in the app', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('recovers from invalid storage and reports a rejected file without replacing the project', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const invalid = JSON.stringify({ ...initialProject, routes: ['broken'] })
    localStorage.setItem('trailforge-project', invalid)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<App />))
      const title = container.querySelector<HTMLInputElement>('[aria-label="Projektname"]')
      expect(title?.value).toBe(initialProject.name)

      const input = container.querySelector<HTMLInputElement>('input[accept=".json,.trailforge.json"]')
      expect(input).not.toBeNull()
      Object.defineProperty(input!, 'files', {
        configurable: true,
        value: [{ text: async () => invalid }],
      })
      await act(async () => input!.dispatchEvent(new Event('change', { bubbles: true })))

      expect(container.textContent).toContain('Die Projektdatei konnte nicht gelesen werden.')
      expect(title?.value).toBe(initialProject.name)
      expect(localStorage.getItem('trailforge-project')).toBe(invalid)

      const valid = { ...initialProject, name: 'Geöffnetes Projekt', mapLayerId: 'opentopomap' }
      Object.defineProperty(input!, 'files', {
        configurable: true,
        value: [{ text: async () => JSON.stringify(valid) }],
      })
      await act(async () => input!.dispatchEvent(new Event('change', { bubbles: true })))
      expect(title?.value).toBe(valid.name)
      expect(container.textContent).toContain('Projekt geöffnet.')
      expect(JSON.parse(localStorage.getItem('trailforge-project')!)).toEqual(valid)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
