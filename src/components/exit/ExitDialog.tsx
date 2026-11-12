import { useEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './ExitDialog.css'

export type ExitChoice = 'save' | 'discard' | 'cancel'

export function ExitDialog({ onChoose }: { onChoose: (choice: ExitChoice) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    return () => {
      if (previous instanceof HTMLElement) setTimeout(() => previous.focus(), 0)
    }
  }, [])

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onChoose('cancel')
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return createPortal(
    <div className="exit-backdrop">
      <div className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"
        aria-describedby="exit-description" ref={dialogRef} onKeyDown={handleKeys}>
        <h2 id="exit-title">Ungespeicherte Änderungen</h2>
        <p id="exit-description">Soll das aktuelle Projekt vor dem Beenden gespeichert werden?</p>
        <div className="exit-actions">
          <button type="button" className="route-editor-action save" onClick={() => onChoose('save')}>Speichern</button>
          <button type="button" className="route-editor-action" onClick={() => onChoose('discard')}>Beenden ohne Speichern</button>
          <button type="button" className="route-editor-action cancel" data-cancel onClick={() => onChoose('cancel')}>Abbrechen</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
