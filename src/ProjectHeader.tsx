import { useEffect, useRef, useState, type RefObject } from 'react'

export function ProjectHeader({ projectInput, openProject, saveProject, importProject, openCache, openAbout, exitApp, desktop }: {
  projectInput: RefObject<HTMLInputElement | null>
  openProject: () => void
  saveProject: () => void
  importProject: (file: File) => void
  openCache: () => void
  openAbout: () => void
  exitApp: () => void
  desktop: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const items = [
    { label: 'Projekt öffnen', action: openProject, available: true },
    { label: 'Projekt speichern', action: saveProject, available: true },
    { label: 'Einstellungen', action: () => {}, available: false },
    { label: 'Cache verwalten', action: openCache, available: true },
    { label: 'Info', action: openAbout, available: true },
    ...(desktop ? [{ label: 'Beenden', action: exitApp, available: true }] : []),
  ]

  function closeMenu() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" />
        <div>
          <strong>Trailforge</strong>
          <span>Open route planner</span>
        </div>
      </div>
      <div className="topbar-actions" ref={rootRef}>
        <button ref={buttonRef} type="button" className="header-menu-toggle icon-button"
          aria-label="Hauptmenü" aria-haspopup="menu" aria-expanded={open}
          aria-controls="header-menu" onClick={() => open ? closeMenu() : setOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {open && (
          <div id="header-menu" ref={menuRef} className="header-menu" role="menu" aria-label="Hauptmenü"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                closeMenu()
              } else if (event.key === 'Tab') {
                closeMenu()
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                buttons[next]?.focus()
              }
            }}>
            {items.map((item) => (
              <button key={item.label} type="button" role="menuitem" disabled={!item.available}
                onClick={() => { closeMenu(); item.action() }}>
                {item.label}
              </button>
            ))}
          </div>
        )}
        <input
          ref={projectInput}
          className="hidden-input"
          type="file"
          accept=".json,.trailforge.json"
          onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])}
        />
      </div>
    </header>
  )
}
