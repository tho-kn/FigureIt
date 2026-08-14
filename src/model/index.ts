export type Transform = { translate: { x: number; y: number }; rotate: number; xScale: number; yScale: number }
export type ScenePoint = { x: number; y: number }
export type SceneGeometry = { x?: number; y?: number; width?: number; height?: number; points?: ScenePoint[] }
export type SceneGradient = { start: string; end: string; angle: number }
export type SceneTextStyle = {
  fontFamily?: 'sans' | 'serif' | 'mono'
  fontSize?: number
  bold?: boolean
  italic?: boolean
  strike?: boolean
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
}
export type SceneStyle = { stroke?: string; fill?: string; gradient?: SceneGradient; strokeWidth?: number; opacity?: number; dash?: string; arrow?: string; textStyle?: SceneTextStyle }
export type ImageProperties = { href: string; width?: number; height?: number }
export const PX_PER_CM = 37.7952755906
export type NodeKind = 'group' | 'rect' | 'roundrect' | 'ellipse' | 'triangle' | 'diamond' | 'line' | 'path' | 'text' | 'math' | 'connector' | 'image' | 'raw'
export type ConnectorAnchor = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left'
export type ConnectorBinding = { nodeId: string; anchor: ConnectorAnchor }
export type ConnectorBindings = { start?: ConnectorBinding; end?: ConnectorBinding; routing?: 'straight' | 'elbow' | 'curved' }

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
  bindings?: ConnectorBindings
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
  | { type: 'update_properties'; id: string; geometry?: Partial<SceneGeometry>; style?: Partial<SceneStyle>; text?: string; image?: Partial<ImageProperties>; bindings?: ConnectorBindings; transform?: Partial<Transform> }
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

type Metadata = Pick<SceneNode, 'id' | 'name' | 'visible' | 'locked' | 'kind' | 'bindings' | 'style'> & { transform?: Transform }
const nodeKinds: NodeKind[] = ['group', 'rect', 'roundrect', 'ellipse', 'triangle', 'diamond', 'line', 'path', 'text', 'math', 'connector', 'image', 'raw']
export const anchors: ConnectorAnchor[] = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']
const bindingFrom = (value?: string): ConnectorBinding | undefined => {
  if (!value) return undefined
  const [nodeId, anchor] = decodeURIComponent(value).split('@')
  return nodeId && anchors.includes(anchor as ConnectorAnchor) ? { nodeId, anchor: anchor as ConnectorAnchor } : undefined
}

const metadataFrom = (line: string): Metadata | undefined => {
  if (!/^\s*%\s*figureit\s*:/i.test(line)) return undefined
  const values = Object.fromEntries([...line.matchAll(/([\w-]+)=("[^"]*"|'[^']*'|\S+)/g)].map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]))
  let name = values.name
  try { if (name) name = decodeURIComponent(name) } catch { /* retain hand-written metadata */ }
  const kind = nodeKinds.includes(values.kind as NodeKind) ? values.kind as NodeKind : 'raw'
  const start = bindingFrom(values.start); const end = bindingFrom(values.end)
  const routing = ['straight', 'elbow', 'curved'].includes(values.routing) ? values.routing as ConnectorBindings['routing'] : undefined
  const textStyle: SceneTextStyle = {
    fontFamily: ['sans', 'serif', 'mono'].includes(values.font) ? values.font as SceneTextStyle['fontFamily'] : undefined,
    fontSize: values.fsize ? Number(values.fsize) : undefined,
    bold: values.bold === 'true' ? true : values.bold === 'false' ? false : undefined,
    italic: values.italic === 'true' ? true : values.italic === 'false' ? false : undefined,
    strike: values.strike === 'true' ? true : values.strike === 'false' ? false : undefined,
    align: ['left', 'center', 'right'].includes(values.talign) ? values.talign as SceneTextStyle['align'] : undefined,
    valign: ['top', 'middle', 'bottom'].includes(values.tvalign) ? values.tvalign as SceneTextStyle['valign'] : undefined,
  }
  const hasTextStyle = Object.values(textStyle).some((v) => v !== undefined)
  const style: SceneStyle | undefined = hasTextStyle ? { textStyle } : undefined
  const hasTransform = ['tx', 'ty', 'rotate', 'xscale', 'yscale'].some((key) => values[key] !== undefined)
  const read = (key: string, fallback: number) => { const parsed = Number(values[key] ?? fallback); return Number.isFinite(parsed) ? parsed : fallback }
  const transform = hasTransform ? { translate: { x: read('tx', 0), y: read('ty', 0) }, rotate: read('rotate', 0), xScale: read('xscale', 1), yScale: read('yscale', 1) } : undefined
  return { id: values.id || newId(), name, visible: values.visible !== 'false', locked: values.locked === 'true', kind, ...((start || end || routing) ? { bindings: { start, end, routing } } : {}), ...(style ? { style } : {}), ...(transform ? { transform } : {}) }
}

const textStyleMeta = (ts?: SceneTextStyle) => {
  if (!ts) return ''
  const parts: string[] = []
  if (ts.fontFamily) parts.push(`font=${ts.fontFamily}`)
  if (ts.fontSize) parts.push(`fsize=${ts.fontSize}`)
  if (ts.bold) parts.push('bold=true')
  if (ts.italic) parts.push('italic=true')
  if (ts.strike) parts.push('strike=true')
  if (ts.align) parts.push(`talign=${ts.align}`)
  if (ts.valign) parts.push(`tvalign=${ts.valign}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

const metaLine = (node: SceneNode) => `% figureit: id=${node.id}${node.name ? ` name=${encodeURIComponent(node.name)}` : ''} visible=${node.visible} locked=${node.locked} kind=${node.kind}${node.bindings?.start ? ` start=${encodeURIComponent(`${node.bindings.start.nodeId}@${node.bindings.start.anchor}`)}` : ''}${node.bindings?.end ? ` end=${encodeURIComponent(`${node.bindings.end.nodeId}@${node.bindings.end.anchor}`)}` : ''}${node.bindings?.routing ? ` routing=${node.bindings.routing}` : ''}${textStyleMeta(node.style?.textStyle)}${isIdentity(node.transform) ? '' : ` tx=${decimal(node.transform.translate.x)} ty=${decimal(node.transform.translate.y)} rotate=${decimal(node.transform.rotate)} xscale=${decimal(node.transform.xScale)} yscale=${decimal(node.transform.yScale)}`}\n`
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
    if (/rectangle\b/.test(text)) return /rounded corners/.test(text) ? 'roundrect' : 'rect'
    if (/ellipse\b/.test(text)) return 'ellipse'
    if (/-\||\|-|to\s*\[|controls\b|plot\s*\[\s*smooth/.test(text)) {
      return /->|<-|<->/.test(text) ? 'connector' : 'line'
    }
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
  const start = xcolor('left color') ?? option(['left color'])
  const end = xcolor('right color') ?? option(['right color'])
  const arrow = options.match(/(?:^|,)\s*(<->|->|<-)\s*(?:,|$)/)?.[1]
  const style: SceneStyle = { stroke: xcolor('draw') ?? xcolor('stroke') ?? option(['draw', 'stroke']), fill: xcolor('fill') ?? option(['fill']), ...(start && end ? { gradient: { start, end, angle: Number(option(['shading angle']) ?? 0) } } : {}), strokeWidth: number(option(['line width', 'stroke width'])), opacity: number(option(['opacity'])), dash: option(['dash pattern']), arrow }
  return Object.values(style).some((value) => value !== undefined) ? style : undefined
}
const propertiesFor = (kind: NodeKind, source: string): Pick<SceneNode, 'geometry' | 'style' | 'text' | 'image' | 'transform' | 'bindings'> => {
  const points = coordinates(source.replace(/\[[^\]]*\]/g, ''))
  const bounds = points.length ? { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)), width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)), height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) } : undefined
  let geometry: SceneGeometry | undefined = ['rect', 'roundrect'].includes(kind) && points.length >= 2 ? { x: points[0].x, y: points[0].y, width: points[1].x - points[0].x, height: points[1].y - points[0].y }
      : kind === 'ellipse' && points.length >= 1 ? (() => { const radii = source.match(/ellipse\s*\(([-.\d]+)\s*and\s*([-.\d]+)\)/); if (!radii) return { x: points[0].x, y: points[0].y }; const rx = Number(radii[1]); const ry = Number(radii[2]); return { x: points[0].x - rx, y: points[0].y - ry, width: rx * 2, height: ry * 2 } })()
      : ['triangle', 'diamond'].includes(kind) && bounds ? bounds
      : ['line', 'path', 'connector'].includes(kind) ? { points } : ['text', 'math', 'image'].includes(kind) && points[0] ? { x: points[0].x, y: points[0].y } : undefined
  const content = source.match(/\{([^{}]*)\}\s*;?\s*(?:%.*)?$/)?.[1]
  const nodeLabel = source.match(/node(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/)?.[1]
  const text = (kind === 'text' || kind === 'math') ? content : nodeLabel
  const imageMatch = source.match(/\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/)
  const image = imageMatch ? { href: imageMatch[2], width: number(imageMatch[1]?.match(/width\s*=\s*([-.\d]+cm?)/)?.[1]), height: number(imageMatch[1]?.match(/height\s*=\s*([-.\d]+cm?)/)?.[1]) } : undefined
  if (kind === 'image' && image && points[0]) geometry = { x: points[0].x - (image.width ?? 0) / 2, y: points[0].y - (image.height ?? 0) / 2, ...(image.width === undefined ? {} : { width: image.width }), ...(image.height === undefined ? {} : { height: image.height }) }
  let routing: ConnectorBindings['routing'] | undefined = undefined
  if (/-\||\|-/.test(source)) routing = 'elbow'
  else if (/to\s*\[|controls\b|plot\s*\[\s*smooth/.test(source)) routing = 'curved'
  return { ...(geometry ? { geometry } : {}), ...(styleFor(source) ? { style: styleFor(source) } : {}), ...(text !== undefined ? { text } : {}), ...(image ? { image } : {}), transform: scopeTransform(source), ...(routing ? { bindings: { routing } } : {}) }
}

const scopeTransform = (source: string): Transform => {
  const t = identity()
  const option = source.match(/\[([^\]]*)\]/)?.[1] ?? ''
  const shift = option.match(/shift=\{?\(([-.\d]+),\s*([-.\d]+)\)\}?/)
  if (shift) t.translate = { x: Number(shift[1]), y: Number(shift[2]) }
  const read = (name: string, fallback: number) => Number(option.match(new RegExp(`${name}\\s*=\\s*([-.\\d]+)`))?.[1] ?? fallback)
  t.rotate = Number(option.match(/rotate\s+around\s*=\s*\{?\s*([-.\d]+)/)?.[1] ?? read('rotate', 0)); t.xScale = read('xscale', 1); t.yScale = read('yscale', 1)
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
      const group: SceneNode = { id: metadata?.id ?? newId(), kind: 'group', name: metadata?.name, visible: metadata?.visible ?? true, locked: metadata?.locked ?? false, transform: metadata?.transform ?? scopeTransform(token), prefix: pending, source: '', children: [] }
      pending = ''; metadata = undefined; stack.at(-1)!.push(group); groups.push(group); stack.push(group.children!)
      continue
    }
    if (/^\s*\\end\{scope\}/.test(token) && stack.length > 1) { groups.at(-1)!.source = token; groups.pop(); stack.pop(); continue }
    if (!/\S/.test(token)) { pending += token; continue }
    const detectedKind = kindFor(token)
    const kind = metadata?.kind && metadata.kind !== 'raw' ? metadata.kind : detectedKind
    const itemMetadata = kind === 'raw' ? undefined : metadata
    const properties = propertiesFor(kind, token)
    const itemBindings = itemMetadata?.bindings ?? properties.bindings
    const itemStyle = itemMetadata?.style
      ? { ...properties.style, ...itemMetadata.style, ...(properties.style?.textStyle || itemMetadata.style.textStyle ? { textStyle: { ...properties.style?.textStyle, ...itemMetadata.style.textStyle } } : {}) }
      : properties.style
    stack.at(-1)!.push({ id: itemMetadata?.id ?? newId(), kind, name: itemMetadata?.name, visible: itemMetadata?.visible ?? true, locked: itemMetadata?.locked ?? false, prefix: pending, source: token, ...properties, ...(itemStyle ? { style: itemStyle } : {}), bindings: itemBindings, ...(itemMetadata?.transform ? { transform: itemMetadata.transform } : {}) })
    pending = ''; if (itemMetadata) metadata = undefined
  }
  if (pending && /\S/.test(pending)) roots.push({ id: newId(), kind: 'raw', visible: true, locked: false, transform: identity(), prefix: '', source: pending })
  return { document: { revision: 0, prefix, nodes: roots, suffix: pending && !/\S/.test(pending) ? pending + suffix : suffix }, errors: stack.length === 1 ? [] : ['Unclosed scope'] }
}

const decimal = (value: number) => String(Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6)))
const transformOptions = (t: Transform) => `shift={(${decimal(t.translate.x)},${decimal(t.translate.y)})},rotate=${decimal(t.rotate)},xscale=${decimal(t.xScale)},yscale=${decimal(t.yScale)}`
const affineOption = (t: Transform, center: ScenePoint) => {
  const radians = t.rotate * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians)
  const a = cos * t.xScale; const b = sin * t.xScale; const c = -sin * t.yScale; const d = cos * t.yScale
  const x = t.translate.x + center.x - a * center.x - c * center.y
  const y = t.translate.y + center.y - b * center.x - d * center.y
  return `cm={${decimal(a)},${decimal(b)},${decimal(c)},${decimal(d)},(${decimal(x)},${decimal(y)})}`
}
const tikzColor = (color: string) => /^#[\da-f]{6}$/i.test(color)
  ? `{rgb,255:red,${Number.parseInt(color.slice(1, 3), 16)};green,${Number.parseInt(color.slice(3, 5), 16)};blue,${Number.parseInt(color.slice(5, 7), 16)}}`
  : color
const inlineOptions = (node: SceneNode) => {
  const style = node.style
  const dash = style?.dash === 'dashed' ? 'on 4pt off 3pt' : style?.dash === 'dotted' ? 'on 0pt off 2pt' : style?.dash
  const parts = [style?.stroke && `draw=${tikzColor(style.stroke)}`, !style?.gradient && style?.fill && `fill=${tikzColor(style.fill)}`, style?.gradient && 'shade', style?.gradient && `left color=${tikzColor(style.gradient.start)}`, style?.gradient && `right color=${tikzColor(style.gradient.end)}`, style?.gradient && `shading angle=${decimal(style.gradient.angle)}`, node.kind === 'roundrect' && 'rounded corners=0.2cm', style?.strokeWidth !== undefined && `line width=${decimal(style.strokeWidth)}cm`, style?.opacity !== undefined && `opacity=${decimal(style.opacity)}`, dash && `dash pattern=${dash}`, style?.arrow ?? (node.kind === 'connector' ? '->' : undefined), !node.visible && 'opacity=0']
  if (!isIdentity(node.transform)) {
    const geometry = node.geometry
    const center = geometry?.x !== undefined && geometry.y !== undefined
      ? { x: geometry.x + (geometry.width ?? 0) / 2, y: geometry.y + (geometry.height ?? 0) / 2 }
      : geometry?.points?.length
        ? { x: (Math.min(...geometry.points.map((point) => point.x)) + Math.max(...geometry.points.map((point) => point.x))) / 2, y: (Math.min(...geometry.points.map((point) => point.y)) + Math.max(...geometry.points.map((point) => point.y))) / 2 }
        : undefined
    parts.push(center ? affineOption(node.transform, center) : transformOptions(node.transform))
  }
  const values = parts.filter((value): value is string => Boolean(value))
  return values.length ? `[${values.join(',')}]` : ''
}
const coordinate = (point: ScenePoint) => `(${decimal(point.x)},${decimal(point.y)})`

const formatTikzText = (rawText: string, ts?: SceneTextStyle) => {
  const lines = rawText.split('\n')
  const formatted = lines.map((line) => {
    let text = line
    if (ts?.strike) text = `\\sout{${text}}`
    if (ts?.italic) text = `\\textit{${text}}`
    if (ts?.bold) text = `\\textbf{${text}}`
    return text
  })
  return formatted.join(' \\\\ ')
}

const generatedSource = (node: SceneNode): string | undefined => {
  const geometry = node.geometry
  if (!geometry) return undefined
  const options = inlineOptions(node)
  const hasMultipleLines = node.text?.includes('\n')
  const alignOpt = node.style?.textStyle?.align ? `align=${node.style.textStyle.align}` : hasMultipleLines ? 'align=center' : ''
  const fontOpt = node.style?.textStyle?.fontFamily === 'mono' ? 'font=\\ttfamily' : node.style?.textStyle?.fontFamily === 'serif' ? 'font=\\rmfamily' : ''
  const textNodeOpts = [alignOpt, fontOpt].filter(Boolean).join(',')
  const textOptsStr = textNodeOpts ? `[pos=0.5,${textNodeOpts}]` : '[pos=0.5]'
  const formattedText = node.text ? formatTikzText(node.text, node.style?.textStyle) : ''
  const textSuffix = node.text && !['text', 'math'].includes(node.kind) ? ` node${textOptsStr} {${formattedText}}` : ''
  if (['rect', 'roundrect'].includes(node.kind) && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${decimal(geometry.x)},${decimal(geometry.y)}) rectangle (${decimal(geometry.x + geometry.width)},${decimal(geometry.y + geometry.height)})${textSuffix};`
  if (node.kind === 'ellipse' && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${decimal(geometry.x + geometry.width / 2)},${decimal(geometry.y + geometry.height / 2)}) ellipse (${decimal(geometry.width / 2)} and ${decimal(geometry.height / 2)})${textSuffix};`
  if (node.kind === 'triangle' && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${decimal(geometry.x + geometry.width / 2)},${decimal(geometry.y + geometry.height)}) -- (${decimal(geometry.x + geometry.width)},${decimal(geometry.y)}) -- (${decimal(geometry.x)},${decimal(geometry.y)}) -- cycle${textSuffix};`
  if (node.kind === 'diamond' && geometry.x !== undefined && geometry.y !== undefined && geometry.width !== undefined && geometry.height !== undefined) return `\\draw${options} (${decimal(geometry.x + geometry.width / 2)},${decimal(geometry.y + geometry.height)}) -- (${decimal(geometry.x + geometry.width)},${decimal(geometry.y + geometry.height / 2)}) -- (${decimal(geometry.x + geometry.width / 2)},${decimal(geometry.y)}) -- (${decimal(geometry.x)},${decimal(geometry.y + geometry.height / 2)}) -- cycle${textSuffix};`
  const points = geometry.points
  if (['line', 'path', 'connector'].includes(node.kind) && points && points.length >= 2) {
    const routing = node.bindings?.routing
    if (routing === 'elbow') {
      if (points.length === 2) {
        return `\\draw${options} ${coordinate(points[0])} -|${textSuffix} ${coordinate(points[1])};`
      }
      return `\\draw${options} ${points.map(coordinate).join(' -- ')}${textSuffix};`
    }
    if (routing === 'curved') {
      if (points.length === 2) {
        return `\\draw${options} ${coordinate(points[0])} to[out=0,in=180]${textSuffix} ${coordinate(points[1])};`
      }
      if (points.length === 3) {
        return `\\draw${options} ${coordinate(points[0])} .. controls ${coordinate(points[1])} ..${textSuffix} ${coordinate(points[2])};`
      }
      if (points.length === 4) {
        return `\\draw${options} ${coordinate(points[0])} .. controls ${coordinate(points[1])} and ${coordinate(points[2])} ..${textSuffix} ${coordinate(points[3])};`
      }
      return `\\draw${options} plot [smooth] coordinates {${points.map(coordinate).join(' ')}}${textSuffix};`
    }
    return `\\draw${options} ${points.map(coordinate).join(' -- ')}${textSuffix};`
  }
  if ((node.kind === 'text' || node.kind === 'math') && geometry.x !== undefined && geometry.y !== undefined && node.text !== undefined) {
    const formatted = node.kind === 'math' ? node.text : formatTikzText(node.text, node.style?.textStyle)
    const extraOpts = node.kind === 'text' ? [alignOpt, fontOpt].filter(Boolean) : []
    const combinedOpts = extraOpts.length ? (options ? `[${options.slice(1, -1)},${extraOpts.join(',')}]` : `[${extraOpts.join(',')}]`) : options
    return `\\node${combinedOpts} at (${decimal(geometry.x)},${decimal(geometry.y)}) {${formatted}};`
  }
  if (node.kind === 'image' && geometry.x !== undefined && geometry.y !== undefined && node.image) {
    const sizes = [node.image.width !== undefined && `width=${decimal(node.image.width)}cm`, node.image.height !== undefined && `height=${decimal(node.image.height)}cm`].filter(Boolean).join(',')
    return `\\node${options} at (${decimal(geometry.x + (geometry.width ?? node.image.width ?? 0) / 2)},${decimal(geometry.y + (geometry.height ?? node.image.height ?? 0) / 2)}) {\\includegraphics${sizes ? `[${sizes}]` : ''}{${node.image.href}}};`
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

export const serializeDocument = (document: SceneDocument): string => {
  const content = document.nodes.map(renderNode).join('')
  return document.prefix + content + (content && !content.endsWith('\n') && !document.suffix.startsWith('\n') ? '\n' : '') + document.suffix
}
export const createDefaultDocument = (): SceneDocument => parseTikz(DEFAULT_TIKZ_SOURCE).document

const findNode = (nodes: SceneNode[], id: string): SceneNode | undefined => {
  for (const node of nodes) { if (node.id === id) return node; const child = node.children && findNode(node.children, id); if (child) return child }
  return undefined
}
export const connectorAnchorPoint = (node: SceneNode, anchor: ConnectorAnchor): ScenePoint | undefined => {
  const geometry = node.geometry
  if (geometry?.x === undefined || geometry.y === undefined || geometry.width === undefined || geometry.height === undefined) return undefined
  const left = geometry.x; const right = left + geometry.width; const bottom = geometry.y; const top = bottom + geometry.height
  const centerX = (left + right) / 2; const centerY = (bottom + top) / 2
  const rx = geometry.width / 2; const ry = geometry.height / 2

  let x = anchor.includes('left') ? left : anchor.includes('right') ? right : centerX
  let y = anchor.includes('top') ? top : anchor.includes('bottom') ? bottom : centerY

  if (node.kind === 'diamond') {
    if (anchor === 'top') { x = centerX; y = top }
    else if (anchor === 'bottom') { x = centerX; y = bottom }
    else if (anchor === 'left') { x = left; y = centerY }
    else if (anchor === 'right') { x = right; y = centerY }
    else if (anchor === 'top-left') { x = (left + centerX) / 2; y = (top + centerY) / 2 }
    else if (anchor === 'top-right') { x = (right + centerX) / 2; y = (top + centerY) / 2 }
    else if (anchor === 'bottom-left') { x = (left + centerX) / 2; y = (bottom + centerY) / 2 }
    else if (anchor === 'bottom-right') { x = (right + centerX) / 2; y = (bottom + centerY) / 2 }
  } else if (node.kind === 'triangle') {
    if (anchor === 'top') { x = centerX; y = top }
    else if (anchor === 'bottom') { x = centerX; y = bottom }
    else if (anchor === 'bottom-left') { x = left; y = bottom }
    else if (anchor === 'bottom-right') { x = right; y = bottom }
    else if (anchor === 'left' || anchor === 'top-left') { x = (left + centerX) / 2; y = (bottom + top) / 2 }
    else if (anchor === 'right' || anchor === 'top-right') { x = (right + centerX) / 2; y = (bottom + top) / 2 }
  } else if (node.kind === 'ellipse') {
    if (anchor === 'top') { x = centerX; y = top }
    else if (anchor === 'bottom') { x = centerX; y = bottom }
    else if (anchor === 'left') { x = left; y = centerY }
    else if (anchor === 'right') { x = right; y = centerY }
    else if (anchor === 'top-left') { x = centerX - rx * 0.707107; y = centerY + ry * 0.707107 }
    else if (anchor === 'top-right') { x = centerX + rx * 0.707107; y = centerY + ry * 0.707107 }
    else if (anchor === 'bottom-left') { x = centerX - rx * 0.707107; y = centerY - ry * 0.707107 }
    else if (anchor === 'bottom-right') { x = centerX + rx * 0.707107; y = centerY - ry * 0.707107 }
  }

  const scaledX = (x - centerX) * node.transform.xScale; const scaledY = (y - centerY) * node.transform.yScale
  const angle = node.transform.rotate * Math.PI / 180; const cos = Math.cos(angle); const sin = Math.sin(angle)
  return {
    x: centerX + scaledX * cos - scaledY * sin + node.transform.translate.x,
    y: centerY + scaledX * sin + scaledY * cos + node.transform.translate.y,
  }
}

export const nearestConnectorAnchor = (node: SceneNode, point: ScenePoint): ConnectorBinding | undefined => {
  let best: { anchor: ConnectorAnchor; distance: number } | undefined
  for (const anchor of anchors) {
    const candidate = connectorAnchorPoint(node, anchor)
    if (!candidate) continue
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
    if (!best || distance < best.distance) best = { anchor, distance }
  }
  return best ? { nodeId: node.id, anchor: best.anchor } : undefined
}
const resolveConnectorBindings = (nodes: SceneNode[], roots = nodes): SceneNode[] => nodes.map((node) => {
  const children = node.children ? resolveConnectorBindings(node.children, roots) : undefined
  if (node.kind !== 'connector' || !node.geometry?.points?.length) return children ? { ...node, children } : node
  const points = [...node.geometry.points]
  const startNode = node.bindings?.start && findNode(roots, node.bindings.start.nodeId)
  const endNode = node.bindings?.end && findNode(roots, node.bindings.end.nodeId)
  const start = startNode && node.bindings?.start ? connectorAnchorPoint(startNode, node.bindings.start.anchor) : undefined
  const end = endNode && node.bindings?.end ? connectorAnchorPoint(endNode, node.bindings.end.anchor) : undefined
  if (start) points[0] = start
  if (end) points[points.length - 1] = end
  return { ...node, geometry: { ...node.geometry, points }, ...(children ? { children } : {}) }
})
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
    if (target.locked && operation.type !== 'set_metadata') return { ok: false, error: 'locked' }
    if (operation.type === 'delete') { nodes = removeNode(nodes, operation.id); continue }
    nodes = updateNode(nodes, operation.id, (node) => {
      if (operation.type === 'move') {
        if (node.geometry?.points) return { ...node, geometry: { ...node.geometry, points: node.geometry.points.map((point) => ({ x: point.x + operation.dx, y: point.y + operation.dy })) } }
        if (node.geometry?.x !== undefined && node.geometry.y !== undefined) return { ...node, geometry: { ...node.geometry, x: node.geometry.x + operation.dx, y: node.geometry.y + operation.dy } }
        return { ...node, transform: { ...node.transform, translate: { x: node.transform.translate.x + operation.dx, y: node.transform.translate.y + operation.dy } } }
      }
      if (operation.type === 'transform') return { ...node, transform: { ...node.transform, ...operation.transform, translate: operation.transform.translate ? { ...operation.transform.translate } : node.transform.translate } }
      if (operation.type === 'set_metadata') return { ...node, ...(operation.name === undefined ? {} : { name: operation.name }), ...(operation.visible === undefined ? {} : { visible: operation.visible }), ...(operation.locked === undefined ? {} : { locked: operation.locked }) }
      if (operation.type === 'update_properties') return { ...node, ...(operation.geometry ? { geometry: { ...node.geometry, ...operation.geometry } } : {}), ...(operation.style ? { style: { ...node.style, ...operation.style } } : {}), ...(operation.text === undefined ? {} : { text: operation.text }), ...(operation.image ? { image: { ...node.image, ...operation.image } as ImageProperties } : {}), ...(operation.bindings ? { bindings: operation.bindings } : {}), ...(operation.transform ? { transform: { ...node.transform, ...operation.transform, translate: operation.transform.translate ? { ...operation.transform.translate } : node.transform.translate } } : {}) }
      return { ...node, source: operation.source }
    })
  }
  return { ok: true, document: { ...document, revision: document.revision + 1, nodes: resolveConnectorBindings(nodes) } }
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
