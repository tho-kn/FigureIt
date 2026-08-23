import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  anchors,
  applySceneTransaction,
  commitHistory,
  connectorAnchorPoint,
  createHistory,
  flattenRenderableNodes,
  nearestConnectorAnchor,
  parseTikz,
  PX_PER_CM,
  redoHistory,
  sceneToClaudeContext,
  serializeDocument,
  undoHistory,
  type SceneDocument,
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
  claudeLogin,
  claudeStatus,
  compileProject,
  createProject,
  desktopFeaturesAvailable,
  listHistory,
  openProject,
  resetClaudeConversation,
  restoreCommit,
  saveProject,
  writeAsset,
  type ClaudeStatus,
  type Commit,
} from "./services/backend";
import {
  canvasPoint,
  computeNodeBounds,
  computePathD,
  editorNumber,
  previewDrag,
  type Drag,
  type DragPreview,
  type SmartGuide,
} from "./editor/interaction";
import { EditorToolbar, KeyboardShortcutsDialog } from "./components/EditorToolbar";
import { TransformDialog, type PivotPreference, type TransformMode } from "./components/TransformDialog";
import {
  expandTransformTargets,
  flipHorizontal,
  flipVertical,
  rotateAroundPivot,
  scaleAroundPivot,
  selectionBounds,
} from "./editor/transforms";
import { detectImportKind, importFile } from "./importers";
import { InspectorPanel } from "./components/InspectorPanel";
import { LayersPanel } from "./components/LayersPanel";
import { ToolOptions } from "./components/ToolOptions";
import { DEFAULT_TOOL_SHORTCUTS, LINE_KINDS, normalizeToolShortcuts, SHAPE_KINDS, TEXT_KINDS, TOOL_LABELS, toolNames, type Tool, type ToolShortcuts } from "./components/toolDomain";
import "./App.css";

const blank = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;


const shortcutStorageKey = "figureit.tool-shortcuts";
const loadToolShortcuts = (): ToolShortcuts => {
  try {
    return normalizeToolShortcuts(JSON.parse(window.localStorage.getItem(shortcutStorageKey) ?? "null"));
  } catch {
    return { ...DEFAULT_TOOL_SHORTCUTS };
  }
};

const pivotStorageKey = "figureit.transform-pivots";
const loadPivotPreferences = (): Record<TransformMode, PivotPreference> => {
  const fallback: Record<TransformMode, PivotPreference> = { rotate: "selection", scale: "selection" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pivotStorageKey) ?? "null") as Partial<Record<TransformMode, PivotPreference>> | null;
    return {
      rotate: parsed?.rotate === "artboard" ? "artboard" : fallback.rotate,
      scale: parsed?.scale === "artboard" ? "artboard" : fallback.scale,
    };
  } catch {
    return fallback;
  }
};

type PanelId = "layers" | "inspector" | "history" | "source" | "assistant";
type DockId = "left" | "right" | "bottom";
type PanelSlot = { dock: DockId; visible: boolean; collapsed: boolean };

const defaultPanels: Record<PanelId, PanelSlot> = {
  layers: { dock: "left", visible: true, collapsed: false },
  inspector: { dock: "right", visible: true, collapsed: false },
  history: { dock: "bottom", visible: true, collapsed: false },
  source: { dock: "bottom", visible: true, collapsed: false },
  assistant: { dock: "bottom", visible: true, collapsed: false },
};

const panelTitles: Record<PanelId, string> = {
  layers: "Layers",
  inspector: "Inspector",
  history: "History",
  source: "Source",
  assistant: "Assistant",
};

const panelOrder: PanelId[] = ["layers", "inspector", "history", "source", "assistant"];

type ToolDefaults = {
  shape: { fill: string; stroke: string; strokeWidth: number };
  text: SceneTextStyle;
  line: { stroke: string; strokeWidth: number; dash: string; arrow: string };
};

const defaultToolDefaults: ToolDefaults = {
  shape: { fill: "#90baff", stroke: "black", strokeWidth: 0.05 },
  text: { fontFamily: "sans", fontSize: 14 },
  line: { stroke: "black", strokeWidth: 0.06, dash: "", arrow: "->" },
};

const identity = { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 };
const canvasPresets = [
  { label: "Standard (800 × 520)", width: 800, height: 520 },
  { label: "Slide 16:9 (960 × 540)", width: 960, height: 540 },
  { label: "IEEE Column (640 × 480)", width: 640, height: 480 },
  { label: "IEEE Double Column (900 × 500)", width: 900, height: 500 },
  { label: "Square (600 × 600)", width: 600, height: 600 },
  { label: "Wide Banner (960 × 380)", width: 960, height: 380 },
];

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

const shapeNode = (kind: Exclude<Tool, "select" | "connector">, index: number, defaults: ToolDefaults): SceneNode => {
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
  if (SHAPE_KINDS.includes(kind))
    return {
      ...base,
      geometry: { x, y, width: 3.5, height: 2.2 },
      style: {
        fill: defaults.shape.fill,
        stroke: defaults.shape.stroke,
        strokeWidth: defaults.shape.strokeWidth,
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
      style: {
        stroke: defaults.line.stroke,
        strokeWidth: defaults.line.strokeWidth,
        ...(defaults.line.dash ? { dash: defaults.line.dash } : {}),
        ...(kind === "arrow" ? { arrow: defaults.line.arrow } : {}),
      },
    };
  if (kind === "dimension")
    return {
      ...base,
      geometry: {
        points: [
          { x, y },
          { x: x + 3.5, y },
        ],
      },
      text: "3.5 cm",
      style: { stroke: defaults.line.stroke, strokeWidth: 0.03, textStyle: { fontSize: 10 } },
    };
  if (kind === "text")
    return {
      ...base,
      geometry: { x, y },
      text: "Text / α²",
      style: { stroke: "black", textStyle: { ...defaults.text } },
    };
  return { ...base, geometry: { x, y }, image: { href: "image-placeholder" } };
};

const id = z.string().min(1).max(160);
const insertNodeSchema = z.object({
  id,
  kind: z.enum(["rect", "roundrect", "ellipse", "triangle", "diamond", "line", "path", "text", "math"]),
  name: z.string().max(160).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  geometry: z.object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(2).optional(),
  }).strict(),
  style: z.object({
    fill: z.string().max(80).optional(),
    stroke: z.string().max(80).optional(),
    strokeWidth: z.number().finite().optional(),
    opacity: z.number().min(0).max(1).optional(),
  }).strict().optional(),
  text: z.string().max(10000).optional(),
}).strict().superRefine((node, ctx) => {
  const g = node.geometry;
  const shape = ["rect", "roundrect", "ellipse", "triangle", "diamond"].includes(node.kind);
  const lined = node.kind === "line" || node.kind === "path";
  const texted = node.kind === "text" || node.kind === "math";
  if (shape && (g.x === undefined || g.y === undefined || g.width === undefined || g.height === undefined))
    ctx.addIssue({ code: "custom", message: "shape nodes need x, y, width, and height" });
  if (lined && (!g.points || g.points.length < 2))
    ctx.addIssue({ code: "custom", message: "line and path nodes need at least two points" });
  if (texted && (g.x === undefined || g.y === undefined))
    ctx.addIssue({ code: "custom", message: "text nodes need x and y" });
});
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
    z.object({
      type: z.literal("insert"),
      parentId: id.optional(),
      node: insertNodeSchema,
    }).strict(),
  ]),
);

const validOperations = (value: unknown): value is SceneOperation[] =>
  operationsSchema.safeParse(value).success;

const normalizeClaudeOperations = (operations: SceneOperation[]): SceneOperation[] =>
  operations.map((operation) => {
    if (operation.type !== "insert") return operation;
    const node = operation.node;
    const isLine = node.kind === "line" || node.kind === "path";
    return {
      ...operation,
      node: {
        id: node.id,
        kind: node.kind,
        name: node.name,
        visible: node.visible ?? true,
        locked: node.locked ?? false,
        transform: identity,
        geometry: node.geometry,
        style: node.style ?? (isLine ? { stroke: "black", strokeWidth: 0.06 } : { fill: "#90baff", stroke: "black", strokeWidth: 0.05 }),
        text: node.text,
        prefix: "\n",
        source: "",
      },
    };
  });

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
  const [claudeState, setClaudeState] = useState<ClaudeStatus | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    void claudeStatus().then(setClaudeState);
  }, []);

  const refreshStatus = () => {
    setClaudeState(null);
    void claudeStatus().then(setClaudeState);
  };

  const startLogin = async () => {
    setLoggingIn(true);
    try {
      const started = await claudeLogin();
      onNotice(started
        ? "Claude login opened in your browser. Sign in, then click Re-check."
        : "Could not start Claude login — is Claude Code installed?");
    } catch {
      onNotice("Could not start Claude login");
    } finally {
      setLoggingIn(false);
    }
  };

  const assistantBlocked = claudeState !== null && claudeState.status !== "ready";

  const sendRequest = (promptText = request) => {
    if (!promptText.trim() || isConsulting || assistantBlocked) return;
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
            operations: normalizeClaudeOperations(result.operations as SceneOperation[]),
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
      {claudeState && claudeState.status !== "ready" && (
        <div className={claudeState.status === "not_logged_in" ? "assistant-status warn" : "assistant-status"}>
          {claudeState.status === "not_logged_in" ? (
            <>
              <span>Claude Code isn't logged in. Sign in to use the design assistant.</span>
              <button onClick={startLogin} disabled={loggingIn}>
                {loggingIn ? "Opening browser..." : "Log in to Claude"}
              </button>
            </>
          ) : (
            <span>Claude Code isn't installed on this machine.</span>
          )}
          <button onClick={refreshStatus}>Re-check</button>
        </div>
      )}
      <div className="assistant-main">
        <div className="assistant-chips">
          {promptChips.map((chip, i) => (
            <button
              key={i}
              className="chip"
              disabled={isConsulting || assistantBlocked}
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
            placeholder={assistantBlocked
              ? "Log in to Claude Code to use the design assistant."
              : "Ask Claude to modify, align, re-theme, or add elements..."}
            value={request}
            disabled={isConsulting || assistantBlocked}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendRequest();
            }}
          />
          <button disabled={isConsulting || assistantBlocked || !request.trim()} onClick={() => sendRequest()}>
            {isConsulting ? "Thinking..." : "Request suggestion"}
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#aeb9ce" }}>
          <input type="checkbox" checked={scopeToSelection} onChange={(e) => setScopeToSelection(e.target.checked)} />
          Scope prompt to selected elements only ({selected.length} selected)
        </label>
        <div className={claudeState?.status === "ready" ? "assistant-status-line ok" : "assistant-status-line"}>
          {claudeState === null
            ? "Checking Claude Code..."
            : claudeState.status === "ready"
              ? "● Claude Code connected"
              : "● Claude Code unavailable"}
        </div>
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
  const [project, setProject] = useState<{ handle?: string; title: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [activeBottomTab, setActiveBottomTab] = useState<PanelId>("source");
  const [panels, setPanels] = useState<Record<PanelId, PanelSlot>>(() => structuredClone(defaultPanels));
  const [toolsVisible, setToolsVisible] = useState(true);
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [dragOverDock, setDragOverDock] = useState<DockId | null>(null);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [toolShortcuts, setToolShortcuts] = useState<ToolShortcuts>(loadToolShortcuts);
  const [shapeDefaults, setShapeDefaults] = useState(defaultToolDefaults.shape);
  const [textDefaults, setTextDefaults] = useState(defaultToolDefaults.text);
  const [lineDefaults, setLineDefaults] = useState(defaultToolDefaults.line);
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
  const [pngDpi, setPngDpi] = useState(300);
  const [fitWidthCm, setFitWidthCm] = useState(8.8);
  const [transformDialog, setTransformDialog] = useState<TransformMode | null>(null);
  const [pivotPrefs, setPivotPrefs] = useState<Record<TransformMode, PivotPreference>>(loadPivotPreferences);

  const svg = useRef<SVGSVGElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const texFileInput = useRef<HTMLInputElement>(null);
  const checkpoint = useRef<number | undefined>(undefined);
  const projectHandle = useRef<string | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const nodes = useMemo(() => flattenRenderableNodes(doc), [doc]);
  const shortcutKeyToTool = useMemo(() => Object.fromEntries(
    TOOL_LABELS.flatMap(([id]) => toolShortcuts[id] ? [[toolShortcuts[id], id]] : []),
  ) as Partial<Record<string, Tool>>, [toolShortcuts]);

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

  const changeToolShortcut = (toolId: Tool, value: string) => {
    const shortcut = value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-1);
    setToolShortcuts((current) => {
      const next = { ...current };
      if (shortcut) for (const [id] of TOOL_LABELS) if (id !== toolId && next[id] === shortcut) next[id] = "";
      next[toolId] = shortcut;
      return next;
    });
  };


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
    if (project?.handle) void checkpointProject(project.handle);
  };

  const persist = (next: SceneDocument) => {
    const source = serializeDocument(next);
    setDoc(next);
    if (project?.handle) {
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
    setHistory((old) => commitHistory(old, result.document));
    persist(result.document);
    setNotice(label);
  };

  const chosenTargets = () =>
    selected
      .map((selectedId) => find(doc.nodes, selectedId))
      .filter((node): node is SceneNode => Boolean(node) && node!.kind !== "raw" && !node!.locked);

  const applyFlip = (axis: "horizontal" | "vertical") => {
    const targets = expandTransformTargets(chosenTargets());
    const bounds = selectionBounds(targets);
    if (!targets.length || !bounds) return setNotice("Selection cannot be flipped");
    const changes = targets.map((node) =>
      axis === "horizontal" ? flipHorizontal(node, bounds.centerX) : flipVertical(node, bounds.centerY),
    );
    transact(axis === "horizontal" ? "Flipped selection horizontally" : "Flipped selection vertically", changes.map((change, index) => ({ type: "update_properties" as const, id: targets[index]!.id, ...change })));
  };

  const openTransformDialog = (mode: TransformMode) => {
    if (!chosenTargets().length) return setNotice("Selection cannot be transformed");
    setTransformDialog(mode);
  };

  const applyNumericTransform = (mode: TransformMode, value: number) => {
    setTransformDialog(null);
    const targets = expandTransformTargets(chosenTargets());
    const bounds = selectionBounds(targets);
    if (!targets.length || !bounds) return setNotice("Selection cannot be transformed");
    const pivot =
      pivotPrefs[mode] === "artboard"
        ? { x: canvasSize.width / PX_PER_CM / 2, y: canvasSize.height / PX_PER_CM / 2 }
        : { x: bounds.centerX, y: bounds.centerY };
    const changes = targets.map((node) =>
      mode === "rotate" ? rotateAroundPivot(node, value, pivot) : scaleAroundPivot(node, value, pivot),
    );
    transact(mode === "rotate" ? `Rotated selection ${value}°` : `Scaled selection ${value}×`, changes.map((change, index) => ({ type: "update_properties" as const, id: targets[index]!.id, ...change })));
  };

  const importExternalFile = async (file: File) => {
    if (!detectImportKind(file.name)) return setNotice("Unsupported file type - import .tex, .pptx, or .pdf");
    if (!project?.handle) return setNotice("Create a project before importing PPTX or PDF");
    try {
      const outcome = await importFile(file, {
        targetWidthCm: canvasSize.width / PX_PER_CM,
        targetHeightCm: canvasSize.height / PX_PER_CM,
      });
      let assetWarning = false;
      for (const asset of outcome.assets) {
        try {
          await writeAsset(project.handle, asset.name, asset.bytes);
        } catch {
          assetWarning = true;
        }
      }
      transact(outcome.label, outcome.operations);
      setSelected(outcome.operations.filter((operation) => operation.type === "insert").map((operation) => operation.node.id));
      setNotice(
        outcome.warnings.length || assetWarning
          ? `${outcome.label} with warnings${assetWarning ? " (an embedded image could not be stored)" : ""}`
          : outcome.label,
      );
    } catch {
      setNotice(`Could not import ${file.name}`);
    }
  };

  const openTexFile = async (file: File) => {
    if (!/\.(tex|tikz|latex)$/i.test(file.name)) return void importExternalFile(file);
    try {
      const text = await file.text();
      const parsed = parseTikz(text);
      if (parsed.errors.length) {
        setNotice("Could not parse TikZ source from file");
        return;
      }
      await resetClaudeConversation();
      setProject({ title: file.name });
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
      { shape: shapeDefaults, text: textDefaults, line: lineDefaults },
    );
    transact(`Add ${node.name}`, [{ type: "insert", node }]);
    setSelected([node.id]);
    setTool(kind);
  };

  const undo = () => {
    const next = undoHistory(history);
    if (next === history) return;
    setHistory(next);
    persist(next.present);
    setSelected([]);
    setNotice("Undo");
  };

  const redo = () => {
    const next = redoHistory(history);
    if (next === history) return;
    setHistory(next);
    persist(next.present);
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
    const { preview } = previewDrag(value, canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height), nodes, snapEnabled && !event.ctrlKey, canvasSize.width, canvasSize.height);
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

  const exportPng = () => {
    if (!svg.current) return;
    const vb = svg.current.viewBox.baseVal;
    const width = vb.width || canvasSize.width;
    const height = vb.height || canvasSize.height;
    const scale = pngDpi / 96;
    const xml = new XMLSerializer().serializeToString(svg.current);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) return setNotice("PNG export failed");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return setNotice("PNG export failed");
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = "figure.png";
        a.click();
        URL.revokeObjectURL(pngUrl);
        setNotice(`PNG exported at ${pngDpi} dpi`);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setNotice("PNG export failed");
    };
    img.src = url;
  };

  const scaleToWidth = (targetCm: number) => {
    if (!Number.isFinite(targetCm) || targetCm <= 0) return;
    const currentCm = canvasSize.width / PX_PER_CM;
    if (currentCm <= 0) return;
    const k = targetCm / currentCm;
    const scaleNode = (node: SceneNode): SceneNode => {
      const geometry = node.geometry
        ? {
            ...node.geometry,
            x: node.geometry.x !== undefined ? node.geometry.x * k : undefined,
            y: node.geometry.y !== undefined ? node.geometry.y * k : undefined,
            width: node.geometry.width !== undefined ? node.geometry.width * k : undefined,
            height: node.geometry.height !== undefined ? node.geometry.height * k : undefined,
            points: node.geometry.points ? node.geometry.points.map((point) => ({ x: point.x * k, y: point.y * k })) : undefined,
          }
        : undefined;
      const textStyle = node.style?.textStyle
        ? { ...node.style.textStyle, fontSize: node.style.textStyle.fontSize !== undefined ? node.style.textStyle.fontSize * k : undefined }
        : undefined;
      const style = node.style ? { ...node.style, ...(textStyle ? { textStyle } : {}) } : undefined;
      return {
        ...node,
        geometry,
        style,
        transform: { ...node.transform, translate: { x: node.transform.translate.x * k, y: node.transform.translate.y * k } },
        children: node.children ? node.children.map(scaleNode) : undefined,
      };
    };
    const next: SceneDocument = { ...doc, revision: doc.revision + 1, nodes: doc.nodes.map(scaleNode) };
    setCanvasSize((s) => ({ width: Math.max(100, Math.round(targetCm * PX_PER_CM)), height: Math.max(100, Math.round(s.height * k)) }));
    setHistory((old) => commitHistory(old, next));
    persist(next);
    setNotice(`Figure scaled to ${targetCm.toFixed(1)} cm wide`);
  };

  const exportPdf = async () => {
    if (!project?.handle) return setNotice("Create a project before exporting PDF");
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
    if (!file || !project?.handle)
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
      { shape: shapeDefaults, text: textDefaults, line: lineDefaults },
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
    try {
      window.localStorage.setItem(shortcutStorageKey, JSON.stringify(toolShortcuts));
    } catch {
      // Storage can be unavailable in privacy-restricted webviews; shortcuts still work for this session.
    }
  }, [toolShortcuts]);

  useEffect(() => {
    try {
      window.localStorage.setItem(pivotStorageKey, JSON.stringify(pivotPrefs));
    } catch {
      // Storage can be unavailable; the preference still applies for this session.
    }
  }, [pivotPrefs]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setShortcutEditorOpen(true);
        setWindowMenuOpen(false);
        return;
      }
      if (shortcutEditorOpen || editingTextNodeId || editingLayerNameId) return;
      const eventTarget = event.target as HTMLElement | null;
      if (eventTarget && ["INPUT", "TEXTAREA", "SELECT"].includes(eventTarget.tagName)) return;
      const next = shortcutKeyToTool[event.key.toLowerCase()];
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && next) {
        if (next === "select" || next === "connector" || next === "path") {
          setTool(next);
          setNotice(
            next === "connector"
              ? "Drag between shape connection sites to connect"
              : next === "path"
                ? "Pen: Click to place points, double-click or Enter to finish"
                : "Select",
          );
        } else if (next === "image") {
          if (desktop) imageInput.current?.click();
        } else {
          add(next);
        }
        return;
      }
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
      } else if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "h" && selected.length) {
        event.preventDefault();
        applyFlip("horizontal");
      } else if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v" && selected.length) {
        event.preventDefault();
        applyFlip("vertical");
      } else if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "r" && selected.length) {
        event.preventDefault();
        openTransformDialog("rotate");
      } else if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s" && selected.length) {
        event.preventDefault();
        openTransformDialog("scale");
      } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveTexFile();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (desktop) void load(true);
        else texFileInput.current?.click();
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

  useEffect(() => {
    if (!windowMenuOpen) return;
    const onOutside = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.(".menu-wrap")) setWindowMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWindowMenuOpen(false);
    };
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEscape);
    };
  }, [windowMenuOpen]);

  const dockPanels = (dock: DockId) =>
    panelOrder.filter((id) => panels[id].visible && panels[id].dock === dock);
  const leftDockPanels = dockPanels("left");
  const rightDockPanels = dockPanels("right");
  const bottomDockPanels = dockPanels("bottom");
  const activeBottom = bottomDockPanels.includes(activeBottomTab) ? activeBottomTab : (bottomDockPanels[0] ?? "source");
  const workspaceColumns = `${toolsVisible ? 52 : 0}px ${leftDockPanels.length ? 240 : 0}px minmax(0, 1fr) ${rightDockPanels.length ? 280 : 0}px`;

  const applyShapeChange = (patch: { fill?: string; stroke?: string; strokeWidth?: number }) => {
    if (active && SHAPE_KINDS.includes(active.kind)) {
      update({ type: "update_properties", id: active.id, style: patch }, "Update shape style");
    } else {
      setShapeDefaults((current) => ({ ...current, ...patch }));
    }
  };

  const applyTextChange = (patch: SceneTextStyle) => {
    if (active && TEXT_KINDS.includes(active.kind)) {
      update(
        {
          type: "update_properties",
          id: active.id,
          style: { ...active.style, textStyle: { ...active.style?.textStyle, ...patch } },
        },
        "Update text style",
      );
    } else {
      setTextDefaults((current) => ({ ...current, ...patch }));
    }
  };

  const applyLineChange = (patch: { stroke?: string; strokeWidth?: number; dash?: string; arrow?: string }) => {
    if (active && LINE_KINDS.includes(active.kind)) {
      update({ type: "update_properties", id: active.id, style: { ...active.style, ...patch } }, "Update line style");
    } else {
      setLineDefaults((current) => ({ ...current, ...patch }));
    }
  };

  const applyRouting = (routing: "straight" | "elbow" | "curved") => {
    if (active?.kind === "connector")
      update({ type: "update_properties", id: active.id, bindings: { ...active.bindings, routing } }, "Change connector route");
  };

  const applyDimensionLabel = (value: string) => {
    if (active?.kind === "dimension")
      update({ type: "update_properties", id: active.id, text: value }, "Edit dimension label");
  };

  const shapeTarget = active && SHAPE_KINDS.includes(active.kind)
    ? {
        fill: active.style?.fill ?? defaultToolDefaults.shape.fill,
        stroke: active.style?.stroke ?? defaultToolDefaults.shape.stroke,
        strokeWidth: active.style?.strokeWidth ?? defaultToolDefaults.shape.strokeWidth,
      }
    : shapeDefaults;
  const textTarget = active && TEXT_KINDS.includes(active.kind) ? (active.style?.textStyle ?? {}) : textDefaults;
  const lineTarget = active && LINE_KINDS.includes(active.kind)
    ? {
        stroke: active.style?.stroke ?? defaultToolDefaults.line.stroke,
        strokeWidth: active.style?.strokeWidth ?? defaultToolDefaults.line.strokeWidth,
        dash: active.style?.dash ?? "",
        arrow: active.style?.arrow ?? defaultToolDefaults.line.arrow,
      }
    : lineDefaults;

  const movePanelToDock = (id: PanelId, dock: DockId) => {
    const sideDockOnly = id === "layers" || id === "inspector";
    if (dock === "bottom" && sideDockOnly) {
      setNotice(`${panelTitles[id]} can only dock on the left or right side`);
      setDraggingPanel(null);
      setDragOverDock(null);
      return;
    }
    setPanels((current) => ({ ...current, [id]: { ...current[id], dock } }));
    setDraggingPanel(null);
    setDragOverDock(null);
  };

  const dockDragHandlers = (dock: DockId) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverDock(dock);
    },
    onDragLeave: () => setDragOverDock((current) => (current === dock ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const moved = event.dataTransfer.getData("application/x-figureit-panel");
      if (moved && panelOrder.includes(moved as PanelId)) movePanelToDock(moved as PanelId, dock);
    },
  });

  const panelWindow = (id: PanelId, children: React.ReactNode) => {
    const slot = panels[id];
    return (
      <section key={id} className={`panel-window ${slot.collapsed ? "collapsed" : ""} ${draggingPanel === id ? "dragging" : ""}`}>
        <header
          className="panel-header"
          draggable
          title="Drag to move panel"
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-figureit-panel", id);
            event.dataTransfer.effectAllowed = "move";
            setDraggingPanel(id);
          }}
          onDragEnd={() => {
            setDraggingPanel(null);
            setDragOverDock(null);
          }}
        >
          <span className="panel-drag-handle" aria-hidden="true">⠿</span>
          <h2>{panelTitles[id]}</h2>
          <button
            aria-label={slot.collapsed ? `Expand ${panelTitles[id]} panel` : `Collapse ${panelTitles[id]} panel`}
            title={slot.collapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setPanels((current) => ({ ...current, [id]: { ...current[id], collapsed: !current[id].collapsed } }))}
          >
            {slot.collapsed ? "▸" : "▾"}
          </button>
          <button
            aria-label={`Close ${panelTitles[id]} panel`}
            title="Close panel"
            onClick={() => setPanels((current) => ({ ...current, [id]: { ...current[id], visible: false } }))}
          >
            ×
          </button>
        </header>
        {!slot.collapsed && <div className="panel-body">{children}</div>}
      </section>
    );
  };

  const restoreHistoryCommit = (commitId: string) => {
    const handle = project?.handle;
    if (!handle) return;
    void restoreCommit(handle, commitId).then((restored) => {
      if (!restored) return;
      const parsed = parseTikz(restored.source);
      if (!parsed.errors.length) {
        setHistory(createHistory(parsed.document));
        persist(parsed.document);
        setNotice("Restored history");
      }
    });
  };

  const renderHistoryPanel = () => (
    <div className="history-list">
      {commits.map((commit) => (
        <div key={commit.id} className="history-item">
          <span>{commit.message}</span>
          <button onClick={() => restoreHistoryCommit(commit.id)}>
            Restore
          </button>
        </div>
      ))}
      {!commits.length && <p className="empty">No saved history yet.</p>}
    </div>
  );

  const renderPanelBody = (id: PanelId): React.ReactNode => {
    switch (id) {
      case "layers":
        return (
          <LayersPanel
            nodes={doc.nodes}
            selected={selected}
            collapsedGroups={collapsedGroups}
            search={layerSearch}
            editingNameId={editingLayerNameId}
            onToggleCollapsed={(id) =>
              setCollapsedGroups((old) => {
                const next = new Set(old);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSearchChange={setLayerSearch}
            onSelect={(id, additive) =>
              setSelected((old) =>
                additive
                  ? old.includes(id)
                    ? old.filter((item) => item !== id)
                    : [...old, id]
                  : [id],
              )
            }
            onRename={(id, name) => update({ type: "set_metadata", id, name }, "Rename layer")}
            onEditName={setEditingLayerNameId}
            onToggleVisible={(id, solo) => {
              if (solo) soloLayer(id);
              else update({ type: "set_metadata", id, visible: !(find(doc.nodes, id)?.visible ?? true) });
            }}
            onToggleLocked={(id) =>
              update({ type: "set_metadata", id, locked: !(find(doc.nodes, id)?.locked ?? false) })
            }
            onMove={(id, delta) => {
              const list = siblingsFor(doc.nodes, id);
              const idx = list?.findIndex((n) => n.id === id) ?? 0;
              const target = Math.max(0, Math.min((list?.length ?? 1) - 1, idx + delta));
              if (target !== idx)
                update({ type: "reorder", id, index: target }, delta < 0 ? "Move layer up" : "Move layer down");
            }}
            onReorder={(draggedId, targetId) => {
              const list = siblingsFor(doc.nodes, targetId);
              const targetIdx = list?.findIndex((n) => n.id === targetId) ?? 0;
              update({ type: "reorder", id: draggedId, index: targetIdx }, "Reorder layer");
            }}
            onGroup={() => {
              transact("Group selection", [{ type: "group", childIds: selected, name: "Group" }]);
              setSelected([]);
            }}
            onAlign={align}
            onDistribute={distribute}
          />
        );
      case "inspector":
        return (
          <InspectorPanel
            active={active}
            copiedStyle={copiedStyle}
            canvasSize={canvasSize}
            selectedCount={selected.length}
            canvasPresets={canvasPresets}
            onUpdate={update}
            onDelete={() =>
              transact("Delete selection", [
                { type: "delete", id: active?.id ?? "" },
              ])
            }
            onAlignToCanvas={alignToCanvas}
            onMatchSize={matchSize}
            onDuplicate={duplicate}
            onCopyStyle={() => {
              if (!active) return;
              setCopiedStyle(active.style ? { ...active.style } : {});
              setNotice("Copied style to format painter");
            }}
            onPasteStyle={() => {
              if (copiedStyle && active)
                update({ type: "update_properties", id: active.id, style: { ...copiedStyle } }, "Paste style");
            }}
            onSetCanvasSize={setCanvasSize}
            onSelectAll={() => setSelected(nodes.map((n) => n.id))}
            onBringForward={() => {
              if (!active) return;
              const list = siblingsFor(doc.nodes, active.id);
              const index = list?.findIndex((node) => node.id === active.id) ?? 0;
              update({ type: "reorder", id: active.id, index: index + 1 }, "Bring forward");
            }}
            onSendBackward={() => {
              if (!active) return;
              const list = siblingsFor(doc.nodes, active.id);
              const index = list?.findIndex((node) => node.id === active.id) ?? 0;
              update({ type: "reorder", id: active.id, index: Math.max(0, index - 1) }, "Send backward");
            }}
            onBringToFront={() => {
              if (active) update({ type: "reorder", id: active.id, index: 999 }, "Bring to front");
            }}
            onSendToBack={() => {
              if (active) update({ type: "reorder", id: active.id, index: 0 }, "Send to back");
            }}
          />
        );
      case "source":
        return (
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
        );
      case "history":
        return renderHistoryPanel();
      case "assistant":
        return (
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
        );
    }
  };

  return (
    <main className="figureit-shell">
      <header className="topbar">
        <strong>
          Figure<span>It</span>
        </strong>
        <span className="file-name">
          {project?.title ?? "untitled-figure.tex"}
        </span>
        <div className="menu-wrap">
          <button
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={windowMenuOpen}
            onClick={() => setWindowMenuOpen((open) => !open)}
          >
            Window ▾
          </button>
          {windowMenuOpen && (
            <div className="menu-popover" role="menu" aria-label="Window">
              <button
                role="menuitemcheckbox"
                aria-checked={toolsVisible}
                onClick={() => setToolsVisible((visible) => !visible)}
              >
                {toolsVisible ? "✓ " : ""}Tools
              </button>
              {panelOrder.map((id) => (
                <button
                  key={id}
                  role="menuitemcheckbox"
                  aria-checked={panels[id].visible}
                  onClick={() =>
                    setPanels((current) => ({
                      ...current,
                      [id]: { ...current[id], visible: !current[id].visible },
                    }))
                  }
                >
                  {panels[id].visible ? "✓ " : ""}
                  {panelTitles[id]}
                </button>
              ))}
              <div className="menu-divider" />
              <button
                role="menuitem"
                disabled={!selected.length}
                onClick={() => {
                  applyFlip("horizontal");
                  setWindowMenuOpen(false);
                }}
              >
                <span>Flip horizontal</span>
                <kbd>⇧ H</kbd>
              </button>
              <button
                role="menuitem"
                disabled={!selected.length}
                onClick={() => {
                  applyFlip("vertical");
                  setWindowMenuOpen(false);
                }}
              >
                <span>Flip vertical</span>
                <kbd>⇧ V</kbd>
              </button>
              <button
                role="menuitem"
                disabled={!selected.length}
                onClick={() => {
                  openTransformDialog("rotate");
                  setWindowMenuOpen(false);
                }}
              >
                <span>Rotate…</span>
                <kbd>⇧ R</kbd>
              </button>
              <button
                role="menuitem"
                disabled={!selected.length}
                onClick={() => {
                  openTransformDialog("scale");
                  setWindowMenuOpen(false);
                }}
              >
                <span>Scale…</span>
                <kbd>⇧ S</kbd>
              </button>
              <div className="menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  setShortcutEditorOpen(true);
                  setWindowMenuOpen(false);
                }}
              >
                <span>Keyboard shortcuts…</span>
                <kbd>⌘/Ctrl ,</kbd>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setPanels(structuredClone(defaultPanels));
                  setToolsVisible(true);
                  setActiveBottomTab("source");
                  setWindowMenuOpen(false);
                }}
              >
                Reset panels
              </button>
            </div>
          )}
        </div>
        <div className="top-actions">
          <button aria-label="New project" onClick={() => load()} title="New project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            New
          </button>
          <button aria-label="Open project" disabled={!desktop} onClick={() => void load(true)} title="Open FigureIt project (Cmd+O)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Open project
          </button>
          <button aria-label="Open TeX file" onClick={() => texFileInput.current?.click()} title="Open standalone TikZ / TeX file, or import PPTX / PDF">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 14h8M8 18h6"/></svg>
            Open .tex
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
          <select
            aria-label="PNG export dpi"
            value={pngDpi}
            onChange={(e) => setPngDpi(Number(e.target.value))}
            title="PNG resolution for journals that require raster images"
            style={{ background: "#171b23", color: "#e8edf7", border: "1px solid #384155", borderRadius: "4px", padding: "4px 4px", fontSize: "11px" }}
          >
            <option value={300}>300 dpi</option>
            <option value={600}>600 dpi</option>
          </select>
          <button onClick={exportPng} title="Export as PNG at the selected resolution">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>
            Export PNG
          </button>
          <button disabled={!desktop} title={desktop ? "Export as standalone PDF" : "PDF export is available on desktop"} onClick={() => void exportPdf()} className="export">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Export PDF
          </button>
        </div>
      </header>
      {shortcutEditorOpen && (
        <KeyboardShortcutsDialog
          shortcuts={toolShortcuts}
          onChange={changeToolShortcut}
          onReset={() => setToolShortcuts({ ...DEFAULT_TOOL_SHORTCUTS })}
          onClose={() => setShortcutEditorOpen(false)}
        />
      )}
      {transformDialog && (
        <TransformDialog
          mode={transformDialog}
          pivotPreference={pivotPrefs[transformDialog]}
          onApply={(value) => applyNumericTransform(transformDialog, value)}
          onPivotPreferenceChange={(preference) => setPivotPrefs((old) => ({ ...old, [transformDialog]: preference }))}
          onClose={() => setTransformDialog(null)}
        />
      )}
      <div className="optionsbar" aria-label="Tool options">
        <ToolOptions
          tool={tool}
          active={active}
          selectedCount={selected.length}
          snapEnabled={snapEnabled}
          gridEnabled={showGrid}
          onToggleSnap={() => setSnapEnabled((enabled) => !enabled)}
          onToggleGrid={() => setShowGrid((visible) => !visible)}
          shapeTarget={shapeTarget}
          onShapeChange={applyShapeChange}
          textTarget={textTarget}
          onTextChange={applyTextChange}
          lineTarget={lineTarget}
          onLineChange={applyLineChange}
          onRouting={applyRouting}
          onDimensionLabel={applyDimensionLabel}
          onAlign={align}
          onDistribute={distribute}
        />
      </div>
      <div className="workspace" style={{ gridTemplateColumns: workspaceColumns }}>
        {toolsVisible && (
          <EditorToolbar
            tool={tool}
            shortcuts={toolShortcuts}
            desktop={desktop}
            imageInputRef={imageInput}
            texFileInputRef={texFileInput}
            onSelectTool={(id) =>
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
            onPlaceImage={(file) => void placeImage(file)}
            onOpenTexFile={(file) => void openTexFile(file)}
          />
        )}
        {leftDockPanels.length > 0 && (
          <aside
            className={`dock dock-left ${dragOverDock === "left" ? "drag-over" : ""}`}
            aria-label="Left panels"
            {...dockDragHandlers("left")}
          >
            {leftDockPanels.map((id) =>
              panelWindow(id, renderPanelBody(id)),
            )}
          </aside>
        )}
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
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "11px", color: "#a0aec0" }} title="Scale the whole figure so its width matches a paper column">
                Fit width (cm):
                <input
                  aria-label="Fit width cm"
                  type="number"
                  min="1"
                  max="40"
                  step="0.1"
                  className="canvas-size-input"
                  value={fitWidthCm}
                  onChange={(e) => setFitWidthCm(Math.max(1, Number(e.target.value)))}
                />
              </label>
              <button onClick={() => scaleToWidth(fitWidthCm)} title="Scale every element so the figure is this wide in the paper">Fit</button>
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
                  const { preview, guides } = previewDrag(drag.current, canvasPoint(event.currentTarget, event.clientX, event.clientY, canvasSize.width, canvasSize.height), nodes, snapEnabled && !event.ctrlKey, canvasSize.width, canvasSize.height);
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
                      ) : node.kind === "dimension" && rawPoints.length >= 2 ? (
                        (() => {
                          const p0 = rawPoints[0];
                          const p1 = rawPoints[1];
                          const dx = p1.x - p0.x;
                          const dy = p1.y - p0.y;
                          const len = Math.hypot(dx, dy) || 1;
                          const ux = dx / len;
                          const uy = dy / len;
                          const stroke = style.stroke ?? "#26334d";
                          const sw = (style.strokeWidth ?? 0.03) * PX_PER_CM;
                          const toScreen = (cx: number, cy: number) => ({ x: cx * PX_PER_CM, y: canvasSize.height - cy * PX_PER_CM });
                          const a = toScreen(p0.x, p0.y);
                          const b = toScreen(p1.x, p1.y);
                          const mid = toScreen((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
                          const tick = 0.14 * PX_PER_CM;
                          const perpX = uy;
                          const perpY = ux;
                          const labelX = mid.x - uy * 0.45 * PX_PER_CM;
                          const labelY = mid.y - ux * 0.45 * PX_PER_CM;
                          return (
                            <g>
                              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
                              <line x1={a.x - perpX * tick} y1={a.y - perpY * tick} x2={a.x + perpX * tick} y2={a.y + perpY * tick} stroke={stroke} strokeWidth={sw} />
                              <line x1={b.x - perpX * tick} y1={b.y - perpY * tick} x2={b.x + perpX * tick} y2={b.y + perpY * tick} stroke={stroke} strokeWidth={sw} />
                              {node.text && (
                                <text
                                  x={labelX}
                                  y={labelY}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize={style.textStyle?.fontSize ?? 10}
                                  fill={stroke}
                                  paintOrder="stroke"
                                  stroke="#ffffff"
                                  strokeWidth={3}
                                  strokeLinejoin="round"
                                >
                                  {node.text}
                                </text>
                              )}
                            </g>
                          );
                        })()
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
                      {node.text && !["text", "math", "dimension"].includes(node.kind) && editingTextNodeId !== node.id && (
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
              const isStandalone = ["text", "math"].includes(targetNode.kind) || targetNode.kind === "dimension";
              const ts = targetNode.style?.textStyle;
              const fontSize = ts?.fontSize ?? (isStandalone ? 14 : 12);
              const dimMid = targetNode.kind === "dimension" && g.points && g.points.length >= 2
                ? { x: (g.points[0].x + g.points[1].x) / 2, y: (g.points[0].y + g.points[1].y) / 2 }
                : undefined;

              const left = isStandalone
                ? (dimMid?.x ?? g.x ?? 0) * PX_PER_CM
                : (g.x ?? 0) * PX_PER_CM;
              const top = isStandalone
                ? canvasSize.height - (dimMid?.y ?? g.y ?? 0) * PX_PER_CM - fontSize - 4
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
        {rightDockPanels.length > 0 && (
          <aside
            className={`dock dock-right ${dragOverDock === "right" ? "drag-over" : ""}`}
            aria-label="Right panels"
            {...dockDragHandlers("right")}
          >
            {rightDockPanels.map((id) =>
              panelWindow(id, renderPanelBody(id)),
            )}
          </aside>
        )}
      </div>
      {bottomDockPanels.length > 0 && (
        <section
          className={`dock dock-bottom ${dragOverDock === "bottom" ? "drag-over" : ""}`}
          aria-label="Source, history, and assistant"
          {...dockDragHandlers("bottom")}
        >
          <div className="bottom-tabs">
            {bottomDockPanels.map((name) => {
              const label = name === "history" ? `History · ${commits.length}` : panelTitles[name];
              return (
                <button
                  key={name}
                  draggable
                  title="Drag to move panel to the left or right side"
                  disabled={!desktop && name !== "source"}
                  className={activeBottom === name ? "active" : ""}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-figureit-panel", name);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingPanel(name);
                  }}
                  onDragEnd={() => {
                    setDraggingPanel(null);
                    setDragOverDock(null);
                  }}
                  onClick={() => {
                    setActiveBottomTab(name);
                    if (name === "history" && project?.handle)
                      void listHistory(project.handle).then(setCommits);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="bottom-body">
            {renderPanelBody(activeBottom)}
          </div>
        </section>
      )}
    </main>
  );
}
export default App;
