import { act, StrictMode, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialProject } from '../src/domain/project'
import { getRouteCoordinates, type Coordinate, type ProjectFile, type Route } from '../src/domain/routeModel'
import { useRouteRouting } from '../src/features/route-routing/useRouteRouting'

type Request = {
  signal: AbortSignal
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

const route: Route = {
  ...initialProject.routes[0],
  nodes: [
    { id: 'one', coordinate: [13, 52] },
    { id: 'two', coordinate: [14, 53] },
  ],
  routingState: 'idle',
}

function response(coordinates: number[][]): Response {
  return new Response(JSON.stringify({ features: [{ geometry: { coordinates } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('routing lifecycle', () => {
  let requests: Request[]
  let root: Root
  let container: HTMLDivElement
  let project: ProjectFile
  let setProject: Dispatch<SetStateAction<ProjectFile>>
  let retry: (id: string) => void
  const onSuccess = vi.fn()
  const onFailure = vi.fn()

  function Harness({ initial }: { initial: ProjectFile }) {
    const [current, setCurrent] = useState(initial)
    const retryCurrent = useRouteRouting(current, setCurrent, { onSuccess, onFailure })
    useLayoutEffect(() => {
      project = current
      setProject = setCurrent
      retry = retryCurrent
    }, [current, retryCurrent])
    return null
  }

  async function mount(routes: Route[], strict = false) {
    const initial = { ...initialProject, routes, activeRouteId: routes[0]?.id ?? '' }
    await act(async () => {
      root.render(strict ? <StrictMode><Harness initial={initial} /></StrictMode> : <Harness initial={initial} />)
    })
  }

  async function changeRoute(id: string, change: (item: Route) => Route) {
    await act(async () => {
      setProject((current) => ({
        ...current,
        routes: current.routes.map((item) => item.id === id ? change(item) : item),
      }))
    })
  }

  async function resolve(index: number, coordinates: number[][] = [[13, 52, 100], [14, 53, 200]]) {
    await act(async () => requests[index].resolve(response(coordinates)))
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    requests = []
    onSuccess.mockReset()
    onFailure.mockReset()
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        if (!(options.signal instanceof AbortSignal)) throw new Error('Missing abort signal')
        requests.push({ signal: options.signal, resolve, reject })
      }),
    ))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps an active request through metadata changes and applies the result to the latest route', async () => {
    await mount([route])
    expect(project.routes[0].routingState).toBe('loading')
    await changeRoute(route.id, (item) => ({
      ...item,
      name: 'Updated',
      description: 'Edited while routing',
      color: '#123456',
      showDistanceMarkers: true,
      distanceMarkerMode: 'manual',
      distanceMarkerStepKm: 2,
    }))
    expect(requests).toHaveLength(1)
    expect(requests[0].signal.aborted).toBe(false)
    await resolve(0)
    expect(project.routes[0]).toMatchObject({
      name: 'Updated',
      color: '#123456',
      description: 'Edited while routing',
      showDistanceMarkers: true,
      routingState: 'ready',
      geometry: [[13, 52], [14, 53]],
      elevations: [100, 200],
    })
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('replaces only the changed route and ignores a late stale response', async () => {
    const other = { ...route, id: 'other' }
    await mount([route, other])
    expect(requests).toHaveLength(2)
    await changeRoute(route.id, (item) => ({
      ...item,
      nodes: [{ id: 'one', coordinate: [10, 50] }, item.nodes[1]],
      routingState: 'idle',
    }))
    expect(requests).toHaveLength(3)
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(false)
    await resolve(2, [[10, 50, 25], [14, 53, 30]])
    await resolve(0, [[13, 52, 1], [14, 53, 2]])
    expect(project.routes[0].geometry).toEqual([[10, 50], [14, 53]])
    expect(project.routes[0].elevations).toEqual([25, 30])
    expect(project.routes[1].routingState).toBe('loading')
    await resolve(1)
    expect(project.routes[1].routingState).toBe('ready')
    expect(onSuccess).toHaveBeenCalledTimes(2)
  })

  it('replaces a pending job when the route type changes', async () => {
    await mount([route])
    await changeRoute(route.id, (item) => ({ ...item, type: 'cycling', routingState: 'idle' }))
    expect(requests).toHaveLength(2)
    expect(requests[0].signal.aborted).toBe(true)
    await act(async () => requests[0].reject(new TypeError('obsolete request')))
    expect(onFailure).not.toHaveBeenCalled()
    await resolve(1)
    expect(project.routes[0]).toMatchObject({ type: 'cycling', routingState: 'ready' })
  })

  it('does not recalculate a restored ready route until explicitly retried', async () => {
    const restored: Route = {
      ...route,
      routingState: 'ready',
      geometry: [[13, 52], [14, 53]],
    }
    await mount([restored])
    await changeRoute(route.id, (item) => ({ ...item, description: 'Updated' }))
    expect(requests).toHaveLength(0)
    await act(async () => retry(route.id))
    expect(requests).toHaveLength(1)
    expect(project.routes[0].routingState).toBe('loading')
    await resolve(0)
    expect(project.routes[0].routingState).toBe('ready')
  })

  it('retries only the selected route even when its coordinates are unchanged', async () => {
    await mount([route, { ...route, id: 'other' }])
    await act(async () => retry(route.id))
    expect(requests).toHaveLength(3)
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(false)
    await resolve(0, [[1, 1], [2, 2]])
    expect(project.routes[0].routingState).toBe('loading')
    await resolve(2)
    expect(project.routes[0].routingState).toBe('ready')
    expect(project.routes[1].routingState).toBe('loading')
  })

  it('uses the direct fallback and retries a failed job without restarting other routes', async () => {
    await mount([route, { ...route, id: 'other' }])
    await act(async () => requests[0].reject(new TypeError('Failed to fetch')))
    expect(project.routes[0]).toMatchObject({
      routingState: 'fallback',
      geometry: getRouteCoordinates(route),
      routingError: expect.stringContaining('BRouter'),
    })
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0][0]).toBe(route.id)
    await changeRoute(route.id, (item) => ({ ...item, color: '#fedcba' }))
    expect(requests).toHaveLength(2)
    await act(async () => retry(route.id))
    expect(requests).toHaveLength(3)
    expect(requests[1].signal.aborted).toBe(false)
    await resolve(2)
    expect(project.routes[0]).toMatchObject({ routingState: 'ready', color: '#fedcba' })
  })

  it('clears old timestamps when a new route geometry is applied', async () => {
    await mount([{
      ...route,
      geometry: [[13, 52], [14, 53]],
      timestamps: ['2025-01-01T10:00:00Z', '2025-01-01T11:00:00Z'],
    }])
    await resolve(0, [[13, 52, 1], [13.5, 52.5, 2], [14, 53, 3]])
    expect(project.routes[0].geometry).toHaveLength(3)
    expect(project.routes[0].timestamps).toBeUndefined()
  })

  it('aborts removed and read-only routes and disregards their late results', async () => {
    await mount([route, { ...route, id: 'other' }])
    await act(async () => setProject((current) => ({
      ...current,
      routes: current.routes.filter((item) => item.id !== route.id)
        .map((item) => ({ ...item, editable: false })),
      activeRouteId: 'other',
    })))
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(true)
    await resolve(0)
    await resolve(1)
    expect(project.routes).toHaveLength(1)
    expect(project.routes[0].geometry).toBeUndefined()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('aborts a job when fewer than two nodes remain', async () => {
    await mount([route])
    await changeRoute(route.id, (item) => ({ ...item, nodes: [item.nodes[0]], routingState: 'idle' }))
    expect(requests[0].signal.aborted).toBe(true)
    await resolve(0)
    expect(requests).toHaveLength(1)
    expect(project.routes[0].geometry).toBeUndefined()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not replace a newly imported ready route with an older pending result', async () => {
    await mount([route])
    const importedGeometry: Coordinate[] = [[13, 52], [13.5, 52.5], [14, 53]]
    await changeRoute(route.id, (item) => ({
      ...item,
      name: 'Imported',
      geometry: importedGeometry,
      routingState: 'ready',
    }))
    expect(requests[0].signal.aborted).toBe(true)
    await resolve(0)
    expect(project.routes[0]).toMatchObject({ name: 'Imported', geometry: importedGeometry })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('aborts pending work on unmount and tolerates late completion', async () => {
    await mount([route])
    await act(async () => root.unmount())
    expect(requests[0].signal.aborted).toBe(true)
    await resolve(0)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('recovers correctly after StrictMode effect cleanup', async () => {
    await mount([route], true)
    expect(requests).toHaveLength(2)
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(false)
    await resolve(0, [[1, 1], [2, 2]])
    await resolve(1)
    expect(project.routes[0].geometry).toEqual([[13, 52], [14, 53]])
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})
