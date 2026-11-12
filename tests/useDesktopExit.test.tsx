import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  active: false,
  invoke: vi.fn(),
  onCloseRequested: vi.fn(),
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: desktop.invoke,
  isTauri: () => desktop.active,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: desktop.onCloseRequested }),
}))

import { useDesktopExit } from '../src/features/desktop-exit/useDesktopExit'
import { initialProject } from '../src/domain/project'

function Harness({ confirmBeforeExit }: {
  confirmBeforeExit: Parameters<typeof useDesktopExit>[0]['confirmBeforeExit']
}) {
  const { exitDialogOpen, chooseExit, exitApp } = useDesktopExit({
    getProjectToSave: () => ({ projectToSave: initialProject, isCurrent: () => true }),
    confirmBeforeExit,
    setNotice: vi.fn(),
  })
  return (
    <>
      <button onClick={() => void exitApp()}>Exit</button>
      {exitDialogOpen && <button onClick={() => chooseExit('cancel')}>Cancel</button>}
    </>
  )
}

describe('useDesktopExit', () => {
  afterEach(() => {
    desktop.active = false
    desktop.invoke.mockReset()
    desktop.onCloseRequested.mockReset()
    desktop.unlisten.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not register a desktop close listener in the browser', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const rootElement = document.createElement('div')
    const root = createRoot(rootElement)
    try {
      await act(async () => root.render(<Harness confirmBeforeExit={vi.fn()} />))
      expect(desktop.onCloseRequested).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      rootElement.remove()
    }
  })

  it('prevents native close until the exit workflow succeeds and removes the listener', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    desktop.active = true
    desktop.onCloseRequested.mockResolvedValue(desktop.unlisten)
    const confirmBeforeExit = vi.fn().mockResolvedValue(true)
    const rootElement = document.createElement('div')
    const root = createRoot(rootElement)
    try {
      await act(async () => root.render(<Harness confirmBeforeExit={confirmBeforeExit} />))
      expect(desktop.onCloseRequested).toHaveBeenCalledOnce()
      const closeHandler = desktop.onCloseRequested.mock.calls[0][0]
      const preventDefault = vi.fn()
      await act(async () => closeHandler({ preventDefault }))
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(confirmBeforeExit).toHaveBeenCalledWith(
        initialProject,
        expect.any(Function),
        expect.any(Function),
      )
      expect(desktop.invoke).toHaveBeenCalledWith('exit_app')
    } finally {
      await act(async () => root.unmount())
      expect(desktop.unlisten).toHaveBeenCalledOnce()
      rootElement.remove()
    }
  })
})
