import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileProject, createProject, desktopFeaturesAvailable, openProject, saveProject, writeAsset } from './backend'

describe('backend fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps browser projects manual and rejects absolute asset names', async () => {
    const project = await createProject()
    await saveProject(project.handle, '\\begin{tikzpicture}\\end{tikzpicture}')
    await expect(writeAsset(project.handle, '../secret', new Uint8Array())).rejects.toThrow('invalid_request')
    expect(JSON.stringify(project)).not.toMatch(/(?:^|[\\/])Users(?:[\\/]|$)/)
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
})
