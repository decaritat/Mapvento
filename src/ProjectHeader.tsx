import type { RefObject } from 'react'

export function ProjectHeader({ projectInput, saveProject, importProject, openAbout }: {
  projectInput: RefObject<HTMLInputElement | null>
  saveProject: () => void
  importProject: (file: File) => void
  openAbout: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" />
        <div>
          <strong>Trailforge</strong>
          <span>Open route planner</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="ghost-button" onClick={() => projectInput.current?.click()}>
          Projekt öffnen
        </button>
        <button className="solid-button" onClick={saveProject}>
          Projekt speichern
        </button>
        <button className="ghost-button" onClick={openAbout}>
          Info
        </button>
        <input
          ref={projectInput}
          className="hidden-input"
          type="file"
          accept=".json,.trailforge.json"
          onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])}
        />
      </div>
    </header>
  )
}
