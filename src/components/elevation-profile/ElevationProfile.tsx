import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { formatDistanceAxis, formatRouteMetrics, getDistanceScale, getElevationScale, profileDetailsAtFraction, profileDetailsAtIndex, routeMetrics, type ElevationScale } from '../../domain/routeMetrics'
import type { ProfilePointDetails, Route } from '../../domain/routeModel'
import { distanceInUnit, durationInUnit, elevationInUnit, type Units } from '../../domain/settings'

const profileViewBox = { width: 560, height: 190, plotLeft: 42, plotRight: 10, plotTop: 12, plotBottom: 34 }

function profileFractionFromPointer(clientX: number, bounds: DOMRect) {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.width) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null
  }
  const viewBoxX = ((clientX - bounds.left) / bounds.width) * profileViewBox.width
  const plotWidth = profileViewBox.width - profileViewBox.plotLeft - profileViewBox.plotRight
  if (viewBoxX < profileViewBox.plotLeft || viewBoxX > profileViewBox.width - profileViewBox.plotRight) {
    return null
  }
  return Math.min(1, Math.max(0, (viewBoxX - profileViewBox.plotLeft) / Math.max(1, plotWidth)))
}

function buildElevationPath(
  elevations: number[],
  distances: number[],
  distanceMax: number,
  scale: ElevationScale,
  width: number,
  height: number,
  plotLeft: number,
  plotRight: number,
  plotTop: number,
  plotBottom: number,
) {
  const plotWidth = Math.max(1, width - plotLeft - plotRight)
  const plotHeight = Math.max(1, height - plotTop - plotBottom)
  const baseline = height - plotBottom
  if (!elevations.length) return `M ${plotLeft} ${baseline} L ${width - plotRight} ${baseline}`
  const line = elevations
    .map((elevation, index) => {
      const distance = distances[index] ?? (index / Math.max(1, elevations.length - 1)) * distanceMax
      const x = plotLeft + (distance / distanceMax) * plotWidth
      const y = plotTop + ((scale.max - elevation) / Math.max(1, scale.max - scale.min)) * plotHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return `${line} L ${width - plotRight} ${baseline} L ${plotLeft} ${baseline} Z`
}

function elevationProfileY(
  elevation: number,
  elevations: number[],
  scale: ElevationScale,
  height: number,
  plotTop: number,
  plotBottom: number,
) {
  if (!elevations.length) return height - plotBottom
  const clampedElevation = Math.min(scale.max, Math.max(scale.min, elevation))
  const plotHeight = Math.max(1, height - plotTop - plotBottom)
  return plotTop + ((scale.max - clampedElevation) / Math.max(1, scale.max - scale.min)) * plotHeight
}


export function ElevationProfile({ activeRoute, profilePointDetails, setHoveredProfilePoint, clearProfileSelection,
  elevationExpanded, setElevationExpanded, units }: {
  units: Units
  activeRoute: Route | undefined
  profilePointDetails: ProfilePointDetails | null
  setHoveredProfilePoint: Dispatch<SetStateAction<ProfilePointDetails | null>>
  clearProfileSelection: () => void
  elevationExpanded: boolean
  setElevationExpanded: Dispatch<SetStateAction<boolean>>
}) {
  const [selection, setSelection] = useState<{ route: Route; index: number } | null>(null)
  const [helpDismissed, setHelpDismissed] = useState(false)
  const activeMetrics = useMemo(() => activeRoute ? routeMetrics(activeRoute) : null, [activeRoute])
  const display = formatRouteMetrics(activeMetrics, units)
  const durationTitle = !activeMetrics?.hasRoute ? 'Dauer nicht verfügbar'
    : activeMetrics.durationSource === 'timestamps' ? 'Dauer aus Zeitstempeln'
      : 'Dauer: Geschätzte Geh- bzw. Fahrzeit basierend auf Streckenlänge und Höhenmetern'
  const elevations = (activeMetrics?.elevations ?? []).map((value) => elevationInUnit(value, units.elevation))
  const distances = (activeMetrics?.distances ?? []).map((value) => distanceInUnit(value, units.distance))
  const activeElevationScale = getElevationScale(elevations)
  const activeDistanceScale = getDistanceScale(distanceInUnit(activeMetrics?.length ?? 0, units.distance))
  const canInspect = Boolean(activeRoute && activeMetrics && elevations.length >= 2 && activeMetrics.length > 0)
  const hasRecordedElevations = Boolean(
    activeRoute?.elevations?.length === elevations.length &&
    elevations.length > 0 &&
    activeRoute.elevations.every(Number.isFinite),
  )
  const selectedIndex = selection && activeRoute &&
    selection.route.id === activeRoute.id &&
    selection.route.geometry === activeRoute.geometry &&
    selection.route.nodes === activeRoute.nodes &&
    selection.route.elevations === activeRoute.elevations &&
    selection.route.timestamps === activeRoute.timestamps &&
    selection.route.type === activeRoute.type
    ? selection.index : null

  useEffect(() => {
    setHoveredProfilePoint(null)
  }, [activeRoute?.id, activeRoute?.geometry, activeRoute?.nodes, activeRoute?.elevations,
    activeRoute?.timestamps, activeRoute?.type, elevationExpanded, setHoveredProfilePoint])

  function indexForDistance(distance: number) {
    return (activeMetrics?.distances ?? []).reduce(
      (closest, value, index, values) =>
        Math.abs(value - distance) < Math.abs(values[closest] - distance) ? index : closest,
      0,
    )
  }

  function selectIndex(index: number) {
    if (!activeRoute || !activeMetrics || !canInspect) return
    const nextIndex = Math.max(0, Math.min(activeMetrics.elevations.length - 1, index))
    setSelection({ route: activeRoute, index: nextIndex })
    setHoveredProfilePoint(profileDetailsAtIndex(activeRoute, nextIndex))
  }

  const currentIndex = selectedIndex ?? (profilePointDetails ? indexForDistance(profilePointDetails.distance) : 0)
  const pointDescription = profilePointDetails
    ? `${Math.round(elevationInUnit(profilePointDetails.elevation, units.elevation))} ${units.elevation} Höhe, ${distanceInUnit(profilePointDetails.distance, units.distance).toFixed(2)} ${units.distance} ab Start, ${durationInUnit(profilePointDetails.elapsedMinutes, units.duration)} ab Start`
    : 'Keine Position ausgewählt'
  const markerFraction = profilePointDetails
    ? (profileViewBox.plotLeft + profilePointDetails.profileFraction *
      (profileViewBox.width - profileViewBox.plotLeft - profileViewBox.plotRight)) / profileViewBox.width
    : 0
  return (
          <section
            className={`inspector ${elevationExpanded ? 'expanded' : 'compact'}`}
            id="active-elevation-profile"
          >
              <button
                className="inspector-close"
                type="button"
                onClick={() => {
                  if (elevationExpanded) setSelection(null)
                  setElevationExpanded(!elevationExpanded)
                }}
                aria-expanded={elevationExpanded}
                title={elevationExpanded ? 'Höhenprofil schließen' : 'Höhenprofil ausklappen'}
                aria-label={elevationExpanded ? 'Höhenprofil schließen' : 'Höhenprofil ausklappen'}
              >
                {elevationExpanded ? '×' : (
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M 3 10 L 8 5 L 13 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            <div className="inspector-main">
              <div className="inspector-title-row">
                <div>
                  <span className="eyebrow">Aktive Route</span>
                  <strong className="inspector-route-name">{activeRoute?.name ?? 'Keine Route'}</strong>
                </div>
                {activeRoute?.routingState === 'loading' && (
                  <span className="inspector-routing-loading" role="status">
                    Route wird berechnet …
                  </span>
                )}
              </div>
              {!elevationExpanded && (
                <div className="compact-inspector-content">
                  <div className="compact-metric-grid">
                    <span title="Distanz: Gesamtlänge der aktiven Route">
                      <strong>{display.distance}</strong> {units.distance}
                    </span>
                    <span title={durationTitle}>
                      <strong>{display.duration}</strong>
                    </span>
                    <span title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                      <strong>{display.ascent}</strong> {units.elevation} Aufstieg
                    </span>
                    <span title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                      <strong>{display.descent}</strong> {units.elevation} Abstieg
                    </span>
                    <span title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                      <strong>{display.high}</strong> {units.elevation} höchster
                    </span>
                    <span title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                      <strong>{display.low}</strong> {units.elevation} niedrigster
                    </span>
                  </div>
                  <button
                    className="elevation-mini-chart-button"
                    type="button"
                    onClick={() => setElevationExpanded(true)}
                    aria-label="Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen"
                    title="Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen"
                  >
                    <svg
                      viewBox="0 0 260 52"
                      preserveAspectRatio="none"
                      className="elevation-mini-chart"
                      aria-hidden="true"
                    >
                      <path
                        d={buildElevationPath(
                          elevations,
                          distances,
                          activeDistanceScale.max,
                          activeElevationScale,
                          260,
                          52,
                          0,
                          0,
                          4,
                          8,
                        )}
                        fill="rgba(126, 231, 135, 0.16)"
                        stroke="#7ee787"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                </div>
              )}
              {elevationExpanded && (
                <div className="metric-grid">
                  <div className="metric" title="Distanz: Gesamtlänge der aktiven Route">
                    <span className="metric-label">Distanz</span>
                    <strong>{display.distance} <small>{units.distance}</small></strong>
                  </div>
                  <div className="metric" title={durationTitle}>
                    <span className="metric-label">Dauer</span>
                    <strong>{display.duration}</strong>
                  </div>
                  <div className="metric" title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                    <span className="metric-label">Aufstieg</span>
                    <strong>{display.ascent} <small>{units.elevation}</small></strong>
                  </div>
                  <div className="metric" title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                    <span className="metric-label">Abstieg</span>
                    <strong>{display.descent} <small>{units.elevation}</small></strong>
                  </div>
                  <div className="metric" title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Höchster Punkt</span>
                    <strong>{display.high} <small>{units.elevation}</small></strong>
                  </div>
                  <div className="metric" title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Niedrigster Punkt</span>
                    <strong>{display.low} <small>{units.elevation}</small></strong>
                  </div>
                </div>
              )}
            </div>
            {elevationExpanded && (
              <div className="elevation-card">
                <div className="elevation-header">
                  <div className="elevation-heading">
                    <span className="eyebrow">Höhenprofil</span>
                    {canInspect && (
                      <span className="profile-help" onMouseEnter={() => setHelpDismissed(false)}>
                        <button
                          className="profile-help-button"
                          type="button"
                          aria-label="Hilfe zur Höhenprofilbedienung"
                          aria-describedby="profile-instructions"
                          onFocus={() => setHelpDismissed(false)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              event.stopPropagation()
                              setHelpDismissed(true)
                            }
                          }}
                        >
                          ?
                        </button>
                        <span
                          className={`profile-help-tooltip${helpDismissed ? ' dismissed' : ''}`}
                          id="profile-instructions"
                          role="tooltip"
                        >
                          Position anklicken oder mit Pfeiltasten wählen; Pos1 und Ende springen zum Anfang und Ende, Escape hebt die Auswahl auf.
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                {canInspect && (
                <>
                {!hasRecordedElevations && (
                  <p className="profile-message">Keine vollständigen Höhenwerte vorhanden. Das Profil verwendet synthetische Ersatzwerte.</p>
                )}
                <div className={`profile-chart-area ${profilePointDetails ? 'has-selection' : ''}`}>
                  <svg
                    viewBox="0 0 560 190"
                    preserveAspectRatio="none"
                    className="elevation-chart"
                    role="slider"
                    tabIndex={0}
                    aria-label="Position im Höhenprofil"
                    aria-describedby="profile-instructions"
                    aria-valuemin={0}
                    aria-valuemax={elevations.length - 1}
                    aria-valuenow={currentIndex}
                    aria-valuetext={pointDescription}
                    onKeyDown={(event) => {
                      let nextIndex: number
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setSelection(null)
                        clearProfileSelection()
                        return
                      } else if (event.key === 'Home') {
                        nextIndex = 0
                      } else if (event.key === 'End') {
                        nextIndex = elevations.length - 1
                      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                        nextIndex = profilePointDetails ? currentIndex + 1 : 0
                      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                        nextIndex = profilePointDetails ? currentIndex - 1 : elevations.length - 1
                      } else {
                        return
                      }
                      event.preventDefault()
                      selectIndex(nextIndex)
                    }}
                    onClick={(event) => {
                      if (!activeRoute) return
                      const fraction = profileFractionFromPointer(event.clientX, event.currentTarget.getBoundingClientRect())
                      if (fraction === null) return
                      if (fraction === 0 || fraction === 1) {
                        event.currentTarget.focus()
                        selectIndex(fraction === 0 ? 0 : elevations.length - 1)
                        return
                      }
                      const details = profileDetailsAtFraction(activeRoute, fraction)
                      if (!details) return
                      event.currentTarget.focus()
                      selectIndex(indexForDistance(details.distance))
                    }}
                    onMouseMove={(event) => {
                      if (!activeRoute || selectedIndex !== null) return
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const fraction = profileFractionFromPointer(event.clientX, bounds)
                      setHoveredProfilePoint(
                        fraction === null ? null : profileDetailsAtFraction(activeRoute, fraction),
                      )
                    }}
                    onMouseLeave={() => {
                      if (selectedIndex === null) setHoveredProfilePoint(null)
                    }}
                  >
                    <defs>
                      <linearGradient id="elevation-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#7ee787" stopOpacity="0.42" />
                        <stop offset="100%" stopColor="#7ee787" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    {Array.from(
                      { length: Math.round((activeElevationScale.max - activeElevationScale.min) / activeElevationScale.step) + 1 },
                      (_, index) => index,
                    ).map((index) => {
                        const value = activeElevationScale.min + index * activeElevationScale.step
                        const y = elevationProfileY(
                        value,
                        elevations,
                        activeElevationScale,
                        profileViewBox.height,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                        )
                        return (
                          <g key={value}>
                            <line x1="42" x2="550" y1={y} y2={y} className="elevation-grid-line" />
                          </g>
                        )
                      })}
                    <path
                      d={buildElevationPath(
                        elevations,
                        distances,
                        activeDistanceScale.max,
                        activeElevationScale,
                        profileViewBox.width,
                        profileViewBox.height,
                        profileViewBox.plotLeft,
                        profileViewBox.plotRight,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                      )}
                      fill="url(#elevation-fill)"
                      stroke="#7ee787"
                      strokeWidth="2"
                    />
                    {activeDistanceScale.ticks.map((distance) => {
                      const x =
                        profileViewBox.plotLeft +
                        (distance / activeDistanceScale.max) *
                          (profileViewBox.width -
                            profileViewBox.plotLeft -
                            profileViewBox.plotRight)
                      return (
                        <g key={distance}>
                          <line
                            x1={x}
                            x2={x}
                            y1={profileViewBox.height - profileViewBox.plotBottom}
                            y2={profileViewBox.height - profileViewBox.plotBottom + 4}
                            className="elevation-axis-tick"
                          />
                        </g>
                      )
                    })}
                    {profilePointDetails && (
                      <>
                        <line
                          x1={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          x2={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          y1={profileViewBox.plotTop}
                          y2={profileViewBox.height - profileViewBox.plotBottom}
                          stroke="#ffb86c"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          cy={elevationProfileY(
                            elevationInUnit(profilePointDetails.elevation, units.elevation),
                            elevations,
                            activeElevationScale,
                            profileViewBox.height,
                            profileViewBox.plotTop,
                            profileViewBox.plotBottom,
                          )}
                          r="4"
                          fill="#ffb86c"
                          stroke="#0d1318"
                          strokeWidth="2"
                        />
                      </>
                    )}
                  </svg>
                  <div className="elevation-axis-overlay" aria-hidden="true">
                    {Array.from(
                      { length: Math.round((activeElevationScale.max - activeElevationScale.min) / activeElevationScale.step) + 1 },
                      (_, index) => index,
                    ).map((index) => {
                      const value = activeElevationScale.min + index * activeElevationScale.step
                      const y = elevationProfileY(
                        value,
                        elevations,
                        activeElevationScale,
                        profileViewBox.height,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                      )
                      return (
                        <span
                          key={value}
                          className="elevation-axis-label-overlay elevation-axis-label-y"
                          style={{
                            left: `${(36 / profileViewBox.width) * 100}%`,
                            top: `${(y / profileViewBox.height) * 100}%`,
                          }}
                        >
                          {value}
                        </span>
                      )
                    })}
                    {activeDistanceScale.ticks.map((distance, index) => {
                      const lastIndex = activeDistanceScale.ticks.length - 1
                      if (index === lastIndex - 1 &&
                        activeDistanceScale.ticks[lastIndex] - distance < activeDistanceScale.max * 0.1) return null
                      const x =
                        profileViewBox.plotLeft +
                        (distance / activeDistanceScale.max) *
                          (profileViewBox.width -
                            profileViewBox.plotLeft -
                            profileViewBox.plotRight)
                      const isFirst = index === 0
                      const isLast = index === lastIndex
                      return (
                        <span
                          key={distance}
                          className={`elevation-axis-label-overlay elevation-axis-label-x ${
                            isFirst ? 'align-start' : isLast ? 'align-end' : ''
                          }`}
                          style={{
                            left: `${(x / profileViewBox.width) * 100}%`,
                            top: `${(166 / profileViewBox.height) * 100}%`,
                          }}
                        >
                          {activeDistanceScale.step < 0.1
                            ? distance.toFixed(Math.min(6, Math.max(1, Math.ceil(-Math.log10(activeDistanceScale.step))))).replace(/\.?0+$/, '')
                            : formatDistanceAxis(distance)}
                        </span>
                      )
                    })}
                    <span
                      className="elevation-axis-title-overlay elevation-axis-title-x"
                      style={{
                        left: `${(296 / profileViewBox.width) * 100}%`,
                        top: `${(187 / profileViewBox.height) * 100}%`,
                      }}
                    >
                      Entfernung ({units.distance})
                    </span>
                    <span
                      className="elevation-axis-title-overlay elevation-axis-title-y"
                      style={{
                        top: `${(92 / profileViewBox.height) * 100}%`,
                      }}
                    >
                      Höhe ({units.elevation})
                    </span>
                  </div>
                  {profilePointDetails && (
                    <div
                      className={`profile-selection profile-selection-side ${
                        profilePointDetails.profileFraction > 0.78 ? 'align-left' : ''
                      }`}
                      style={{
                        left: `calc(${markerFraction * 100}% + ${(1 - markerFraction) * 4.5}rem)`,
                      }}
                    >
                      <span>{Math.round(elevationInUnit(profilePointDetails.elevation, units.elevation))} {units.elevation} Höhe</span>
                      <span>{distanceInUnit(profilePointDetails.distance, units.distance).toFixed(2)} {units.distance} ab Start</span>
                      <span>{durationInUnit(profilePointDetails.elapsedMinutes, units.duration)} ab Start</span>
                    </div>
                  )}
                </div>
                <span className="profile-live-status" role="status" aria-live="polite">
                  {selectedIndex !== null ? pointDescription : ''}
                </span>
                </>
                )}
              </div>
            )}
          </section>
  )
}
