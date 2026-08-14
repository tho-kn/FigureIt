import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  anchors,
  applySceneTransaction,
  connectorAnchorPoint,
  createHistory,
  flattenRenderableNodes,
  nearestConnectorAnchor,
  parseTikz,
  PX_PER_CM,
  sceneToClaudeContext,
  serializeDocument,
  type ConnectorBinding,
  type SceneDocument,
  type SceneGeometry,
  type SceneHistory,
  type SceneNode,
  type SceneOperation,
  type ScenePoint,
  type SceneStyle,
  type SceneTextStyle,
} from "./model";

import {
  askClaude,
  checkpointProject,
  compileProject,
  createProject,
  desktopFeaturesAvailable,
  listHistory,
  openProject,
  resetClaudeConversation,
  restoreCommit,
  saveProject,
  writeAsset,
  type Commit,
} from "./services/backend";
import "./App.css";

type Tool = "select" | "rect" | "roundrect" | "ellipse" | "triangle" | "diamond" | "text" | "line" | "arrow" | "connector" | "path" | "image";
type Tab = "source" | "history" | "assistant";
type CanvasPoint = { x: number; y: number };
type Drag = {
  id: string;
  pointerId: number;
  start: CanvasPoint;
  mode: "move" | "resize" | "rotate" | "point" | "connect" | "marquee" | "pan";
  width?: number;
  height?: number;
  originX?: number;
  originY?: number;
  handle?: number;
  rotation?: number;
  center?: CanvasPoint;
  points?: ScenePoint[];
  pointIndex?: number;
  fromId?: string;
};
type DragPreview = {
  id: string;
  mode: Drag["mode"];
  dx: number;
  dy: number;
  geometry?: Partial<SceneGeometry>;
  rotation?: number;
  marquee?: { start: CanvasPoint; current: CanvasPoint };
  snappedAnchor?: { node: SceneNode; binding: ConnectorBinding; point: ScenePoint };
};
type SmartGuide = { orientation: "h" | "v"; coord: number; start: number; end: number };

const paletteColors = [
  "#ffffff", "#f1f5f9", "#cbd5e1", "#64748b", "#1e293b",
  "#2b4c7e", "#3b82f6", "#0ea5e9", "#06b6d4", "#10b981",
  "#84cc16", "#eab308", "#f97316", "#ef4444", "#ec4899", "#8b5cf6"
];

const blank = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;


const ToolIcon = ({ kind, size = 16 }: { kind: Tool; size?: number }) => {
  switch (kind) {
    case "select":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4l7 17 2.5-6.5L20 12 4 4z" />
        </svg>
      );
    case "rect":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
        </svg>
      );
    case "roundrect":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="6" />
        </svg>
      );
    case "ellipse":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="12" rx="9" ry="7" />
        </svg>
      );
    case "triangle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 3 22 20 2 20" />
        </svg>
      );
    case "diamond":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 22 12 12 22 2 12" />
        </svg>
      );
    case "text":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </svg>
      );
    case "line":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="20" x2="20" y2="4" />
          <circle cx="4" cy="20" r="2.5" fill="currentColor" />
          <circle cx="20" cy="4" r="2.5" fill="currentColor" />
        </svg>
      );
    case "arrow":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="19" x2="19" y2="5" />
          <polyline points="9 5 19 5 19 15" />
        </svg>
      );
    case "connector":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="4" cy="5" r="2" fill="currentColor" />
          <path d="M4 5h8a4 4 0 0 1 4 4v10" />
          <polyline points="12 15 16 19 20 15" />
        </svg>
      );
    case "path":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <circle cx="11" cy="11" r="1.5" fill="currentColor" />
        </svg>
      );
    case "image":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="2" fill="currentColor" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
  }
};

const labels: Array<[Tool, string]> = [
  ["select", "Select"],
  ["rect", "Rectangle"],
  ["roundrect", "Rounded rectangle"],
  ["ellipse", "Ellipse"],
  ["triangle", "Triangle"],
  ["diamond", "Diamond"],
  ["text", "Text / math"],
  ["line", "Line"],
  ["arrow", "Arrow"],
  ["connector", "Connector"],
  ["path", "Pen path"],
  ["image", "Place image"],
];

const identity = { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 };
const toolNames: Partial<Record<Tool, string>> = {
  rect: "Rectangle",
  roundrect: "Rounded rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  diamond: "Diamond",
  text: "Text",
  line: "Line",
  arrow: "Arrow",
  connector: "Connector",
  path: "Path",
  image: "Image",
};

const KindIcon = ({ kind, size = 13 }: { kind: string; size?: number }) => {
  switch (kind) {
    case "rect":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="1"/></svg>;
    case "roundrect":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="5"/></svg>;
    case "ellipse":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>;
    case "triangle":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 3 21 20 3 20"/></svg>;
    case "diamond":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 12 12 22 2 12"/></svg>;
    case "text":
    case "math":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>;
    case "line":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor"/><circle cx="20" cy="4" r="2" fill="currentColor"/></svg>;
    case "arrow":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>;
    case "connector":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h8a4 4 0 0 1 4 4v8"/><polyline points="12 15 16 19 20 15"/></svg>;
    case "path":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>;
    case "image":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>;
    case "group":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7l4-4h6l2 4"/></svg>;
    case "raw":
    default:
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  }
};

const canvasPresets = [
  { label: "Standard (800 × 520)", width: 800, height: 520 },
  { label: "Slide 16:9 (960 × 540)", width: 960, height: 540 },
  { label: "IEEE Column (640 × 480)", width: 640, height: 480 },
  { label: "IEEE Double Column (900 × 500)", width: 900, height: 500 },
  { label: "Square (600 × 600)", width: 600, height: 600 },
  { label: "Wide Banner (960 × 380)", width: 960, height: 380 },
];



const computePathD = (rawPoints: ScenePoint[], routing: string | undefined, canvasHeight: number): string => {
  if (rawPoints.length < 2) return "";
  const pts = rawPoints.map((p) => ({
    x: p.x * PX_PER_CM,
    y: canvasHeight - p.y * PX_PER_CM,
  }));

  if (routing === "curved") {
    if (pts.length === 2) {
      const p0 = pts[0];
      const p1 = pts[1];
      const midX = (p0.x + p1.x) / 2;
      return `M ${p0.x} ${p0.y} C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    if (pts.length === 3) {
      return `M ${pts[0].x} ${pts[0].y} Q ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y}`;
    }
    if (pts.length === 4) {
      return `M ${pts[0].x} ${pts[0].y} C ${pts[1].x} ${pts[1].y}, ${pts[2].x} ${pts[2].y}, ${pts[3].x} ${pts[3].y}`;
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  if (routing === "elbow") {
    if (pts.length === 2) {
      const p0 = pts[0];
      const p1 = pts[1];
      const midX = (p0.x + p1.x) / 2;
      return `M ${p0.x} ${p0.y} L ${midX} ${p0.y} L ${midX} ${p1.y} L ${p1.x} ${p1.y}`;
    }
    return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
  }

  return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
};

const renderRichText = (
  text: string | undefined,
  ts: SceneTextStyle | undefined,
  color: string,
  box: { x: number; y: number; w: number; h: number },
  isStandaloneText: boolean,
) => {
  if (!text) return null;
  const lines = text.split("\n");
  const fontSize = ts?.fontSize ?? (isStandaloneText ? 14 : 12);
  const lineHeight = fontSize * 1.25;
  const totalHeight = lines.length * lineHeight;

  const textAnchor = ts?.align === "left"
    ? "start"
    : ts?.align === "right"
      ? "end"
      : isStandaloneText
        ? "start"
        : "middle";

  const textX = ts?.align === "left"
    ? (isStandaloneText ? box.x : box.x + 8)
    : ts?.align === "right"
      ? (isStandaloneText ? box.x + box.w : box.x + box.w - 8)
      : (isStandaloneText ? box.x : box.x + box.w / 2);

  const startY = isStandaloneText
    ? box.y
    : ts?.valign === "top"
      ? box.y - box.h + fontSize + 4
      : ts?.valign === "bottom"
        ? box.y - totalHeight + fontSize - 4
        : box.y - box.h / 2 - totalHeight / 2 + fontSize * 0.85;

  const fontFamily = ts?.fontFamily === "mono"
    ? "ui-monospace, monospace"
    : ts?.fontFamily === "serif"
      ? "Georgia, 'Times New Roman', serif"
      : "Inter, system-ui, sans-serif";

  return (
    <text
      x={textX}
      y={startY}
      textAnchor={textAnchor}
      dominantBaseline="auto"
      fill={color}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fontWeight={ts?.bold ? "bold" : "normal"}
      fontStyle={ts?.italic ? "italic" : "normal"}
      textDecoration={ts?.strike ? "line-through" : "none"}
      pointerEvents="none"
    >
      {lines.map((line, idx) => (
        <tspan key={idx} x={textX} dy={idx === 0 ? 0 : lineHeight}>
          {line || " "}
        </tspan>
      ))}
    </text>
  );
};

const promptChips = [
  { label: "🪄 Auto-Align & Tidy", text: "Align all shapes into a neat, balanced layout with consistent spacing between boxes and straightened connectors." },
  { label: "🎨 IEEE Publication Palette", text: "Apply an academic IEEE publication palette: crisp navy blue headers (#2b4c7e), subtle grey backgrounds (#f4f6f9), and dark slate strokes." },
  { label: "🌿 Nature Pastel Palette", text: "Apply a modern scientific pastel palette with sage green (#a8c3a0), dusty sky blue (#9bbcdb), and soft sand accents (#e8d5b5)." },
  { label: "📐 Equalize & Straighten", text: "Make all rectangular boxes equal width (3.5cm) and height (2cm), and adjust connectors to route orthogonally." },
  { label: "🏷️ Flowchart Pipeline", text: "Arrange these shapes sequentially from left to right as an end-to-end pipeline with arrow connectors in between." },
  { label: "✨ Minimal Modern Dark", text: "Style this diagram with modern dark mode aesthetics: charcoal fills (#20242c), electric blue accents (#4285f4), and crisp white text." },
];

const shapeNode = (kind: Exclude<Tool, "select" | "connector">, index: number): SceneNode => {
  const x = 1.5 + index * 0.45;
  const y = 1.5 + index * 0.35;
  const name = `${toolNames[kind] ?? kind}${index ? ` ${index + 1}` : ""}`;
  const nodeKind = kind === "arrow" ? "line" : kind;
  const base = {
    id: crypto.randomUUID(),
    kind: nodeKind,
    name,
    visible: true,
    locked: false,
    transform: identity,
    prefix: "\n",
    source: "",
  };
  if (["rect", "roundrect", "ellipse", "triangle", "diamond"].includes(kind))
    return {
      ...base,
      geometry: { x, y, width: 3.5, height: 2.2 },
      style: {
        fill: "#90baff",
        stroke: "black",
        strokeWidth: 0.05,
        opacity: 1,
      },
    };
  if (kind === "line" || kind === "arrow" || kind === "path")
    return {
      ...base,
      geometry: {
        points: [
          { x, y },
          { x: x + 3.5, y: y + 1.5 },
        ],
      },
      style: { stroke: "black", strokeWidth: 0.06, ...(kind === "arrow" ? { arrow: "->" } : {}) },
    };
  if (kind === "text")
    return {
      ...base,
      geometry: { x, y },
      text: "Text / α²",
      style: { stroke: "black" },
    };
  return { ...base, geometry: { x, y }, image: { href: "image-placeholder" } };
};

const id = z.string().min(1).max(160);
const operationsSchema = z.array(
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("move"), id, dx: z.number().finite(), dy: z.number().finite() }).strict(),
    z.object({
      type: z.literal("transform"),
      id,
      transform: z.object({
        rotate: z.number().finite().optional(),
        xScale: z.number().finite().optional(),
        yScale: z.number().finite().optional(),
        translate: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal("set_metadata"),
      id,
      name: z.string().max(160).optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
    }).strict(),
    z.object({
      type: z.literal("update_properties"),
      id,
      geometry: z.object({
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        width: z.number().finite().optional(),
        height: z.number().finite().optional(),
      }).strict().optional(),
      style: z.object({
        fill: z.string().max(80).optional(),
        stroke: z.string().max(80).optional(),
        gradient: z.object({ start: z.string().max(80), end: z.string().max(80), angle: z.number().finite() }).strict().optional(),
        strokeWidth: z.number().finite().optional(),
        opacity: z.number().min(0).max(1).optional(),
        dash: z.string().max(100).optional(),
        arrow: z.string().max(8).optional(),
      }).strict().optional(),
      text: z.string().max(10000).optional(),
    }).strict(),
    z.object({ type: z.literal("delete"), id }).strict(),
    z.object({
      type: z.literal("reorder"),
      id,
      index: z.number().int().min(0),
      parentId: id.optional(),
    }).strict(),
    z.object({
      type: z.literal("group"),
      childIds: z.array(id).min(2),
      id: id.optional(),
      parentId: id.optional(),
      name: z.string().max(160).optional(),
    }).strict(),
    z.object({ type: z.literal("ungroup"), id }).strict(),
  ]),
);

const validOperations = (value: unknown): value is SceneOperation[] =>
  operationsSchema.safeParse(value).success;
const editorNumber = (value: number, digits = 3) => Number(value.toFixed(digits));

const canvasPoint = (canvas: SVGSVGElement, clientX: number, clientY: number, canvasWidth = 800, canvasHeight = 520): CanvasPoint => {
  const matrix = canvas.getScreenCTM?.();
  if (matrix && canvas.createSVGPoint) {
    const point = canvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }
  const bounds = canvas.getBoundingClientRect();
  return bounds.width && bounds.height
    ? { x: (clientX - bounds.left) * canvasWidth / bounds.width, y: (clientY - bounds.top) * canvasHeight / bounds.height }
    : { x: clientX, y: clientY };
};

const computeNodeBounds = (node: SceneNode): { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number } | undefined => {
  if (node.geometry?.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined) {
    const x = node.geometry.x + node.transform.translate.x;
    const y = node.geometry.y + node.transform.translate.y;
    const w = node.geometry.width;
    const h = node.geometry.height;
    return { minX: x, maxX: x + w, minY: y, maxY: y + h, centerX: x + w / 2, centerY: y + h / 2 };
  }
  if (node.geometry?.points?.length) {
    const xs = node.geometry.points.map((p) => p.x + node.transform.translate.x);
    const ys = node.geometry.points.map((p) => p.y + node.transform.translate.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }
  if (node.geometry?.x !== undefined && node.geometry.y !== undefined) {
    const x = node.geometry.x + node.transform.translate.x;
    const y = node.geometry.y + node.transform.translate.y;
    return { minX: x, maxX: x + 1, minY: y, maxY: y + 0.5, centerX: x + 0.5, centerY: y + 0.25 };
  }
  return undefined;
};

const previewDrag = (drag: Drag, point: CanvasPoint, nodes: SceneNode[] = [], snapEnabled = true, canvasWidth = 800, canvasHeight = 520): { preview: DragPreview; guides: SmartGuide[] } => {
  let dx = (point.x - drag.start.x) / PX_PER_CM;
  let dy = -(point.y - drag.start.y) / PX_PER_CM;
  const guides: SmartGuide[] = [];

  if (drag.mode === "marquee") {
    return {
      preview: { id: drag.id, mode: drag.mode, dx: 0, dy: 0, marquee: { start: drag.start, current: point } },
      guides: [],
    };
  }

  if ((drag.mode === "point" || drag.mode === "connect") && drag.points?.length) {
    const rawPos = { x: point.x / PX_PER_CM, y: (canvasHeight - point.y) / PX_PER_CM };
    let snapPos = rawPos;
    let snappedAnchor: { node: SceneNode; binding: ConnectorBinding; point: ScenePoint } | undefined;

    const snapRadius = 0.5; // snap threshold in cm (~19px)
    let bestDist = snapRadius;
    for (const n of nodes) {
      if (n.id === drag.id || (drag.fromId && n.id === drag.fromId) || !n.visible || n.locked || ["line", "path", "connector", "raw"].includes(n.kind)) continue;
      for (const anchor of anchors) {
        const ap = connectorAnchorPoint(n, anchor);
        if (!ap) continue;
        const dist = Math.hypot(ap.x - rawPos.x, ap.y - rawPos.y);
        if (dist < bestDist) {
          bestDist = dist;
          snapPos = ap;
          snappedAnchor = { node: n, binding: { nodeId: n.id, anchor }, point: ap };
        }
      }
    }

    const points = [...drag.points];
    points[drag.pointIndex ?? points.length - 1] = snapPos;
    return { preview: { id: drag.id, mode: drag.mode, dx, dy, geometry: { points }, snappedAnchor }, guides: [] };
  }

  if (drag.mode === "resize" && drag.width !== undefined && drag.height !== undefined) {
    const radians = ((drag.rotation ?? 0) * Math.PI) / 180;
    const localDx = dx * Math.cos(radians) + dy * Math.sin(radians);
    const localDy = -dx * Math.sin(radians) + dy * Math.cos(radians);
    const west = drag.handle === 0 || drag.handle === 6 || drag.handle === 7;
    const east = drag.handle === 2 || drag.handle === 3 || drag.handle === 4;
    const north = drag.handle === 0 || drag.handle === 1 || drag.handle === 2;
    const south = drag.handle === 4 || drag.handle === 5 || drag.handle === 6;
    let width = Math.max(0.2, drag.width + (east ? localDx : west ? -localDx : 0));
    let height = Math.max(0.2, drag.height + (north ? localDy : south ? -localDy : 0));

    if (snapEnabled) {
      const snapThreshold = 6 / PX_PER_CM;
      const otherNodes = nodes.filter((n) => n.id !== drag.id && n.visible && !n.locked && n.geometry?.width !== undefined && n.geometry?.height !== undefined);
      for (const other of otherNodes) {
        if (Math.abs(width - other.geometry!.width!) < snapThreshold) {
          width = other.geometry!.width!;
        }
        if (Math.abs(height - other.geometry!.height!) < snapThreshold) {
          height = other.geometry!.height!;
        }
      }
    }

    return {
      preview: {
        id: drag.id,
        mode: drag.mode,
        dx,
        dy,
        geometry: {
          width,
          height,
          ...(west ? { x: (drag.originX ?? 0) + drag.width - width } : {}),
          ...(south ? { y: (drag.originY ?? 0) + drag.height - height } : {}),
        },
      },
      guides: [],
    };
  }

  if (drag.mode === "rotate" && drag.rotation !== undefined && drag.center) {
    const start = Math.atan2(drag.start.y - drag.center.y, drag.start.x - drag.center.x);
    const current = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
    let rawAngle = (drag.rotation - ((current - start) * 180) / Math.PI) % 360;
    if (rawAngle < 0) rawAngle += 360;
    if (snapEnabled) {
      const snapSteps = [0, 45, 90, 135, 180, 225, 270, 315, 360];
      for (const targetAngle of snapSteps) {
        if (Math.abs(rawAngle - targetAngle) <= 6) {
          rawAngle = targetAngle === 360 ? 0 : targetAngle;
          break;
        }
      }
    }
    return { preview: { id: drag.id, mode: drag.mode, dx, dy, rotation: editorNumber(rawAngle, 1) }, guides: [] };
  }

  if (drag.mode === "move" && snapEnabled) {
    const activeNode = nodes.find((n) => n.id === drag.id);
    const bounds = activeNode ? computeNodeBounds(activeNode) : undefined;
    if (bounds) {
      const snapThreshold = 6 / PX_PER_CM;
      const targetMinX = bounds.minX + dx;
      const targetCenterX = bounds.centerX + dx;
      const targetMaxX = bounds.maxX + dx;
      const targetMinY = bounds.minY + dy;
      const targetCenterY = bounds.centerY + dy;
      const targetMaxY = bounds.maxY + dy;

      const otherNodes = nodes.filter((n) => n.id !== drag.id && n.visible && !n.locked);
      const xCandidates: Array<{ pos: number; type: string }> = [
        { pos: 0, type: "canvas" },
        { pos: canvasWidth / PX_PER_CM / 2, type: "canvas-center" },
        { pos: canvasWidth / PX_PER_CM, type: "canvas" },
      ];
      const yCandidates: Array<{ pos: number; type: string }> = [
        { pos: 0, type: "canvas" },
        { pos: canvasHeight / PX_PER_CM / 2, type: "canvas-center" },
        { pos: canvasHeight / PX_PER_CM, type: "canvas" },
      ];

      for (const other of otherNodes) {
        const b = computeNodeBounds(other);
        if (!b) continue;
        xCandidates.push({ pos: b.minX, type: "node" }, { pos: b.centerX, type: "node" }, { pos: b.maxX, type: "node" });
        yCandidates.push({ pos: b.minY, type: "node" }, { pos: b.centerY, type: "node" }, { pos: b.maxY, type: "node" });
      }

      let bestSnapX: { diff: number; targetCoord: number } | null = null;
      for (const cand of xCandidates) {
        for (const testPos of [targetMinX, targetCenterX, targetMaxX]) {
          const diff = cand.pos - testPos;
          if (Math.abs(diff) < snapThreshold && (!bestSnapX || Math.abs(diff) < Math.abs(bestSnapX.diff))) {
            bestSnapX = { diff, targetCoord: cand.pos };
          }
        }
      }
      if (bestSnapX) {
        dx += bestSnapX.diff;
        guides.push({ orientation: "v", coord: bestSnapX.targetCoord * PX_PER_CM, start: 0, end: canvasHeight });
      }

      let bestSnapY: { diff: number; targetCoord: number } | null = null;
      for (const cand of yCandidates) {
        for (const testPos of [targetMinY, targetCenterY, targetMaxY]) {
          const diff = cand.pos - testPos;
          if (Math.abs(diff) < snapThreshold && (!bestSnapY || Math.abs(diff) < Math.abs(bestSnapY.diff))) {
            bestSnapY = { diff, targetCoord: cand.pos };
          }
        }
      }
      if (bestSnapY) {
        dy += bestSnapY.diff;
        guides.push({ orientation: "h", coord: canvasHeight - bestSnapY.targetCoord * PX_PER_CM, start: 0, end: canvasWidth });
      }
    }
  }

  return { preview: { id: drag.id, mode: drag.mode, dx, dy }, guides };
};

function SourceTab({
  doc,
  onApplySource,
  onCopyTikz,
  onNotice,
}: {
  doc: SceneDocument;
  onApplySource: (document: SceneDocument) => void;
  onCopyTikz: () => void;
  onNotice: (msg: string) => void;
}) {
  const serialized = useMemo(() => serializeDocument(doc), [doc]);
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? serialized;

  return (
    <div className="bottom-content">
      <label className="source-label">
        TikZ source
        <textarea
          aria-label="TikZ source"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="source-actions">
        <button
          aria-label="Apply source"
          onClick={() => {
            const parsed = parseTikz(value);
            if (parsed.errors.length) return onNotice("Source has parse errors");
            onApplySource(parsed.document);
            setDraft(null);
            onNotice("Source applied");
          }}
        >
          Apply
        </button>
        <button
          aria-label="Discard source changes"
          onClick={() => setDraft(serializeDocument(doc))}
        >
          Discard
        </button>
        <button onClick={onCopyTikz}>Copy TikZ</button>
      </div>
    </div>
  );
}

function AssistantTab({
  doc,
  selected,
  suggestion,
  setSuggestion,
  onApplyOperations,
  onNotice,
}: {
  doc: SceneDocument;
  selected: string[];
  suggestion: { text: string; operations: SceneOperation[] } | null;
  setSuggestion: (s: { text: string; operations: SceneOperation[] } | null) => void;
  onApplyOperations: (label: string, ops: SceneOperation[]) => void;
  onNotice: (msg: string) => void;
}) {
  const [request, setRequest] = useState("");
  const [isConsulting, setIsConsulting] = useState(false);
  const [scopeToSelection, setScopeToSelection] = useState(false);
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "assistant"; text: string; time: string }>>([]);

  const sendRequest = (promptText = request) => {
    if (!promptText.trim() || isConsulting) return;
    const scopedDoc = scopeToSelection && selected.length ? { ...doc, nodes: doc.nodes.filter((n) => selected.includes(n.id)) } : doc;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setChatLog((old) => [...old, { role: "user", text: promptText, time }]);
    setIsConsulting(true);
    onNotice("Consulting Claude...");

    void Promise.resolve(askClaude(sceneToClaudeContext(scopedDoc), promptText))
      .then((result) => {
        setIsConsulting(false);
        if (!result) return;
        if (result.status === "ok" && validOperations(result.operations)) {
          setSuggestion({
            text: result.text,
            operations: result.operations,
          });
          setChatLog((old) => [...old, { role: "assistant", text: result.text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
          onNotice("Suggestion ready for review");
        } else {
          const msg = result.status === "ok" ? "Assistant suggestion was rejected" : result.message;
          onNotice(msg);
          setChatLog((old) => [...old, { role: "assistant", text: msg, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
        }
      })
      .catch(() => {
        setIsConsulting(false);
        onNotice("Claude connection error");
      });
  };

  return (
    <div className="assistant-panel">
      <div className="assistant-main">
        <div className="assistant-chips">
          {promptChips.map((chip, i) => (
            <button
              key={i}
              className="chip"
              disabled={isConsulting}
              onClick={() => {
                setRequest(chip.text);
                sendRequest(chip.text);
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="assistant-request-wrap">
          <textarea
            aria-label="Assistant request"
            placeholder="Ask Claude to modify, align, re-theme, or add elements..."
            value={request}
            disabled={isConsulting}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendRequest();
            }}
          />
          <button disabled={isConsulting || !request.trim()} onClick={() => sendRequest()}>
            {isConsulting ? "Thinking..." : "Request suggestion"}
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#aeb9ce" }}>
          <input type="checkbox" checked={scopeToSelection} onChange={(e) => setScopeToSelection(e.target.checked)} />
          Scope prompt to selected elements only ({selected.length} selected)
        </label>
      </div>
      <div className="assistant-sidebar">
        {isConsulting ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "8px", color: "#8a99b5" }}>
            <div className="spinner" style={{ width: "20px", height: "20px", border: "2px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: "12px" }}>Claude is analyzing the scene...</span>
          </div>
        ) : suggestion ? (
          <div className="suggestion-box">
            <p><b>Proposal:</b> {suggestion.text}</p>
            <button
              onClick={() => {
                onApplyOperations("Apply assistant suggestion", suggestion.operations);
                setSuggestion(null);
              }}
            >
              Apply suggestion
            </button>
          </div>
        ) : (
          <p className="empty" style={{ fontSize: "11px" }}>
            {chatLog.length ? "Ready for next instruction." : "Choose a quick preset or type instructions for Claude."}
          </p>
        )}
      </div>
    </div>
  );
}

function App() {
  const desktop = desktopFeaturesAvailable();
  const [doc, setDoc] = useState<SceneDocument>(() => parseTikz(blank).document);
  const [history, setHistory] = useState<SceneHistory>(() => createHistory(parseTikz(blank).document));
  const [project, setProject] = useState<{ handle: string; title: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<Tab>("source");
  const [notice, setNotice] = useState("Ready");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [suggestion, setSuggestion] = useState<{ text: string; operations: SceneOperation[] } | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingLayerNameId, setEditingLayerNameId] = useState<string | null>(null);
  const [layerSearch, setLayerSearch] = useState("");
  const [editingTextNodeId, setEditingTextNodeId] = useState<string | null>(null);
  const [copiedStyle, setCopiedStyle] = useState<SceneStyle | null>(null);
  const [clipboard, setClipboard] = useState<SceneNode[]>([]);
  const [draftPoints, setDraftPoints] = useState<ScenePoint[]>([]);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 800, height: 520 });

  const svg = useRef<SVGSVGElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const texFileInput = useRef<HTMLInputElement>(null);
  const checkpoint = useRef<number | undefined>(undefined);
  const projectHandle = useRef<string | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const nodes = useMemo(() => flattenRenderableNodes(doc), [doc]);

  const find = useCallback((list: SceneNode[], nodeId: string): SceneNode | undefined =>
    list.find((node) => node.id === nodeId) ??
    list.flatMap((node) => node.children ?? []).map((node) => find([node], nodeId)).find(Boolean), []);

  const groupBounds = useMemo(() => {
    if (selected.length < 2) return null;
    const bounds = selected
      .map((id) => find(doc.nodes, id))
      .map((n) => (n ? computeNodeBounds(n) : undefined))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));
    if (!bounds.length) return null;
    const minX = Math.min(...bounds.map((b) => b.minX));
    const maxX = Math.max(...bounds.map((b) => b.maxX));
    const minY = Math.min(...bounds.map((b) => b.minY));
    const maxY = Math.max(...bounds.map((b) => b.maxY));
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }, [selected, doc, find]);

  const active = find(doc.nodes, selected.at(-1) ?? "");
  projectHandle.current = project?.handle;


  const copySelection = () => {
    const chosen = selected.map((id) => find(doc.nodes, id)).filter((n): n is SceneNode => Boolean(n));
    if (!chosen.length) return;
    setClipboard(chosen.map((n) => structuredClone(n)));
    setNotice(`Copied ${chosen.length} item(s) to clipboard`);
  };

  const pasteSelection = () => {
    if (!clipboard.length) return;
    const offset = 0.4;
    const newNodes: SceneNode[] = [];
    const newIds: string[] = [];
    for (const item of clipboard) {
      const clone = structuredClone(item);
      clone.id = crypto.randomUUID();
      clone.name = `${item.name ?? item.kind} copy`;
      if (clone.geometry?.points) {
        clone.geometry.points = clone.geometry.points.map((p) => ({ x: p.x + offset, y: p.y - offset }));
      } else if (clone.geometry?.x !== undefined && clone.geometry.y !== undefined) {
        clone.geometry.x += offset;
        clone.geometry.y -= offset;
      }
      newNodes.push(clone);
      newIds.push(clone.id);
    }
    transact("Paste selection", newNodes.map((node) => ({ type: "insert", node })));
    setSelected(newIds);
  };


  const flushCheckpoint = () => {
    if (checkpoint.current) window.clearTimeout(checkpoint.current);
    checkpoint.current = undefined;
    if (project) void checkpointProject(project.handle);
  };

  const persist = (next: SceneDocument) => {
    const source = serializeDocument(next);
    setDoc(next);
    if (project) {
      void saveProject(project.handle, source);
      if (checkpoint.current) window.clearTimeout(checkpoint.current);
      checkpoint.current = window.setTimeout(flushCheckpoint, 500);
    }
  };

  const transact = (label: string, operations: SceneOperation[]) => {
    const result = applySceneTransaction(doc, {
      baseRevision: doc.revision,
      operations,
    });
    if (!result.ok) {
      setNotice("That change is unavailable");
      return;
    }
    setHistory((old) => ({
      ...old,
      past: [...old.past, old.present].slice(-old.limit),
      present: result.document,
      future: [],
    }));
    persist(result.document);
    setNotice(label);
  };

  const openTexFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseTikz(text);
      if (parsed.errors.length) {
        setNotice("Could not parse TikZ source from file");
        return;
      }
      await resetClaudeConversation();
      setProject({ handle: `file-${Date.now()}`, title: file.name });
      setDoc(parsed.document);
      setHistory(createHistory(parsed.document));
      setSelected([]);
      setNotice(`Opened ${file.name}`);
    } catch {
      setNotice("Failed to open file");
    }
  };

  const saveTexFile = () => {
    const source = serializeDocument(doc);
    const filename = project?.title
      ? (project.title.endsWith(".tex") || project.title.endsWith(".tikz") ? project.title : `${project.title}.tex`)
      : "figure.tex";
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`Saved ${filename}`);
  };

  const load = async (open = false) => {
    const next = await (open ? openProject() : createProject());
    const parsed = parseTikz(next.source);
    if (parsed.errors.length) {
      setNotice("Project source could not be parsed");
      return;
    }
    await resetClaudeConversation();
    setProject({ handle: next.handle, title: next.title });
    setDoc(parsed.document);
    setHistory(createHistory(parsed.document));
    setSelected([]);
    setNotice(`Opened ${next.title}`);
    setCommits(await listHistory(next.handle));
  };

  const add = (kind: Exclude<Tool, "select" | "connector">) => {
    const node = shapeNode(
      kind,
      nodes.filter((node) => node.kind !== "raw").length,
    );
    transact(`Add ${node.name}`, [{ type: "insert", node }]);
    setSelected([node.id]);
    setTool("select");
  };

  const undo = () => {
    const prior = history.past.at(-1);
    if (!prior) return;
    const next = {
      ...history,
      past: history.past.slice(0, -1),
      present: prior,
      future: [history.present, ...history.future],
    };
    setHistory(next);
    persist(prior);
    setSelected([]);
    setNotice("Undo");
  };

  const redo = () => {
    const nextDoc = history.future[0];
    if (!nextDoc) return;
    const next = {
      ...history,
      past: [...history.past, history.present].slice(-history.limit),
      present: nextDoc,
      future: history.future.slice(1),
    };
    setHistory(next);
    persist(nextDoc);
    setSelected([]);
    setNotice("Redo");
  };

  const update = (operation: SceneOperation, label = "Update properties") =>
    transact(label, [operation]);

  const siblingsFor = (list: SceneNode[], nodeId: string): SceneNode[] | undefined => {
    if (list.some((node) => node.id === nodeId)) return list;
    return list.map((node) => node.children && siblingsFor(node.children, nodeId)).find(Boolean);
  };

  const duplicate = () => {
    if (!active) return;
    const clone = structuredClone(active);
    clone.id = crypto.randomUUID();
    clone.name = `${active.name ?? active.kind} copy`;
    if (clone.geometry?.points)
      clone.geometry.points = clone.geometry.points.map((point) => ({ x: point.x + 0.3, y: point.y + 0.3 }));
    else if (clone.geometry?.x !== undefined && clone.geometry.y !== undefined) {
      clone.geometry.x += 0.3;
      clone.geometry.y += 0.3;
    }
    transact("Duplicate selection", [{ type: "insert", node: clone }]);
    setSelected([clone.id]);
  };

  const align = (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    const chosen = selected.map((nodeId) => find(doc.nodes, nodeId)).filter((node): node is SceneNode => Boolean(node?.geometry && node.geometry.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined));
    if (chosen.length < 2) return;
    const horizontal = ["left", "center", "right"].includes(mode);
    const values = chosen.map((node) => horizontal ? node.geometry!.x! + (mode === "center" ? node.geometry!.width! / 2 : mode === "right" ? node.geometry!.width! : 0) : node.geometry!.y! + (mode === "middle" ? node.geometry!.height! / 2 : mode === "top" ? node.geometry!.height! : 0));
    const left = Math.min(...chosen.map((node) => node.geometry!.x!));
    const right = Math.max(...chosen.map((node) => node.geometry!.x! + node.geometry!.width!));
    const bottom = Math.min(...chosen.map((node) => node.geometry!.y!));
    const top = Math.max(...chosen.map((node) => node.geometry!.y! + node.geometry!.height!));
    const target = mode === "left" ? left : mode === "right" ? right : mode === "center" ? (left + right) / 2 : mode === "bottom" ? bottom : mode === "top" ? top : (bottom + top) / 2;
    transact(`Align ${mode}`, chosen.map((node, index) => ({ type: "move", id: node.id, dx: horizontal ? target - values[index] : 0, dy: horizontal ? 0 : target - values[index] })));
  };

  const alignToCanvas = (axis: "h" | "v") => {
    const chosen = selected.map((nodeId) => find(doc.nodes, nodeId)).filter((node): node is SceneNode => Boolean(node));
    if (!chosen.length) return;
    const canvasCenterX = canvasSize.width / PX_PER_CM / 2;
    const canvasCenterY = canvasSize.height / PX_PER_CM / 2;
    const ops: SceneOperation[] = [];
    for (const node of chosen) {
      const b = computeNodeBounds(node);
      if (!b) continue;
      ops.push({
        type: "move",
        id: node.id,
        dx: axis === "h" ? canvasCenterX - b.centerX : 0,
        dy: axis === "v" ? canvasCenterY - b.centerY : 0,
      });
    }
    if (ops.length) transact(`Center on canvas ${axis === "h" ? "horizontally" : "vertically"}`, ops);
  };

  const matchSize = (dim: "width" | "height" | "both") => {
    if (!active?.geometry?.width || !active.geometry.height || selected.length < 2) return;
    const targetW = active.geometry.width;
    const targetH = active.geometry.height;
    const ops: SceneOperation[] = selected
      .filter((id) => id !== active.id)
      .map((id) => find(doc.nodes, id))
      .filter((n): n is SceneNode => Boolean(n?.geometry?.width !== undefined))
      .map((n) => ({
        type: "update_properties",
        id: n.id,
        geometry: {
          ...(dim === "width" || dim === "both" ? { width: targetW } : {}),
          ...(dim === "height" || dim === "both" ? { height: targetH } : {}),
        },
      }));
    if (ops.length) transact("Match size", ops);
  };

  const distribute = (axis: "horizontal" | "vertical") => {
    const chosen = selected.map((nodeId) => find(doc.nodes, nodeId)).filter((node): node is SceneNode => Boolean(node?.geometry && node.geometry.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined));
    if (chosen.length < 3) return;
    const center = (node: SceneNode) => axis === "horizontal" ? node.geometry!.x! + node.geometry!.width! / 2 : node.geometry!.y! + node.geometry!.height! / 2;
    const ordered = [...chosen].sort((a, b) => center(a) - center(b));
    const first = center(ordered[0]);
    const step = (center(ordered.at(-1)!) - first) / (ordered.length - 1);
    transact(`Distribute ${axis}`, ordered.map((node, index) => ({ type: "move", id: node.id, dx: axis === "horizontal" ? first + step * index - center(node) : 0, dy: axis === "vertical" ? first + step * index - center(node) : 0 })));
  };

  const copyTikz = () => {
    const code = serializeDocument(doc);
    void navigator.clipboard.writeText(code);
    setNotice("Copied TikZ to clipboard");
  };

  const beginDrag = (
    event: React.PointerEvent<SVGElement>,
    value: Omit<Drag, "pointerId" | "start">,
  ) => {
    if (!svg.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = canvasPoint(svg.current, event.clientX, event.clientY, canvasSize.width, canvasSize.height);
    drag.current = { ...value, pointerId: event.pointerId, start };
    setDragPreview({ id: value.id, mode: value.mode, dx: 0, dy: 0 });
    setSmartGuides([]);
    svg.current.setPointerCapture?.(event.pointerId);
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>, cancel = false) => {
    const value = drag.current;
    if (!value || value.pointerId !== event.pointerId) return;
    const { preview } = previewDrag(value, canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height), nodes, snapEnabled, canvasSize.width, canvasSize.height);
    drag.current = null;
    setDragPreview(null);
    setSmartGuides([]);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) return;

    if (preview.mode === "marquee" && preview.marquee) {
      const minX = Math.min(preview.marquee.start.x, preview.marquee.current.x) / PX_PER_CM;
      const maxX = Math.max(preview.marquee.start.x, preview.marquee.current.x) / PX_PER_CM;
      const minY = (canvasSize.height - Math.max(preview.marquee.start.y, preview.marquee.current.y)) / PX_PER_CM;
      const maxY = (canvasSize.height - Math.min(preview.marquee.start.y, preview.marquee.current.y)) / PX_PER_CM;

      const hitIds = nodes.filter((n) => {
        const b = computeNodeBounds(n);
        if (!b) return false;
        return b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY;
      }).map((n) => n.id);

      setSelected((old) => event.shiftKey ? Array.from(new Set([...old, ...hitIds])) : hitIds);
      return;
    }

    const hit = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<SVGElement>("[data-node-id]")?.dataset.nodeId;
    const hitNode = hit ? find(doc.nodes, hit) : undefined;
    const scenePoint = { x: event.clientX, y: event.clientY };
    const canvas = canvasPoint(event.currentTarget, scenePoint.x, scenePoint.y, canvasSize.width, canvasSize.height);
    const endpoint = { x: canvas.x / PX_PER_CM, y: (canvasSize.height - canvas.y) / PX_PER_CM };

    if (preview.mode === "connect" && value.fromId) {
      const from = find(doc.nodes, value.fromId);
      const toAnchor = preview.snappedAnchor;
      const targetNode = toAnchor?.node ?? hitNode;
      if (!from || !targetNode || targetNode.id === from.id) return setNotice("Drop connector on a valid shape attach point");
      const start = nearestConnectorAnchor(from, { x: value.start.x / PX_PER_CM, y: (canvasSize.height - value.start.y) / PX_PER_CM });
      const end = toAnchor ? toAnchor.binding : nearestConnectorAnchor(targetNode, endpoint);
      if (!start || !end) return setNotice("That shape has no connection sites");
      const node: SceneNode = { id: crypto.randomUUID(), kind: "connector", name: "Connector", visible: true, locked: false, transform: identity, geometry: { points: [connectorAnchorPoint(from, start.anchor)!, connectorAnchorPoint(targetNode, end.anchor)!] }, bindings: { start, end, routing: "straight" }, style: { stroke: "black", strokeWidth: 0.06, arrow: "->" }, prefix: "\n", source: "" };
      transact("Connect shapes", [{ type: "insert", node }]);
      setSelected([node.id]);
      setTool("select");

      return;
    }
    if (preview.mode === "point" && preview.geometry?.points) {
      const node = find(doc.nodes, preview.id);
      if (!node) return;
      const index = value.pointIndex ?? 0;
      const isEndpoint = index === 0 || index === preview.geometry.points.length - 1;
      let bindings = node.bindings;
      if (isEndpoint) {
        if (preview.snappedAnchor) {
          const binding = preview.snappedAnchor.binding;
          bindings = { ...(bindings ?? { routing: "straight" }), ...(index === 0 ? { start: binding } : { end: binding }) };
        } else if (bindings) {
          bindings = { ...bindings, ...(index === 0 ? { start: undefined } : { end: undefined }) };
        }
      }
      update({
        type: "update_properties",
        id: preview.id,
        geometry: { points: preview.geometry.points.map((point) => ({ x: editorNumber(point.x), y: editorNumber(point.y) })) },
        ...(bindings ? { bindings } : {}),
      }, bindings ? "Connect endpoint" : "Reshape line");
      return;
    }

    if (value.id === "multi-selection" && value.mode === "resize" && value.width && value.height && preview.geometry?.width !== undefined && preview.geometry?.height !== undefined) {
      const scaleX = preview.geometry.width / value.width;
      const scaleY = preview.geometry.height / value.height;
      const originX = value.originX ?? 0;
      const originY = value.originY ?? 0;
      const ops: SceneOperation[] = [];
      for (const id of selected) {
        const node = find(doc.nodes, id);
        if (!node) continue;
        if (node.geometry?.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined) {
          const nx = originX + (node.geometry.x - originX) * scaleX;
          const ny = originY + (node.geometry.y - originY) * scaleY;
          const nw = Math.max(0.1, node.geometry.width * scaleX);
          const nh = Math.max(0.1, node.geometry.height * scaleY);
          ops.push({ type: "update_properties", id: node.id, geometry: { x: editorNumber(nx), y: editorNumber(ny), width: editorNumber(nw), height: editorNumber(nh) } });
        } else if (node.geometry?.points) {
          const points = node.geometry.points.map((p) => ({ x: editorNumber(originX + (p.x - originX) * scaleX), y: editorNumber(originY + (p.y - originY) * scaleY) }));
          ops.push({ type: "update_properties", id: node.id, geometry: { points } });
        } else if (node.geometry?.x !== undefined && node.geometry.y !== undefined) {
          const nx = originX + (node.geometry.x - originX) * scaleX;
          const ny = originY + (node.geometry.y - originY) * scaleY;
          ops.push({ type: "update_properties", id: node.id, geometry: { x: editorNumber(nx), y: editorNumber(ny) } });
        }
      }
      if (ops.length) transact("Scale selection", ops);
      return;
    }

    if (value.id === "multi-selection" && value.mode === "rotate" && preview.rotation !== undefined) {
      const ops: SceneOperation[] = selected.map((id) => {
        const node = find(doc.nodes, id);
        return {
          type: "transform",
          id,
          transform: { rotate: editorNumber((node?.transform.rotate ?? 0) + preview.rotation!, 1) },
        };
      });
      transact("Rotate selection", ops);
      return;
    }

    if (preview.mode === "resize" && preview.geometry)
      update({ type: "update_properties", id: preview.id, geometry: Object.fromEntries(Object.entries(preview.geometry).filter((entry): entry is [string, number] => typeof entry[1] === "number").map(([key, value]) => [key, editorNumber(value)])) }, "Resize selection");
    else if (preview.mode === "rotate" && preview.rotation !== undefined)
      update({ type: "transform", id: preview.id, transform: { rotate: editorNumber(preview.rotation, 1) } }, "Rotate selection");
    else if (preview.dx || preview.dy) {
      if (selected.length > 1 && selected.includes(preview.id)) {
        transact("Move selection", selected.map((id) => ({ type: "move", id, dx: editorNumber(preview.dx), dy: editorNumber(preview.dy) })));
      } else {
        update({ type: "move", id: preview.id, dx: editorNumber(preview.dx), dy: editorNumber(preview.dy) }, "Move selection");
      }
    }

  };

  const soloLayer = (targetId: string) => {
    const ops: SceneOperation[] = nodes.map((node) => ({
      type: "set_metadata",
      id: node.id,
      visible: node.id === targetId,
    }));
    transact("Solo layer", ops);
  };

  const layer = (
    node: SceneNode,
    depth = 0,
    ancestorVisible = true,
    ancestorLocked = false,
  ): React.ReactNode => {
    const isGroup = node.kind === "group";
    const isCollapsed = collapsedGroups.has(node.id);
    const matchesSearch = !layerSearch || (node.name ?? node.kind).toLowerCase().includes(layerSearch.toLowerCase()) || node.kind.toLowerCase().includes(layerSearch.toLowerCase());

    return (
      <Fragment key={node.id}>
        {matchesSearch && (
          <div
            className={`layer ${selected.includes(node.id) ? "selected" : ""}`}
            draggable={!node.locked}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData("text/plain");
              if (draggedId && draggedId !== node.id) {
                const list = siblingsFor(doc.nodes, node.id);
                const targetIdx = list?.findIndex((n) => n.id === node.id) ?? 0;
                update({ type: "reorder", id: draggedId, index: targetIdx }, "Reorder layer");
              }
            }}
            style={{
              paddingLeft: 4 + depth * 14,
              opacity: ancestorVisible && node.visible ? 1 : 0.45,
            }}
          >

            <span className="layer-drag-handle" title="Drag to reorder">⠿</span>
            {isGroup ? (
              <button
                className="layer-fold"
                aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                onClick={() => {
                  setCollapsedGroups((old) => {
                    const next = new Set(old);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                }}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="layer-icon"><KindIcon kind={node.kind} size={12} /></span>
            )}
            {editingLayerNameId === node.id ? (
              <input
                className="layer-rename-input"
                autoFocus
                defaultValue={node.name ?? node.kind}
                onBlur={(e) => {
                  setEditingLayerNameId(null);
                  if (e.target.value !== (node.name ?? node.kind))
                    update({ type: "set_metadata", id: node.id, name: e.target.value }, "Rename layer");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingLayerNameId(null);
                }}
              />
            ) : (
              <button
                className="layer-name"
                onDoubleClick={() => setEditingLayerNameId(node.id)}
                onClick={(event) =>
                  setSelected((old) =>
                    event.shiftKey
                      ? old.includes(node.id)
                        ? old.filter((id) => id !== node.id)
                        : [...old, node.id]
                      : [node.id],
                  )
                }
              >
                {node.name ?? node.kind}
              </button>
            )}
            <button
              aria-label={
                node.visible
                  ? `Hide ${node.name ?? node.kind}`
                  : `Show ${node.name ?? node.kind}`
              }
              onClick={(e) => {
                if (e.altKey) soloLayer(node.id);
                else
                  update({
                    type: "set_metadata",
                    id: node.id,
                    visible: !node.visible,
                  });
              }}
              title="Click to toggle, Alt+Click to solo"
            >
              {node.visible ? "◉" : "○"}
            </button>
            <button
              aria-label={
                node.locked || ancestorLocked
                  ? `Unlock ${node.name ?? node.kind}`
                  : `Lock ${node.name ?? node.kind}`
              }
              disabled={ancestorLocked}
              onClick={() =>
                update({ type: "set_metadata", id: node.id, locked: !node.locked })
              }
            >
              {node.locked || ancestorLocked ? "🔒" : "🔓"}
            </button>
            <div className="layer-actions">
              <button
                aria-label={`Move ${node.name ?? node.kind} up`}
                title="Move up"
                onClick={(e) => {
                  e.stopPropagation();
                  const list = siblingsFor(doc.nodes, node.id);
                  const idx = list?.findIndex((n) => n.id === node.id) ?? 0;
                  if (idx > 0) update({ type: "reorder", id: node.id, index: idx - 1 }, "Move layer up");
                }}
              >
                ▲
              </button>
              <button
                aria-label={`Move ${node.name ?? node.kind} down`}
                title="Move down"
                onClick={(e) => {
                  e.stopPropagation();
                  const list = siblingsFor(doc.nodes, node.id);
                  const idx = list?.findIndex((n) => n.id === node.id) ?? 0;
                  if (list && idx < list.length - 1) update({ type: "reorder", id: node.id, index: idx + 1 }, "Move layer down");
                }}
              >
                ▼
              </button>
            </div>
          </div>

        )}
        {!isCollapsed && node.children?.map((child) => (
          <Fragment key={child.id}>{layer(child, depth + 1, ancestorVisible && node.visible, ancestorLocked || node.locked)}</Fragment>
        ))}
      </Fragment>
    );
  };

  const exportSvg = () => {
    if (!svg.current) return;
    const blob = new Blob(
      [new XMLSerializer().serializeToString(svg.current)],
      { type: "image/svg+xml" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "figure.svg";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("SVG exported");
  };

  const exportPdf = async () => {
    if (!project) return setNotice("Create a project before exporting PDF");
    const result = await compileProject(project.handle);
    if (result.status !== "ok")
      return setNotice(
        result.status === "unavailable"
          ? "PDF export is unavailable"
          : "PDF export failed",
      );
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(result.pdf)], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "figure.pdf";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("PDF exported");
  };

  const placeImage = async (file?: File) => {
    if (!file || !project)
      return setNotice("Create a project before placing an image");
    const name =
      file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "image";
    await writeAsset(
      project.handle,
      name,
      new Uint8Array(await file.arrayBuffer()),
    );
    const base = shapeNode(
      "image",
      nodes.filter((node) => node.kind === "image").length,
    );
    const node = {
      ...base,
      name: "Image",
      geometry: { ...base.geometry, width: 3, height: 2 },
      image: { href: name, width: 3, height: 2 },
    };
    transact("Place image", [{ type: "insert", node }]);
    setSelected([node.id]);
  };




  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (editingTextNodeId || editingLayerNameId) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "c" && selected.length) {
        event.preventDefault();
        copySelection();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "v" && clipboard.length) {
        event.preventDefault();
        pasteSelection();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "d" &&
        active
      ) {
        event.preventDefault();
        duplicate();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "g" &&
        selected.length > 1
      ) {
        event.preventDefault();
        if (event.shiftKey && active?.kind === "group") {
          update({ type: "ungroup", id: active.id }, "Ungroup selection");
        } else {
          transact("Group selection", [{ type: "group", childIds: selected, name: "Group" }]);
        }
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "a"
      ) {
        event.preventDefault();
        setSelected(nodes.filter((n) => n.kind !== "raw" && !n.locked).map((n) => n.id));
      } else if (event.key === "Enter" && draftPoints.length >= 2) {
        event.preventDefault();
        const node: SceneNode = {
          id: crypto.randomUUID(),
          kind: "path",
          name: "Path",
          visible: true,
          locked: false,
          transform: identity,
          geometry: { points: draftPoints },
          style: { stroke: "black", strokeWidth: 0.06 },
          prefix: "\n",
          source: "",
        };
        transact("Create path", [{ type: "insert", node }]);
        setDraftPoints([]);
        setSelected([node.id]);
        setTool("select");
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveTexFile();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (texFileInput.current) texFileInput.current.click();
        else void load(true);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected.length
      ) {
        transact(
          "Delete selection",
          selected.map((id) => ({ type: "delete", id })),
        );
      } else if (event.key === "Escape") {
        setSelected([]);
        setDraftPoints([]);
        setEditingTextNodeId(null);
      }
 else if (
        active &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 0.25 : 0.03;
        update(
          {
            type: "move",
            id: active.id,
            dx:
              event.key === "ArrowRight"
                ? step
                : event.key === "ArrowLeft"
                  ? -step
                  : 0,
            dy:
              event.key === "ArrowUp"
                ? step
                : event.key === "ArrowDown"
                  ? -step
                  : 0,
          },
          "Nudge selection",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  useEffect(() => () => {
    if (checkpoint.current) {
      window.clearTimeout(checkpoint.current);
      const handle = projectHandle.current;
      if (handle) void checkpointProject(handle);
    }
  }, []);

  return (
    <main className="figureit-shell">
      <header className="topbar">
        <strong>
          Figure<span>It</span>
        </strong>
        <span className="file-name">
          {project?.title ?? "untitled-figure.tex"}
        </span>
        <div className="top-actions">
          <button aria-label="New project" onClick={() => load()} title="New project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            New
          </button>
          <button aria-label="Open project" onClick={() => texFileInput.current ? texFileInput.current.click() : void load(true)} title="Open TikZ / TeX file (Cmd+O)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Open
          </button>
          <button aria-label="Save TeX file" onClick={saveTexFile} title="Save / Export as .tex file (Cmd+S)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save .tex
          </button>
          <button
            aria-label="Undo"
            disabled={!history.past.length}
            onClick={undo}
            title="Undo (Cmd+Z)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>
          <button
            aria-label="Redo"
            disabled={!history.future.length}
            onClick={redo}
            title="Redo (Cmd+Shift+Z)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
          </button>
          <button aria-label="Copy selection" disabled={!selected.length} onClick={copySelection} title="Copy selection (Cmd+C)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
          <button aria-label="Paste selection" disabled={!clipboard.length} onClick={pasteSelection} title="Paste selection (Cmd+V)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
            Paste
          </button>
          <button onClick={copyTikz} title="Copy TikZ code to clipboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Copy TikZ
          </button>
          <button onClick={exportSvg} title="Export as SVG">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12 8 16 16 8 16"/></svg>
            Export SVG
          </button>
          <button disabled={!desktop} title={desktop ? "Export as standalone PDF" : "PDF export is available on desktop"} onClick={() => void exportPdf()} className="export">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Export PDF
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="left-panel" aria-label="Tools and layers">
          <section className="tool-grid">
            <h2>Tools</h2>
            {labels.map(([id, label]) => (
              <button
                key={id}
                aria-label={label}
                className={tool === id ? "active" : ""}
                disabled={id === "image" && !desktop}
                title={id === "image" && !desktop ? "Images are available on desktop" : undefined}
                onClick={() =>
                  id === "select" || id === "connector" || id === "path"
                    ? (setTool(id),
                      setNotice(
                        id === "connector"
                          ? "Drag between shape connection sites to connect"
                          : id === "path"
                            ? "Pen: Click to place points, double-click or Enter to finish"
                            : "Select",
                      ))
                    : id === "image"
                      ? imageInput.current?.click()
                      : add(id)
                }
              >
                <span className="tool-icon-wrap"><ToolIcon kind={id} /></span>
                <small>{label}</small>
              </button>
            ))}
            <input ref={imageInput} aria-label="Image file" type="file" accept="image/*" hidden onChange={(event) => void placeImage(event.target.files?.[0])} />
            <input
              ref={texFileInput}
              aria-label="TeX file"
              type="file"
              accept=".tex,.tikz,.latex,text/plain"
              hidden
              onChange={(event) => {
                const f = event.target.files?.[0];
                if (f) void openTexFile(f);
                event.target.value = "";
              }}
            />
          </section>

          <section className="layers">
            <div className="panel-title">
              <h2>Layers</h2>
              <button
                aria-label="Group selected layers"
                disabled={selected.length < 2}
                onClick={() => {
                  transact("Group selection", [
                    { type: "group", childIds: selected, name: "Group" },
                  ]);
                  setSelected([]);
                }}
              >
                Group
              </button>
            </div>
            <input
              className="layer-search"
              placeholder="Filter layers..."
              value={layerSearch}
              onChange={(e) => setLayerSearch(e.target.value)}
            />
            <div className="layer-list">
              {doc.nodes.map((node) => <Fragment key={node.id}>{layer(node)}</Fragment>)}
            </div>
            {selected.length > 1 && <div className="layer-arrange" aria-label="Align selected layers">
              <button aria-label="Align left" onClick={() => align("left")} title="Align Left">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="4" y1="3" x2="4" y2="21"/><rect x="4" y="6" width="14" height="4" rx="1"/><rect x="4" y="14" width="8" height="4" rx="1"/></svg>
              </button>
              <button aria-label="Align center" onClick={() => align("center")} title="Align Center (H)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="3" x2="12" y2="21"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>
              </button>
              <button aria-label="Align right" onClick={() => align("right")} title="Align Right">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="20" y1="3" x2="20" y2="21"/><rect x="6" y="6" width="14" height="4" rx="1"/><rect x="12" y="14" width="8" height="4" rx="1"/></svg>
              </button>
              <button aria-label="Align top" onClick={() => align("top")} title="Align Top">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="4" x2="21" y2="4"/><rect x="6" y="4" width="4" height="14" rx="1"/><rect x="14" y="4" width="4" height="8" rx="1"/></svg>
              </button>
              <button aria-label="Align middle" onClick={() => align("middle")} title="Align Middle (V)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="12" x2="21" y2="12"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>
              </button>
              <button aria-label="Align bottom" onClick={() => align("bottom")} title="Align Bottom">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="6" width="4" height="14" rx="1"/><rect x="14" y="12" width="4" height="8" rx="1"/></svg>
              </button>
              <button aria-label="Distribute horizontally" disabled={selected.length < 3} onClick={() => distribute("horizontal")} title="Distribute Horizontally">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="18" y="5" width="4" height="14" rx="1"/></svg>
              </button>
              <button aria-label="Distribute vertically" disabled={selected.length < 3} onClick={() => distribute("vertical")} title="Distribute Vertically">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="2" width="14" height="4" rx="1"/><rect x="5" y="10" width="14" height="4" rx="1"/><rect x="5" y="18" width="14" height="4" rx="1"/></svg>
              </button>
            </div>}
          </section>
        </aside>
        <section className="canvas-area" aria-label="Artboard">
          <div className="canvas-controls">
            <div className="canvas-controls-group">
              <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} title="Zoom out">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <output title="Canvas Zoom">{Math.round(zoom * 100)}%</output>
              <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))} title="Zoom in">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button onClick={() => setZoom(1)} title="Reset zoom">100%</button>
              <button onClick={() => setShowGrid((g) => !g)} className={showGrid ? "active" : ""} title="Toggle grid pattern">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                Grid
              </button>
              <button onClick={() => setSnapEnabled((s) => !s)} className={snapEnabled ? "active" : ""} title="Toggle smart snapping guides">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="3" x2="8" y2="3"/><line x1="16" y1="3" x2="20" y2="3"/></svg>
                Snap
              </button>
              <select
                aria-label="Canvas size preset"
                value={`${canvasSize.width}x${canvasSize.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split("x").map(Number);
                  if (w && h) setCanvasSize({ width: w, height: h });
                }}
                style={{ background: "#171b23", color: "#e8edf7", border: "1px solid #384155", borderRadius: "4px", padding: "2px 6px", fontSize: "11px" }}
              >
                {canvasPresets.map((preset) => (
                  <option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
                    {preset.label}
                  </option>
                ))}
                {!canvasPresets.some((p) => p.width === canvasSize.width && p.height === canvasSize.height) && (
                  <option value={`${canvasSize.width}x${canvasSize.height}`}>
                    Custom ({canvasSize.width} × {canvasSize.height})
                  </option>
                )}
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "11px", color: "#a0aec0" }}>
                W:
                <input
                  aria-label="Canvas width"
                  type="number"
                  min="100"
                  max="4000"
                  step="10"
                  className="canvas-size-input"
                  value={canvasSize.width}
                  onChange={(e) => setCanvasSize((s) => ({ ...s, width: Math.max(100, Number(e.target.value)) }))}
                  title="Canvas width in pixels"
                />
              </label>
              <span style={{ color: "#718096" }}>×</span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "11px", color: "#a0aec0" }}>
                H:
                <input
                  aria-label="Canvas height"
                  type="number"
                  min="100"
                  max="4000"
                  step="10"
                  className="canvas-size-input"
                  value={canvasSize.height}
                  onChange={(e) => setCanvasSize((s) => ({ ...s, height: Math.max(100, Number(e.target.value)) }))}
                  title="Canvas height in pixels"
                />
              </label>
            </div>
            <div className="canvas-controls-group">
              <span style={{ fontSize: "11px", color: "#8a99b5" }}>
                {(canvasSize.width / PX_PER_CM).toFixed(1)} × {(canvasSize.height / PX_PER_CM).toFixed(1)} cm
              </span>
              <span>Scene · {doc.revision}</span>
            </div>
          </div>
          <div
            className="artboard-wrap"
            style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0];
              if (f) void openTexFile(f);
            }}
          >
            <svg
              ref={svg}
              className="artboard"
              viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
              style={{ width: `${canvasSize.width}px`, aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
              aria-label="Figure artboard"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  if (tool === "path") {
                    const canvas = canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height);
                    const newPt = { x: editorNumber(canvas.x / PX_PER_CM), y: editorNumber((canvasSize.height - canvas.y) / PX_PER_CM) };
                    if (draftPoints.length >= 1 && event.detail === 2) {
                      const node: SceneNode = {
                        id: crypto.randomUUID(),
                        kind: "path",
                        name: "Path",
                        visible: true,
                        locked: false,
                        transform: identity,
                        geometry: { points: [...draftPoints, newPt] },
                        style: { stroke: "black", strokeWidth: 0.06 },
                        prefix: "\n",
                        source: "",
                      };
                      transact("Create path", [{ type: "insert", node }]);
                      setDraftPoints([]);
                      setSelected([node.id]);
                      setTool("select");
                    } else {
                      setDraftPoints((old) => [...old, newPt]);
                      setNotice(`Pen: ${draftPoints.length + 1} point(s) placed. Double-click or press Enter to finish.`);
                    }
                  } else if (tool === "select") {
                    const start = canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height);
                    drag.current = { id: "marquee", mode: "marquee", pointerId: event.pointerId, start };
                    setDragPreview({ id: "marquee", mode: "marquee", dx: 0, dy: 0, marquee: { start, current: start } });
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  } else {
                    setSelected([]);
                  }
                }
              }}
              onPointerMove={(event) => {
                if (drag.current?.pointerId === event.pointerId) {
                  const { preview, guides } = previewDrag(drag.current, canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height), nodes, snapEnabled, canvasSize.width, canvasSize.height);
                  setDragPreview(preview);
                  setSmartGuides(guides);
                }
              }}
              onPointerUp={(event) => finishDrag(event)}
              onPointerCancel={(event) => finishDrag(event, true)}
            >
              <defs>
                <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke" /></marker>
                <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke" /></marker>
                {nodes.filter((node) => node.style?.gradient).map((node) => <linearGradient key={node.id} id={`gradient-${node.id.replace(/[^\w-]/g, "-")}`} gradientTransform={`rotate(${node.style!.gradient!.angle} .5 .5)`}><stop offset="0" stopColor={node.style!.gradient!.start} /><stop offset="1" stopColor={node.style!.gradient!.end} /></linearGradient>)}
                <pattern id="canvas-grid" width="18.897" height="18.897" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#c3cee0" />
                </pattern>
              </defs>
              <rect width={canvasSize.width} height={canvasSize.height} fill="white" pointerEvents="none" />
              {showGrid && <rect width={canvasSize.width} height={canvasSize.height} fill="url(#canvas-grid)" pointerEvents="none" opacity="0.6" />}
              {nodes
                .filter((node) => node.visible)
                .map((node) => {
                  const preview = dragPreview?.id === node.id ? dragPreview : undefined;
                  const g = { ...node.geometry, ...(preview?.geometry ?? {}) };
                  const x = (g.x ?? 0) * PX_PER_CM;
                  const y = canvasSize.height - (g.y ?? 0) * PX_PER_CM;
                  const w = (g.width ?? 3) * PX_PER_CM;
                  const h = (g.height ?? 2) * PX_PER_CM;
                  const style = node.style ?? {};
                  const rawPoints = g.points ?? [];
                  const transformCenterX = rawPoints.length ? (Math.min(...rawPoints.map((point) => point.x)) + Math.max(...rawPoints.map((point) => point.x))) / 2 * PX_PER_CM : node.kind === "text" || node.kind === "math" ? x : x + w / 2;
                  const transformCenterY = rawPoints.length ? canvasSize.height - (Math.min(...rawPoints.map((point) => point.y)) + Math.max(...rawPoints.map((point) => point.y))) / 2 * PX_PER_CM : node.kind === "text" || node.kind === "math" ? y : y - h / 2;
                  const fill = style.gradient ? `url(#gradient-${node.id.replace(/[^\w-]/g, "-")})` : style.fill ?? "#7c9cff";
                  const dash = style.dash === "dashed" || style.dash === "on 4pt off 3pt" ? "8 6" : style.dash === "dotted" || style.dash === "on 0pt off 2pt" ? "2 5" : undefined;
                  const markerStart = style.arrow === "<-" || style.arrow === "<->" ? "url(#arrow-start)" : undefined;
                  const markerEnd = style.arrow === "->" || style.arrow === "<->" || (node.kind === "connector" && style.arrow === undefined) ? "url(#arrow-end)" : undefined;
                  const hasSuggestion = suggestion?.operations.some((op) => "id" in op && op.id === node.id);

                  return (
                    <g
                      key={node.id}
                      aria-label={node.name ?? node.kind}
                      data-testid="shape"
                      data-node-id={node.id}
                      transform={`translate(${(node.transform.translate.x + (preview?.mode === "move" ? preview.dx : 0)) * PX_PER_CM} ${-(node.transform.translate.y + (preview?.mode === "move" ? preview.dy : 0)) * PX_PER_CM}) rotate(${-(preview?.rotation ?? node.transform.rotate)} ${transformCenterX} ${transformCenterY}) translate(${transformCenterX} ${transformCenterY}) scale(${node.transform.xScale} ${node.transform.yScale}) translate(${-transformCenterX} ${-transformCenterY})`}
                      opacity={style.opacity ?? 1}
                      className={`shape ${selected.includes(node.id) ? "selected" : ""} ${hasSuggestion ? "has-suggestion" : ""}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (["line", "path", "connector"].includes(node.kind) && rawPoints.length >= 2 && svg.current) {
                          const cp = canvasPoint(svg.current, e.clientX, e.clientY, canvasSize.width, canvasSize.height);
                          const clickPoint = {
                            x: editorNumber(cp.x / PX_PER_CM),
                            y: editorNumber((canvasSize.height - cp.y) / PX_PER_CM),
                          };
                          const newPoints = [rawPoints[0], clickPoint, ...rawPoints.slice(1)];
                          update({
                            type: "update_properties",
                            id: node.id,
                            geometry: { points: newPoints },
                          }, "Add vertex to line");
                        } else {
                          setEditingTextNodeId(node.id);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (!node.locked) {
                          if (tool === "connector" && node.geometry?.width !== undefined && node.geometry.height !== undefined && svg.current) {
                            const canvas = canvasPoint(svg.current, event.clientX, event.clientY, canvasSize.width, canvasSize.height);
                            const binding = nearestConnectorAnchor(node, { x: canvas.x / PX_PER_CM, y: (canvasSize.height - canvas.y) / PX_PER_CM });
                            const point = binding && connectorAnchorPoint(node, binding.anchor);
                            if (point) beginDrag(event, { id: "connector-preview", mode: "connect", fromId: node.id, points: [point, point], pointIndex: 1 });
                          } else {
                            beginDrag(event, { id: node.id, mode: "move" });
                          }
                          setSelected((old) =>
                            event.shiftKey || event.metaKey || event.ctrlKey
                              ? old.includes(node.id)
                                ? old.filter((id) => id !== node.id)
                                : [...old, node.id]
                              : old.includes(node.id)
                                ? old
                                : [node.id],
                          );
                        }
                      }}
                    >

                      {node.kind === "ellipse" ? (
                        <ellipse
                          cx={x + w / 2}
                          cy={y - h / 2}
                          rx={w / 2}
                          ry={h / 2}
                          fill={fill}
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                          strokeDasharray={dash}
                        />
                      ) : node.kind === "line" ||
                        node.kind === "path" ||
                        node.kind === "connector" ? (
                        <path
                          d={computePathD(rawPoints, node.bindings?.routing, canvasSize.height)}
                          fill="none"
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                          strokeDasharray={dash}
                          markerStart={markerStart}
                          markerEnd={markerEnd}
                        />
                      ) : node.kind === "triangle" ? (
                        <polygon points={`${x + w / 2},${y - h} ${x + w},${y} ${x},${y}`} fill={fill} stroke={style.stroke ?? "#26334d"} strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM} strokeDasharray={dash} />
                      ) : node.kind === "diamond" ? (
                        <polygon points={`${x + w / 2},${y - h} ${x + w},${y - h / 2} ${x + w / 2},${y} ${x},${y - h / 2}`} fill={fill} stroke={style.stroke ?? "#26334d"} strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM} strokeDasharray={dash} />
                      ) : node.kind === "text" || node.kind === "math" ? (
                        editingTextNodeId !== node.id && renderRichText(node.text, style.textStyle, style.stroke ?? "#26334d", { x, y, w, h }, true)
                      ) : node.kind === "image" ? (
                        <rect
                          x={x}
                          y={y - h}
                          width={w}
                          height={h}
                          fill="#e8edf6"
                          stroke="#62708a"
                          strokeDasharray="6 4"
                        />
                      ) : (
                        <rect
                          x={x}
                          y={y - h}
                          width={w}
                          height={h}
                          rx={node.kind === "roundrect" ? 12 : 0}
                          fill={fill}
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                          strokeDasharray={dash}
                        />
                      )}
                      {node.text && !["text", "math"].includes(node.kind) && editingTextNodeId !== node.id && (
                        renderRichText(node.text, style.textStyle, style.stroke ?? "#26334d", { x, y, w, h }, false)
                      )}
                      {hasSuggestion && (
                        <rect className="ghost-preview" x={x - 4} y={y - h - 4} width={w + 8} height={h + 8} />
                      )}
                      {tool !== "connector" && selected.length === 1 && selected.includes(node.id) && !node.locked && g.width !== undefined && g.height !== undefined && (
                        <>
                          <rect className="selection-box" x={x - 5} y={y - h - 5} width={w + 10} height={h + 10} />
                          <line className="selection-box" x1={x + w / 2} y1={y - h - 5} x2={x + w / 2} y2={y - h - 26} />
                          {[[x, y - h], [x + w / 2, y - h], [x + w, y - h], [x + w, y - h / 2], [x + w, y], [x + w / 2, y], [x, y], [x, y - h / 2]].map(([hx, hy], index) => (
                            <rect key={index} aria-label={`Resize handle ${index + 1}`} className="resize-handle" style={{ cursor: ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"][index] }} x={hx - 5} y={hy - 5} width="10" height="10" onPointerDown={(event) => beginDrag(event, { id: node.id, mode: "resize", width: g.width, height: g.height, originX: g.x, originY: g.y, handle: index, rotation: node.transform.rotate })} />
                          ))}
                          <circle aria-label="Rotate handle" className="rotate-handle" cx={x + w / 2} cy={y - h - 26} r="6" onPointerDown={(event) => beginDrag(event, { id: node.id, mode: "rotate", rotation: node.transform.rotate, center: { x: x + w / 2 + node.transform.translate.x * PX_PER_CM, y: y - h / 2 - node.transform.translate.y * PX_PER_CM } })} />
                        </>
                      )}
                      {tool !== "connector" && selected.includes(node.id) && !node.locked && (
                        <>
                          {node.bindings?.routing === "curved" && rawPoints.length === 3 && (
                            <line
                              className="tangent-guide"
                              x1={rawPoints[0].x * PX_PER_CM}
                              y1={canvasSize.height - rawPoints[0].y * PX_PER_CM}
                              x2={rawPoints[1].x * PX_PER_CM}
                              y2={canvasSize.height - rawPoints[1].y * PX_PER_CM}
                            />
                          )}
                          {node.bindings?.routing === "curved" && rawPoints.length === 4 && (
                            <>
                              <line
                                className="tangent-guide"
                                x1={rawPoints[0].x * PX_PER_CM}
                                y1={canvasSize.height - rawPoints[0].y * PX_PER_CM}
                                x2={rawPoints[1].x * PX_PER_CM}
                                y2={canvasSize.height - rawPoints[1].y * PX_PER_CM}
                              />
                              <line
                                className="tangent-guide"
                                x1={rawPoints[3].x * PX_PER_CM}
                                y1={canvasSize.height - rawPoints[3].y * PX_PER_CM}
                                x2={rawPoints[2].x * PX_PER_CM}
                                y2={canvasSize.height - rawPoints[2].y * PX_PER_CM}
                              />
                            </>
                          )}
                          {rawPoints.map((point, index) => {
                            const isCurveControl = node.bindings?.routing === "curved" && (rawPoints.length === 3 ? index === 1 : (rawPoints.length === 4 && (index === 1 || index === 2)));
                            return (
                              <circle
                                key={index}
                                aria-label={`Point handle ${index + 1}`}
                                className={`point-handle ${isCurveControl ? "curve-handle" : ""}`}
                                cx={point.x * PX_PER_CM}
                                cy={canvasSize.height - point.y * PX_PER_CM}
                                r={isCurveControl ? 5 : 6}
                                onPointerDown={(event) =>
                                  beginDrag(event, {
                                    id: node.id,
                                    mode: "point",
                                    points: rawPoints,
                                    pointIndex: index,
                                  })
                                }
                              />
                            );
                          })}
                          {node.bindings?.routing === "elbow" && rawPoints.length === 2 && (() => {
                            const midPoint = {
                              x: (rawPoints[0].x + rawPoints[1].x) / 2,
                              y: rawPoints[0].y,
                            };
                            const midCanvasX = midPoint.x * PX_PER_CM;
                            const midCanvasY = canvasSize.height - midPoint.y * PX_PER_CM;
                            return (
                              <rect
                                aria-label="Elbow adjust handle"
                                className="elbow-handle"
                                x={midCanvasX - 5}
                                y={midCanvasY - 5}
                                width="10"
                                height="10"
                                transform={`rotate(45 ${midCanvasX} ${midCanvasY})`}
                                onPointerDown={(event) => {
                                  const newPoints = [rawPoints[0], midPoint, rawPoints[1]];
                                  beginDrag(event, {
                                    id: node.id,
                                    mode: "point",
                                    points: newPoints,
                                    pointIndex: 1,
                                  });
                                }}
                              >
                                <title>Drag to adjust elbow step position</title>
                              </rect>
                            );
                          })()}
                          {node.bindings?.routing === "curved" && rawPoints.length === 2 && (() => {
                            const midPoint = {
                              x: (rawPoints[0].x + rawPoints[1].x) / 2,
                              y: (rawPoints[0].y + rawPoints[1].y) / 2,
                            };
                            const midCanvasX = midPoint.x * PX_PER_CM;
                            const midCanvasY = canvasSize.height - midPoint.y * PX_PER_CM;
                            return (
                              <rect
                                aria-label="Curve bend handle"
                                className="curve-handle"
                                x={midCanvasX - 5}
                                y={midCanvasY - 5}
                                width="10"
                                height="10"
                                transform={`rotate(45 ${midCanvasX} ${midCanvasY})`}
                                onPointerDown={(event) => {
                                  const newPoints = [rawPoints[0], midPoint, rawPoints[1]];
                                  beginDrag(event, {
                                    id: node.id,
                                    mode: "point",
                                    points: newPoints,
                                    pointIndex: 1,
                                  });
                                }}
                              >
                                <title>Drag to bend curve</title>
                              </rect>
                            );
                          })()}
                        </>
                      )}
                    </g>
                  );
                })}
              {groupBounds && selected.length > 1 && tool !== "connector" && (() => {
                const gx = groupBounds.minX * PX_PER_CM;
                const gy = canvasSize.height - groupBounds.maxY * PX_PER_CM;
                const gw = groupBounds.width * PX_PER_CM;
                const gh = groupBounds.height * PX_PER_CM;
                return (
                  <g className="multi-selection-group">
                    <rect className="selection-box" x={gx - 4} y={gy - 4} width={gw + 8} height={gh + 8} />
                    <line className="selection-box" x1={gx + gw / 2} y1={gy - 4} x2={gx + gw / 2} y2={gy - 24} />
                    <circle
                      aria-label="Rotate selection group"
                      className="rotate-handle"
                      cx={gx + gw / 2}
                      cy={gy - 24}
                      r="6"
                      onPointerDown={(event) =>
                        beginDrag(event, {
                          id: "multi-selection",
                          mode: "rotate",
                          rotation: 0,
                          center: { x: gx + gw / 2, y: gy + gh / 2 },
                        })
                      }
                    />
                    {[
                      [gx, gy],
                      [gx + gw / 2, gy],
                      [gx + gw, gy],
                      [gx + gw, gy + gh / 2],
                      [gx + gw, gy + gh],
                      [gx + gw / 2, gy + gh],
                      [gx, gy + gh],
                      [gx, gy + gh / 2],
                    ].map(([hx, hy], index) => (
                      <rect
                        key={index}
                        aria-label={`Group resize handle ${index + 1}`}
                        className="resize-handle"
                        style={{
                          cursor: [
                            "nwse-resize",
                            "ns-resize",
                            "nesw-resize",
                            "ew-resize",
                            "nwse-resize",
                            "ns-resize",
                            "nesw-resize",
                            "ew-resize",
                          ][index],
                        }}
                        x={hx - 5}
                        y={hy - 5}
                        width="10"
                        height="10"
                        onPointerDown={(event) =>
                          beginDrag(event, {
                            id: "multi-selection",
                            mode: "resize",
                            width: groupBounds.width,
                            height: groupBounds.height,
                            originX: groupBounds.minX,
                            originY: groupBounds.minY,
                            handle: index,
                          })
                        }
                      />
                    ))}
                  </g>
                );
              })()}
              {draftPoints.length > 0 && (
                <g className="draft-path-preview">
                  <polyline
                    points={draftPoints.map((p) => `${p.x * PX_PER_CM},${canvasSize.height - p.y * PX_PER_CM}`).join(" ")}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                  {draftPoints.map((p, idx) => (
                    <circle key={idx} cx={p.x * PX_PER_CM} cy={canvasSize.height - p.y * PX_PER_CM} r="4" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
                  ))}
                </g>
              )}
              {(tool === "connector" || dragPreview?.mode === "point" || dragPreview?.mode === "connect") &&
                nodes
                  .filter((n) => n.visible && !n.locked && !["line", "path", "connector", "raw"].includes(n.kind) && n.geometry?.width !== undefined)
                  .map((n) => (
                    <g key={`anchors-${n.id}`}>
                      {anchors.map((anchor) => {
                        const ap = connectorAnchorPoint(n, anchor);
                        if (!ap) return null;
                        const isSnap = dragPreview?.snappedAnchor?.node.id === n.id && dragPreview.snappedAnchor.binding.anchor === anchor;
                        return (
                          <circle
                            key={anchor}
                            className={isSnap ? "connection-site-snap" : "connection-site"}
                            cx={ap.x * PX_PER_CM}
                            cy={canvasSize.height - ap.y * PX_PER_CM}
                            r={isSnap ? 8 : 4.5}
                            pointerEvents="none"
                          />
                        );
                      })}
                    </g>
                  ))}

              {smartGuides.map((guide, idx) => (
                guide.orientation === "v" ? (
                  <line key={idx} className="smart-guide" x1={guide.coord} y1={guide.start} x2={guide.coord} y2={guide.end} />
                ) : (
                  <line key={idx} className="smart-guide" x1={guide.start} y1={guide.coord} x2={guide.end} y2={guide.coord} />
                )
              ))}
              {dragPreview?.mode === "marquee" && dragPreview.marquee && (
                <rect
                  className="marquee-box"
                  x={Math.min(dragPreview.marquee.start.x, dragPreview.marquee.current.x)}
                  y={Math.min(dragPreview.marquee.start.y, dragPreview.marquee.current.y)}
                  width={Math.abs(dragPreview.marquee.current.x - dragPreview.marquee.start.x)}
                  height={Math.abs(dragPreview.marquee.current.y - dragPreview.marquee.start.y)}
                />
              )}
              {dragPreview?.mode === "connect" && dragPreview.geometry?.points && (
                <polyline className="connector-preview" points={dragPreview.geometry.points.map((point) => `${point.x * PX_PER_CM},${canvasSize.height - point.y * PX_PER_CM}`).join(" ")} fill="none" />
              )}
            </svg>
            {editingTextNodeId && (() => {
              const targetNode = find(doc.nodes, editingTextNodeId);
              if (!targetNode?.geometry) return null;
              const g = targetNode.geometry;
              const isStandalone = ["text", "math"].includes(targetNode.kind);
              const ts = targetNode.style?.textStyle;
              const fontSize = ts?.fontSize ?? (isStandalone ? 14 : 12);

              const left = isStandalone
                ? (g.x ?? 0) * PX_PER_CM
                : (g.x ?? 0) * PX_PER_CM;
              const top = isStandalone
                ? canvasSize.height - (g.y ?? 0) * PX_PER_CM - fontSize - 4
                : canvasSize.height - ((g.y ?? 0) + (g.height ?? 2.2)) * PX_PER_CM;
              const width = isStandalone
                ? Math.max(160, (g.width ?? 3) * PX_PER_CM)
                : (g.width ?? 3.5) * PX_PER_CM;
              const height = isStandalone
                ? Math.max(40, (g.height ?? 1) * PX_PER_CM)
                : (g.height ?? 2.2) * PX_PER_CM;

              const fontFamily = ts?.fontFamily === "mono"
                ? "ui-monospace, monospace"
                : ts?.fontFamily === "serif"
                  ? "Georgia, 'Times New Roman', serif"
                  : "Inter, system-ui, sans-serif";

              return (
                <div
                  className="canvas-text-editor"
                  style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                    display: "flex",
                    alignItems: ts?.valign === "top" ? "flex-start" : ts?.valign === "bottom" ? "flex-end" : "center",
                    justifyContent: ts?.align === "left" ? "flex-start" : ts?.align === "right" ? "flex-end" : "center",
                    boxSizing: "border-box",
                  }}
                >
                  <textarea
                    autoFocus
                    defaultValue={targetNode.text ?? ""}
                    placeholder="Type text (Enter for newline)..."
                    style={{
                      width: "100%",
                      height: "100%",
                      background: isStandalone ? "rgba(255, 255, 255, 0.95)" : "transparent",
                      color: targetNode.style?.stroke ?? "#1e293b",
                      textAlign: ts?.align ?? (isStandalone ? "left" : "center"),
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight: ts?.bold ? "bold" : "normal",
                      fontStyle: ts?.italic ? "italic" : "normal",
                      textDecoration: ts?.strike ? "line-through" : "none",
                      lineHeight: "1.25",
                      border: "1.5px dashed #3b82f6",
                      borderRadius: "4px",
                      padding: "4px 6px",
                      resize: "none",
                      outline: "none",
                      boxShadow: isStandalone ? "0 2px 8px rgba(0,0,0,0.15)" : "none",
                      boxSizing: "border-box",
                    }}
                    onBlur={(e) => {
                      setEditingTextNodeId(null);
                      if (e.target.value !== (targetNode.text ?? ""))
                        update({ type: "update_properties", id: targetNode.id, text: e.target.value }, "Edit text");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingTextNodeId(null);
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (e.target as HTMLTextAreaElement).blur();
                    }}
                  />
                </div>
              );
            })()}

          </div>
          <footer className="statusbar">
            <span>{notice}</span>
            <span>
              {selected.length ? `${selected.length} selected` : "No selection"}
            </span>
          </footer>
        </section>
        <aside className="inspector" aria-label="Inspector">
          <h2>Inspector</h2>
          {active ? (
            <>
              <label>
                Name
                <input
                  aria-label="Layer name"
                  value={active.name ?? ""}
                  onChange={(event) =>
                    update(
                      {
                        type: "set_metadata",
                        id: active.id,
                        name: event.target.value,
                      },
                      "Rename layer",
                    )
                  }
                />
              </label>
              <div className="field-grid">
                <label>
                  X
                  <input
                    aria-label="X position"
                    type="number"
                    value={active.geometry?.x ?? 0}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        geometry: { x: Number(event.target.value) },
                      })
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    aria-label="Y position"
                    type="number"
                    value={active.geometry?.y ?? 0}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        geometry: { y: Number(event.target.value) },
                      })
                    }
                  />
                </label>
                <label>
                  W
                  <input
                    aria-label="Width"
                    type="number"
                    value={active.geometry?.width ?? 0}
                    onChange={(event) =>
                      update(
                        {
                          type: "update_properties",
                          id: active.id,
                          geometry: { width: Number(event.target.value) },
                        },
                        "Resize selection",
                      )
                    }
                  />
                </label>
                <label>
                  H
                  <input
                    aria-label="Height"
                    type="number"
                    value={active.geometry?.height ?? 0}
                    onChange={(event) =>
                      update(
                        {
                          type: "update_properties",
                          id: active.id,
                          geometry: { height: Number(event.target.value) },
                        },
                        "Resize selection",
                      )
                    }
                  />
                </label>
                <label>
                  Rotation
                  <input
                    aria-label="Rotation"
                    type="number"
                    value={active.transform.rotate}
                    onChange={(event) =>
                      update({
                        type: "transform",
                        id: active.id,
                        transform: { rotate: Number(event.target.value) },
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Fill type
                <select aria-label="Fill type" value={active.style?.gradient ? "gradient" : active.style?.fill === "none" ? "none" : "solid"} onChange={(event) => update({ type: "update_properties", id: active.id, style: event.target.value === "gradient" ? { fill: undefined, gradient: active.style?.gradient ?? { start: active.style?.fill ?? "#90baff", end: "#ffffff", angle: 0 } } : event.target.value === "none" ? { fill: "none", gradient: undefined } : { fill: active.style?.fill === "none" ? "#90baff" : active.style?.fill ?? "#90baff", gradient: undefined } })}>
                  <option value="solid">Solid</option><option value="gradient">Gradient</option><option value="none">No fill</option>
                </select>
              </label>
              <label>
                Fill
                <div className="color-input-wrap">
                  <input
                    type="color"
                    className="color-picker-input"
                    aria-label="Fill color picker"
                    disabled={Boolean(active.style?.gradient) || active.style?.fill === "none"}
                    value={active.style?.fill && /^#[\da-f]{6}$/i.test(active.style.fill) ? active.style.fill : "#3b82f6"}
                    onChange={(event) => update({ type: "update_properties", id: active.id, style: { fill: event.target.value } })}
                  />
                  <input
                    aria-label="Fill color"
                    disabled={Boolean(active.style?.gradient) || active.style?.fill === "none"}
                    value={active.style?.fill ?? ""}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        style: { fill: event.target.value },
                      })
                    }
                  />
                </div>
                {!active.style?.gradient && active.style?.fill !== "none" && (
                  <div className="color-swatches" aria-label="Fill palette swatches">
                    {paletteColors.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`color-swatch ${active.style?.fill === hex ? "active" : ""}`}
                        style={{ backgroundColor: hex }}
                        title={`Set fill ${hex}`}
                        onClick={() => update({ type: "update_properties", id: active.id, style: { fill: hex } })}
                      />
                    ))}
                  </div>
                )}
              </label>
              {active.style?.gradient && <div className="field-grid">
                <label>Gradient start<input aria-label="Gradient start" value={active.style.gradient.start} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, start: event.target.value } } })} /></label>
                <label>Gradient end<input aria-label="Gradient end" value={active.style.gradient.end} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, end: event.target.value } } })} /></label>
                <label>Angle<input aria-label="Gradient angle" type="number" value={active.style.gradient.angle} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, angle: Number(event.target.value) } } })} /></label>
              </div>}
              <label>
                Stroke
                <div className="color-input-wrap">
                  <input
                    type="color"
                    className="color-picker-input"
                    aria-label="Stroke color picker"
                    value={active.style?.stroke && /^#[\da-f]{6}$/i.test(active.style.stroke) ? active.style.stroke : "#26334d"}
                    onChange={(event) => update({ type: "update_properties", id: active.id, style: { stroke: event.target.value } })}
                  />
                  <input
                    aria-label="Stroke color"
                    value={active.style?.stroke ?? ""}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        style: { stroke: event.target.value },
                      })
                    }
                  />
                </div>
                <div className="color-swatches" aria-label="Stroke palette swatches">
                  {paletteColors.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={`color-swatch ${active.style?.stroke === hex ? "active" : ""}`}
                      style={{ backgroundColor: hex }}
                      title={`Set stroke ${hex}`}
                      onClick={() => update({ type: "update_properties", id: active.id, style: { stroke: hex } })}
                    />
                  ))}
                </div>
              </label>

              <label>
                Text
                <textarea
                  aria-label="Text content"
                  rows={3}
                  placeholder="Enter text (Shift+Enter for newline)..."
                  value={active.text ?? ""}
                  onChange={(event) => update({ type: "update_properties", id: active.id, text: event.target.value }, "Edit text")}
                />
              </label>
              <div className="field-grid" style={{ marginTop: 2 }}>
                <label>
                  Font
                  <select
                    aria-label="Font family"
                    value={active.style?.textStyle?.fontFamily ?? "sans"}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          ...active.style,
                          textStyle: {
                            ...active.style?.textStyle,
                            fontFamily: event.target.value as SceneTextStyle["fontFamily"],
                          },
                        },
                      }, "Change font")
                    }
                  >
                    <option value="sans">Sans (Modern)</option>
                    <option value="serif">Serif (LaTeX)</option>
                    <option value="mono">Mono (Code)</option>
                  </select>
                </label>
                <label>
                  Size (pt)
                  <input
                    aria-label="Font size"
                    type="number"
                    min="6"
                    max="96"
                    value={active.style?.textStyle?.fontSize ?? (["text", "math"].includes(active.kind) ? 14 : 12)}
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          ...active.style,
                          textStyle: {
                            ...active.style?.textStyle,
                            fontSize: Math.max(6, Number(event.target.value)),
                          },
                        },
                      }, "Change font size")
                    }
                  />
                </label>
              </div>
              <div className="format-bar" aria-label="Text formatting">
                <button
                  type="button"
                  aria-label="Bold text"
                  className={active.style?.textStyle?.bold ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          bold: !active.style?.textStyle?.bold,
                        },
                      },
                    }, "Toggle bold")
                  }
                  title="Toggle Bold (B)"
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  aria-label="Italic text"
                  className={active.style?.textStyle?.italic ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          italic: !active.style?.textStyle?.italic,
                        },
                      },
                    }, "Toggle italic")
                  }
                  title="Toggle Italic (I)"
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  aria-label="Strikethrough text"
                  className={active.style?.textStyle?.strike ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          strike: !active.style?.textStyle?.strike,
                        },
                      },
                    }, "Toggle strikethrough")
                  }
                  title="Toggle Strikethrough (S)"
                >
                  <s>S</s>
                </button>
                <button
                  type="button"
                  aria-label="Toggle math mode"
                  className={active.text?.startsWith("$") && active.text.endsWith("$") ? "active" : ""}
                  onClick={() => {
                    const current = active.text ?? "";
                    const next = current.startsWith("$") && current.endsWith("$") ? current.slice(1, -1) : `$${current}$`;
                    update({ type: "update_properties", id: active.id, text: next }, "Toggle math mode");
                  }}
                  title="Toggle LaTeX Math Mode ($...$)"
                >
                  ∑
                </button>
                <div style={{ width: 1, height: 16, background: "#384155", margin: "0 2px" }} />
                <button
                  type="button"
                  aria-label="Text align left"
                  className={active.style?.textStyle?.align === "left" ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "left",
                        },
                      },
                    }, "Align text left")
                  }
                  title="Align Left"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                </button>
                <button
                  type="button"
                  aria-label="Text align center"
                  className={(!active.style?.textStyle?.align || active.style?.textStyle?.align === "center") ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "center",
                        },
                      },
                    }, "Align text center")
                  }
                  title="Align Center"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
                </button>
                <button
                  type="button"
                  aria-label="Text align right"
                  className={active.style?.textStyle?.align === "right" ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "right",
                        },
                      },
                    }, "Align text right")
                  }
                  title="Align Right"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
                </button>
                <div style={{ width: 1, height: 16, background: "#384155", margin: "0 2px" }} />
                <button
                  type="button"
                  aria-label="Text align top"
                  className={active.style?.textStyle?.valign === "top" ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "top",
                        },
                      },
                    }, "Align text top")
                  }
                  title="Align Top"
                >
                  ⤊
                </button>
                <button
                  type="button"
                  aria-label="Text align middle"
                  className={(!active.style?.textStyle?.valign || active.style?.textStyle?.valign === "middle") ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "middle",
                        },
                      },
                    }, "Align text middle")
                  }
                  title="Align Middle"
                >
                  ⬍
                </button>
                <button
                  type="button"
                  aria-label="Text align bottom"
                  className={active.style?.textStyle?.valign === "bottom" ? "active" : ""}
                  onClick={() =>
                    update({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "bottom",
                        },
                      },
                    }, "Align text bottom")
                  }
                  title="Align Bottom"
                >
                  ⤋
                </button>
              </div>

              <div className="section-actions" style={{ marginBottom: "10px", marginTop: "10px" }}>
                <button onClick={() => { setCopiedStyle(active.style ? { ...active.style } : {}); setNotice("Copied style to format painter"); }} title="Copy style (Format Painter)">Copy Style</button>
                <button disabled={!copiedStyle} onClick={() => { if (copiedStyle && active) update({ type: "update_properties", id: active.id, style: { ...copiedStyle } }, "Paste style"); }} title="Paste copied style">Paste Style</button>
              </div>

              <div className="field-grid">
                <label>
                  Stroke width
                  <input aria-label="Stroke width" type="number" min="0" step="0.01" value={active.style?.strokeWidth ?? 0} onChange={(event) => update({ type: "update_properties", id: active.id, style: { strokeWidth: Math.max(0, Number(event.target.value)) } })} />
                </label>
                <label>
                  Line pattern
                  <select
                    aria-label="Line pattern"
                    value={
                      active.style?.dash === "on 4pt off 3pt" || active.style?.dash === "dashed"
                        ? "dashed"
                        : active.style?.dash === "on 0pt off 2pt" || active.style?.dash === "dotted"
                          ? "dotted"
                          : "solid"
                    }
                    onChange={(event) =>
                      update({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          dash:
                            event.target.value === "solid"
                              ? ""
                              : event.target.value === "dashed"
                                ? "on 4pt off 3pt"
                                : "on 0pt off 2pt",
                        },
                      })
                    }
                  >
                    <option value="solid">Solid (—)</option>
                    <option value="dashed">Dashed (---)</option>
                    <option value="dotted">Dotted (···)</option>
                  </select>
                </label>
              </div>
              <div className="field-grid">
                <label>
                  Opacity
                  <input aria-label="Opacity" type="number" min="0" max="1" step="0.05" value={active.style?.opacity ?? 1} onChange={(event) => update({ type: "update_properties", id: active.id, style: { opacity: Math.min(1, Math.max(0, Number(event.target.value))) } })} />
                </label>
              </div>

              {["line", "path", "connector"].includes(active.kind) && (
                <>
                <div className="field-grid">
                  <label>
                    Arrow ends
                    <select
                      aria-label="Line ends"
                      value={
                        active.style?.arrow === "<-"
                          ? "start"
                          : active.style?.arrow === "<->"
                            ? "both"
                            : active.style?.arrow === "->" || (active.kind === "connector" && active.style?.arrow === undefined)
                              ? "end"
                              : "none"
                      }
                      onChange={(event) =>
                        update({
                          type: "update_properties",
                          id: active.id,
                          style: {
                            arrow:
                              event.target.value === "start"
                                ? "<-"
                                : event.target.value === "both"
                                  ? "<->"
                                  : event.target.value === "end"
                                    ? "->"
                                    : "",
                          },
                        })
                      }
                    >
                      <option value="none">None (—)</option>
                      <option value="end">End Arrow (→)</option>
                      <option value="start">Start Arrow (←)</option>
                      <option value="both">Both Ends (↔)</option>
                    </select>
                  </label>
                  <label>
                    Routing
                    <select
                      aria-label="Connector route"
                      value={active.bindings?.routing ?? "straight"}
                      onChange={(event) =>
                        update(
                          {
                            type: "update_properties",
                            id: active.id,
                            bindings: {
                              ...active.bindings,
                              routing: event.target.value as "straight" | "elbow" | "curved",
                            },
                          },
                          "Change connector route",
                        )
                      }
                    >
                      <option value="straight">Straight (—)</option>
                      <option value="elbow">Elbow (↳)</option>
                      <option value="curved">Curved (∿)</option>
                    </select>
                  </label>
                </div>
                <div className="section-actions" style={{ marginTop: 4 }}>
                  <button
                    aria-label="Add waypoint"
                    title="Add waypoint / vertex to line or connector"
                    onClick={() => {
                      const pts = active.geometry?.points ?? [{ x: 1, y: 1 }, { x: 4, y: 3 }];
                      if (pts.length >= 2) {
                        const mid = {
                          x: editorNumber((pts[0].x + pts[1].x) / 2),
                          y: editorNumber((pts[0].y + pts[1].y) / 2),
                        };
                        const newPoints = [pts[0], mid, ...pts.slice(1)];
                        update(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: newPoints },
                          },
                          "Add waypoint to line",
                        );
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14"/></svg>
                    Add Waypoint
                  </button>
                  {active.geometry?.points && active.geometry.points.length > 2 && (
                    <button
                      aria-label="Remove waypoint"
                      title="Remove last intermediate waypoint"
                      onClick={() => {
                        const pts = active.geometry!.points!;
                        const newPoints = [pts[0], ...pts.slice(2)];
                        update(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: newPoints },
                          },
                          "Remove waypoint",
                        );
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14"/></svg>
                      Remove Waypoint
                    </button>
                  )}
                  <button
                    aria-label="Reverse direction"
                    title="Reverse start and end endpoints"
                    onClick={() => {
                      const pts = active.geometry?.points;
                      if (pts && pts.length >= 2) {
                        const rev = [...pts].reverse();
                        const bindings = active.bindings ? {
                          ...active.bindings,
                          start: active.bindings.end,
                          end: active.bindings.start,
                        } : undefined;
                        update(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: rev },
                            ...(bindings ? { bindings } : {}),
                          },
                          "Reverse line direction",
                        );
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                    Reverse
                  </button>
                </div>
              </>
              )}
              <div className="section-actions">
                <button onClick={() => alignToCanvas("h")} title="Center horizontally on canvas">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="2" x2="12" y2="22"/><rect x="4" y="7" width="16" height="10" rx="2"/></svg>
                  Center Canvas H
                </button>
                <button onClick={() => alignToCanvas("v")} title="Center vertically on canvas">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="2" y1="12" x2="22" y2="12"/><rect x="7" y="4" width="10" height="16" rx="2"/></svg>
                  Center Canvas V
                </button>
                {selected.length > 1 && (
                  <>
                    <button onClick={() => matchSize("width")} title="Match width of active shape">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/></svg>
                      Match Width
                    </button>
                    <button onClick={() => matchSize("height")} title="Match height of active shape">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/></svg>
                      Match Height
                    </button>
                  </>
                )}
              </div>
              <div className="arrange">
                <button
                  aria-label={
                    active.locked
                      ? "Unlock selected layer"
                      : "Lock selected layer"
                  }
                  onClick={() =>
                    update({
                      type: "set_metadata",
                      id: active.id,
                      locked: !active.locked,
                    })
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d={active.locked ? "M7 11V7a5 5 0 0 1 10 0v4" : "M7 11V7a5 5 0 0 1 9.9-1"}/></svg>
                  {active.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  aria-label={
                    active.visible
                      ? "Hide selected layer"
                      : "Show selected layer"
                  }
                  onClick={() =>
                    update({
                      type: "set_metadata",
                      id: active.id,
                      visible: !active.visible,
                    })
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {active.visible ? "Hide" : "Show"}
                </button>
                <button
                  aria-label="Bring forward"
                  onClick={() => { const list = siblingsFor(doc.nodes, active.id); const index = list?.findIndex((node) => node.id === active.id) ?? 0; update({ type: "reorder", id: active.id, index: index + 1 }, "Bring forward"); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="18 15 12 9 6 15"/></svg>
                  Forward
                </button>
                <button aria-label="Send backward" onClick={() => { const list = siblingsFor(doc.nodes, active.id); const index = list?.findIndex((node) => node.id === active.id) ?? 0; update({ type: "reorder", id: active.id, index: Math.max(0, index - 1) }, "Send backward"); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="6 9 12 15 18 9"/></svg>
                  Backward
                </button>
                <button aria-label="Bring to front" onClick={() => update({ type: "reorder", id: active.id, index: 999 }, "Bring to front")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
                  To front
                </button>
                <button aria-label="Send to back" onClick={() => update({ type: "reorder", id: active.id, index: 0 }, "Send to back")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
                  To back
                </button>
                <button aria-label="Duplicate selected layer" onClick={duplicate}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Duplicate
                </button>
                <button aria-label="Flip horizontal" disabled={active.kind === "group"} onClick={() => update({ type: "transform", id: active.id, transform: { xScale: -active.transform.xScale } }, "Flip horizontal")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="8 4 4 8 8 12"/><line x1="4" y1="8" x2="20" y2="8"/><polyline points="16 20 20 16 16 12"/><line x1="20" y1="16" x2="4" y2="16"/></svg>
                  Flip H
                </button>
                <button aria-label="Flip vertical" disabled={active.kind === "group"} onClick={() => update({ type: "transform", id: active.id, transform: { yScale: -active.transform.yScale } }, "Flip vertical")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="4 8 8 4 12 8"/><line x1="8" y1="4" x2="8" y2="20"/><polyline points="20 16 16 20 12 16"/><line x1="16" y1="20" x2="16" y2="4"/></svg>
                  Flip V
                </button>
                <button
                  aria-label="Ungroup selected layer"
                  disabled={active.kind !== "group"}
                  onClick={() =>
                    update(
                      { type: "ungroup", id: active.id },
                      "Ungroup selection",
                    )
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="10" x2="14" y2="14"/></svg>
                  Ungroup
                </button>
                <button
                  onClick={() =>
                    transact("Delete selection", [
                      { type: "delete", id: active.id },
                    ])
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="canvas-inspector">
              <h3 style={{ fontSize: "12px", color: "#8a99b5", marginBottom: "8px" }}>Canvas Properties</h3>
              <label>
                Preset
                <select
                  value={`${canvasSize.width}x${canvasSize.height}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split("x").map(Number);
                    if (w && h) setCanvasSize({ width: w, height: h });
                  }}
                >
                  {canvasPresets.map((p) => (
                    <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label>
                  Width (px)
                  <input
                    type="number"
                    min="300"
                    max="3000"
                    step="20"
                    value={canvasSize.width}
                    onChange={(e) => setCanvasSize((s) => ({ ...s, width: Math.max(200, Number(e.target.value)) }))}
                  />
                </label>
                <label>
                  Height (px)
                  <input
                    type="number"
                    min="200"
                    max="3000"
                    step="20"
                    value={canvasSize.height}
                    onChange={(e) => setCanvasSize((s) => ({ ...s, height: Math.max(150, Number(e.target.value)) }))}
                  />
                </label>
                <label>
                  Width (cm)
                  <input
                    type="number"
                    step="0.5"
                    value={Number((canvasSize.width / PX_PER_CM).toFixed(1))}
                    onChange={(e) => setCanvasSize((s) => ({ ...s, width: Math.round(Number(e.target.value) * PX_PER_CM) }))}
                  />
                </label>
                <label>
                  Height (cm)
                  <input
                    type="number"
                    step="0.5"
                    value={Number((canvasSize.height / PX_PER_CM).toFixed(1))}
                    onChange={(e) => setCanvasSize((s) => ({ ...s, height: Math.round(Number(e.target.value) * PX_PER_CM) }))}
                  />
                </label>
              </div>
              <div className="button-group" style={{ marginTop: "12px" }}>
                <button onClick={() => alignToCanvas("h")}>Center Horizontally</button>
                <button onClick={() => alignToCanvas("v")}>Center Vertically</button>
                <button onClick={() => setSelected(nodes.map((n) => n.id))}>Select All (⌘A)</button>
              </div>
            </div>
          )}
        </aside>
      </div>
      <section
        className="bottom-panel"
        aria-label="Source, history, and assistant"
      >
        <div className="bottom-tabs">
          {(["source", "history", "assistant"] as Tab[]).map((name) => (
            <button
              key={name}
              disabled={!desktop && name !== "source"}
              title={!desktop && name !== "source" ? `${name} is available on desktop` : undefined}
              className={tab === name ? "active" : ""}
              onClick={() => {
                setTab(name);
                if (name === "history" && project)
                  void listHistory(project.handle).then(setCommits);
              }}
            >
              {name === "source"
                ? "Source"
                : name === "history"
                  ? `History · ${commits.length}`
                  : "Assistant"}
            </button>
          ))}
        </div>
        {tab === "source" ? (
          <SourceTab
            doc={doc}
            onApplySource={(newDoc) => {
              flushCheckpoint();
              setHistory(createHistory(newDoc));
              persist(newDoc);
              setSelected([]);
            }}
            onCopyTikz={copyTikz}
            onNotice={setNotice}
          />
        ) : tab === "history" ? (
          <div className="history-list">
            {commits.map((commit) => (
              <div key={commit.id} className="history-item">
                <span>{commit.message}</span>
                <button
                  onClick={() =>
                    project &&
                    void restoreCommit(project.handle, commit.id).then(
                      (restored) => {
                        if (!restored) return;
                        const parsed = parseTikz(restored.source);
                        if (!parsed.errors.length) {
                          setHistory(createHistory(parsed.document));
                          persist(parsed.document);
                          setNotice("Restored history");
                        }
                      },
                    )
                  }
                >
                  Restore
                </button>
              </div>
            ))}
            {!commits.length && <p className="empty">No saved history yet.</p>}
          </div>
        ) : (
          <AssistantTab
            doc={doc}
            selected={selected}
            suggestion={suggestion}
            setSuggestion={setSuggestion}
            onApplyOperations={(label, ops) => {
              flushCheckpoint();
              transact(label, ops);
            }}
            onNotice={setNotice}
          />
        )}
      </section>
    </main>
  );
}
export default App;
