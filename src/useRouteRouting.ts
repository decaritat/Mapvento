import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { getRouteCoordinates, type Coordinate, type ProjectFile, type Route } from './routeModel'
import { describeRoutingError, requestRouteGeometry } from './routing'

type RoutingResult = {
  coordinates: Coordinate[]
  elevations?: number[]
  routingState: 'ready' | 'fallback'
  routingError?: string
}

type RoutingJob = {
  key: string
  controller: AbortController
  result?: RoutingResult
  notified: boolean
}

type RoutingCallbacks = {
  onSuccess: (routeId: string) => void
  onFailure: (routeId: string, message: string) => void
}

function routeKey(route: Route): string {
  return JSON.stringify([route.id, route.type, route.nodes.map((node) => node.coordinate)])
}

function canRoute(route: Route): boolean {
  return route.editable && route.nodes.length >= 2
}

export function useRouteRouting(
  project: ProjectFile,
  setProject: Dispatch<SetStateAction<ProjectFile>>,
  callbacks: RoutingCallbacks,
) {
  const jobs = useRef(new Map<string, RoutingJob>())
  const callbacksRef = useRef(callbacks)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    const activeRoutes = new Map(project.routes.map((route) => [route.id, route]))
    for (const [id, job] of jobs.current) {
      const current = activeRoutes.get(id)
      if (
        !current ||
        !canRoute(current) ||
        routeKey(current) !== job.key ||
        (current.routingState === 'ready' && !job.result) ||
        (job.result && current.routingState !== 'loading' && current.geometry !== job.result.coordinates)
      ) {
        job.controller.abort()
        jobs.current.delete(id)
      }
    }

    for (const route of project.routes) {
      if (!canRoute(route)) continue
      const key = routeKey(route)
      const existing = jobs.current.get(route.id)
      if (existing) {
        if (!existing.result && route.routingState !== 'loading') {
          setProject((current) => ({
            ...current,
            routes: current.routes.map((item) =>
              item.id === route.id &&
              canRoute(item) &&
              routeKey(item) === key &&
              jobs.current.get(item.id) === existing
                ? { ...item, routingState: 'loading', routingError: undefined }
                : item,
            ),
          }))
        }
        continue
      }
      if (route.routingState === 'ready') continue

      const job: RoutingJob = {
        key,
        controller: new AbortController(),
        notified: false,
      }
      jobs.current.set(route.id, job)
      setProject((current) => ({
        ...current,
        routes: current.routes.map((item) =>
          item.id === route.id &&
          canRoute(item) &&
          routeKey(item) === key &&
          item.routingState !== 'ready' &&
          jobs.current.get(item.id) === job
            ? { ...item, routingState: 'loading', routingError: undefined }
            : item,
        ),
      }))

      const finish = (result: RoutingResult) => {
        if (job.controller.signal.aborted || jobs.current.get(route.id) !== job) return
        job.result = result
        setProject((current) => ({
          ...current,
          routes: current.routes.map((item) =>
            item.id === route.id &&
            canRoute(item) &&
            routeKey(item) === key &&
            item.routingState === 'loading' &&
            jobs.current.get(item.id) === job
              ? {
                  ...item,
                  geometry: result.coordinates,
                  elevations: result.elevations,
                  timestamps: undefined,
                  routingState: result.routingState,
                  routingError: result.routingError,
                }
              : item,
          ),
        }))
      }

      requestRouteGeometry(
        route.type,
        route.nodes.map((node) => node.coordinate),
        job.controller.signal,
      ).then(
        (geometry) => finish({ ...geometry, routingState: 'ready' }),
        (error: unknown) => {
          if (job.controller.signal.aborted) return
          finish({
            coordinates: getRouteCoordinates(route),
            routingState: 'fallback',
            routingError: describeRoutingError(error),
          })
        },
      )
    }
  }, [project.routes, setProject])

  useEffect(() => {
    for (const route of project.routes) {
      const job = jobs.current.get(route.id)
      const result = job?.result
      if (
        !job ||
        !result ||
        job.notified ||
        routeKey(route) !== job.key ||
        route.geometry !== result.coordinates ||
        route.routingState !== result.routingState
      ) continue
      job.notified = true
      if (result.routingState === 'fallback' && result.routingError) {
        callbacksRef.current.onFailure(route.id, result.routingError)
      } else {
        callbacksRef.current.onSuccess(route.id)
      }
    }
  }, [project.routes])

  useEffect(() => () => {
    for (const job of jobs.current.values()) job.controller.abort()
    jobs.current.clear()
  }, [])

  return useCallback((routeId: string) => {
    const job = jobs.current.get(routeId)
    if (job) {
      job.controller.abort()
      jobs.current.delete(routeId)
    }
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) =>
        route.id === routeId && canRoute(route)
          ? { ...route, routingState: 'idle', routingError: undefined }
          : route,
      ),
    }))
  }, [setProject])
}
