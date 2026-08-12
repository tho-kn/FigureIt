import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
const backend = vi.hoisted(() => ({
  createProject: vi.fn(async () => ({ handle: 'test', title: 'Diagram', source: String.raw`\begin{tikzpicture}
\shade (0,0) circle (1);
\end{tikzpicture}` })), openProject: vi.fn(), saveProject: vi.fn(async () => undefined), checkpointProject: vi.fn(async () => undefined), writeAsset: vi.fn(async () => undefined), listHistory: vi.fn(async () => []), restoreCommit: vi.fn(), compileProject: vi.fn(), askClaude: vi.fn(), resetClaudeConversation: vi.fn(async () => undefined),
}))
vi.mock('./services/backend', () => backend)
import App from './App'

describe('FigureIt scene editor', () => {
  afterEach(cleanup)
  it('creates a shape into canonical source and saves while preserving unsupported raw source', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'New project' })); await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('shade (0,0) circle (1)')
    expect(backend.saveProject).toHaveBeenCalledWith('test', expect.stringContaining('rectangle'))
    expect(backend.resetClaudeConversation).toHaveBeenCalledOnce()
  })
  it('groups selected layers into a visible nested group', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Ellipse' }))
    const layers = screen.getAllByRole('button', { name: /Rectangle|Ellipse/ }).filter((button) => button.className === 'layer-name')
    await user.click(layers[0]); await user.keyboard('{Shift>}'); await user.click(layers[1]); await user.keyboard('{/Shift}')
    await user.click(screen.getByRole('button', { name: 'Group selected layers' }))
    expect(screen.getAllByRole('button', { name: /Group/ }).some((button) => button.className === 'layer-name')).toBe(true); expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('begin{scope}')
  })
  it('resizes through a selection handle and commits canonical geometry', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    const handle = screen.getByLabelText('Resize handle 1')
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 }); fireEvent.pointerUp(handle, { clientX: 76, clientY: 0 })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('(3.510')
  })
  it('selects a group separately and ungroups it', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Ellipse' }))
    const layers = screen.getAllByRole('button', { name: /Rectangle|Ellipse/ }).filter((button) => button.className === 'layer-name'); await user.click(layers[0]); await user.keyboard('{Shift>}'); await user.click(layers[1]); await user.keyboard('{/Shift}'); await user.click(screen.getByRole('button', { name: 'Group selected layers' }))
    const group = screen.getAllByRole('button', { name: /Group/ }).find((button) => button.className === 'layer-name')!; await user.click(group); await user.click(screen.getByRole('button', { name: 'Ungroup selected layer' }))
    expect(screen.queryByRole('button', { name: 'Ungroup selected layer' })).not.toBeInTheDocument(); expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).not.toContain('begin{scope}')
  })
  it('places an image through the native input and writes a safe project asset', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'New project' }))
    const file = new File(['pixels'], 'my chart.png', { type: 'image/png' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2]).buffer })
    await user.upload(screen.getByLabelText('Image file'), file)
    expect(backend.writeAsset).toHaveBeenCalledWith('test', 'my-chart.png', expect.any(Uint8Array)); expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('includegraphics')
  })
  it('rejects malformed assistant operations before they can be applied', async () => {
    backend.askClaude.mockResolvedValueOnce({ status: 'ok', text: 'Move it right.', operations: [{ type: 'move', id: 'missing', dx: 'one', dy: 0 }] })
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Assistant' })); await user.type(screen.getByLabelText('Assistant request'), 'move it')
    await user.click(screen.getByRole('button', { name: 'Request suggestion' })); expect(await screen.findByText('Assistant suggestion was rejected')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Apply suggestion' })).not.toBeInTheDocument()
  })
  it('applies source drafts and undo/redo scene edits', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Undo' })); expect(screen.getAllByLabelText('Rectangle')).toHaveLength(1); await user.click(screen.getByRole('button', { name: 'Redo' })); expect(screen.getAllByLabelText('Rectangle')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('TikZ source'), { target: { value: String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}` } }); await user.click(screen.getByRole('button', { name: 'Apply source' })); expect(screen.getByText('Source applied')).toBeInTheDocument()
  })
})
