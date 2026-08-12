import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  applySceneTransaction,
  connectorAnchorPoint,
  createHistory,
  flattenRenderableNodes,
  nearestConnectorAnchor,
  parseTikz,
  PX_PER_CM,
  sceneToClaudeContext,
  serializeDocument,
  type SceneDocument,
  type SceneGeometry,
  type SceneHistory,
  type SceneNode,
  type SceneOperation,
  type ScenePoint,
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
  mode: "move" | "resize" | "rotate" | "point" | "connect";
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
};
const blank = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
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
const toolNames: Partial<Record<Tool, string>> = { rect: "Rectangle", roundrect: "Rounded rectangle", ellipse: "Ellipse", triangle: "Triangle", diamond: "Diamond", text: "Text", line: "Line", arrow: "Arrow", path: "Path", image: "Image" };
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
    z
      .object({
        type: z.literal("move"),
        id,
        dx: z.number().finite(),
        dy: z.number().finite(),
      })
      .strict(),
    z
      .object({
        type: z.literal("transform"),
        id,
        transform: z
          .object({
            rotate: z.number().finite().optional(),
            xScale: z.number().finite().optional(),
            yScale: z.number().finite().optional(),
            translate: z
              .object({ x: z.number().finite(), y: z.number().finite() })
              .optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal("set_metadata"),
        id,
        name: z.string().max(160).optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("update_properties"),
        id,
        geometry: z
          .object({
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
            width: z.number().finite().optional(),
            height: z.number().finite().optional(),
          })
          .strict()
          .optional(),
        style: z
          .object({
            fill: z.string().max(80).optional(),
            stroke: z.string().max(80).optional(),
            gradient: z.object({ start: z.string().max(80), end: z.string().max(80), angle: z.number().finite() }).strict().optional(),
            strokeWidth: z.number().finite().optional(),
            opacity: z.number().min(0).max(1).optional(),
            dash: z.string().max(100).optional(),
            arrow: z.string().max(8).optional(),
          })
          .strict()
          .optional(),
        text: z.string().max(10000).optional(),
      })
      .strict(),
    z.object({ type: z.literal("delete"), id }).strict(),
    z
      .object({
        type: z.literal("reorder"),
        id,
        index: z.number().int().min(0),
        parentId: id.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("group"),
        childIds: z.array(id).min(2),
        id: id.optional(),
        parentId: id.optional(),
        name: z.string().max(160).optional(),
      })
      .strict(),
    z.object({ type: z.literal("ungroup"), id }).strict(),
  ]),
);
const validOperations = (value: unknown): value is SceneOperation[] =>
  operationsSchema.safeParse(value).success;
const editorNumber = (value: number, digits = 3) => Number(value.toFixed(digits));

const canvasPoint = (canvas: SVGSVGElement, clientX: number, clientY: number): CanvasPoint => {
  const matrix = canvas.getScreenCTM?.();
  if (matrix && canvas.createSVGPoint) {
    const point = canvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }
  const bounds = canvas.getBoundingClientRect();
  return bounds.width && bounds.height
    ? { x: (clientX - bounds.left) * 800 / bounds.width, y: (clientY - bounds.top) * 520 / bounds.height }
    : { x: clientX, y: clientY };
};

const previewDrag = (drag: Drag, point: CanvasPoint): DragPreview => {
  const dx = (point.x - drag.start.x) / PX_PER_CM;
  const dy = -(point.y - drag.start.y) / PX_PER_CM;
  if ((drag.mode === "point" || drag.mode === "connect") && drag.points?.length) {
    const points = [...drag.points];
    points[drag.pointIndex ?? points.length - 1] = { x: point.x / PX_PER_CM, y: (520 - point.y) / PX_PER_CM };
    return { id: drag.id, mode: drag.mode, dx, dy, geometry: { points } };
  }
  if (drag.mode === "resize" && drag.width !== undefined && drag.height !== undefined) {
    const radians = (drag.rotation ?? 0) * Math.PI / 180;
    const localDx = dx * Math.cos(radians) + dy * Math.sin(radians);
    const localDy = -dx * Math.sin(radians) + dy * Math.cos(radians);
    const west = drag.handle === 0 || drag.handle === 6 || drag.handle === 7;
    const east = drag.handle === 2 || drag.handle === 3 || drag.handle === 4;
    const north = drag.handle === 0 || drag.handle === 1 || drag.handle === 2;
    const south = drag.handle === 4 || drag.handle === 5 || drag.handle === 6;
    const width = Math.max(0.2, drag.width + (east ? localDx : west ? -localDx : 0));
    const height = Math.max(0.2, drag.height + (north ? localDy : south ? -localDy : 0));
    return {
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
    };
  }
  if (drag.mode === "rotate" && drag.rotation !== undefined && drag.center) {
    const start = Math.atan2(drag.start.y - drag.center.y, drag.start.x - drag.center.x);
    const current = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
    return { id: drag.id, mode: drag.mode, dx, dy, rotation: drag.rotation - (current - start) * 180 / Math.PI };
  }
  return { id: drag.id, mode: drag.mode, dx, dy };
};

function App() {
  const desktop = desktopFeaturesAvailable();
  const [doc, setDoc] = useState<SceneDocument>(
    () => parseTikz(blank).document,
  );
  const [history, setHistory] = useState<SceneHistory>(() =>
    createHistory(parseTikz(blank).document),
  );
  const [project, setProject] = useState<{
    handle: string;
    title: string;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<Tab>("source");
  const [draft, setDraft] = useState(blank);
  const [notice, setNotice] = useState("Ready");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [request, setRequest] = useState("");
  const [suggestion, setSuggestion] = useState<{
    text: string;
    operations: SceneOperation[];
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const checkpoint = useRef<number | undefined>(undefined);
  const projectHandle = useRef<string | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const nodes = useMemo(() => flattenRenderableNodes(doc), [doc]);
  const find = (list: SceneNode[], nodeId: string): SceneNode | undefined =>
    list.find((node) => node.id === nodeId) ??
    list
      .flatMap((node) => node.children ?? [])
      .map((node) => find([node], nodeId))
      .find(Boolean);
  const active = find(doc.nodes, selected.at(-1) ?? "");
  projectHandle.current = project?.handle;
  const flushCheckpoint = () => {
    if (checkpoint.current) window.clearTimeout(checkpoint.current);
    checkpoint.current = undefined;
    if (project) void checkpointProject(project.handle);
  };
  const persist = (next: SceneDocument) => {
    const source = serializeDocument(next);
    setDoc(next);
    setDraft(source);
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
  const load = async (open = false) => {
    const next = await (open ? openProject() : createProject());
    const parsed = parseTikz(next.source);
    if (parsed.errors.length) {
      setNotice("Project source could not be parsed");
      return;
    }
    const source = serializeDocument(parsed.document);
    await resetClaudeConversation();
    setProject({ handle: next.handle, title: next.title });
    setDoc(parsed.document);
    setHistory(createHistory(parsed.document));
    setDraft(source);
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
    const clone = structuredClone(active); clone.id = crypto.randomUUID(); clone.name = `${active.name ?? active.kind} copy`;
    if (clone.geometry?.points) clone.geometry.points = clone.geometry.points.map((point) => ({ x: point.x + 0.3, y: point.y + 0.3 }));
    else if (clone.geometry?.x !== undefined && clone.geometry.y !== undefined) { clone.geometry.x += 0.3; clone.geometry.y += 0.3; }
    transact("Duplicate selection", [{ type: "insert", node: clone }]); setSelected([clone.id]);
  };
  const align = (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    const chosen = selected.map((nodeId) => find(doc.nodes, nodeId)).filter((node): node is SceneNode => Boolean(node?.geometry && node.geometry.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined));
    if (chosen.length < 2) return;
    const horizontal = ["left", "center", "right"].includes(mode);
    const values = chosen.map((node) => horizontal ? node.geometry!.x! + (mode === "center" ? node.geometry!.width! / 2 : mode === "right" ? node.geometry!.width! : 0) : node.geometry!.y! + (mode === "middle" ? node.geometry!.height! / 2 : mode === "top" ? node.geometry!.height! : 0));
    const left = Math.min(...chosen.map((node) => node.geometry!.x!)); const right = Math.max(...chosen.map((node) => node.geometry!.x! + node.geometry!.width!)); const bottom = Math.min(...chosen.map((node) => node.geometry!.y!)); const top = Math.max(...chosen.map((node) => node.geometry!.y! + node.geometry!.height!));
    const target = mode === "left" ? left : mode === "right" ? right : mode === "center" ? (left + right) / 2 : mode === "bottom" ? bottom : mode === "top" ? top : (bottom + top) / 2;
    transact(`Align ${mode}`, chosen.map((node, index) => ({ type: "move", id: node.id, dx: horizontal ? target - values[index] : 0, dy: horizontal ? 0 : target - values[index] })));
  };
  const distribute = (axis: "horizontal" | "vertical") => {
    const chosen = selected.map((nodeId) => find(doc.nodes, nodeId)).filter((node): node is SceneNode => Boolean(node?.geometry && node.geometry.x !== undefined && node.geometry.y !== undefined && node.geometry.width !== undefined && node.geometry.height !== undefined));
    if (chosen.length < 3) return;
    const center = (node: SceneNode) => axis === "horizontal" ? node.geometry!.x! + node.geometry!.width! / 2 : node.geometry!.y! + node.geometry!.height! / 2;
    const ordered = [...chosen].sort((a, b) => center(a) - center(b)); const first = center(ordered[0]); const step = (center(ordered.at(-1)!) - first) / (ordered.length - 1);
    transact(`Distribute ${axis}`, ordered.map((node, index) => ({ type: "move", id: node.id, dx: axis === "horizontal" ? first + step * index - center(node) : 0, dy: axis === "vertical" ? first + step * index - center(node) : 0 })));
  };
  const beginDrag = (
    event: React.PointerEvent<SVGElement>,
    value: Omit<Drag, "pointerId" | "start">,
  ) => {
    if (!svg.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = canvasPoint(svg.current, event.clientX, event.clientY);
    drag.current = { ...value, pointerId: event.pointerId, start };
    setDragPreview({ id: value.id, mode: value.mode, dx: 0, dy: 0 });
    svg.current.setPointerCapture?.(event.pointerId);
  };
  const finishDrag = (event: React.PointerEvent<SVGSVGElement>, cancel = false) => {
    const value = drag.current;
    if (!value || value.pointerId !== event.pointerId) return;
    const preview = previewDrag(value, canvasPoint(event.currentTarget, event.clientX, event.clientY));
    drag.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) return;
    const hit = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<SVGElement>("[data-node-id]")?.dataset.nodeId;
    const hitNode = hit ? find(doc.nodes, hit) : undefined;
    const scenePoint = { x: event.clientX, y: event.clientY };
    const canvas = canvasPoint(event.currentTarget, scenePoint.x, scenePoint.y);
    const endpoint = { x: canvas.x / PX_PER_CM, y: (520 - canvas.y) / PX_PER_CM };
    if (preview.mode === "connect" && value.fromId) {
      const from = find(doc.nodes, value.fromId);
      if (!from || !hitNode || hitNode.id === from.id) return setNotice("Drop a connector on another shape");
      const start = nearestConnectorAnchor(from, { x: value.start.x / PX_PER_CM, y: (520 - value.start.y) / PX_PER_CM });
      const end = nearestConnectorAnchor(hitNode, endpoint);
      if (!start || !end) return setNotice("That shape has no connection sites");
      const node: SceneNode = { id: crypto.randomUUID(), kind: "connector", name: "Connector", visible: true, locked: false, transform: identity, geometry: { points: [connectorAnchorPoint(from, start.anchor)!, connectorAnchorPoint(hitNode, end.anchor)!] }, bindings: { start, end, routing: "straight" }, style: { stroke: "black", strokeWidth: 0.06, arrow: "->" }, prefix: "\n", source: "" };
      transact("Connect shapes", [{ type: "insert", node }]); setSelected([node.id]); setTool("select"); return;
    }
    if (preview.mode === "point" && preview.geometry?.points) {
      const node = find(doc.nodes, preview.id);
      if (!node) return;
      const index = value.pointIndex ?? 0;
      let bindings = node.bindings;
      if (node.kind === "connector" && (index === 0 || index === preview.geometry.points.length - 1)) {
        const binding = hitNode && hitNode.id !== node.id ? nearestConnectorAnchor(hitNode, endpoint) : undefined;
        bindings = { ...node.bindings, ...(index === 0 ? { start: binding } : { end: binding }) };
      }
      update({ type: "update_properties", id: preview.id, geometry: { points: preview.geometry.points.map((point) => ({ x: editorNumber(point.x), y: editorNumber(point.y) })) }, ...(bindings ? { bindings } : {}) }, node.kind === "connector" ? "Reconnect endpoint" : "Reshape line"); return;
    }
    if (preview.mode === "resize" && preview.geometry)
      update({ type: "update_properties", id: preview.id, geometry: Object.fromEntries(Object.entries(preview.geometry).filter((entry): entry is [string, number] => typeof entry[1] === "number").map(([key, value]) => [key, editorNumber(value)])) }, "Resize selection");
    else if (preview.mode === "rotate" && preview.rotation !== undefined)
      update({ type: "transform", id: preview.id, transform: { rotate: editorNumber(preview.rotation, 1) } }, "Rotate selection");
    else if (preview.dx || preview.dy)
      update({ type: "move", id: preview.id, dx: editorNumber(preview.dx), dy: editorNumber(preview.dy) }, "Move selection");
  };
  const layer = (
    node: SceneNode,
    depth = 0,
    ancestorVisible = true,
    ancestorLocked = false,
  ): React.ReactNode => (
    <>
      <div
        className={`layer ${selected.includes(node.id) ? "selected" : ""}`}
        key={node.id}
        style={{
          paddingLeft: 4 + depth * 15,
          opacity: ancestorVisible && node.visible ? 1 : 0.45,
        }}
      >
        <button
          className="layer-name"
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
          {node.kind === "group" ? "▾ " : ""}
          {node.name ?? node.kind}
        </button>
        <button
          aria-label={
            node.visible
              ? `Hide ${node.name ?? node.kind}`
              : `Show ${node.name ?? node.kind}`
          }
          onClick={() =>
            update({
              type: "set_metadata",
              id: node.id,
              visible: !node.visible,
            })
          }
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
      </div>
      {node.children?.map((child) => (
        <Fragment key={child.id}>{layer(child, depth + 1, ancestorVisible && node.visible, ancestorLocked || node.locked)}</Fragment>
      ))}
    </>
  );
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
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "d" &&
        active
      ) {
        event.preventDefault();
        const clone = {
          ...active,
          id: crypto.randomUUID(),
          name: `${active.name ?? active.kind} copy`,
          transform: {
            ...active.transform,
            translate: {
              x: active.transform.translate.x + 0.3,
              y: active.transform.translate.y + 0.3,
            },
          },
        };
        transact("Duplicate selection", [{ type: "insert", node: clone }]);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected.length
      ) {
        transact(
          "Delete selection",
          selected.map((id) => ({ type: "delete", id })),
        );
      } else if (
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
  useEffect(() => () => { if (checkpoint.current) { window.clearTimeout(checkpoint.current); const handle = projectHandle.current; if (handle) void checkpointProject(handle); } }, []);
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
          <button aria-label="New project" onClick={() => void load()}>
            New
          </button>
          <button aria-label="Open project" onClick={() => void load(true)}>
            Open
          </button>
          <button
            aria-label="Undo"
            disabled={!history.past.length}
            onClick={undo}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            disabled={!history.future.length}
            onClick={redo}
          >
            ↷
          </button>
          <button onClick={exportSvg}>Export SVG</button>
          <button disabled={!desktop} title={desktop ? undefined : "PDF export is available on desktop"} onClick={() => void exportPdf()}>Export PDF</button>
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
                onClick={() => id === "select" || id === "connector" ? (setTool(id), setNotice(id === "connector" ? "Drag from one shape connection site to another" : "Select")) : id === "image" ? imageInput.current?.click() : add(id)}
              >
                <b>{label[0]}</b>
                <small>{label}</small>
              </button>
            ))}
            <input ref={imageInput} aria-label="Image file" type="file" accept="image/*" hidden onChange={(event) => void placeImage(event.target.files?.[0])} />
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
            {doc.nodes.map((node) => <Fragment key={node.id}>{layer(node)}</Fragment>)}
            {selected.length > 1 && <div className="layer-arrange" aria-label="Align selected layers">
              {(["left", "center", "right", "top", "middle", "bottom"] as const).map((mode) => <button key={mode} onClick={() => align(mode)}>Align {mode}</button>)}
              <button disabled={selected.length < 3} onClick={() => distribute("horizontal")}>Distribute horizontally</button>
              <button disabled={selected.length < 3} onClick={() => distribute("vertical")}>Distribute vertically</button>
            </div>}
          </section>
        </aside>
        <section className="canvas-area" aria-label="Artboard">
          <div className="canvas-controls">
            <span>Scene · {doc.revision}</span>
          </div>
          <div className="artboard-wrap">
            <svg
              ref={svg}
              className="artboard"
              viewBox="0 0 800 520"
              aria-label="Figure artboard"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setSelected([]);
              }}
              onPointerMove={(event) => {
                if (drag.current?.pointerId === event.pointerId)
                  setDragPreview(previewDrag(drag.current, canvasPoint(event.currentTarget, event.clientX, event.clientY)));
              }}
              onPointerUp={(event) => finishDrag(event)}
              onPointerCancel={(event) => finishDrag(event, true)}
            >
              <defs>
                <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke" /></marker>
                <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke" /></marker>
                {nodes.filter((node) => node.style?.gradient).map((node) => <linearGradient key={node.id} id={`gradient-${node.id.replace(/[^\w-]/g, "-")}`} gradientTransform={`rotate(${node.style!.gradient!.angle} .5 .5)`}><stop offset="0" stopColor={node.style!.gradient!.start} /><stop offset="1" stopColor={node.style!.gradient!.end} /></linearGradient>)}
              </defs>
              <rect width="800" height="520" fill="white" pointerEvents="none" />
              {nodes
                .filter((node) => node.visible)
                .map((node) => {
                  const preview = dragPreview?.id === node.id ? dragPreview : undefined;
                  const g = { ...node.geometry, ...(preview?.geometry ?? {}) };
                  const x = (g.x ?? 0) * PX_PER_CM;
                  const y = 520 - (g.y ?? 0) * PX_PER_CM;
                  const w = (g.width ?? 3) * PX_PER_CM;
                  const h = (g.height ?? 2) * PX_PER_CM;
                  const style = node.style ?? {};
                  const rawPoints = g.points ?? [];
                  const transformCenterX = rawPoints.length ? (Math.min(...rawPoints.map((point) => point.x)) + Math.max(...rawPoints.map((point) => point.x))) / 2 * PX_PER_CM : node.kind === "text" || node.kind === "math" ? x : x + w / 2;
                  const transformCenterY = rawPoints.length ? 520 - (Math.min(...rawPoints.map((point) => point.y)) + Math.max(...rawPoints.map((point) => point.y))) / 2 * PX_PER_CM : node.kind === "text" || node.kind === "math" ? y : y - h / 2;
                  const routedPoints = node.kind === "connector" && node.bindings?.routing === "elbow" && rawPoints.length >= 2 ? [rawPoints[0], { x: rawPoints.at(-1)!.x, y: rawPoints[0].y }, rawPoints.at(-1)!] : rawPoints;
                  const svgPoints = routedPoints.map((point) => `${point.x * PX_PER_CM},${520 - point.y * PX_PER_CM}`).join(" ");
                  const fill = style.gradient ? `url(#gradient-${node.id.replace(/[^\w-]/g, "-")})` : style.fill ?? "#7c9cff";
                  const dash = style.dash === "dashed" || style.dash === "on 4pt off 3pt" ? "8 6" : style.dash === "dotted" || style.dash === "on 0pt off 2pt" ? "2 5" : undefined;
                  const markerStart = style.arrow === "<-" || style.arrow === "<->" ? "url(#arrow-start)" : undefined;
                  const markerEnd = style.arrow === "->" || style.arrow === "<->" || (node.kind === "connector" && style.arrow === undefined) ? "url(#arrow-end)" : undefined;
                  return (
                    <g
                      key={node.id}
                      aria-label={node.name ?? node.kind}
                      data-testid="shape"
                      data-node-id={node.id}
                      transform={`translate(${(node.transform.translate.x + (preview?.mode === "move" ? preview.dx : 0)) * PX_PER_CM} ${-(node.transform.translate.y + (preview?.mode === "move" ? preview.dy : 0)) * PX_PER_CM}) rotate(${-(preview?.rotation ?? node.transform.rotate)} ${transformCenterX} ${transformCenterY}) translate(${transformCenterX} ${transformCenterY}) scale(${node.transform.xScale} ${node.transform.yScale}) translate(${-transformCenterX} ${-transformCenterY})`}
                      opacity={style.opacity ?? 1}
                      className={`shape ${selected.includes(node.id) ? "selected" : ""}`}
                      onPointerDown={(event) => {
                        if (!node.locked) {
                          if (tool === "connector" && node.geometry?.width !== undefined && node.geometry.height !== undefined && svg.current) {
                            const canvas = canvasPoint(svg.current, event.clientX, event.clientY); const binding = nearestConnectorAnchor(node, { x: canvas.x / PX_PER_CM, y: (520 - canvas.y) / PX_PER_CM }); const point = binding && connectorAnchorPoint(node, binding.anchor);
                            if (point) beginDrag(event, { id: "connector-preview", mode: "connect", fromId: node.id, points: [point, point], pointIndex: 1 });
                          } else beginDrag(event, { id: node.id, mode: "move" });
                          setSelected(
                            event.shiftKey
                              ? selected.includes(node.id) ? selected : [...selected, node.id]
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
                        node.kind === "connector" && node.bindings?.routing === "curved" && rawPoints.length >= 2 ? <path d={`M ${rawPoints[0].x * PX_PER_CM} ${520 - rawPoints[0].y * PX_PER_CM} C ${(rawPoints[0].x + rawPoints.at(-1)!.x) / 2 * PX_PER_CM} ${520 - rawPoints[0].y * PX_PER_CM}, ${(rawPoints[0].x + rawPoints.at(-1)!.x) / 2 * PX_PER_CM} ${520 - rawPoints.at(-1)!.y * PX_PER_CM}, ${rawPoints.at(-1)!.x * PX_PER_CM} ${520 - rawPoints.at(-1)!.y * PX_PER_CM}`} fill="none" stroke={style.stroke ?? "#26334d"} strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM} strokeDasharray={dash} markerStart={markerStart} markerEnd={markerEnd} /> : <polyline
                          points={svgPoints}
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
                        <text x={x} y={y} fill={style.stroke ?? "#26334d"}>
                          {node.text}
                        </text>
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
                      {tool !== "connector" && selected.includes(node.id) && !node.locked && g.width !== undefined && g.height !== undefined && <><rect className="selection-box" x={x - 5} y={y - h - 5} width={w + 10} height={h + 10} /><line className="selection-box" x1={x + w / 2} y1={y - h - 5} x2={x + w / 2} y2={y - h - 26} />{[[x, y - h], [x + w / 2, y - h], [x + w, y - h], [x + w, y - h / 2], [x + w, y], [x + w / 2, y], [x, y], [x, y - h / 2]].map(([hx, hy], index) => <rect key={index} aria-label={`Resize handle ${index + 1}`} className="resize-handle" style={{ cursor: ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"][index] }} x={hx - 5} y={hy - 5} width="10" height="10" onPointerDown={(event) => beginDrag(event, { id: node.id, mode: "resize", width: g.width, height: g.height, originX: g.x, originY: g.y, handle: index, rotation: node.transform.rotate })} />)}<circle aria-label="Rotate handle" className="rotate-handle" cx={x + w / 2} cy={y - h - 26} r="6" onPointerDown={(event) => beginDrag(event, { id: node.id, mode: "rotate", rotation: node.transform.rotate, center: { x: x + w / 2 + node.transform.translate.x * PX_PER_CM, y: y - h / 2 - node.transform.translate.y * PX_PER_CM } })} /></>}
                      {tool !== "connector" && selected.includes(node.id) && !node.locked && rawPoints.map((point, index) => <circle key={index} aria-label={`Point handle ${index + 1}`} className="point-handle" cx={point.x * PX_PER_CM} cy={520 - point.y * PX_PER_CM} r="6" onPointerDown={(event) => beginDrag(event, { id: node.id, mode: "point", points: rawPoints, pointIndex: index })} />)}
                      {tool === "connector" && g.width !== undefined && g.height !== undefined && [[x, y - h], [x + w / 2, y - h], [x + w, y - h], [x + w, y - h / 2], [x + w, y], [x + w / 2, y], [x, y], [x, y - h / 2]].map(([cx, cy], index) => <circle key={index} className="connection-site" cx={cx} cy={cy} r="5" pointerEvents="none" />)}
                    </g>
                  );
                })}
              {dragPreview?.mode === "connect" && dragPreview.geometry?.points && <polyline className="connector-preview" points={dragPreview.geometry.points.map((point) => `${point.x * PX_PER_CM},${520 - point.y * PX_PER_CM}`).join(" ")} fill="none" />}
            </svg>
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
              </label>
              {active.style?.gradient && <div className="field-grid">
                <label>Gradient start<input aria-label="Gradient start" value={active.style.gradient.start} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, start: event.target.value } } })} /></label>
                <label>Gradient end<input aria-label="Gradient end" value={active.style.gradient.end} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, end: event.target.value } } })} /></label>
                <label>Angle<input aria-label="Gradient angle" type="number" value={active.style.gradient.angle} onChange={(event) => update({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, angle: Number(event.target.value) } } })} /></label>
              </div>}
              <label>
                Stroke
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
              </label>
              {active.text !== undefined && <label>
                Text
                <textarea aria-label="Text content" value={active.text} onChange={(event) => update({ type: "update_properties", id: active.id, text: event.target.value }, "Edit text")} />
              </label>}
              <div className="field-grid">
                <label>
                  Stroke width
                  <input aria-label="Stroke width" type="number" min="0" step="0.01" value={active.style?.strokeWidth ?? 0} onChange={(event) => update({ type: "update_properties", id: active.id, style: { strokeWidth: Math.max(0, Number(event.target.value)) } })} />
                </label>
                <label>
                  Opacity
                  <input aria-label="Opacity" type="number" min="0" max="1" step="0.05" value={active.style?.opacity ?? 1} onChange={(event) => update({ type: "update_properties", id: active.id, style: { opacity: Math.min(1, Math.max(0, Number(event.target.value))) } })} />
                </label>
              </div>
              {["line", "path", "connector"].includes(active.kind) && <div className="field-grid">
                <label>Line pattern<select aria-label="Line pattern" value={active.style?.dash === "on 4pt off 3pt" || active.style?.dash === "dashed" ? "dashed" : active.style?.dash === "on 0pt off 2pt" || active.style?.dash === "dotted" ? "dotted" : "solid"} onChange={(event) => update({ type: "update_properties", id: active.id, style: { dash: event.target.value === "solid" ? "" : event.target.value === "dashed" ? "on 4pt off 3pt" : "on 0pt off 2pt" } })}>
                  <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                </select></label>
                <label>Line ends<select aria-label="Line ends" value={active.style?.arrow === "<-" ? "start" : active.style?.arrow === "<->" ? "both" : active.style?.arrow === "->" || (active.kind === "connector" && active.style?.arrow === undefined) ? "end" : "none"} onChange={(event) => update({ type: "update_properties", id: active.id, style: { arrow: event.target.value === "start" ? "<-" : event.target.value === "both" ? "<->" : event.target.value === "end" ? "->" : "" } })}>
                  <option value="none">None</option><option value="start">Start</option><option value="end">End</option><option value="both">Both</option>
                </select></label>
                {active.kind === "connector" && <label>Connector route<select aria-label="Connector route" value={active.bindings?.routing ?? "straight"} onChange={(event) => update({ type: "update_properties", id: active.id, bindings: { ...active.bindings, routing: event.target.value as "straight" | "elbow" | "curved" } }, "Change connector route")}><option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curved">Curved</option></select></label>}
              </div>}
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
                  {active.visible ? "Hide" : "Show"}
                </button>
                <button
                  aria-label="Bring forward"
                  onClick={() => { const list = siblingsFor(doc.nodes, active.id); const index = list?.findIndex((node) => node.id === active.id) ?? 0; update({ type: "reorder", id: active.id, index: index + 1 }, "Bring forward"); }}
                >
                  Forward
                </button>
                <button aria-label="Send backward" onClick={() => { const list = siblingsFor(doc.nodes, active.id); const index = list?.findIndex((node) => node.id === active.id) ?? 0; update({ type: "reorder", id: active.id, index: Math.max(0, index - 1) }, "Send backward"); }}>Backward</button>
                <button aria-label="Bring to front" onClick={() => update({ type: "reorder", id: active.id, index: 999 }, "Bring to front")}>To front</button>
                <button aria-label="Send to back" onClick={() => update({ type: "reorder", id: active.id, index: 0 }, "Send to back")}>To back</button>
                <button aria-label="Duplicate selected layer" onClick={duplicate}>Duplicate</button>
                <button aria-label="Flip horizontal" disabled={active.kind === "group"} onClick={() => update({ type: "transform", id: active.id, transform: { xScale: -active.transform.xScale } }, "Flip horizontal")}>Flip H</button>
                <button aria-label="Flip vertical" disabled={active.kind === "group"} onClick={() => update({ type: "transform", id: active.id, transform: { yScale: -active.transform.yScale } }, "Flip vertical")}>Flip V</button>
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
                  Ungroup
                </button>
                <button
                  onClick={() =>
                    transact("Delete selection", [
                      { type: "delete", id: active.id },
                    ])
                  }
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <p className="empty">Select an object to edit its properties.</p>
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
          <div className="bottom-content">
            <label className="source-label">
              TikZ source
              <textarea
                aria-label="TikZ source"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="source-actions">
              <button
                aria-label="Apply source"
                onClick={() => {
                  flushCheckpoint();
                  const parsed = parseTikz(draft);
                  if (parsed.errors.length)
                    return setNotice("Source has parse errors");
                  setHistory(createHistory(parsed.document));
                  persist(parsed.document);
                  setSelected([]);
                  setNotice("Source applied");
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
            </div>
          </div>
        ) : tab === "history" ? (
          <div className="history-list">
            {commits.map((commit) => (
              <div key={commit.id}>
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
          <div className="assistant-panel">
            <label>
              Ask Claude
              <textarea
                aria-label="Assistant request"
                value={request}
                onChange={(event) => setRequest(event.target.value)}
              />
            </label>
            <button
              onClick={() =>
                void askClaude(sceneToClaudeContext(doc), request).then(
                  (result) => {
                    if (
                      result.status === "ok" &&
                      validOperations(result.operations)
                    )
                      setSuggestion({
                        text: result.text,
                        operations: result.operations,
                      });
                    else
                      setNotice(
                        result.status === "ok"
                          ? "Assistant suggestion was rejected"
                          : result.message,
                      );
                  },
                )
              }
            >
              Request suggestion
            </button>
            {suggestion && (
              <div>
                <p>{suggestion.text}</p>
                <button
                  onClick={() => {
                    flushCheckpoint();
                    transact(
                      "Apply assistant suggestion",
                      suggestion.operations,
                    );
                    setSuggestion(null);
                  }}
                >
                  Apply suggestion
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
export default App;
