import { describe, expect, it } from 'vitest'
import {
  applySceneTransaction,
  commitHistory,
  connectorAnchorPoint,
  createDefaultDocument,
  createHistory,
  parseTikz,
  redoHistory,
  sceneToClaudeContext,
  serializeDocument,
  flattenRenderableNodes,
  undoHistory,
} from './index'

const fixture = String.raw`\begin{tikzpicture}
% figureit: id=box name=Box visible=true locked=false
\draw (0,0) rectangle (2,1);
\shade (0,0) circle (1); % unsupported but sacred
% figureit: id=label name=Caption
\node at (1,2) {Hello caption};
\end{tikzpicture}
`

describe('TikZ scene document', () => {
  it('projects editable statements while retaining unsupported source byte-for-byte', () => {
    const parsed = parseTikz(fixture)
    expect(parsed.errors).toEqual([])
    expect(parsed.document.nodes.map((node) => node.kind)).toEqual(['rect', 'raw', 'text'])
    expect(parsed.document.nodes[0]).toMatchObject({ id: 'box', name: 'Box', visible: true, locked: false })

    const moved = applySceneTransaction(parsed.document, {
      baseRevision: parsed.document.revision,
      operations: [{ type: 'move', id: 'box', dx: 3, dy: -1 }],
    })
    expect(moved.ok).toBe(true)
    expect(serializeDocument(moved.document!)).toContain('\\shade (0,0) circle (1); % unsupported but sacred')
  })

  it('preserves unsupported draw commands and layer names with spaces', () => {
    const source = String.raw`\begin{tikzpicture}
% figureit: id=circle name=Reference circle
\draw (0,0) circle (1);
\end{tikzpicture}`
    const document = parseTikz(source).document
    expect(document.nodes[0]).toMatchObject({ kind: 'raw' })
    expect(serializeDocument(document)).toContain('\\draw (0,0) circle (1);')

    const named = createDefaultDocument()
    named.nodes[0].name = 'Primary rectangle'
    expect(parseTikz(serializeDocument(named)).document.nodes[0].name).toBe('Primary rectangle')
  })

  it('round trips generated source and has path-free Claude context', () => {
    const document = createDefaultDocument()
    const reparsed = parseTikz(serializeDocument(document)).document
    expect(reparsed.nodes.map((node) => node.kind)).toEqual(document.nodes.map((node) => node.kind))
    expect(JSON.stringify(sceneToClaudeContext(document))).not.toMatch(/(?:^|[\\/])Users(?:[\\/]|$)/)
  })

  it('rejects stale revisions and invalid targets without mutation', () => {
    const document = createDefaultDocument()
    const stale = applySceneTransaction(document, { baseRevision: 4, operations: [] })
    const bad = applySceneTransaction(document, {
      baseRevision: document.revision,
      operations: [{ type: 'move', id: 'missing', dx: 1, dy: 1 }],
    })
    expect(stale).toMatchObject({ ok: false, error: 'stale_revision' })
    expect(bad).toMatchObject({ ok: false, error: 'invalid_target' })
    expect(document.revision).toBe(0)
  })

  it('undoes and redoes a committed transaction', () => {
    const initial = createDefaultDocument()
    const changed = applySceneTransaction(initial, {
      baseRevision: 0,
      operations: [{ type: 'move', id: initial.nodes[0].id, dx: 1, dy: 2 }],
    }).document!
    const history = commitHistory(createHistory(initial), changed)
    expect(undoHistory(history).present).toEqual(initial)
    expect(redoHistory(undoHistory(history)).present).toEqual(changed)
  })

  it('parses and round trips generated styled geometry', () => {
    const parsed = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=styled
\draw[draw=red,fill=blue,line width=0.1cm] (1,2) rectangle (4,6);
\end{tikzpicture}
`)
    const node = parsed.document.nodes[0]
    expect(node).toMatchObject({
      kind: 'rect',
      geometry: { x: 1, y: 2, width: 3, height: 4 },
      style: { stroke: 'red', fill: 'blue', strokeWidth: 0.1 },
    })
    expect(parseTikz(serializeDocument(parsed.document)).document.nodes[0]).toMatchObject(node)
  })

  it('updates geometry, rotation and style into equivalent TikZ', () => {
    const initial = createDefaultDocument()
    const result = applySceneTransaction(initial, {
      baseRevision: initial.revision,
      operations: [{ type: 'update_properties', id: 'default-rect', geometry: { width: 5, height: 4 }, style: { fill: 'orange' }, transform: { rotate: 30 } }],
    })
    expect(result.ok).toBe(true)
    expect(serializeDocument(result.document!)).toContain('cm={0.866025,0.5,-0.5,0.866025,(1.334936,-0.982051)}')
    expect(parseTikz(serializeDocument(result.document!)).document.nodes[0]).toMatchObject({ geometry: { width: 5, height: 4 }, style: { fill: 'orange' }, transform: { rotate: 30 } })
  })

  it('groups, ungroups, and keeps child IDs and order', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=a
\draw (0,0) rectangle (1,1);
% figureit: id=b
\draw (2,0) rectangle (3,1);
\end{tikzpicture}
`).document
    const grouped = applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'group', id: 'g', childIds: ['a', 'b'] }] }).document!
    expect(grouped.nodes[0]).toMatchObject({ id: 'g', kind: 'group', children: [{ id: 'a' }, { id: 'b' }] })
    const ungrouped = applySceneTransaction(grouped, { baseRevision: 1, operations: [{ type: 'ungroup', id: 'g' }] }).document!
    expect(ungrouped.nodes.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('parses a tikzpicture whose body is on the same line', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}\draw (0,0) rectangle (1,1);\end{tikzpicture}`).document
    expect(document.nodes[0]).toMatchObject({ kind: 'rect', geometry: { width: 1, height: 1 } })
  })

  it('serializes CSS hex colours as xcolor and parses them back', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=hex
\draw (0,0) rectangle (1,1);
\end{tikzpicture}`).document
    const updated = applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'update_properties', id: 'hex', style: { stroke: '#1020ff', fill: '#a0b1c2' } }] }).document!
    const source = serializeDocument(updated)
    expect(source).toContain('{rgb,255:red,16;green,32;blue,255}')
    expect(parseTikz(source).document.nodes[0].style).toMatchObject({ stroke: '#1020ff', fill: '#a0b1c2' })
  })

  it('serializes hidden nodes and groups invisibly without losing their styling', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=g visible=false
\begin{scope}
% figureit: id=child visible=true
\draw[fill=blue,opacity=0.4] (0,0) rectangle (1,1);
\end{scope}
\end{tikzpicture}`).document
    const source = serializeDocument(document)
    expect(source).toContain('opacity=0')
    const reopened = parseTikz(source).document.nodes[0]
    expect(reopened).toMatchObject({ visible: false, children: [{ visible: true, style: { fill: 'blue', opacity: 0.4 } }] })
  })

  it('flattens renderable nodes with ancestor state and composed transforms', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=g visible=false locked=true
\begin{scope}[shift={(1,2)},rotate=30,xscale=2,yscale=3]
% figureit: id=child visible=true locked=false
\draw (0,0) rectangle (1,1);
\end{scope}
\end{tikzpicture}`).document
    expect(flattenRenderableNodes(document)).toMatchObject([{ id: 'child', visible: false, locked: true, transform: { translate: { x: 1, y: 2 }, rotate: 30, xScale: 2, yScale: 3 } }])
  })

  it('serializes connectors with one option list', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}\draw[->,draw=black] (0,0) -- (1,1);\end{tikzpicture}`).document
    const source = serializeDocument(document)
    expect(source).toContain('\\draw[draw=black,->]')
    expect(source).not.toContain('][->]')
  })

  it('moves editable geometry and emits readable canonical numbers', () => {
    const document = createDefaultDocument()
    const moved = applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'move', id: 'default-rect', dx: 1 / 3, dy: -2 / 3 }] }).document!
    expect(moved.nodes[0]).toMatchObject({ geometry: { x: 1 / 3, y: -2 / 3 }, transform: { translate: { x: 0, y: 0 } } })
    expect(serializeDocument(moved)).toContain('(0.333333,-0.666667) rectangle (3.333333,1.333333);\n\\end{tikzpicture}')
  })

  it('keeps connector anchors attached when shapes move or resize and after reopen', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=a
\draw (0,0) rectangle (2,2);
% figureit: id=b
\draw (6,0) rectangle (8,2);
\end{tikzpicture}`).document
    const inserted = applySceneTransaction(document, {
      baseRevision: 0,
      operations: [{ type: 'insert', node: {
        id: 'wire', kind: 'connector', name: 'Connector', visible: true, locked: false,
        transform: { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 },
        geometry: { points: [{ x: 2, y: 2 }, { x: 6, y: 0 }] },
        bindings: { start: { nodeId: 'a', anchor: 'top-right' }, end: { nodeId: 'b', anchor: 'bottom-left' }, routing: 'elbow' },
        style: { stroke: '#111111', strokeWidth: 0.06, dash: 'dotted', arrow: '<->' },
        prefix: '\n', source: '',
      } }],
    }).document!
    const changed = applySceneTransaction(inserted, {
      baseRevision: 1,
      operations: [
        { type: 'move', id: 'a', dx: 1, dy: 0.5 },
        { type: 'update_properties', id: 'b', geometry: { x: 7, y: -1 } },
      ],
    }).document!
    expect(changed.nodes[2].geometry?.points).toEqual([{ x: 3, y: 2.5 }, { x: 7, y: -1 }])
    const source = serializeDocument(changed)
    expect(source).toContain('start=a%40top-right end=b%40bottom-left routing=elbow')
    expect(source).toContain('dash pattern=on 0pt off 2pt,<->')
    expect(source).toContain('(3,2.5) -| (7,-1)')
    expect(parseTikz(source).document.nodes[2]).toMatchObject({
      kind: 'connector',
      bindings: { start: { nodeId: 'a', anchor: 'top-right' }, end: { nodeId: 'b', anchor: 'bottom-left' }, routing: 'elbow' },
    })
  })

  it('round trips diagram primitives and gradient fills', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=shape kind=roundrect
\draw[shade,left color=red,right color=blue,shading angle=45,rounded corners=0.2cm] (0,0) rectangle (3,2);
\end{tikzpicture}`).document
    expect(document.nodes[0]).toMatchObject({ kind: 'roundrect', style: { gradient: { start: 'red', end: 'blue', angle: 45 } } })
    expect(serializeDocument(document)).toContain('left color=red,right color=blue,shading angle=45')
  })

  it('allows a locked layer to be unlocked but rejects other edits while locked', () => {
    const document = createDefaultDocument()
    document.nodes[0].locked = true
    expect(applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'move', id: 'default-rect', dx: 1, dy: 0 }] })).toMatchObject({ ok: false, error: 'locked' })
    expect(applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'set_metadata', id: 'default-rect', locked: false }] }).document?.nodes[0].locked).toBe(false)
  })

  it('serializes flips around the object centre and preserves the editable transform', () => {
    const document = createDefaultDocument()
    const flipped = applySceneTransaction(document, { baseRevision: 0, operations: [{ type: 'transform', id: 'default-rect', transform: { xScale: -1 } }] }).document!
    const source = serializeDocument(flipped)
    expect(source).toContain('xscale=-1')
    expect(source).toContain('cm={-1,0,0,1,(3,0)}')
    expect(parseTikz(source).document.nodes[0].transform.xScale).toBe(-1)
  })

  it('uses one lower-left geometry convention for ellipses, connectors, and TikZ', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=oval kind=ellipse
\draw (4,3) ellipse (2 and 1);
\end{tikzpicture}`).document
    expect(document.nodes[0].geometry).toEqual({ x: 2, y: 2, width: 4, height: 2 })
    expect(connectorAnchorPoint(document.nodes[0], 'left')).toEqual({ x: 2, y: 3 })
    expect(serializeDocument(document)).toContain('(4,3) ellipse (2 and 1)')
  })

  it('keeps connector anchors on transformed shape connection sites', () => {
    const node = createDefaultDocument().nodes[0]
    node.geometry = { x: 0, y: 0, width: 2, height: 2 }
    node.transform = { translate: { x: 3, y: 4 }, rotate: 90, xScale: 2, yScale: 1 }
    expect(connectorAnchorPoint(node, 'right')).toMatchObject({ x: 4, y: 7 })
  })

  it('round trips image bounds without shifting the exported image', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=photo kind=image
\node at (4,3) {\includegraphics[width=2cm,height=1cm]{assets/photo.png}};
\end{tikzpicture}`).document
    expect(document.nodes[0]).toMatchObject({ geometry: { x: 3, y: 2.5, width: 2, height: 1 }, image: { width: 2, height: 1 } })
    expect(serializeDocument(document)).toContain('at (4,3) {\\includegraphics[width=2cm,height=1cm]')
  })

  it('round trips shapes with embedded text labels', () => {
    const document = parseTikz(String.raw`\begin{tikzpicture}
% figureit: id=box kind=rect
\draw[draw=black] (0,0) rectangle (3,2) node[pos=0.5] {Server Box};
\end{tikzpicture}`).document
    expect(document.nodes[0]).toMatchObject({ kind: 'rect', text: 'Server Box' })
    const source = serializeDocument(document)
    expect(source).toContain('node[pos=0.5] {Server Box}')
    expect(parseTikz(source).document.nodes[0].text).toBe('Server Box')
  })
})

