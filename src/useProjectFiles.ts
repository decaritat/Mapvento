import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { parseGpx, toGpx } from './gpx'
import { initialProject, normalizeProject } from './project'
import type { ProjectFile, Route } from './routeModel'
import type { ExitChoice } from './ExitDialog'
import { openProjectFile, readTextFile, saveProjectFile, saveTextFile, type ProjectFileReference } from './projectFileAdapter'

function isAclDenied(error: unknown) {
  return String(error).includes('not allowed by ACL')
}

const unavailableFileDialog = 'Dateidialog in dieser Umgebung nicht verfügbar. Bitte Mapvento als Desktop-App oder in einem externen Browser öffnen.'

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
  const projectFile = useRef<ProjectFileReference | null>(null)
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

  async function saveProject(projectToSave = project, saveAs = false) {
    if (saving.current) {
      setNotice('Ein Speichervorgang läuft bereits.')
      return false
    }
    saving.current = true
    const generation = projectGeneration.current
    const serialized = JSON.stringify(projectToSave, null, 2)
    try {
      const filename = `${projectToSave.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'projekt'}.mapvento.json`
      const saved = await saveProjectFile(filename, serialized, projectFile.current, saveAs)
      if (projectGeneration.current !== generation) {
        setNotice('Das gespeicherte Projekt ist nicht mehr geöffnet.')
        return false
      }
      localStorage.setItem('mapvento-project', serialized)
      projectFile.current = saved.file
      savedProject.current = JSON.stringify(projectToSave)
      setNotice(saved.downloadStarted ? 'Projekt-Download gestartet.' : 'Projekt gespeichert.')
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

  async function confirmBeforeExit(projectToSave: ProjectFile, isCurrent: () => boolean, ask: () => Promise<ExitChoice>) {
    if (saving.current) {
      setNotice('Ein Speichervorgang läuft bereits.')
      return false
    }
    const projectAtStart = JSON.stringify(currentProject.current)
    if (JSON.stringify(projectToSave) !== savedProject.current) {
      const choice = await ask()
      if (choice === 'cancel') return false
      if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
        setNotice('Das Projekt wurde während des Beendens geändert. Bitte erneut versuchen.')
        return false
      }
      if (choice === 'save') {
        if (!await saveProject(projectToSave)) return false
        if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
          setNotice('Das Projekt wurde während des Speicherns geändert. Bitte erneut versuchen.')
          return false
        }
      }
    }
    return true
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
    readTextFile(file).then((content) => {
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

  function loadProject(content: string, file: ProjectFileReference | null) {
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
      const content = await readTextFile(file)
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
      const opened = await openProjectFile()
      if (opened === 'fallback') fallback()
      else if (opened && isCurrent()) loadProject(opened.content, opened.file)
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) {
        setNotice(isAclDenied(error) ? unavailableFileDialog : `Die Projektdatei konnte nicht geöffnet werden: ${String(error)}`)
      }
    }
  }

  return { exportRoute, saveProject, confirmBeforeExit, newProject, openProject, importGpx, importProject }
}
