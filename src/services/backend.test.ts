import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeLogin, claudeStatus, compileProject, createProject, desktopFeaturesAvailable, openProject, saveProject, writeAsset } from './backend'

describe('backend fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps browser projects manual and rejects absolute asset names', async () => {
    const project = await createProject()
    await saveProject(project.handle, '\\begin{tikzpicture}\\end{tikzpicture}')
    await expect(writeAsset(project.handle, '../secret', new Uint8Array())).rejects.toThrow('invalid_request')
    expect(JSON.stringify(project)).not.toMatch(/(?:^|[\\/])Users(?:[\\/]|$)/)
  })

  it('retains only the active browser project', async () => {
    const previous = await createProject()
    const active = await createProject()
    const empty = '\\begin{tikzpicture}\\end{tikzpicture}'
    await expect(saveProject(previous.handle, empty)).rejects.toThrow('project_unavailable')
    await expect(saveProject(active.handle, empty)).resolves.toBeUndefined()
  })

  it('persists the manual editor locally on Android and disables desktop-only compilation', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('navigator', { userAgent: 'Android' })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
    const project = await createProject()
    const edited = String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`
    await saveProject(project.handle, edited)
    expect(desktopFeaturesAvailable()).toBe(false)
    expect((await openProject()).source).toBe(edited)
    expect(await compileProject(project.handle)).toEqual({ status: 'unavailable', message: 'Tectonic is unavailable' })
  })

  it('reports Claude as unavailable without a desktop backend', async () => {
    expect(await claudeStatus()).toEqual({ status: 'not_installed' })
    expect(await claudeLogin()).toBe(false)
  })
})
