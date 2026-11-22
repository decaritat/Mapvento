import { createPortal } from 'react-dom'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { formatRouteMetrics, routeMetrics } from '../../domain/routeMetrics'
import type { Units } from '../../domain/settings'
import { DEFAULT_ROUTE_COLOR, type ProjectFile, type Route } from '../../domain/routeModel'

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
  openRouteActions: (id: string, button: HTMLButtonElement, focusLast?: boolean) => void
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
              const display = formatRouteMetrics(metrics, units)
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
                        style={{ backgroundColor: route.color ?? DEFAULT_ROUTE_COLOR }}
                      />
                      <span className="route-card-content">
                        <span className="route-card-title">
                            {route.name}
                            {!route.editable && (
                              <span className="lock-badge" lang="en" title="Diese Route ist schreibgeschützt">
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
                          <span>{display.distance} {units.distance}</span>
                          <span>{display.duration}</span>
                          <span>↗ {display.ascent} {units.elevation}</span>
                          <span>↘ {display.descent} {units.elevation}</span>
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
                          aria-controls={`route-menu-${route.id}`}
                          aria-label={`Aktionen für ${route.name}`}
                          title="Routenaktionen"
                          onClick={(event) => {
                            if (openRouteMenu?.routeId === route.id) {
                              setOpenRouteMenu(null)
                            } else {
                              openRouteActions(route.id, event.currentTarget)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                            event.preventDefault()
                            openRouteActions(
                              route.id,
                              event.currentTarget,
                              event.key === 'ArrowUp' || event.key === 'End',
                            )
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
                id={`route-menu-${openMenuRoute.id}`}
                aria-label={`Aktionen für ${openMenuRoute.name}`}
                style={{ top: openRouteMenu.top, left: openRouteMenu.left }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setOpenRouteMenu(null)
                    routeMenuButtonRef.current?.focus()
                  } else if (event.key === 'Tab') {
                    setOpenRouteMenu(null)
                    routeMenuButtonRef.current?.focus()
                  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault()
                    const items = Array.from(
                      routeMenuPopoverRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
                    )
                    const index = items.indexOf(document.activeElement as HTMLButtonElement)
                    const next = event.key === 'Home' ? 0
                      : event.key === 'End' ? items.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                    items[next]?.focus()
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
