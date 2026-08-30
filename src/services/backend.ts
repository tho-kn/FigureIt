import { invoke } from '@tauri-apps/api/core'

export type Project = { handle: string; title: string; source: string }
export type Commit = { id: string; time: string; message: string }
export type CompileResult =
  | { status: 'ok'; pdf: number[]; diagnostics: Array<{ line?: number; message: string }> }
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; diagnostics: Array<{ line?: number; message: string }> }
export type ClaudeResult =
  | { status: 'ok'; text: string; operations: unknown }
  | { status: 'unavailable' | 'rejected'; message: string }
export type ClaudeStatus =
  | { status: 'ready'; method: string }
  | { status: 'not_installed' }
  | { status: 'not_logged_in' }

const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}
`
export const MAX_SOURCE_BYTES = 1_000_000
export const MAX_ASSET_BYTES = 1_000_000
const memory = new Map<string, Project>()
const localProjectKey = 'figureit:local-project'
let nextHandle = 1
let claudeConversation: string | undefined

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
function isMobile() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent)
}
export function desktopFeaturesAvailable() {
  return isTauri() && !isMobile()
}

function safeAsset(name: string) {
  if (!name || name.length > 160 || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/.test(name)) throw new Error('invalid_request')
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  return desktopFeaturesAvailable() ? invoke<T>(command, args) : undefined
}

function remember(project: Project) {
  memory.clear()
  memory.set(project.handle, project)
  if (isMobile()) localStorage.setItem(localProjectKey, JSON.stringify({ title: project.title, source: project.source }))
}

export async function createProject(): Promise<Project> {
  const result = await call<Project>('create_project')
  if (result) return result
  const project = { handle: `memory-${nextHandle++}`, title: 'Untitled', source }
  remember(project)
  return project
}

export async function openProject(): Promise<Project> {
  try {
    const result = await call<Project>('open_project')
    if (result) return result
  } catch {
    // Graceful fallback if dialog is cancelled or unavailable
  }
  if (isMobile()) try {
    const saved = JSON.parse(localStorage.getItem(localProjectKey) ?? 'null') as Partial<Project> | null
    if (saved && typeof saved.source === 'string' && saved.source.length <= 1_000_000) {
      const project = { handle: `memory-${nextHandle++}`, title: typeof saved.title === 'string' ? saved.title.slice(0, 80) : 'Local figure', source: saved.source }
      remember(project)
      return project
    }
  } catch { localStorage.removeItem(localProjectKey) }
  return createProject()
}

export async function saveProject(handle: string, nextSource: string): Promise<void> {
  if (nextSource.length > MAX_SOURCE_BYTES) throw new Error('invalid_request')
  if (desktopFeaturesAvailable()) { await call<void>('save_project', { handle, source: nextSource }); return }
  const project = memory.get(handle)
  if (!project) throw new Error('project_unavailable')
  remember({ ...project, source: nextSource })
}

export async function writeAsset(handle: string, name: string, bytes: Uint8Array): Promise<void> {
  safeAsset(name)
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('invalid_request')
  if (desktopFeaturesAvailable()) { await call<void>('write_asset', { handle, name, bytes: [...bytes] }); return }
  if (!memory.has(handle)) throw new Error('project_unavailable')
}

export async function checkpointProject(handle: string): Promise<void> {
  if (desktopFeaturesAvailable()) await call<void>('checkpoint_project', { handle })
}
export async function listHistory(handle: string): Promise<Commit[]> {
  return (await call<Commit[]>('list_history', { handle })) ?? []
}
export async function restoreCommit(handle: string, commit: string): Promise<Project | undefined> {
  if (!/^[0-9a-f]{1,64}$/i.test(commit)) throw new Error('invalid_request')
  return call<Project>('restore_commit', { handle, commit })
}
export async function compileProject(handle: string): Promise<CompileResult> {
  return (await call<CompileResult>('compile_project', { handle })) ?? { status: 'unavailable', message: 'Tectonic is unavailable' }
}
export async function resetClaudeConversation(): Promise<void> {
  claudeConversation = undefined
  if (desktopFeaturesAvailable()) await call<void>('reset_claude')
}
export async function claudeStatus(): Promise<ClaudeStatus> {
  return (await call<ClaudeStatus>('claude_status')) ?? { status: 'not_installed' }
}
export async function claudeLogin(): Promise<boolean> {
  if (!desktopFeaturesAvailable()) return false
  return (await call<boolean>('claude_login')) ?? false
}
export async function askClaude(scene: unknown, request: string): Promise<ClaudeResult> {
  if (!request || request.length > 100_000 || /(?:\/Users\/|\/home\/|\\\\|\0)/.test(request)) throw new Error('invalid_request')
  const result = await call<ClaudeResult & { conversation?: string }>('ask_claude', { request: { scene, request, conversation: claudeConversation } })
  if (result?.status === 'ok') claudeConversation = result.conversation
  return result ?? { status: 'unavailable', message: 'Claude is unavailable' }
}
