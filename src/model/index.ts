export type Transform = { translate: { x: number; y: number }; rotate: number; xScale: number; yScale: number }
export type ScenePoint = { x: number; y: number }
export type SceneGeometry = { x?: number; y?: number; width?: number; height?: number; points?: ScenePoint[] }
export type SceneStyle = { stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; dash?: string; arrow?: string }
export type ImageProperties = { href: string; width?: number; height?: number }
export const PX_PER_CM = 37.7952755906
export type NodeKind = 'group' | 'rect' | 'ellipse' | 'line' | 'path' | 'text' | 'math' | 'connector' | 'image' | 'raw'

type NodeBase = {
  id: string
  kind: NodeKind
  name?: string
  visible: boolean
  locked: boolean
  transform: Transform
  geometry?: SceneGeometry
  style?: SceneStyle
  text?: string
  image?: ImageProperties
  prefix: string
  source: string
}

export type SceneNode = NodeBase & { children?: SceneNode[] }
export type SceneDocument = { revision: number; prefix: string; nodes: SceneNode[]; suffix: string }
export type ParseResult = { document: SceneDocument; errors: string[] }
export type SceneOperation =
  | { type: 'move'; id: string; dx: number; dy: number }
  | { type: 'transform'; id: string; transform: Partial<Transform> }
  | { type: 'set_metadata'; id: string; name?: string; visible?: boolean; locked?: boolean }
  | { type: 'replace_source'; id: string; source: string }
  | { type: 'update_properties'; id: string; geometry?: Partial<SceneGeometry>; style?: Partial<SceneStyle>; text?: string; image?: Partial<ImageProperties>; transform?: Partial<Transform> }
  | { type: 'delete'; id: string }
  | { type: 'insert'; parentId?: string; node: SceneNode; index?: number }
  | { type: 'reorder'; id: string; parentId?: string; index: number }
  | { type: 'group'; id?: string; childIds: string[]; parentId?: string; name?: string }
  | { type: 'ungroup'; id: string }
export type SceneTransaction = { baseRevision: number; operations: SceneOperation[] }
export type TransactionResult = { ok: true; document: SceneDocument } | { ok: false; document?: undefined; error: 'stale_revision' | 'invalid_target' | 'locked' | 'invalid_operation' }
export type SceneHistory = { past: SceneDocument[]; present: SceneDocument; future: SceneDocument[]; limit: number }

const identity = (): Transform => ({ translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 })
let newId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `node-${Math.random().toString(36).slice(2)}`

/** Lets tests use deterministic IDs without weakening production UUID generation. */
export const setIdFactoryForTests = (factory: (() => string) | undefined) => { newId = factory ?? (() => globalThis.crypto?.randomUUID?.() ?? `node-${Math.random().toString(36).slice(2)}`) }

export const DEFAULT_TIKZ_SOURCE = String.raw`\begin{tikzpicture}
% figureit: id=default-rect name=Rectangle visible=true locked=false
\draw (0,0) rectangle (3,2);
\end{tikzpicture}
`

type Metadata = Pick<SceneNode, 'id' | 'name' | 'visible' | 'locked'>

const metadataFrom = (line: string): Metadata | undefined => {
  if (!/^\s*%\s*figureit\s*:/i.test(line)) return undefined
  const values = Object.fromEntries([...line.matchAll(/([\w-]+)=("[^"]*"|'[^']*'|\S+)/g)].map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]))
  let name = values.name
  try { if (name) name = decodeURIComponent(name) } catch { /* retain hand-written metadata */ }
  return { id: values.id || newId(), name, visible: values.visible !== 'false', locked: values.locked === 'true' }
}

const metaLine = (node: SceneNode) => `% figureit: id=${node.id}${node.name ? ` name=${encodeURIComponent(node.name)}` : ''} visible=${node.visible} locked=${node.locked}\n`
const isIdentity = (t: Transform) => t.translate.x === 0 && t.translate.y === 0 && t.rotate === 0 && t.xScale === 1 && t.yScale === 1
const cloneTransform = (t: Transform): Transform => ({ translate: { ...t.translate }, rotate: t.rotate, xScale: t.xScale, yScale: t.yScale })

const scan = (source: string): string[] => {
  const out: string[] = []
  let at = 0
  while (at < source.length) {
    const rest = source.slice(at)
    const scope = rest.match(/^\s*\\(?:begin|end)\{scope\}[^\n]*(?:\n|$)/)
    if (scope) { out.push(scope[0]); at += scope[0].length; continue }
    const comment = rest.match(/^\s*%[^\n]*(?:\n|$)/)
    if (comment) { out.push(comment[0]); at += comment[0].length; continue }
    let brace = 0
    let found = -1
    for (let i = at; i < source.length; i += 1) {
      if (source[i] === '%' && (i === 0 || source[i - 1] === '\n')) { const nl = source.indexOf('\n', i); i = nl < 0 ? source.length : nl; continue }
      if (source[i] === '{') brace += 1
      if (source[i] === '}') brace = Math.max(0, brace - 1)
      if (source[i] === ';' && brace === 0) { found = i + 1; break }
    }
    if (found < 0) { out.push(source.slice(at)); break }
    const trailingComment = source.slice(found).match(/^[ \t]*%[^\n]*/)?.[0] ?? ''
    out.push(source.slice(at, found + trailingComment.length)); at = found + trailingComment.length
  }
  return out
}

const kindFor = (source: string): NodeKind => {
  const text = source.replace(/^\s*/, '')
  if (/\\node\b/.test(text)) return /includegraphics/.test(text) ? 'image' : /\$[^$]+\$/.test(text) ? 'math' : 'text'
  if (/\\(?:draw|path)\b/.test(text)) {
    if (/rectangle\b/.test(text)) return 'rect'
    if (/ellipse\b/.test(text)) return 'ellipse'
    if (!/--/.test(text)) return 'raw'
    if (/->|<-|<->/.test(text)) return 'connector'
    return (text.match(/--/g)?.length ?? 0) <= 1 ? 'line' : 'path'
  }
  return 'raw'
}

const number = (value: string | undefined) => value === undefined ? undefined : Number(value.replace(/cm$/, ''))
const coordinates = (source: string): ScenePoint[] => [...source.matchAll(/\(([-.\d]+),\s*([-.\d]+)\)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
const optionsFor = (source: string) => source.match(/\\(?:draw|path|node)\s*\[([^\]]*)\]/)?.[1] ?? ''
const styleFor = (source: string): SceneStyle | undefined => {
  const options = optionsFor(source)
  const xcolor = (name: string) => {
    const match = options.match(new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*\\{rgb,255:red,(\\d+);green,(\\d+);blue,(\\d+)\\}`))
    return match ? `#${match.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}` : undefined
  }
  const option = (names: string[]) => names.map((name) => options.match(new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*([^,]+)`))?.[1]?.trim()).find(Boolean)
  const style: SceneStyle = { stroke: xcolor('draw') ?? xcolor('stroke') ?? option(['draw', 'stroke']), fill: xcolor('fill') ?? option(['fill']), strokeWidth: number(option(['line width', 'stroke width'])), opacity: number(option(['opacity'])), dash: option(['dash pattern']), arrow: option(['->', '<-', '<->']) }
  return Object.values(style).some((value) => value !== undefined) ? style : undefined
}
const propertiesFor = (kind: NodeKind, source: string): Pick<SceneNode, 'geometry' | 'style' | 'text' | 'image' | 'transform'> => {
  const points = coordinates(source.replace(/\[[^\]]*\]/g, ''))
  const geometry: SceneGeometry | undefined = kind === 'rect' && points.length >= 2 ? { x: points[0].x, y: points[0].y, width: points[1].x - points[0].x, height: points[1].y - points[0].y }
    : kind === 'ellipse' && points.length >= 1 ? (() => { const radii = source.match(/ellipse\s*\(([-.\d]+)\s*and\s*([-.\d]+)\)/); return radii ? { x: points[0].x, y: points[0].y, width: Number(radii[1]) * 2, height: Number(radii[2]) * 2 } : { x: points[0].x, y: points[0].y } })()
      : ['line', 'path', 'connector'].includes(kind) ? { points } : ['text', 'math', 'image'].includes(kind) && points[0] ? { x: points[0].x, y: points[0].y } : undefined
  const content = source.match(/\{([^{}]*)\}\s*;?\s*(?:%.*)?$/)?.[1]
  const imageMatch = source.match(/\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/)
  const image = imageMatch ? { href: imageMatch[2], width: number(imageMatch[1]?.match(/width\s*=\s*([-.\d]+cm?)/)?.[1]), height: number(imageMatch[1]?.match(/height\s*=\s*([-.\d]+cm?)/)?.[1]) } : undefined
  return { ...(geometry ? { geometry } : {}), ...(styleFor(source) ? { style: styleFor(source) } : {}), ...((kind === 'text' || kind === 'math') && content ? { text: content } : {}), ...(image ? { image } : {}), transform: scopeTransform(source) }
}

const scopeTransform = (source: string): Transform => {
  const t = identity()
  const option = source.match(/\[([^\]]*)\]/)?.[1] ?? ''
  const shift = option.match(/shift=\{?\(([-.\d]+),\s*([-.\d]+)\)\}?/)
  if (shift) t.translate = { x: Number(shift[1]), y: Number(shift[2]) }
  const read = (name: string, fallback: number) => Number(option.match(new RegExp(`${name}\\s*=\\s*([-.\\d]+)`))?.[1] ?? fallback)
  t.rotate = read('rotate', 0); t.xScale = read('xscale', 1); t.yScale = read('yscale', 1)
  return t
}

export const parseTikz = (source: string): ParseResult => {
  const begin = source.search(/\\begin\{tikzpicture\}/)
  const endMatch = [...source.matchAll(/\\end\{tikzpicture\}/g)].at(-1)
  if (begin < 0 || !endMatch?.index) return { document: { revision: 0, prefix: '', nodes: [{ id: newId(), kind: 'raw', visible: true, locked: false, transform: identity(), prefix: '', source }], suffix: '' }, errors: ['Missing tikzpicture environment'] }
  const beginEnd = source.indexOf('}', begin) + 1
  const bodyStart = source[beginEnd] === '\n' ? beginEnd + 1 : beginEnd
  const end = endMatch.index
  const prefix = source.slice(0, bodyStart)
  const suffix = source.slice(end)
  const roots: SceneNode[] = []
  const stack: SceneNode[][] = [roots]
  const groups: SceneNode[] = []
  let pending = ''
  let metadata: Metadata | undefined
  for (const token of scan(source.slice(bodyStart, end))) {
    const parsedMeta = metadataFrom(token)
    if (parsedMeta) { metadata = parsedMeta; continue }
    if (/^\s*\\begin\{scope\}/.test(token)) {
      const group: SceneNode = { id: metadata?.id ?? newId(), kind: 'group', name: metadata?.name, visible: metadata?.visible ?? true, locked: metadata?.locked ?? false, transform: scopeTransform(token), prefix: pending, source: '', children: [] }
      pending = ''; metadata = undefined; stack.at(-1)!.push(group); groups.push(group); stack.push(group.children!)
      continue
    }
    if (/^\s*\\end\{scope\}/.test(token) && stack.length > 1) { groups.at(-1)!.source = token; groups.pop(); stack.pop(); continue }
    if (!/\S/.test(token)) { pending += token; continue }
    const kind = kindFor(token)
    const itemMetadata = kind === 'raw' ? undefined : metadata
    stack.at(-1)!.push({ id: itemMetadata?.id ?? newId(), kind, name: itemMetadata?.name, visible: itemMetadata?.visible ?? true, locked: itemMetadata?.locked ?? false, prefix: pending, source: token, ...propertiesFor(kind, token) })
    pending = ''; if (itemMetadata) metadata = undefined
  }
  if (pending && /\S/.test(pending)) roots.push({ id: newId(), kind: 'raw', visible: true, locked: false, transform: identity(), prefix: '', source: pending })
  return { document: { revision: 0, prefix, nodes: roots, suffix: pending && !/\S/.test(pending) ? pending + suffix : suffix }, errors: stack.length === 1 ? [] : ['Unclosed scope'] }
}

const transformOptions = (t: Transform) => `shift={(${t.translate.x},${t.translate.y})},rotate=${t.rotate},xscale=${t.xScale},yscale=${t.yScale}`
const tikzColor = (color: string) => /^#[\da-f]{6}$/i.test(color)
  ? `{rgb,255:red,${Number.parseInt(color.slice(1, 3), 16)};green,${Number.parseInt(color.slice(3, 5), 16)};blue,${Number.parseInt(color.slice(5, 7), 16)}}`
  : color
const inlineOptions = (node: SceneNode) => {
  const style = node.style
  const parts = [style?.stroke && `draw=${tikzColor(style.stroke)}`, style?.fill && `fill=${tikzColor(style.fill)}`, style?.strokeWidth !== undefined && `line width=${style.strokeWidth}cm`, style?.opacity !== undefined && `opacity=${style.opacity}`, style?.dash && `dash pattern=${style.dash}`, style?.arrow ?? (node.kind === 'connector' ? '->' : undefined), !node.visible && 'opacity=0']
  if (!isIdentity(node.transform)) parts.push(`shift={(${node.transform.translate.x},${node.transform.translate.y})}`, `rotate=${node.transform.rotate}`, `xscale=${node.transform.xScale}`, `yscale=${node.transform.yScale}`)
  const values = parts.filter((value): value is string => Boolean(value))
  return values.length ? `[${values.join(',')}]` : ''
}
const coordinate = (point: ScenePoint) => `(${point.x},${point.y})`
const generatedSource = (node: SceneNode): string | undefined => {
  const geometry = node.geometry
  if (!geometry) return undefined
  const options = inlineOptions(node)
  if (node.kind === 'rect' && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${geometry.x},${geometry.y}) rectangle (${geometry.x + geometry.width},${geometry.y + geometry.height});`
  if (node.kind === 'ellipse' && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${geometry.x},${geometry.y}) ellipse (${geometry.width / 2} and ${geometry.height / 2});`
  if (['line', 'path', 'connector'].includes(node.kind) && geometry.points?.length) return `\\draw${options} ${geometry.points.map(coordinate).join(' -- ')};`
  if ((node.kind === 'text' || node.kind === 'math') && geometry.x !== undefined && geometry.y !== undefined && node.text !== undefined) return `\\node${options} at (${geometry.x},${geometry.y}) {${node.text}};`
  if (node.kind === 'image' && geometry.x !== undefined && geometry.y !== undefined && node.image) {
    const sizes = [node.image.width !== undefined && `width=${node.image.width}cm`, node.image.height !== undefined && `height=${node.image.height}cm`].filter(Boolean).join(',')
    return `\\node${options} at (${geometry.x},${geometry.y}) {\\includegraphics${sizes ? `[${sizes}]` : ''}{${node.image.href}}};`
  }
  return undefined
}
const renderNode = (node: SceneNode): string => {
  if (node.kind === 'raw') return node.prefix + node.source
  const content = node.kind === 'group' ? (node.children ?? []).map(renderNode).join('') : generatedSource(node) ?? node.source
  const wrapped = node.kind === 'group'
    ? `\\begin{scope}[${transformOptions(node.transform)}${node.visible ? '' : ',opacity=0'}]\n${content}${node.source}`
    : content
  return node.prefix + metaLine(node) + wrapped
}

export const serializeDocument = (document: SceneDocument): string => document.prefix + document.nodes.map(renderNode).join('') + document.suffix
export const createDefaultDocument = (): SceneDocument => parseTikz(DEFAULT_TIKZ_SOURCE).document

const findNode = (nodes: SceneNode[], id: string): SceneNode | undefined => {
  for (const node of nodes) { if (node.id === id) return node; const child = node.children && findNode(node.children, id); if (child) return child }
  return undefined
}
const parentIdFor = (nodes: SceneNode[], id: string, parentId?: string): string | undefined => {
  for (const node of nodes) { if (node.id === id) return parentId; const found = node.children && parentIdFor(node.children, id, node.id); if (found !== undefined) return found }
  return undefined
}
const listAt = (nodes: SceneNode[], parentId?: string): SceneNode[] | undefined => parentId === undefined ? nodes : findNode(nodes, parentId)?.kind === 'group' ? findNode(nodes, parentId)?.children : undefined
const replaceList = (nodes: SceneNode[], parentId: string | undefined, list: SceneNode[]): SceneNode[] => parentId === undefined ? list : updateNode(nodes, parentId, (node) => ({ ...node, children: list }))
const updateNode = (nodes: SceneNode[], id: string, change: (node: SceneNode) => SceneNode): SceneNode[] => nodes.map((node) => node.id === id ? change(node) : node.children ? { ...node, children: updateNode(node.children, id, change) } : node)
const removeNode = (nodes: SceneNode[], id: string): SceneNode[] => nodes.filter((node) => node.id !== id).map((node) => node.children ? { ...node, children: removeNode(node.children, id) } : node)

export const applySceneTransaction = (document: SceneDocument, transaction: SceneTransaction): TransactionResult => {
  if (transaction.baseRevision !== document.revision) return { ok: false, error: 'stale_revision' }
  let nodes = document.nodes
  for (const operation of transaction.operations) {
    if (operation.type === 'group') {
      const list = listAt(nodes, operation.parentId)
      const selected = list?.filter((node) => operation.childIds.includes(node.id))
      if (!list || selected?.length !== operation.childIds.length || selected.some((node) => node.kind === 'raw' || node.locked)) return { ok: false, error: 'invalid_target' }
      const first = selected[0]
      const group: SceneNode = { id: operation.id ?? newId(), kind: 'group', name: operation.name, visible: true, locked: false, transform: identity(), prefix: first.prefix, source: '\n\\end{scope}', children: [{ ...first, prefix: '' }, ...selected.slice(1)] }
      let inserted = false
      nodes = replaceList(nodes, operation.parentId, list.reduce<SceneNode[]>((result, node) => {
        if (operation.childIds.includes(node.id)) { if (!inserted) { result.push(group); inserted = true } return result }
        result.push(node); return result
      }, []))
      continue
    }
    if (operation.type === 'ungroup') {
      const group = findNode(nodes, operation.id)
      const parentId = parentIdFor(nodes, operation.id)
      const list = listAt(nodes, parentId)
      if (!group || group.kind !== 'group' || group.locked || !list) return { ok: false, error: 'invalid_target' }
      const children = group.children ?? []
      nodes = replaceList(nodes, parentId, list.flatMap((node) => node.id === group.id ? children.map((child, index) => index === 0 ? { ...child, prefix: group.prefix + child.prefix } : child) : [node]))
      continue
    }
    if (operation.type === 'reorder') {
      const target = findNode(nodes, operation.id)
      const parentId = operation.parentId ?? parentIdFor(nodes, operation.id)
      const list = listAt(nodes, parentId)
      if (!target || target.kind === 'raw' || target.locked || !list || !list.some((node) => node.id === operation.id)) return { ok: false, error: 'invalid_target' }
      const rest = list.filter((node) => node.id !== operation.id)
      nodes = replaceList(nodes, parentId, [...rest.slice(0, operation.index), target, ...rest.slice(operation.index)])
      continue
    }
    if (operation.type === 'insert') {
      const destination = operation.parentId ? findNode(nodes, operation.parentId) : undefined
      if (operation.parentId && (!destination || destination.kind !== 'group' || destination.locked)) return { ok: false, error: 'invalid_target' }
      const insert = (list: SceneNode[]) => [...list.slice(0, operation.index ?? list.length), operation.node, ...list.slice(operation.index ?? list.length)]
      nodes = operation.parentId ? updateNode(nodes, operation.parentId, (node) => ({ ...node, children: insert(node.children ?? []) })) : insert(nodes)
      continue
    }
    const target = findNode(nodes, operation.id)
    if (!target || target.kind === 'raw') return { ok: false, error: 'invalid_target' }
    if (target.locked) return { ok: false, error: 'locked' }
    if (operation.type === 'delete') { nodes = removeNode(nodes, operation.id); continue }
    nodes = updateNode(nodes, operation.id, (node) => {
      if (operation.type === 'move') return { ...node, transform: { ...node.transform, translate: { x: node.transform.translate.x + operation.dx, y: node.transform.translate.y + operation.dy } } }
      if (operation.type === 'transform') return { ...node, transform: { ...node.transform, ...operation.transform, translate: operation.transform.translate ? { ...operation.transform.translate } : node.transform.translate } }
      if (operation.type === 'set_metadata') return { ...node, ...(operation.name === undefined ? {} : { name: operation.name }), ...(operation.visible === undefined ? {} : { visible: operation.visible }), ...(operation.locked === undefined ? {} : { locked: operation.locked }) }
      if (operation.type === 'update_properties') return { ...node, ...(operation.geometry ? { geometry: { ...node.geometry, ...operation.geometry } } : {}), ...(operation.style ? { style: { ...node.style, ...operation.style } } : {}), ...(operation.text === undefined ? {} : { text: operation.text }), ...(operation.image ? { image: { ...node.image, ...operation.image } as ImageProperties } : {}), ...(operation.transform ? { transform: { ...node.transform, ...operation.transform, translate: operation.transform.translate ? { ...operation.transform.translate } : node.transform.translate } } : {}) }
      return { ...node, source: operation.source }
    })
  }
  return { ok: true, document: { ...document, revision: document.revision + 1, nodes } }
}

export const createHistory = (initial: SceneDocument, limit = 100): SceneHistory => ({ past: [], present: initial, future: [], limit })
export const commitHistory = (history: SceneHistory, next: SceneDocument): SceneHistory => ({ ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: [] })
export const undoHistory = (history: SceneHistory): SceneHistory => history.past.length ? { ...history, past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] } : history
export const redoHistory = (history: SceneHistory): SceneHistory => history.future.length ? { ...history, past: [...history.past, history.present].slice(-history.limit), present: history.future[0], future: history.future.slice(1) } : history

export const flattenRenderableNodes = (document: SceneDocument): SceneNode[] => {
  const flatten = (nodes: SceneNode[], parent = identity(), visible = true, locked = false): SceneNode[] => nodes.flatMap((node) => {
    const transform: Transform = {
      translate: { x: parent.translate.x + node.transform.translate.x, y: parent.translate.y + node.transform.translate.y },
      rotate: parent.rotate + node.transform.rotate,
      xScale: parent.xScale * node.transform.xScale,
      yScale: parent.yScale * node.transform.yScale,
    }
    const effectiveVisible = visible && node.visible
    const effectiveLocked = locked || node.locked
    return node.kind === 'group' ? flatten(node.children ?? [], transform, effectiveVisible, effectiveLocked) : node.kind === 'raw' ? [] : [{ ...node, visible: effectiveVisible, locked: effectiveLocked, transform }]
  })
  return flatten(document.nodes)
}
const contextNode = (node: SceneNode): object => ({ id: node.id, kind: node.kind, ...(node.name ? { name: node.name } : {}), visible: node.visible, locked: node.locked, transform: cloneTransform(node.transform), ...(node.geometry ? { geometry: node.geometry } : {}), ...(node.style ? { style: node.style } : {}), ...(node.text !== undefined ? { text: node.text } : {}), ...(node.image ? { image: { width: node.image.width, height: node.image.height } } : {}), ...(node.children ? { children: node.children.map(contextNode) } : {}) })
export const sceneToClaudeContext = (document: SceneDocument): object => ({ revision: document.revision, nodes: document.nodes.map(contextNode) })
