import { describe, expect, it } from 'vitest'
import { initialProject } from '../src/domain/project'
import { projectCoverage } from '../src/integrations/map/tileCoverage'

describe('project tile coverage', () => {
  it('distinguishes empty projects from incomplete and stale coverage', () => {
    expect(projectCoverage(initialProject, 1, [])).toBeNull()
    const project = {
      ...initialProject,
      points: [
        { id: 'a', name: '', description: '', coordinate: [-90, 45] as [number, number], source: 'manual' as const },
        { id: 'b', name: '', description: '', coordinate: [90, -45] as [number, number], source: 'manual' as const },
      ],
    }
    expect(projectCoverage(project, 1, [
      { z: 1, x: 0, y: 0, stale: false },
      { z: 1, x: 1, y: 1, stale: true },
      { z: 2, x: 0, y: 0, stale: false },
    ])).toEqual({ total: 4, cached: 2, stale: 1 })
  })

  it('clamps polar and antimeridian edge coordinates', () => {
    const project = {
      ...initialProject,
      points: [{ id: 'a', name: '', description: '', coordinate: [180, -90] as [number, number], source: 'manual' as const }],
    }
    expect(projectCoverage(project, 2, [{ z: 2, x: 3, y: 3, stale: false }]))
      .toEqual({ total: 1, cached: 1, stale: 0 })
  })
})
