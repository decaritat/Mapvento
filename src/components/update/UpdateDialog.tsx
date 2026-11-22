import { createPortal } from 'react-dom'
import { useModalFocus } from '../shared/useModalFocus'
import { LATEST_RELEASE_URL } from '../../features/update-check/updateCheck'
import { openExternalUrl } from '../../integrations/desktop/externalUrl'
import './UpdateDialog.css'

export function UpdateDialog({
  currentVersion,
  availableVersion,
  onClose,
}: {
  currentVersion: string
  availableVersion: string
  onClose: () => void
}) {
  const { dialogRef, onKeyDown } = useModalFocus<HTMLDivElement>(onClose)

  return createPortal(
    <div className="update-backdrop">
      <div
        ref={dialogRef}
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id="update-title">Software-Update</h2>
        <p>Eine neue Version von Mapvento ist verfügbar.</p>
        <div className="version-info">
          <span>Gestartete Version</span>
          <span>{currentVersion}</span>

          <span>Verfügbare Version</span>
          <span>{availableVersion}</span>
        </div>
        <footer>
          <button type="button" onClick={onClose}>Schließen</button>
          <button type="button" className="update-download" onClick={() => { void openExternalUrl(LATEST_RELEASE_URL) }}>Zum Download</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
