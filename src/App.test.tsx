import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
const backend = vi.hoisted(() => ({
  desktopFeaturesAvailable: () => true, createProject: vi.fn(async () => ({ handle: 'test', title: 'Diagram', source: String.raw`\begin{tikzpicture}
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
    const canvas = screen.getByLabelText('Figure artboard')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 260, width: 400, height: 260, x: 0, y: 0, toJSON: () => ({}) })
    Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
    const handle = screen.getByLabelText('Resize handle 1')
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 }); fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 138, clientY: 100 })
    const shape = screen.getAllByLabelText('Rectangle').find((element) => element.tagName.toLowerCase() === 'g')!; expect(Number(shape.querySelector('rect:not(.selection-box):not(.resize-handle)')?.getAttribute('width'))).toBeCloseTo(56.28, 1)
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 138, clientY: 100 })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('(3.511')
  })
  it('moves with live pointer capture at the rendered SVG scale', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    const canvas = screen.getByLabelText('Figure artboard'); const shape = screen.getAllByLabelText('Rectangle').find((element) => element.tagName.toLowerCase() === 'g')!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 260, width: 400, height: 260, x: 0, y: 0, toJSON: () => ({}) }); const capture = vi.fn(); Object.assign(canvas, { setPointerCapture: capture, hasPointerCapture: () => false })
    fireEvent.pointerDown(shape, { pointerId: 7, clientX: 100, clientY: 100 }); fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 150, clientY: 125 })
    expect(capture).toHaveBeenCalledWith(7); expect(screen.getAllByLabelText('Rectangle').find((element) => element.tagName.toLowerCase() === 'g')?.getAttribute('transform')).toContain('translate(100 50)')
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 150, clientY: 125 }); expect(screen.getByLabelText<HTMLInputElement>('X position').value).toBe('4.146'); expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).not.toContain('shift=')
  })
  it('resizes a rotated shape along its local axis', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' })); fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '90' } })
    const canvas = screen.getByLabelText('Figure artboard'); vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 260, width: 400, height: 260, x: 0, y: 0, toJSON: () => ({}) }); Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
    fireEvent.pointerDown(screen.getByLabelText('Resize handle 4'), { pointerId: 9, clientX: 100, clientY: 100 }); fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 100, clientY: 81 })
    expect(Number(screen.getByLabelText<HTMLInputElement>('Width').value)).toBeGreaterThan(4.4)
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

  it('draws a persistent snapped connector between shape connection sites', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Ellipse' })); await user.click(screen.getByRole('button', { name: 'Connector' }))
    expect(screen.queryByLabelText('Resize handle 1')).not.toBeInTheDocument()
    const shapes = screen.getAllByTestId('shape')
    const canvas = screen.getByLabelText('Figure artboard'); Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => shapes[1]) })
    fireEvent.pointerDown(shapes[0], { pointerId: 12, clientX: 80, clientY: 400 })
    fireEvent.pointerUp(canvas, { pointerId: 12, clientX: 220, clientY: 350 })
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toContain('kind=connector')
    expect(source).toMatch(/start=.*%40(?:top|right|bottom|left)/)
    expect(source).toContain('->')
  })

  it('offers PowerPoint-like primitive, line, fill, and layer controls', async () => {
    const user = userEvent.setup(); render(<App />)
    for (const name of ['Rounded rectangle', 'Triangle', 'Diamond', 'Arrow']) expect(screen.getByRole('button', { name })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Arrow' }))
    await user.selectOptions(screen.getByLabelText('Line pattern'), 'dotted')
    await user.selectOptions(screen.getByLabelText('Line ends'), 'both')
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('dash pattern=on 0pt off 2pt')
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('<->')
    await user.selectOptions(screen.getByLabelText('Fill type'), 'gradient')
    expect(screen.getByLabelText('Gradient end')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send to back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Duplicate selected layer' })).toBeEnabled()
  })

  it('reshapes a line by dragging either endpoint', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Line' }))
    const canvas = screen.getByLabelText('Figure artboard'); Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
    fireEvent.pointerDown(screen.getByLabelText('Point handle 2'), { pointerId: 14, clientX: 189, clientY: 407 })
    fireEvent.pointerUp(canvas, { pointerId: 14, clientX: 260, clientY: 300 })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toMatch(/-- \(6\.879,5\.821\)/)
  })

  it('unlocks a locked layer from the layers panel', async () => {
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    await user.click(screen.getByRole('button', { name: 'Lock selected layer' }))
    await user.click(screen.getByRole('button', { name: 'Unlock Rectangle' }))
    expect(screen.getByRole('button', { name: 'Lock Rectangle' })).toBeEnabled()
  })

  it('changes connector routing and detaches an endpoint in empty space', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Ellipse' })); await user.click(screen.getByRole('button', { name: 'Connector' }))
    const shapes = screen.getAllByTestId('shape'); const hit = vi.fn(() => shapes[1]); Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit })
    const canvas = screen.getByLabelText('Figure artboard'); Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
    fireEvent.pointerDown(shapes[0], { pointerId: 20, clientX: 80, clientY: 400 }); fireEvent.pointerUp(canvas, { pointerId: 20, clientX: 220, clientY: 350 })
    await user.selectOptions(screen.getByLabelText('Connector route'), 'elbow'); expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain(' -| ')
    hit.mockReturnValue(null as unknown as HTMLElement)
    fireEvent.pointerDown(screen.getByLabelText('Point handle 2'), { pointerId: 21, clientX: 220, clientY: 350 }); fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 300, clientY: 250 })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).not.toMatch(/ end=/)
  })

  it('reorders, aligns, distributes, duplicates, and styles selected layers', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' })); await user.click(screen.getByRole('button', { name: 'Ellipse' }))
    await user.click(screen.getByRole('button', { name: 'Send to back' }))
    let source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value; expect(source.indexOf('name=Ellipse')).toBeLessThan(source.indexOf('name=Rectangle'))
    const layers = screen.getAllByRole('button', { name: /Rectangle|Ellipse/ }).filter((button) => button.className === 'layer-name'); await user.click(layers[0]); await user.keyboard('{Shift>}'); await user.click(layers[1]); await user.keyboard('{/Shift}')
    await user.click(screen.getByRole('button', { name: 'Align left' })); source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value; expect(source).toContain('(1.5,1.5) rectangle'); expect(source).toContain('(3.25,2.95) ellipse')
    await user.click(screen.getByRole('button', { name: 'Duplicate selected layer' })); expect(screen.getAllByTestId('shape')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '0.5' } }); fireEvent.change(screen.getByLabelText('Stroke color'), { target: { value: '#ff0000' } })
    source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value; expect(source).toContain('opacity=0.5'); expect(source).toContain('red,255;green,0;blue,0')
  })

  it('creates and resizes each new diagram primitive', async () => {
    const user = userEvent.setup(); render(<App />)
    for (const name of ['Rounded rectangle', 'Triangle', 'Diamond']) { await user.click(screen.getByRole('button', { name })); expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('3.5') }
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toContain('kind=roundrect'); expect(source).toContain('kind=triangle'); expect(source).toContain('kind=diamond'); expect(source).toContain('rounded corners=0.2cm'); expect(source).toContain('-- cycle')
  })
})
