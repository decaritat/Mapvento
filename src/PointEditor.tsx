import type { Dispatch, SetStateAction } from 'react'
import { getPoiIcon, POI_ICON_CATEGORIES, poiIconSvg, type PoiIconId } from './poiIcons'
import type { MapPoint } from './routeModel'

export function PointEditor({
  point, isNew, top, left, poiIconPickerOpen, setPoiIconPickerOpen, updatePointDraft,
  confirmDeletePoint, savePointProperties, close,
}: {
  point: MapPoint
  isNew: boolean
  top: number
  left: number
  poiIconPickerOpen: boolean
  setPoiIconPickerOpen: Dispatch<SetStateAction<boolean>>
  updatePointDraft: (patch: Partial<MapPoint>) => void
  confirmDeletePoint: () => void
  savePointProperties: () => void
  close: () => void
}) {
    const selectedIcon = getPoiIcon(point.icon)
    const isReadOnly = point.editable === false

    return (
      <section
        className="route-editor poi-editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          isNew
            ? 'Neuen POI anlegen'
            : isReadOnly
              ? `POI ${point.name} anzeigen`
              : `POI ${point.name} bearbeiten`
        }
        style={{ top: top, left: left }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (poiIconPickerOpen) {
            event.stopPropagation()
            setPoiIconPickerOpen(false)
          } else close()
        }}
      >
        <div className="route-editor-heading">
          <span className="eyebrow">{isNew ? 'POI anlegen' : 'POI-Eigenschaften'}</span>
          {isReadOnly && <span className="lock-badge">READ-ONLY</span>}
          <span
            className="poi-editor-selected-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: poiIconSvg(selectedIcon) }}
          />
        </div>
        <div className={`poi-icon-picker ${poiIconPickerOpen ? 'open' : ''}`}>
          <button
            className="poi-icon-picker-toggle"
            type="button"
            aria-expanded={poiIconPickerOpen}
            aria-controls={`poi-icon-picker-options-${point.id}`}
            disabled={isReadOnly}
            onClick={() => setPoiIconPickerOpen((open) => !open)}
          >
            <span className="route-editor-section-label">Symbol</span>
            <span className="poi-icon-picker-current">
              <span
                className="poi-icon-picker-current-graphic"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: poiIconSvg(selectedIcon) }}
              />
              <span>{selectedIcon.label}</span>
            </span>
            <span className="poi-icon-picker-chevron" aria-hidden="true">
              {poiIconPickerOpen ? '▴' : '▾'}
            </span>
          </button>
          {poiIconPickerOpen && (
            <div className="poi-icon-picker-options" id={`poi-icon-picker-options-${point.id}`}>
              {POI_ICON_CATEGORIES.map((category) => (
                <fieldset className="poi-icon-category" key={category.id}>
                  <legend>{category.label}</legend>
                  <div className="poi-icon-options">
                    {category.icons.map((icon) => (
                      <button
                        className={`poi-icon-option ${point.icon === icon.id ? 'selected' : ''}`}
                        key={icon.id}
                        type="button"
                        disabled={isReadOnly}
                        aria-label={icon.label}
                        aria-pressed={point.icon === icon.id}
                        onClick={() => {
                          updatePointDraft({ icon: icon.id as PoiIconId })
                          setPoiIconPickerOpen(false)
                        }}
                      >
                        <span
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: poiIconSvg(icon) }}
                        />
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </div>
        <input
          className="sidebar-route-input"
          value={point.name}
          onChange={(event) => updatePointDraft({ name: event.target.value })}
          disabled={isReadOnly}
          aria-label="POI-Titel"
          placeholder="POI-Titel"
        />
        <textarea
          className="sidebar-route-description"
          value={point.description}
          onChange={(event) =>
            updatePointDraft({ description: event.target.value.slice(0, 180) })
          }
          disabled={isReadOnly}
          aria-label="POI-Beschreibung"
          placeholder="POI-Beschreibung"
          maxLength={180}
          rows={3}
        />
        <span className="route-description-length">{point.description.length}/180 Zeichen</span>
        <div className="route-editor-actions">
          {!isNew && !isReadOnly && (
            <button
              className="route-editor-action delete"
              type="button"
              onClick={confirmDeletePoint}
              aria-label="POI löschen"
              title="POI löschen"
            >
              × Löschen
            </button>
          )}
          {!isReadOnly && (
            <button
              className="route-editor-action save"
              type="button"
              onClick={savePointProperties}
              aria-label="POI-Eigenschaften übernehmen"
              title="Übernehmen"
            >
              ✓ Übernehmen
            </button>
          )}
          <button
            className="route-editor-action cancel"
            type="button"
            onClick={() => close()}
            aria-label={isReadOnly ? 'POI-Ansicht schließen' : 'POI-Eigenschaften verwerfen und schließen'}
            title={isReadOnly ? 'Schließen' : 'Abbrechen'}
          >
            {isReadOnly ? 'Schließen' : '× Abbrechen'}
          </button>
        </div>
      </section>
    )
  }
