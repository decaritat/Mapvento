import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from './ExternalLink'
import { getAppVersion } from './appVersion'
import { ALL_PROVIDER_ATTRIBUTIONS } from './providers'
import './AboutDialog.css'

const REPOSITORY_URL = 'https://github.com/decaritat/Mapvento'

type Ecosystem = 'npm' | 'rust'

type ThirdPartyComponent = {
  ecosystem: Ecosystem
  name: string
  version: string
  license: string
  repository: string
  textId: string
}

type ThirdPartyData = {
  rustIncluded: boolean
  components: ThirdPartyComponent[]
  texts: Record<string, string>
}

type ThirdPartyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ThirdPartyData }

const projectLinks = [
  { label: 'GitHub-Projekt', url: REPOSITORY_URL },
  { label: 'Dokumentation', url: `${REPOSITORY_URL}#readme` },
  { label: 'Changelog', url: `${REPOSITORY_URL}/blob/main/Changelog.md` },
  { label: 'Lizenz (GPL-3.0-or-later)', url: `${REPOSITORY_URL}/blob/main/LICENSE` },
]

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ThirdPartyState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [ecosystem, setEcosystem] = useState<'all' | Ecosystem>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch((error) => {
        console.error('Version konnte nicht gelesen werden', error)
        setVersion('unbekannt')
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    import('./generated/third-party.json')
      .then((module) => {
        if (!cancelled) setState({ status: 'ready', data: module.default as ThirdPartyData })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const reason = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', message: `Drittkomponenten konnten nicht geladen werden: ${reason}` })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) setTimeout(() => previous.focus(), 0)
    }
  }, [])

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    return state.data.components.filter(
      (component) =>
        (ecosystem === 'all' || component.ecosystem === ecosystem) &&
        (!needle ||
          component.name.toLowerCase().includes(needle) ||
          component.license.toLowerCase().includes(needle)),
    )
  }, [ecosystem, query, state])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, summary, [tabindex="0"]',
    )
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="about-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="about-header">
          <img className="about-logo" src="/favicon.svg" alt="" />
          <div>
            <h2 id="about-title">Mapvento</h2>
            <span className="about-version">Version {version}</span>
            <p>Open-Source-Routenplaner für Wander- und Radtouren</p>
          </div>
          <button className="icon-button about-close" type="button" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </header>

        <div className="about-body">
          <section aria-labelledby="about-links">
            <h3 id="about-links">Projekt</h3>
            <ul className="about-link-list">
              {projectLinks.map((link) => (
                <li key={link.url}>
                  <ExternalLink url={link.url}>{link.label}</ExternalLink>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="about-data">
            <h3 id="about-data">Daten und Dienste</h3>
            <ul className="about-attributions">
              {ALL_PROVIDER_ATTRIBUTIONS.map((item) => (
                <li key={item.name}>
                  <ExternalLink url={item.url}>{item.name}</ExternalLink>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="about-third-party">
            <h3 id="about-third-party">Drittkomponenten und Lizenzen</h3>
            {state.status === 'loading' && <p className="about-hint">Wird geladen …</p>}
            {state.status === 'error' && (
              <p className="about-hint about-error" role="alert">
                {state.message}
              </p>
            )}
            {state.status === 'ready' && (
              <>
                {!state.data.rustIncluded && (
                  <p className="about-hint about-error" role="alert">
                    Die Rust-Komponenten fehlen in diesem Build (cargo-about war nicht verfügbar).
                    Vollständige Hinweise: THIRD-PARTY-NOTICES.md.
                  </p>
                )}
                <div className="about-filters">
                  <input
                    type="search"
                    value={query}
                    placeholder="Name oder Lizenz filtern"
                    aria-label="Drittkomponenten filtern"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <select
                    value={ecosystem}
                    aria-label="Ökosystem"
                    onChange={(event) => setEcosystem(event.target.value as 'all' | Ecosystem)}
                  >
                    <option value="all">Alle</option>
                    <option value="npm">npm (Oberfläche)</option>
                    <option value="rust">Rust (Desktop)</option>
                  </select>
                  <span className="about-count" aria-live="polite">
                    {filtered.length} von {state.data.components.length}
                  </span>
                </div>
                <ul className="about-components">
                  {filtered.map((component) => {
                    const key = `${component.ecosystem}:${component.name}@${component.version}`
                    const open = expanded === key
                    return (
                      <li key={key}>
                        <div className="about-component-row">
                          <button
                            type="button"
                            className="about-component-toggle"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : key)}
                          >
                            <strong>{component.name}</strong>
                            <span>{component.version}</span>
                            <em>{component.license}</em>
                          </button>
                          {component.repository && (
                            <ExternalLink url={component.repository}>Quelle</ExternalLink>
                          )}
                        </div>
                        {open && <pre className="about-license-text">{state.data.texts[component.textId]}</pre>}
                      </li>
                    )
                  })}
                  {!filtered.length && <li className="about-hint">Keine Treffer.</li>}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
