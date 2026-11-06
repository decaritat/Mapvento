import type { Dispatch, SetStateAction } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { parseGpx, toGpx } from './gpx'
import { normalizeProject } from './project'
import type { ProjectFile, Route } from './routeModel'

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (content: string) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

export async function saveTextFile(filename: string, content: string, type: string) {
  if (isTauri()) {
    try {
      const saved = await invoke<boolean>('save_text_file', { filename, content })
      if (!saved) throw new DOMException('Save cancelled', 'AbortError')
      return
    } catch (error) {
      // Hosts without Trailforge's Rust backend (e.g. an embedded preview) lack this command.
      if (!String(error).includes('not found')) throw error
    }
  }

  const savePicker = (window as SavePickerWindow).showSaveFilePicker
  if (savePicker) {
    try {
      const extension = filename.split('.').pop() ?? 'txt'
      const handle = await savePicker({
        suggestedName: filename,
        types: [{ description: type, accept: { [type]: [`.${extension}`] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }

  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}


export function useProjectFiles({ project, activeRoute, setProject, setLayerId, setNotice }: {
  project: ProjectFile
  activeRoute: Route | undefined
  setProject: Dispatch<SetStateAction<ProjectFile>>
  setLayerId: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string>>
}) {
  async function exportRoute(route = activeRoute) {
    if (!route) return
    if (!route.editable) {
      setNotice('Schreibgeschützte GPX-Routen können nicht exportiert werden.')
      return
    }
    try {
      await saveTextFile(
        `${route.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'route'}.gpx`,
        toGpx(route, project.points),
        'application/gpx+xml',
      )
      setNotice('GPX exportiert.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('GPX-Export abgebrochen.')
        return
      }
      setNotice('GPX konnte nicht gespeichert werden.')
    }
  }

  async function saveProject() {
    const serialized = JSON.stringify(project, null, 2)
    localStorage.setItem('trailforge-project', serialized)
    try {
      await saveTextFile(
        `${project.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'projekt'}.trailforge.json`,
        serialized,
        'application/json',
      )
      setNotice('Projekt gespeichert.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('Speichern abgebrochen.')
        return
      }
      setNotice('Projekt wurde lokal gespeichert, aber der Dateidialog konnte nicht geöffnet werden.')
    }
  }

  function importGpx(file: File) {
    file.text().then((content) => {
      const parsed = parseGpx(content)
      if (!parsed) {
        setNotice('Die GPX-Datei konnte nicht gelesen werden.')
        return
      }
      const route = {
        ...parsed.route,
        editable: false,
        description: parsed.route.description.slice(0, 180),
      }
      setProject((current) => ({
        ...current,
        routes: [...current.routes, route],
        points: [...current.points, ...parsed.waypoints],
        activeRouteId: route.id,
      }))
      const waypointNotice = parsed.waypoints.length
        ? ` ${parsed.waypoints.length} GPX-Wegpunkt${parsed.waypoints.length === 1 ? '' : 'e'} als POI übernommen.`
        : ''
      const skippedWaypointNotice = parsed.skippedWaypoints
        ? ` ${parsed.skippedWaypoints} ungültige GPX-Wegpunkte übersprungen.`
        : ''
      setNotice(`GPX schreibgeschützt importiert.${waypointNotice}${skippedWaypointNotice}`)
    }).catch(() => setNotice('Die GPX-Datei konnte nicht gelesen werden.'))
  }

  function importProject(file: File) {
    file
      .text()
      .then((content) => {
        let warning = ''
        const normalizedProject = normalizeProject(JSON.parse(content), (message) => { warning = message })
        const mapLayerId = normalizedProject.mapLayerId
        setProject(normalizedProject)
        setLayerId(mapLayerId)
        localStorage.setItem('trailforge-project', JSON.stringify(normalizedProject))
        setNotice(warning ? `Projekt geöffnet. ${warning}` : 'Projekt geöffnet.')
      })
      .catch(() => setNotice('Die Projektdatei konnte nicht gelesen werden.'))
  }

  return { exportRoute, saveProject, importGpx, importProject }
}
