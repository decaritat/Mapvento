import type { RefObject } from 'react'
import { ExternalLink } from '../shared/ExternalLink'
import { ROUTING_PROVIDER, routingProfileLabel } from '../../domain/routing'
import { DISTANCE_MARKER_MIN_STEP_KM, DISTANCE_MARKER_MAX_STEP_KM, isValidDistanceMarkerStepKm } from '../../domain/routeMetrics'
import type { Route, RouteType } from '../../domain/routeModel'
import { distanceInKm, distanceInUnit, type Units } from '../../domain/settings'

const routeColors = [
  '#7ee787',
  '#ffb86c',
  '#72b7ff',
  '#d6a8ff',
  '#ff7b72',
  '#f2cc60',
  '#00c2a8',
  '#a855f7',
]
function getCustomRouteColor(route: Route) {
  if (route.customColor) return route.customColor
  if (route.color && !routeColors.includes(route.color)) return route.color
  return undefined
}

export function RouteEditor({ route, routeEditorRef, top, left, updateRouteDraft, saveRouteProperties, close, units }: {
  units: Units
  route: Route
  routeEditorRef: RefObject<HTMLElement | null>
  top: number
  left: number
  updateRouteDraft: (patch: Partial<Route>) => void
  saveRouteProperties: () => void
  close: () => void
}) {
    const customColor = getCustomRouteColor(route)
    const showDistanceMarkers = Boolean(route.showDistanceMarkers)
    const distanceMarkerMode = route.distanceMarkerMode === 'manual' ? 'manual' : 'auto'
    const manualDistanceMarkerInvalid =
      showDistanceMarkers &&
      distanceMarkerMode === 'manual' &&
      !isValidDistanceMarkerStepKm(route.distanceMarkerStepKm)
    const manualDistanceMarkerStep =
      typeof route.distanceMarkerStepKm === 'number' &&
      Number.isFinite(route.distanceMarkerStepKm)
        ? route.distanceMarkerStepKm
        : 1

    return (
      <section
        ref={routeEditorRef}
        className="route-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Eigenschaften von ${route.name}`}
        style={{ top: top, left: left }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
      >
        <div className="route-editor-heading">
          <span className="eyebrow">Routeneigenschaften</span>
          {!route.editable && (
            <span className="lock-badge" title="Diese Route ist schreibgeschützt">
              READ-ONLY
            </span>
          )}
        </div>
        <input
          className="sidebar-route-input"
          value={route.name}
          onChange={(event) => updateRouteDraft({ name: event.target.value })}
          disabled={!route.editable}
          aria-label="Routenname"
        />
        <textarea
          className="sidebar-route-description"
          value={route.description}
          onChange={(event) =>
            updateRouteDraft({ description: event.target.value.slice(0, 180) })
          }
          disabled={!route.editable}
          aria-label="Routenbeschreibung"
          placeholder="Routenbeschreibung"
          maxLength={180}
          rows={3}
        />
        <span className="route-description-length">{route.description.length}/180 Zeichen</span>
        {route.editable ? (
          <div className="route-editor-section">
            <div className="route-editor-section-header">
              <label className="route-editor-section-label" htmlFor={`route-type-${route.id}`}>
                Routentyp
              </label>
              <ExternalLink
                url={ROUTING_PROVIDER.attributionUrl}
                className="route-editor-provider-link"
                title={`Routing über ${ROUTING_PROVIDER.label} (${routingProfileLabel(route.type)})`}
              >
                via {ROUTING_PROVIDER.label}
              </ExternalLink>
            </div>
            <select
              id={`route-type-${route.id}`}
              value={route.type}
              onChange={(event) => updateRouteDraft({ type: event.target.value as RouteType })}
              aria-label="Routentyp"
            >
              <option value="hiking">Wandern</option>
              <option value="cycling">Radfahren</option>
            </select>
          </div>
        ) : route.gpxType ? (
          <div className="route-editor-section">
            <label className="route-editor-section-label" htmlFor={`route-type-${route.id}`}>
              Routentyp
            </label>
            <input
              id={`route-type-${route.id}`}
              className="sidebar-route-input"
              value={route.gpxType}
              readOnly
              aria-label="Routentyp (schreibgeschützt)"
            />
          </div>
        ) : null}
        <div className="route-editor-section route-color-section">
          <span className="route-editor-section-label">Routenfarbe</span>
          <div className="route-color-controls">
            <div className="color-swatches" aria-label="Schnellwahl Routenfarbe">
              {routeColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${route.color === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  title={`Farbe ${color}`}
                  onClick={() => updateRouteDraft({ color, customColor })}
                />
              ))}
            </div>
            <label className="sidebar-color-picker" title="Eigene Routenfarbe">
              <input
                type="color"
                value={customColor ?? '#000000'}
                onChange={(event) =>
                  updateRouteDraft({
                    color: event.target.value,
                    customColor: event.target.value,
                  })
                }
                aria-label="Eigene Routenfarbe"
              />
              <span>Eigene Farbe</span>
            </label>
          </div>
        </div>
        <fieldset className="distance-marker-settings">
          <legend className="distance-marker-heading">
            <label className="distance-marker-toggle">
              <input
                type="checkbox"
                checked={showDistanceMarkers}
                onChange={(event) =>
                  updateRouteDraft({ showDistanceMarkers: event.target.checked })
                }
              />
              <span className="distance-marker-switch" aria-hidden="true" />
              <span>Abstandsmarker</span>
            </label>
            <span
              className="distance-marker-info"
              role="img"
              aria-label="Informationen zu Abstandsmarkern"
              title="Zeigt Entfernungsangaben entlang der Route an."
            >
              i
            </span>
          </legend>
          <div className={`distance-marker-options ${showDistanceMarkers ? '' : 'disabled'}`}>
            <label className="distance-marker-option">
              <input
                type="radio"
                name={`distance-marker-mode-${route.id}`}
                value="auto"
                checked={distanceMarkerMode === 'auto'}
                onChange={() => updateRouteDraft({ distanceMarkerMode: 'auto' })}
                disabled={!showDistanceMarkers}
              />
              <span>Anpassung an den Kartenmaßstab</span>
            </label>
            <label className="distance-marker-option">
              <input
                type="radio"
                name={`distance-marker-mode-${route.id}`}
                value="manual"
                checked={distanceMarkerMode === 'manual'}
                onChange={() =>
                  updateRouteDraft({
                    distanceMarkerMode: 'manual',
                    distanceMarkerStepKm: isValidDistanceMarkerStepKm(route.distanceMarkerStepKm)
                      ? route.distanceMarkerStepKm
                      : 1,
                  })
                }
                disabled={!showDistanceMarkers}
              />
              <span>Anzeigen in Schritten von</span>
              <input
                className="distance-marker-step-input"
                type="number"
                min={distanceInUnit(DISTANCE_MARKER_MIN_STEP_KM, units.distance)}
                max={distanceInUnit(DISTANCE_MARKER_MAX_STEP_KM, units.distance)}
                step="any"
                value={Number(distanceInUnit(manualDistanceMarkerStep, units.distance).toFixed(6))}
                onChange={(event) =>
                  updateRouteDraft({
                    distanceMarkerStepKm:
                      event.target.value === '' ? undefined : distanceInKm(Number(event.target.value), units.distance),
                  })
                }
                disabled={!showDistanceMarkers || distanceMarkerMode !== 'manual'}
                aria-invalid={manualDistanceMarkerInvalid}
                aria-label={`Manuelle Schrittweite in ${units.distance === 'km' ? 'Kilometern' : 'Meilen'}`}
              />
              <span>{units.distance}</span>
            </label>
            {manualDistanceMarkerInvalid && (
              <span className="field-error" role="alert">
                Wert zwischen {distanceInUnit(DISTANCE_MARKER_MIN_STEP_KM, units.distance).toFixed(units.distance === 'km' ? 1 : 6)} und {distanceInUnit(DISTANCE_MARKER_MAX_STEP_KM, units.distance).toFixed(units.distance === 'km' ? 0 : 6)} {units.distance}
                eingeben.
              </span>
            )}
          </div>
        </fieldset>
        <div className="route-editor-actions">
          <button
            className="route-editor-action save"
            type="button"
            onClick={saveRouteProperties}
            aria-label="Routeneigenschaften übernehmen"
            title="Übernehmen"
          >
            ✓ Übernehmen
          </button>
          <button
            className="route-editor-action cancel"
            type="button"
            onClick={() => close()}
            aria-label="Routeneigenschaften verwerfen und schließen"
            title="Abbrechen"
          >
            × Abbrechen
          </button>
        </div>
      </section>
    )
  }
