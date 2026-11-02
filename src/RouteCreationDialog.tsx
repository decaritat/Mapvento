import type { RefObject } from 'react'

export function RouteCreationDialog({ mode, inputRef, onModeChange, onClose, onConfirm }: {
  mode: 'new' | 'gpx'
  inputRef: RefObject<HTMLInputElement | null>
  onModeChange: (mode: 'new' | 'gpx') => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <section
      className="route-creation-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-creation-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="route-editor-heading">
        <span className="eyebrow" id="route-creation-title">
          Was möchtest du tun?
        </span>
      </div>
      <fieldset className="route-creation-options">
        <label className="route-creation-option">
          <input
            ref={inputRef}
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
