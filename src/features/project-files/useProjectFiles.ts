import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { parseGpx, toGpx } from '../../domain/gpx'
import { initialProject, normalizeProject } from '../../domain/project'
import type { ProjectFile, Route } from '../../domain/routeModel'
import type { ExitChoice } from '../../components/exit/ExitDialog'
import { openProjectFile, readTextFile, saveProjectFile, saveTextFile, type ProjectFileReference } from './projectFileAdapter'

function isAclDenied(error: unknown) {
  return String(error).includes('not allowed by ACL')
}

const unavailableFileDialog = 'Dateidialog in dieser Umgebung nicht verfügbar. Bitte Mapvento als Desktop-App oder in einem externen Browser öffnen.'

export function useProjectFiles({ project, activeRoute, setProject, setLayerId, setNotice, reportProblem }: {
  project: ProjectFile
  activeRoute: Route | undefined
  setProject: Dispatch<SetStateAction<ProjectFile>>
  setLayerId: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string>>
  reportProblem: (message: string) => void
}) {
  const savedProject = useRef(JSON.stringify(project))
  const currentProject = useRef(project)
  useLayoutEffect(() => { currentProject.current = project }, [project])
  const projectFile = useRef<ProjectFileReference | null>(null)
  const projectGeneration = useRef(0)
  const openRequest = useRef(0)
  const saving = useRef(false)
  const pendingOpen = useRef<{
    request: number
    generation: number
    projectSnapshot: string
    isCurrent: () => boolean
  } | null>(null)

  const isProjectDirty = useCallback(
    (projectToCheck: ProjectFile) => JSON.stringify(projectToCheck) !== savedProject.current,
    [],
  )

  async function confirmBeforeReplace(
    projectToSave: ProjectFile,
    isCurrent: () => boolean,
    ask: () => Promise<ExitChoice>,
  ) {
    if (saving.current) {
      reportProblem('Ein Speichervorgang läuft bereits. Bitte warten und erneut versuchen.')
      return false
    }

    const projectAtStart = JSON.stringify(currentProject.current)
    if (!isProjectDirty(projectToSave)) return isCurrent()

    const choice = await ask()
    if (choice === 'cancel') return false
    if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
      reportProblem('Das Projekt wurde während des Projektwechsels geändert. Bitte erneut versuchen.')
      return false
    }
    if (choice === 'discard') return true

    if (!await saveProject(projectToSave)) return false
    if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
      reportProblem('Das Projekt wurde während des Speicherns geändert. Bitte erneut versuchen.')
      return false
    }
    return true
  }

  async function exportRoute(route = activeRoute) {
    if (!route) return
    if (!route.editable) {
      reportProblem('Schreibgeschützte GPX-Routen können nicht exportiert werden. Bitte eine bearbeitbare Route auswählen.')
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
      reportProblem(isAclDenied(error) ? unavailableFileDialog : 'GPX konnte nicht gespeichert werden. Bitte erneut versuchen.')
    }
  }

  async function saveProject(projectToSave = project, saveAs = false) {
    if (saving.current) {
      reportProblem('Ein Speichervorgang läuft bereits. Bitte warten und erneut versuchen.')
      return false
    }
    saving.current = true
    const generation = projectGeneration.current
    const serialized = JSON.stringify(projectToSave, null, 2)
    try {
      const filename = `${projectToSave.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'projekt'}.mapvento.json`
      const saved = await saveProjectFile(filename, serialized, projectFile.current, saveAs)
      if (projectGeneration.current !== generation) {
        reportProblem('Das gespeicherte Projekt ist nicht mehr geöffnet. Bitte das aktuelle Projekt erneut speichern.')
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
      reportProblem(isAclDenied(error) ? unavailableFileDialog : `Projekt konnte nicht gespeichert werden: ${String(error)}. Bitte erneut versuchen.`)
      return false
    } finally {
      saving.current = false
    }
  }

  async function confirmBeforeExit(projectToSave: ProjectFile, isCurrent: () => boolean, ask: () => Promise<ExitChoice>) {
    if (saving.current) {
      reportProblem('Ein Speichervorgang läuft bereits. Bitte warten und erneut versuchen.')
      return false
    }
    const projectAtStart = JSON.stringify(currentProject.current)
    if (JSON.stringify(projectToSave) !== savedProject.current) {
      const choice = await ask()
      if (choice === 'cancel') return false
      if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
        reportProblem('Das Projekt wurde während des Beendens geändert. Bitte erneut versuchen.')
        return false
      }
      if (choice === 'save') {
        if (!await saveProject(projectToSave)) return false
        if (JSON.stringify(currentProject.current) !== projectAtStart || !isCurrent()) {
          reportProblem('Das Projekt wurde während des Speicherns geändert. Bitte erneut versuchen.')
          return false
        }
      }
    }
    return true
  }

  async function newProject(
    projectToSave: ProjectFile,
    isCurrent: () => boolean,
    ask: () => Promise<ExitChoice>,
  ) {
    if (!await confirmBeforeReplace(projectToSave, isCurrent, ask)) return false
    pendingOpen.current = null
    const next = structuredClone(initialProject)
    try {
      localStorage.setItem('mapvento-project', JSON.stringify(next))
    } catch (error) {
      reportProblem(`Neues Projekt konnte nicht angelegt werden: ${String(error)}. Bitte Speicherzugriff prüfen und erneut versuchen.`)
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
        reportProblem('Die GPX-Datei konnte nicht gelesen werden. Bitte eine gültige GPX-Datei auswählen.')
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
      const message = `GPX schreibgeschützt importiert.${waypointNotice}${skippedWaypointNotice}`
      if (parsed.skippedWaypoints) reportProblem(`${message} Bitte die Quelldatei prüfen.`)
      else setNotice(message)
    }).catch(() => {
      if (projectGeneration.current === generation) reportProblem('Die GPX-Datei konnte nicht gelesen werden. Bitte eine gültige GPX-Datei auswählen.')
    })
  }

  function loadProject(content: string, file: ProjectFileReference | null) {
    try {
      let warning = ''
      const normalizedProject = normalizeProject(JSON.parse(content), (message) => { warning = message })
      const mapLayerId = normalizedProject.mapLayerId
      localStorage.setItem('mapvento-project', JSON.stringify(normalizedProject))
      pendingOpen.current = null
      openRequest.current += 1
      projectGeneration.current += 1
      projectFile.current = file
      savedProject.current = JSON.stringify(normalizedProject)
      setProject(normalizedProject)
      setLayerId(mapLayerId)
      if (warning) reportProblem(`Projekt geöffnet. ${warning} Bitte die Kartenauswahl prüfen.`)
      else setNotice('Projekt geöffnet.')
    } catch {
      pendingOpen.current = null
      openRequest.current += 1
      reportProblem('Die Projektdatei konnte nicht gelesen werden. Bitte eine gültige Projektdatei auswählen.')
    }
  }

  async function importProject(file: File) {
    const opening = pendingOpen.current
    if (!opening) {
      reportProblem('Projektöffnung wurde nicht bestätigt. Bitte erneut über das Hauptmenü öffnen.')
      return
    }
    try {
      const content = await readTextFile(file)
      const stillCurrent = opening.request === openRequest.current &&
        opening.generation === projectGeneration.current &&
        JSON.stringify(currentProject.current) === opening.projectSnapshot &&
        opening.isCurrent()
      if (stillCurrent) {
        loadProject(content, null)
      } else if (opening.request === openRequest.current) {
        pendingOpen.current = null
        reportProblem('Das Projekt wurde während des Öffnens geändert. Bitte erneut versuchen.')
      }
    } catch {
      if (opening.request === openRequest.current) {
        pendingOpen.current = null
        reportProblem('Die Projektdatei konnte nicht gelesen werden. Bitte eine gültige Projektdatei auswählen.')
      }
    }
  }

  async function openProject(
    fallback: () => void,
    projectToSave: ProjectFile,
    isCurrent: () => boolean,
    ask: () => Promise<ExitChoice>,
  ) {
    if (!await confirmBeforeReplace(projectToSave, isCurrent, ask)) return
    const request = ++openRequest.current
    const generation = projectGeneration.current
    const projectSnapshot = JSON.stringify(currentProject.current)
    const isOpenCurrent = () => request === openRequest.current &&
      generation === projectGeneration.current &&
      JSON.stringify(currentProject.current) === projectSnapshot &&
      isCurrent()
    pendingOpen.current = { request, generation, projectSnapshot, isCurrent }
    try {
      const opened = await openProjectFile()
      if (opened === 'fallback') fallback()
      else if (opened && isOpenCurrent()) loadProject(opened.content, opened.file)
      else if (!opened && request === openRequest.current) pendingOpen.current = null
      else if (opened && request === openRequest.current) {
        pendingOpen.current = null
        reportProblem('Das Projekt wurde während des Öffnens geändert. Bitte erneut versuchen.')
      }
    } catch (error) {
      if (request === openRequest.current) {
        pendingOpen.current = null
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          reportProblem(isAclDenied(error) ? unavailableFileDialog : `Die Projektdatei konnte nicht geöffnet werden: ${String(error)}. Bitte erneut versuchen.`)
        }
      }
    }
  }

  return {
    exportRoute,
    saveProject,
    confirmBeforeExit,
    isProjectDirty,
    newProject,
    openProject,
    importGpx,
    importProject,
  }
}
