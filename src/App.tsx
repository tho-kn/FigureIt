import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  applySceneTransaction,
  createHistory,
  flattenRenderableNodes,
  parseTikz,
  PX_PER_CM,
  sceneToClaudeContext,
  serializeDocument,
  type SceneDocument,
  type SceneHistory,
  type SceneNode,
  type SceneOperation,
} from "./model";
import {
  askClaude,
  checkpointProject,
  compileProject,
  createProject,
  listHistory,
  openProject,
  resetClaudeConversation,
  restoreCommit,
  saveProject,
  writeAsset,
  type Commit,
} from "./services/backend";
import "./App.css";

type Tool = "select" | "rect" | "ellipse" | "text" | "line" | "path" | "image";
type Tab = "source" | "history" | "assistant";
const blank = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
const labels: Array<[Tool, string]> = [
  ["select", "Select"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["text", "Text / math"],
  ["line", "Line / arrow"],
  ["path", "Pen path"],
  ["image", "Place image"],
];
const identity = { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 };
const shapeNode = (kind: Exclude<Tool, "select">, index: number): SceneNode => {
  const x = 1.5 + index * 0.45;
  const y = 1.5 + index * 0.35;
  const name = `${kind === "rect" ? "Rectangle" : kind[0].toUpperCase() + kind.slice(1)}${index ? ` ${index + 1}` : ""}`;
  const base = {
    id: crypto.randomUUID(),
    kind,
    name,
    visible: true,
    locked: false,
    transform: identity,
    prefix: "\n",
    source: "",
  };
  if (kind === "rect" || kind === "ellipse")
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
  if (kind === "line" || kind === "path")
    return {
      ...base,
      geometry: {
        points: [
          { x, y },
          { x: x + 3.5, y: y + 1.5 },
        ],
      },
      style: { stroke: "black", strokeWidth: 0.06 },
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
            strokeWidth: z.number().finite().optional(),
            opacity: z.number().min(0).max(1).optional(),
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

function App() {
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
  const svg = useRef<SVGSVGElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const checkpoint = useRef<number | undefined>(undefined);
  const projectHandle = useRef<string | undefined>(undefined);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    mode: "move" | "resize" | "rotate";
    width?: number;
    height?: number;
    originX?: number;
    originY?: number;
    handle?: number;
    rotation?: number;
  } | null>(null);
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
  const add = (kind: Exclude<Tool, "select">) => {
    const node = shapeNode(
      kind,
      nodes.filter((node) => node.kind === kind).length,
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
    const node = {
      ...shapeNode(
        "image",
        nodes.filter((node) => node.kind === "image").length,
      ),
      name: "Image",
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
          <button onClick={() => void exportPdf()}>Export PDF</button>
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
                onClick={() => id === "select" ? setTool(id) : id === "image" ? imageInput.current?.click() : add(id)}
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
            >
              <rect width="800" height="520" fill="white" />
              {nodes
                .filter((node) => node.visible)
                .map((node) => {
                  const g = node.geometry ?? {};
                  const x = (g.x ?? 0) * PX_PER_CM;
                  const y = 520 - (g.y ?? 0) * PX_PER_CM;
                  const w = (g.width ?? 3) * PX_PER_CM;
                  const h = (g.height ?? 2) * PX_PER_CM;
                  const style = node.style ?? {};
                  return (
                    <g
                      key={node.id}
                      aria-label={node.name ?? node.kind}
                      transform={`translate(${node.transform.translate.x * PX_PER_CM} ${-node.transform.translate.y * PX_PER_CM}) rotate(${-node.transform.rotate} ${x + w / 2} ${y - h / 2})`}
                      opacity={style.opacity ?? 1}
                      className={`shape ${selected.includes(node.id) ? "selected" : ""}`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (!node.locked) {
                          drag.current = {
                            id: node.id,
                            x: event.clientX,
                            y: event.clientY,
                            mode: "move",
                          };
                          setSelected(
                            event.shiftKey ? [...selected, node.id] : [node.id],
                          );
                        }
                      }}
                      onPointerUp={(event) => {
                        const point = drag.current;
                        drag.current = null;
                        if (point?.id === node.id) {
                          const dx = (event.clientX - point.x) / PX_PER_CM;
                          const dy = -(event.clientY - point.y) / PX_PER_CM;
                          if (point.mode === "resize" && point.width && point.height) { const west = point.handle === 0 || point.handle === 6 || point.handle === 7; const east = point.handle === 2 || point.handle === 3 || point.handle === 4; const north = point.handle === 0 || point.handle === 1 || point.handle === 2; const south = point.handle === 4 || point.handle === 5 || point.handle === 6; const width = Math.max(.2, point.width + (east ? dx : west ? -dx : 0)); const height = Math.max(.2, point.height + (north ? dy : south ? -dy : 0)); update({ type: "update_properties", id: node.id, geometry: { width, height, ...(west ? { x: (point.originX ?? 0) + point.width - width } : {}), ...(south ? { y: (point.originY ?? 0) + point.height - height } : {}) } }, "Resize selection"); }
                          else if (point.mode === "rotate" && point.rotation !== undefined) { const angle = Math.atan2(event.clientY - (y - h / 2), event.clientX - (x + w / 2)) * 180 / Math.PI; update({ type: "transform", id: node.id, transform: { rotate: point.rotation - angle } }, "Rotate selection") }
                          else if (dx || dy)
                            update(
                              { type: "move", id: node.id, dx, dy },
                              "Move selection",
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
                          fill={style.fill ?? "none"}
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                        />
                      ) : node.kind === "line" ||
                        node.kind === "path" ||
                        node.kind === "connector" ? (
                        <polyline
                          points={(g.points ?? [])
                            .map(
                              (point) =>
                                `${point.x * PX_PER_CM},${520 - point.y * PX_PER_CM}`,
                            )
                            .join(" ")}
                          fill="none"
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                        />
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
                          rx="8"
                          fill={style.fill ?? "#7c9cff"}
                          stroke={style.stroke ?? "#26334d"}
                          strokeWidth={(style.strokeWidth ?? 0.05) * PX_PER_CM}
                        />
                      )}
                      {selected.includes(node.id) && !node.locked && g.width !== undefined && g.height !== undefined && <><rect className="selection-box" x={x - 5} y={y - h - 5} width={w + 10} height={h + 10} /><line className="selection-box" x1={x + w / 2} y1={y - h - 5} x2={x + w / 2} y2={y - h - 26} />{[[x, y - h], [x + w / 2, y - h], [x + w, y - h], [x + w, y - h / 2], [x + w, y], [x + w / 2, y], [x, y], [x, y - h / 2]].map(([hx, hy], index) => <rect key={index} aria-label={`Resize handle ${index + 1}`} className="resize-handle" x={hx - 4} y={hy - 4} width="8" height="8" onPointerDown={(event) => { event.stopPropagation(); drag.current = { id: node.id, x: event.clientX, y: event.clientY, mode: "resize", width: g.width, height: g.height, originX: g.x, originY: g.y, handle: index } }} />)}<circle aria-label="Rotate handle" className="rotate-handle" cx={x + w / 2} cy={y - h - 26} r="5" onPointerDown={(event) => { event.stopPropagation(); drag.current = { id: node.id, x: event.clientX, y: event.clientY, mode: "rotate", rotation: node.transform.rotate } }} /></>}
                    </g>
                  );
                })}
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
                Fill
                <input
                  aria-label="Fill color"
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
                  aria-label="Move forward"
                  onClick={() =>
                    update({ type: "reorder", id: active.id, index: 999 })
                  }
                >
                  Forward
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
