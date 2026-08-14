import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
const backend = vi.hoisted(() => ({
  desktopFeaturesAvailable: () => true, createProject: vi.fn(async () => ({ handle: 'test', title: 'Diagram', source: String.raw`\begin{tikzpicture}
\shade (0,0) circle (1);
\end{tikzpicture}` })), openProject: vi.fn(), saveProject: vi.fn(async () => undefined), checkpointProject: vi.fn(async () => undefined), writeAsset: vi.fn(async () => undefined), listHistory: vi.fn(async () => []), restoreCommit: vi.fn(), compileProject: vi.fn(), askClaude: vi.fn(), resetClaudeConversation: vi.fn(async () => undefined), claudeStatus: vi.fn(async (): Promise<import('./services/backend').ClaudeStatus> => ({ status: 'ready', method: 'oauth' })), claudeLogin: vi.fn(async () => true),
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
  it('adds a dimension annotation with a length label', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Dimension' }))
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toContain('|-|')
    expect(source).toContain('3.5 cm')
  })

  it('applies an assistant suggestion that inserts a new shape', async () => {
    backend.askClaude.mockResolvedValueOnce({
      status: 'ok',
      text: 'Added a box.',
      operations: [{ type: 'insert', node: { id: 'new-box', kind: 'rect', geometry: { x: 1, y: 1, width: 3, height: 2 }, style: { fill: '#90baff' } } }],
    })
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Assistant' }))
    await user.type(screen.getByLabelText('Assistant request'), 'add a box')
    await user.click(screen.getByRole('button', { name: 'Request suggestion' }))
    expect(await screen.findByRole('button', { name: 'Apply suggestion' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }))
    await user.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('rectangle')
  })

  it('scales the whole figure to a target column width', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    fireEvent.change(screen.getByLabelText('Fit width cm'), { target: { value: '8.8' } })
    await user.click(screen.getByRole('button', { name: 'Fit' }))
    expect(screen.getByLabelText<HTMLInputElement>('Canvas width').value).toBe('333')
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).not.toContain('(1.5,1.5) rectangle')
  })

  it('explains and starts Claude Code login when not authenticated', async () => {
    backend.claudeStatus.mockResolvedValueOnce({ status: 'not_logged_in' })
    const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(await screen.findByRole('button', { name: 'Log in to Claude' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request suggestion' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Log in to Claude' }))
    expect(backend.claudeLogin).toHaveBeenCalledOnce()
    backend.claudeStatus.mockResolvedValueOnce({ status: 'ready', method: 'oauth' })
    await user.click(screen.getByRole('button', { name: 'Re-check' }))
    expect(await screen.findByText('● Claude Code connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🪄 Auto-Align & Tidy' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Log in to Claude' })).not.toBeInTheDocument()
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

  it('centers shapes on the canvas and matches dimensions', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    await user.click(screen.getByRole('button', { name: 'Center Canvas H' }))
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toMatch(/rectangle \(\d+\.\d+/)

    await user.click(screen.getByRole('button', { name: 'Ellipse' }))
    const layers = screen.getAllByRole('button', { name: /Rectangle|Ellipse/ }).filter((b) => b.className === 'layer-name')
    await user.click(layers[0]); await user.keyboard('{Shift>}'); await user.click(layers[1]); await user.keyboard('{/Shift}')
    expect(screen.getByRole('button', { name: 'Match Width' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Match Width' }))
  })

  it('filters layers and offers AI quick action prompt chips', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    await user.type(screen.getByPlaceholderText('Filter layers...'), 'Rect')
    const layerBtn = screen.getAllByRole('button', { name: /Rectangle/ }).find((b) => b.className === 'layer-name')
    expect(layerBtn).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(screen.getByRole('button', { name: '🪄 Auto-Align & Tidy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🎨 IEEE Publication Palette' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '🪄 Auto-Align & Tidy' }))
    expect(backend.askClaude).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('Align all shapes'))
  })

  it('supports copy and paste of selected shapes', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    expect(screen.getAllByTestId('shape')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Copy selection' }))
    await user.click(screen.getByRole('button', { name: 'Paste selection' }))
    expect(screen.getAllByTestId('shape')).toHaveLength(2)
  })

  it('supports multi-selection and universal line routing', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Line' }))
    const routingSelect = screen.getByLabelText('Connector route')
    expect(routingSelect).toBeInTheDocument()
    fireEvent.change(routingSelect, { target: { value: 'elbow' } })
    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toContain('routing=elbow')
  })

  it('supports rich multi-line text, shape border patterns, and manual canvas sizing', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    
    // Set dashed line pattern on shape border
    const dashSelect = screen.getByLabelText('Line pattern')
    fireEvent.change(dashSelect, { target: { value: 'dashed' } })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('dash pattern=on 4pt off 3pt')

    // Enter multi-line text and rich formatting
    const textInput = screen.getByLabelText('Text content')
    fireEvent.change(textInput, { target: { value: 'Header\nSubline' } })
    await user.click(screen.getByLabelText('Bold text'))
    await user.click(screen.getByLabelText('Italic text'))
    await user.click(screen.getByLabelText('Text align left'))

    const source = screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value
    expect(source).toContain('bold=true')
    expect(source).toContain(String.raw`\textbf{\textit{Header}} \\ \textbf{\textit{Subline}}`)

    // Change canvas width and height manually
    const widthInput = screen.getByLabelText('Canvas width')
    const heightInput = screen.getByLabelText('Canvas height')
    fireEvent.change(widthInput, { target: { value: '1200' } })
    fireEvent.change(heightInput, { target: { value: '750' } })
    expect(screen.getByLabelText('Figure artboard')).toHaveAttribute('viewBox', '0 0 1200 750')
  })

  it('supports saving as .tex source and opening .tex files directly', async () => {
    const user = userEvent.setup(); render(<App />)
    
    // Test Save .tex button
    const saveBtn = screen.getByRole('button', { name: 'Save TeX file' })
    expect(saveBtn).toBeInTheDocument()
    await user.click(saveBtn)
    expect(screen.getByText(/Saved/i)).toBeInTheDocument()

    // Test opening a .tex file
    const sampleTex = `\\begin{tikzpicture}
\\node[draw=none, fill=none] (node-1) at (2, 3) {Imported TeX};
\\end{tikzpicture}`
    const file = new File([sampleTex], 'diagram.tex', { type: 'text/plain' })
    const fileInput = screen.getByLabelText('TeX file')
    await user.upload(fileInput, file)

    expect(screen.getByText('diagram.tex')).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('Imported TeX')
  })

  it('opens a desktop project separately from a standalone TeX file', async () => {
    backend.openProject.mockResolvedValueOnce({
      handle: 'opened-project',
      title: 'Existing project',
      source: String.raw`\begin{tikzpicture}
\end{tikzpicture}`,
    })
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open project' }))
    expect(backend.openProject).toHaveBeenCalledOnce()
    expect(screen.getByText('Existing project')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open TeX file' })).toBeInTheDocument()
  })

  it('does not persist standalone TeX edits through a fabricated project handle', async () => {
    backend.saveProject.mockClear()
    const user = userEvent.setup(); render(<App />)
    const file = new File([
      String.raw`\begin{tikzpicture}
\end{tikzpicture}`,
    ], 'standalone.tex', { type: 'text/plain' })
    await user.upload(screen.getByLabelText('TeX file'), file)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    expect(backend.saveProject).not.toHaveBeenCalled()
    expect(screen.getByText('standalone.tex')).toBeInTheDocument()
  })

  it('shows tools as icon-only buttons with hover tooltips', async () => {
    render(<App />)
    const rect = screen.getByRole('button', { name: 'Rectangle' })
    expect(rect.querySelector('svg')).not.toBeNull()
    expect(rect.textContent?.trim()).toBe('')
    expect(rect.getAttribute('data-tip')).toContain('Rectangle')
    expect(rect.getAttribute('data-tip')).toContain('R')
    expect(screen.getByRole('button', { name: 'Select' }).getAttribute('data-tip')).toContain('V')
  })

  it('offers a Photoshop-like options bar for the active tool', async () => {
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rectangle' }))
    expect(screen.getByLabelText('Tool fill')).toBeInTheDocument()
    expect(screen.getByLabelText('Tool stroke')).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>('Tool fill color').value).toBe('#90baff')
    fireEvent.change(screen.getByLabelText('Tool fill'), { target: { value: '#ff00aa' } })
    expect(screen.getByLabelText<HTMLTextAreaElement>('TikZ source').value).toContain('red,255;green,0;blue,170')
  })

  it('toggles panels from the Window menu and restores them', async () => {
    const user = userEvent.setup(); render(<App />)
    expect(screen.getByPlaceholderText('Filter layers...')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Window/ }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Layers/ }))
    expect(screen.queryByPlaceholderText('Filter layers...')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Layers/ }))
    expect(screen.getByPlaceholderText('Filter layers...')).toBeInTheDocument()
  })

  it('moves a panel between docks and collapses it', async () => {
    const user = userEvent.setup(); render(<App />)
    const store: Record<string, string> = {}
    const dataTransfer = { setData: (type: string, value: string) => { store[type] = value }, getData: (type: string) => store[type] ?? '', effectAllowed: 'move', dropEffect: 'move' }
    const assistantTab = screen.getByRole('button', { name: 'Assistant' })
    const dockRight = screen.getByRole('complementary', { name: 'Right panels' })
    fireEvent.dragStart(assistantTab, { dataTransfer })
    fireEvent.dragOver(dockRight, { dataTransfer })
    fireEvent.drop(dockRight, { dataTransfer })
    expect(screen.getByRole('button', { name: 'Collapse Assistant panel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse Assistant panel' }))
    expect(screen.getByRole('button', { name: 'Expand Assistant panel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request suggestion' })).not.toBeInTheDocument()
  })
})

