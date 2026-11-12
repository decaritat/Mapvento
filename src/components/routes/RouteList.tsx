import { createPortal } from 'react-dom'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { routeMetrics } from '../../domain/routeMetrics'
import { distanceInUnit, durationInUnit, elevationInUnit, type Units } from '../../domain/settings'
import type { ProjectFile, Route } from '../../domain/routeModel'

type RouteMenu = { routeId: string; top: number; left: number }
export function RouteList({ project, openRouteMenu, setOpenRouteMenu, routeMenuRef, routeMenuPopoverRef,
  routeMenuButtonRef, routeCardRefs, focusRoute, openRouteActions, showRouteProperties, exportRoute,
  confirmDeleteRoute, units }: {
  units: Units
  project: ProjectFile
  openRouteMenu: RouteMenu | null
  setOpenRouteMenu: Dispatch<SetStateAction<RouteMenu | null>>
  routeMenuRef: RefObject<HTMLDivElement | null>
  routeMenuPopoverRef: RefObject<HTMLDivElement | null>
  routeMenuButtonRef: RefObject<HTMLButtonElement | null>
  routeCardRefs: RefObject<Map<string, HTMLDivElement>>
  focusRoute: (route: Route) => void
  openRouteActions: (id: string, button: HTMLButtonElement) => void
  showRouteProperties: (route: Route) => void
  exportRoute: (route: Route) => Promise<void>
  confirmDeleteRoute: (route: Route) => void
}) {
  const openMenuRoute = openRouteMenu
    ? project.routes.find((route) => route.id === openRouteMenu.routeId)
    : undefined

  return (
    <>
          <div className="route-list">
            {project.routes.map((route) => {
              const metrics = routeMetrics(route)
              const active = route.id === project.activeRouteId
              return (
                <div className={`route-entry ${active ? 'selected' : ''}`} key={route.id}>
                  <div
                    className={`route-card ${active ? 'selected' : ''}`}
                    ref={(element) => {
                      if (element) routeCardRefs.current.set(route.id, element)
                      else routeCardRefs.current.delete(route.id)
                    }}
                  >
                    <button
                      className="route-card-main"
                      type="button"
                      onClick={() => focusRoute(route)}
                    >
                      <span
                        className={`route-color ${route.type}`}
                        style={{ backgroundColor: route.color ?? '#7ee787' }}
                      />
                      <span className="route-card-content">
                        <span className="route-card-title">
                            {route.name}
                            {!route.editable && (
                              <span className="lock-badge" title="Diese Route ist schreibgeschützt">
                                READ-ONLY
                              </span>
                            )}
                          </span>
                          {(route.editable || route.gpxType) && (
                            <span className="route-card-meta">
                              {route.gpxType ??
                                (route.type === 'hiking' ? 'Wandern' : 'Radfahren')}
                            </span>
                          )}
                        <span className="route-card-stats">
                          <span>{distanceInUnit(metrics.length, units.distance).toFixed(1)} {units.distance}</span>
                          <span>{durationInUnit(metrics.durationMinutes, units.duration)}</span>
                          <span>↗ {Math.round(elevationInUnit(metrics.ascent, units.elevation))} {units.elevation}</span>
                          <span>↘ {Math.round(elevationInUnit(metrics.descent, units.elevation))} {units.elevation}</span>
                        </span>
                      </span>
                    </button>
                    <span className="route-card-actions">
                      <div
                        className="route-menu"
                        ref={openRouteMenu?.routeId === route.id ? routeMenuRef : null}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setOpenRouteMenu(null)
                            routeMenuButtonRef.current?.focus()
                          }
                        }}
                      >
                        <button
                          ref={openRouteMenu?.routeId === route.id ? routeMenuButtonRef : null}
                          className="route-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openRouteMenu?.routeId === route.id}
                          aria-label={`Aktionen für ${route.name}`}
                          title="Routenaktionen"
                          onClick={(event) => {
                            if (openRouteMenu?.routeId === route.id) {
                              setOpenRouteMenu(null)
                            } else {
                              openRouteActions(route.id, event.currentTarget)
                            }
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {openMenuRoute &&
            openRouteMenu &&
            createPortal(
              <div
                ref={routeMenuPopoverRef}
                className="route-menu-popover"
                role="menu"
                aria-label={`Aktionen für ${openMenuRoute.name}`}
                style={{ top: openRouteMenu.top, left: openRouteMenu.left }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setOpenRouteMenu(null)
                    routeMenuButtonRef.current?.focus()
                  }
                }}
              >
                <button
                  className="route-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => showRouteProperties(openMenuRoute)}
                >
                  Eigenschaften
                </button>
                {openMenuRoute.editable && (
                  <button
                    className="route-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenRouteMenu(null)
                      void exportRoute(openMenuRoute)
                    }}
                  >
                    GPX exportieren
                  </button>
                )}
                <button
                  className="route-menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => confirmDeleteRoute(openMenuRoute)}
                >
                  Route entfernen
                </button>
              </div>,
              document.body,
            )}
    </>
  )
}
