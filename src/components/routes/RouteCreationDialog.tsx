import { useModalFocus } from '../shared/useModalFocus'

export function RouteCreationDialog({ mode, onModeChange, onClose, onConfirm }: {
  mode: 'new' | 'gpx'
  onModeChange: (mode: 'new' | 'gpx') => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { dialogRef, onKeyDown } = useModalFocus<HTMLElement>(onClose, { initialFocus: 'input:checked' })
  return (
    <section
      ref={dialogRef}
      className="route-creation-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-creation-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="route-editor-heading">
        <span className="eyebrow" id="route-creation-title">
          Was möchtest du tun?
        </span>
      </div>
      <fieldset className="route-creation-options">
        <label className="route-creation-option">
          <input
            type="radio"
            name="route-creation-mode"
            value="new"
            checked={mode === 'new'}
            onChange={() => onModeChange('new')}
          />
          <span>Neue Route erstellen</span>
        </label>
        <label className="route-creation-option">
          <input
            type="radio"
            name="route-creation-mode"
            value="gpx"
            checked={mode === 'gpx'}
            onChange={() => onModeChange('gpx')}
          />
          <span>GPX-Datei importieren</span>
        </label>
      </fieldset>
      <div className="route-editor-actions">
        <button className="route-editor-action cancel" type="button" onClick={onClose}>
          Abbrechen
        </button>
        <button className="route-editor-action save" type="button" onClick={onConfirm}>
          Weiter
        </button>
      </div>
    </section>
  )
}
