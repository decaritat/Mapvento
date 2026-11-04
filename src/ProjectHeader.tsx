import { useEffect, useRef, useState, type RefObject } from 'react'
import { ExternalLink } from './ExternalLink'
import { openExternalUrl } from './externalUrl'
import { layers } from './mapLayers'

function LayerDropdown({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: Array<{ id: string; label: string; provider?: string; attributionUrl?: string }>
  disabled?: boolean
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.id === value) ?? options[0]
  const menuOpen = open && !disabled

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  function move(offset: number) {
    const index = options.findIndex((option) => option.id === selected.id)
    const next = options[Math.min(options.length - 1, Math.max(0, index + offset))]
    if (next) onChange(next.id)
  }

  return (
    <div
      className="dropdown"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
        else if (event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-labelledby="layer-select-label"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {selected.label}
      </button>
      {menuOpen && (
        <ul className="dropdown-menu" role="listbox" aria-labelledby="layer-select-label">
          {options.map((option) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === selected.id}
              className={option.id === selected.id ? 'selected' : undefined}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.attributionUrl && (
                <span
                  className="dropdown-item-attribution"
                  role="button"
                  tabIndex={0}
                  title={`Attribution & Lizenz für ${option.label} (${option.provider ?? option.label}) öffnen`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openExternalUrl(option.attributionUrl!)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      e.preventDefault()
                      openExternalUrl(option.attributionUrl!)
                    }
                  }}
                >
                  ©
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}


export function ProjectHeader({ layerId, routePropertiesOpen, setNotice, changeLayer, projectInput, saveProject, importProject, openAbout }: {
  layerId: string
  routePropertiesOpen: boolean
  setNotice: (notice: string) => void
  changeLayer: (layerId: string) => void
  projectInput: RefObject<HTMLInputElement | null>
  saveProject: () => void
  importProject: (file: File) => void
  openAbout: () => void
}) {
  return (
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div>
            <strong>Trailforge</strong>
            <span>Open route planner</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="layer-select">
            <span id="layer-select-label">Kartenlayer</span>
            <LayerDropdown
              value={layerId}
              disabled={routePropertiesOpen}
              options={layers.map((layer) => ({
                id: layer.id,
                label: `${layer.label}${layer.requiresKey ? ' · API-Key' : ''}`,
                provider: layer.provider,
                attributionUrl: layer.attributionUrl,
              }))}
              onChange={(nextLayerId) => {
                const nextLayer = layers.find((layer) => layer.id === nextLayerId)
                if (nextLayer?.requiresKey) {
                  setNotice('Tracestrack benötigt einen API-Key. OSM Carto bleibt aktiv.')
                  return
                }
                changeLayer(nextLayerId)
              }}
            />
            {(() => {
              const activeLayerDef = layers.find((layer) => layer.id === layerId) ?? layers[0]
              return (
                <ExternalLink
                  url={activeLayerDef.attributionUrl}
                  className="layer-attribution-badge"
                  title={`Attribution & Lizenz für ${activeLayerDef.label} (${activeLayerDef.provider}) öffnen`}
                >
                  © {activeLayerDef.provider}
                </ExternalLink>
              )
            })()}
          </div>
          <button className="ghost-button" onClick={() => projectInput.current?.click()}>
            Projekt öffnen
          </button>
          <button className="solid-button" onClick={saveProject}>
            Projekt speichern
          </button>
          <button className="ghost-button" onClick={openAbout}>
            Info
          </button>
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
