import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { parseGpx, toGpx } from './gpx'
import { initialProject, normalizeProject } from './project'
import type { ProjectFile, Route } from './routeModel'

type FileHandle = {
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileHandle>
  showOpenFilePicker?: (options: {
    types: Array<{ description: string; accept: Record<string, string[]> }>
    multiple: boolean
  }) => Promise<FileHandle[]>
}

function isAclDenied(error: unknown) {
  return String(error).includes('not allowed by ACL')
}

const unavailableFileDialog = 'Dateidialog in dieser Umgebung nicht verfügbar. Bitte Mapvento als Desktop-App oder in einem externen Browser öffnen.'

export async function saveTextFile(filename: string, content: string, type: string) {
  if (isTauri()) {
    const saved = await invoke<boolean>('save_text_file', { filename, content })
    if (!saved) throw new DOMException('Save cancelled', 'AbortError')
    return
  }

  const savePicker = (window as SavePickerWindow).showSaveFilePicker
  if (savePicker) {
    const extension = filename.split('.').pop() ?? 'txt'
    const handle = await savePicker({
      suggestedName: filename,
      types: [{ description: type, accept: { [type]: [`.${extension}`] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return
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
  const savedProject = useRef(JSON.stringify(project))
  const currentProject = useRef(project)
  useLayoutEffect(() => { currentProject.current = project }, [project])
  const projectFile = useRef<{ kind: 'desktop'; path: string } | { kind: 'browser'; handle: FileHandle } | null>(null)
  const projectGeneration = useRef(0)
  const openRequest = useRef(0)
  const saving = useRef(false)

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
      setNotice(isAclDenied(error) ? unavailableFileDialog : 'GPX konnte nicht gespeichert werden.')
    }
  }

  async function saveProject(projectToSave = project) {
    if (saving.current) {
      setNotice('Ein Speichervorgang läuft bereits.')
      return false
    }
    saving.current = true
    const generation = projectGeneration.current
    const serialized = JSON.stringify(projectToSave, null, 2)
    try {
      const filename = `${projectToSave.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'projekt'}.mapvento.json`
      let selectedFile = projectFile.current
      let downloadStarted = false
      if (isTauri()) {
        const path = await invoke<string | null>('save_project_file', {
          filename, content: serialized, path: projectFile.current?.kind === 'desktop' ? projectFile.current.path : null,
        })
        if (!path) throw new DOMException('Save cancelled', 'AbortError')
        selectedFile = { kind: 'desktop', path }
      } else {
        let handle = projectFile.current?.kind === 'browser' ? projectFile.current.handle : null
        const picker = (window as SavePickerWindow).showSaveFilePicker
        if (!handle && picker) {
          handle = await picker({
            suggestedName: filename,
            types: [{ description: 'application/json', accept: { 'application/json': ['.json'] } }],
          })
        }
        if (handle) {
          const writable = await handle.createWritable()
          await writable.write(serialized)
          await writable.close()
          selectedFile = { kind: 'browser', handle }
        } else {
          await saveTextFile(filename, serialized, 'application/json')
          downloadStarted = true
        }
      }
      if (projectGeneration.current !== generation) {
        setNotice('Das gespeicherte Projekt ist nicht mehr geöffnet.')
        return false
      }
      localStorage.setItem('mapvento-project', serialized)
      projectFile.current = selectedFile
      savedProject.current = JSON.stringify(projectToSave)
      setNotice(downloadStarted ? 'Projekt-Download gestartet.' : 'Projekt gespeichert.')
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('Speichern abgebrochen.')
        return false
      }
      setNotice(isAclDenied(error) ? unavailableFileDialog : `Projekt konnte nicht gespeichert werden: ${String(error)}`)
      return false
    } finally {
      saving.current = false
    }
  }

  async function newProject(projectToSave = project, isCurrent = () => true) {
    if (saving.current) {
      setNotice('Ein Speichervorgang läuft bereits.')
      return false
    }
    if (JSON.stringify(projectToSave) !== savedProject.current &&
        window.confirm('Soll das aktuelle Projekt vor dem Erstellen eines neuen Projekts gespeichert werden?')) {
      if (!await saveProject(projectToSave)) return false
      if (JSON.stringify(currentProject.current) !== JSON.stringify(project) || !isCurrent()) {
        setNotice('Das Projekt wurde während des Speicherns geändert. Bitte erneut versuchen.')
        return false
      }
    }
    const next = structuredClone(initialProject)
    try {
      localStorage.setItem('mapvento-project', JSON.stringify(next))
    } catch (error) {
      setNotice(`Neues Projekt konnte nicht angelegt werden: ${String(error)}`)
      return false
    }
    projectFile.current = null
    projectGeneration.current += 1
    openRequest.current += 1
    savedProject.current = JSON.stringify(next)
    setProject(next)
    setLayerId(next.mapLayerId)
    setNotice('Neues Projekt geöffnet.')
    return true
  }

  function importGpx(file: File) {
    const generation = projectGeneration.current
    file.text().then((content) => {
      if (projectGeneration.current !== generation) return
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
    }).catch(() => {
      if (projectGeneration.current === generation) setNotice('Die GPX-Datei konnte nicht gelesen werden.')
    })
  }

  function loadProject(content: string, file: typeof projectFile.current) {
    try {
      let warning = ''
      const normalizedProject = normalizeProject(JSON.parse(content), (message) => { warning = message })
      const mapLayerId = normalizedProject.mapLayerId
      localStorage.setItem('mapvento-project', JSON.stringify(normalizedProject))
      projectGeneration.current += 1
      projectFile.current = file
      savedProject.current = JSON.stringify(normalizedProject)
      setProject(normalizedProject)
      setLayerId(mapLayerId)
      setNotice(warning ? `Projekt geöffnet. ${warning}` : 'Projekt geöffnet.')
    } catch {
      setNotice('Die Projektdatei konnte nicht gelesen werden.')
    }
  }

  async function importProject(file: File) {
    const request = ++openRequest.current
    const generation = projectGeneration.current
    try {
      const content = await file.text()
      if (request === openRequest.current && generation === projectGeneration.current) {
        loadProject(content, null)
      }
    } catch {
      if (request === openRequest.current && generation === projectGeneration.current) {
        setNotice('Die Projektdatei konnte nicht gelesen werden.')
      }
    }
  }

  async function openProject(fallback: () => void) {
    const request = ++openRequest.current
    const generation = projectGeneration.current
    const isCurrent = () => request === openRequest.current && generation === projectGeneration.current
    try {
      if (isTauri()) {
        const opened = await invoke<{ path: string; content: string } | null>('open_project_file')
        if (opened && isCurrent()) loadProject(opened.content, { kind: 'desktop', path: opened.path })
      } else if ((window as SavePickerWindow).showOpenFilePicker) {
        const [handle] = await (window as SavePickerWindow).showOpenFilePicker!({
          types: [{ description: 'Projektdatei', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        })
        if (handle) {
          const content = await (await handle.getFile()).text()
          if (isCurrent()) loadProject(content, { kind: 'browser', handle })
        }
      } else {
        fallback()
      }
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) {
        setNotice(isAclDenied(error) ? unavailableFileDialog : `Die Projektdatei konnte nicht geöffnet werden: ${String(error)}`)
      }
    }
  }

  return { exportRoute, saveProject, newProject, openProject, importGpx, importProject }
}
