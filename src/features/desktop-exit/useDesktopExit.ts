import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ExitChoice } from '../../components/exit/ExitDialog'
import type { ProjectFile } from '../../domain/routeModel'

type Props = {
  getProjectToSave: () => { projectToSave: ProjectFile; isCurrent: () => boolean }
  confirmBeforeExit: (
    projectToSave: ProjectFile,
    isCurrent: () => boolean,
    ask: () => Promise<ExitChoice>,
  ) => Promise<boolean>
  reportProblem: (message: string) => void
}

export function useDesktopExit({ getProjectToSave, confirmBeforeExit, reportProblem }: Props) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false)
  const exitChoiceRef = useRef<((choice: ExitChoice) => void) | null>(null)
  const exitInProgress = useRef(false)
  const exitAppRef = useRef<() => Promise<void>>(async () => {})

  const chooseExit = useCallback((choice: ExitChoice) => {
    const resolve = exitChoiceRef.current
    exitChoiceRef.current = null
    setExitDialogOpen(false)
    resolve?.(choice)
  }, [])

  useEffect(() => () => {
    exitChoiceRef.current?.('cancel')
    exitChoiceRef.current = null
  }, [])

  const exitApp = useCallback(async () => {
    if (exitInProgress.current) return
    exitInProgress.current = true
    try {
      const { projectToSave, isCurrent } = getProjectToSave()
      if (await confirmBeforeExit(projectToSave, isCurrent, () => new Promise<ExitChoice>((resolve) => {
        exitChoiceRef.current = resolve
        setExitDialogOpen(true)
      }))) await invoke('exit_app')
    } catch (error) {
      reportProblem(`Beenden fehlgeschlagen: ${String(error)}. Bitte erneut versuchen oder das Fenster schließen.`)
    } finally {
      exitInProgress.current = false
    }
  }, [confirmBeforeExit, getProjectToSave, reportProblem])

  useLayoutEffect(() => {
    exitAppRef.current = exitApp
  }, [exitApp])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      void exitAppRef.current()
    }).then((stopListening) => {
      if (disposed) stopListening()
      else unlisten = stopListening
    }).catch((error: unknown) => {
      if (!disposed) reportProblem(`Fensterschließen konnte nicht überwacht werden: ${String(error)}. Bitte Änderungen vor dem Schließen speichern.`)
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [reportProblem])

  return { exitDialogOpen, chooseExit, exitApp }
}
