import { createPortal } from 'react-dom'
import { useModalFocus } from '../shared/useModalFocus'
import './ExitDialog.css'

export type ExitChoice = 'save' | 'discard' | 'cancel'

export function ExitDialog({
  onChoose,
  title = 'Ungespeicherte Änderungen',
  description = 'Soll das aktuelle Projekt vor dem Beenden gespeichert werden?',
  discardLabel = 'Beenden ohne Speichern',
}: {
  onChoose: (choice: ExitChoice) => void
  title?: string
  description?: string
  discardLabel?: string
}) {
  const { dialogRef, onKeyDown } = useModalFocus<HTMLDivElement>(() => onChoose('cancel'), {
    initialFocus: '[data-cancel]',
  })

  return createPortal(
    <div className="exit-backdrop">
      <div className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"
        aria-describedby="exit-description" ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id="exit-title">{title}</h2>
        <p id="exit-description">{description}</p>
        <div className="exit-actions">
          <button type="button" className="route-editor-action delete" onClick={() => onChoose('discard')}>{discardLabel}</button>
          <button type="button" className="route-editor-action cancel" data-cancel onClick={() => onChoose('cancel')}>Abbrechen</button>
          <button type="button" className="route-editor-action save" onClick={() => onChoose('save')}>Speichern</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
