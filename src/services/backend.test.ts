import { describe, expect, it } from 'vitest'
import { createProject, saveProject, writeAsset } from './backend'

describe('backend fallback', () => {
  it('keeps browser projects manual and rejects absolute asset names', async () => {
    const project = await createProject()
    await saveProject(project.handle, '\\begin{tikzpicture}\\end{tikzpicture}')
    await expect(writeAsset(project.handle, '../secret', new Uint8Array())).rejects.toThrow('invalid_request')
    expect(JSON.stringify(project)).not.toMatch(/(?:^|[\\/])Users(?:[\\/]|$)/)
  })
})
