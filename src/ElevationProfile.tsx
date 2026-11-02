import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { getInspectorElevationStatus, getInspectorRouteStatus } from './providers'
import { formatDistanceAxis, formatDuration, getDistanceScale, getElevationScale, profileDetailsAtFraction, routeMetrics, type ElevationScale } from './routeMetrics'
import type { ProfilePointDetails, Route } from './routeModel'

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
      const x = plotLeft + (distance / Math.max(1, distanceMax)) * plotWidth
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


export function ElevationProfile({ activeRoute, profilePointDetails, setHoveredProfilePoint,
  elevationExpanded, setElevationExpanded }: {
  activeRoute: Route | undefined
  profilePointDetails: ProfilePointDetails | null
  setHoveredProfilePoint: Dispatch<SetStateAction<ProfilePointDetails | null>>
  elevationExpanded: boolean
  setElevationExpanded: Dispatch<SetStateAction<boolean>>
}) {
  const activeMetrics = useMemo(() => activeRoute ? routeMetrics(activeRoute) : null, [activeRoute])
  const inspectorRouteStatus = getInspectorRouteStatus(activeRoute)
  const inspectorElevationStatus = getInspectorElevationStatus(activeRoute, activeMetrics?.elevations.length ?? 0)
  const activeElevationScale = getElevationScale(activeMetrics?.elevations ?? [])
  const activeDistanceScale = getDistanceScale(activeMetrics?.length ?? 0)
  return (
          <section
            className={`inspector ${elevationExpanded ? 'expanded' : 'compact'}`}
            id="active-elevation-profile"
          >
            {elevationExpanded && (
              <button
                className="inspector-close"
                type="button"
                onClick={() => setElevationExpanded(false)}
                title="Höhenprofil schließen"
                aria-label="Höhenprofil schließen"
              >
                ×
              </button>
            )}
            <div className="inspector-main">
              <div className="inspector-title-row">
                <div>
                  <span className="eyebrow">Aktive Route</span>
                  <strong className="inspector-route-name">{activeRoute?.name ?? 'Keine Route'}</strong>
                </div>
                <div className="inspector-actions">
                  <span
                    className={`inspector-route-status ${
                      inspectorRouteStatus.isError ? 'error' : ''
                    }`}
                    title={inspectorRouteStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorRouteStatus.text}
                  </span>
                  <span
                    className={`inspector-elevation-status ${
                      inspectorElevationStatus.active ? '' : 'inactive'
                    }`}
                    title={inspectorElevationStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorElevationStatus.text}
                  </span>
                </div>
              </div>
              {!elevationExpanded && (
                <div className="compact-inspector-content">
                  <div className="compact-metric-grid">
                    <span title="Distanz: Gesamtlänge der aktiven Route">
                      <strong>{activeMetrics?.length.toFixed(1) ?? '0.0'}</strong> km
                    </span>
                    <span title="Dauer: Geschätzte Geh- bzw. Fahrzeit basierend auf Streckenlänge und Höhenmetern">
                      <strong>{activeMetrics ? formatDuration(activeMetrics.durationMinutes) : '–'}</strong>
                    </span>
                    <span title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                      <strong>{Math.round(activeMetrics?.ascent ?? 0)}</strong> m Aufstieg
                    </span>
                    <span title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                      <strong>{Math.round(activeMetrics?.descent ?? 0)}</strong> m Abstieg
                    </span>
                    <span title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                      <strong>{activeMetrics?.high ?? 0}</strong> m höchster
                    </span>
                    <span title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                      <strong>{activeMetrics?.low ?? 0}</strong> m niedrigster
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
                          activeMetrics?.elevations ?? [],
                          activeMetrics?.distances ?? [],
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
                    <strong>{activeMetrics?.length.toFixed(1) ?? '0.0'} <small>km</small></strong>
                  </div>
                  <div className="metric" title="Dauer: Geschätzte Geh- bzw. Fahrzeit basierend auf Streckenlänge und Höhenmetern">
                    <span className="metric-label">Dauer</span>
                    <strong>{activeMetrics ? formatDuration(activeMetrics.durationMinutes) : '–'}</strong>
                  </div>
                  <div className="metric" title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                    <span className="metric-label">Aufstieg</span>
                    <strong>{Math.round(activeMetrics?.ascent ?? 0)} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                    <span className="metric-label">Abstieg</span>
                    <strong>{Math.round(activeMetrics?.descent ?? 0)} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Höchster Punkt</span>
                    <strong>{activeMetrics?.high ?? 0} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Niedrigster Punkt</span>
                    <strong>{activeMetrics?.low ?? 0} <small>m</small></strong>
                  </div>
                </div>
              )}
            </div>
            {elevationExpanded && (
              <div className="elevation-card">
                <div className="elevation-header">
                  <span className="eyebrow">Höhenprofil</span>
                  <span
                    className={`elevation-profile-status ${
                      inspectorElevationStatus.active ? '' : 'inactive'
                    }`}
                    title={inspectorElevationStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorElevationStatus.text}
                  </span>
                </div>
                <div className={`profile-chart-area ${profilePointDetails ? 'has-selection' : ''}`}>
                  <svg
                    viewBox="0 0 560 190"
                    preserveAspectRatio="none"
                    className="elevation-chart"
                    role="img"
                    aria-label="Höhenprofil der aktiven Route"
                    onMouseMove={(event) => {
                      if (!activeRoute || !activeMetrics?.elevations.length) {
                        setHoveredProfilePoint(null)
                        return
                      }
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const fraction = profileFractionFromPointer(event.clientX, bounds)
                      setHoveredProfilePoint(
                        fraction === null ? null : profileDetailsAtFraction(activeRoute, fraction),
                      )
                    }}
                    onMouseLeave={() => setHoveredProfilePoint(null)}
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
                        activeMetrics?.elevations ?? [],
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
                        activeMetrics?.elevations ?? [],
                        activeMetrics?.distances ?? [],
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
                        (distance / Math.max(1, activeDistanceScale.max)) *
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
                            profilePointDetails.elevation,
                            activeMetrics?.elevations ?? [],
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
                        activeMetrics?.elevations ?? [],
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
                      const x =
                        profileViewBox.plotLeft +
                        (distance / Math.max(1, activeDistanceScale.max)) *
                          (profileViewBox.width -
                            profileViewBox.plotLeft -
                            profileViewBox.plotRight)
                      const isFirst = index === 0
                      const isLast = index === activeDistanceScale.ticks.length - 1
                      return (
                        <span
                          key={distance}
                          className={`elevation-axis-label-overlay elevation-axis-label-x ${
                            isFirst ? 'align-start' : isLast ? 'align-end' : ''
                          }`}
                          style={{
                            left: `${(x / profileViewBox.width) * 100}%`,
                            top: `${(174 / profileViewBox.height) * 100}%`,
                          }}
                        >
                          {formatDistanceAxis(distance)}
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
                      Entfernung (km)
                    </span>
                    <span
                      className="elevation-axis-title-overlay elevation-axis-title-y"
                      style={{
                        left: `${(10 / profileViewBox.width) * 100}%`,
                        top: `${(92 / profileViewBox.height) * 100}%`,
                      }}
                    >
                      Höhe (m)
                    </span>
                  </div>
                  {profilePointDetails && (
                    <div
                      className={`profile-selection profile-selection-side ${
                        profilePointDetails.profileFraction > 0.78 ? 'align-left' : ''
                      }`}
                      style={{
                        left: `${
                          ((profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)) /
                            profileViewBox.width) *
                          100
                        }%`,
                      }}
                    >
                      <span>{profilePointDetails.elevation} m Höhe</span>
                      <span>{profilePointDetails.distance.toFixed(2)} km ab Start</span>
                      <span>{formatDuration(profilePointDetails.elapsedMinutes)} ab Start</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
  )
}
