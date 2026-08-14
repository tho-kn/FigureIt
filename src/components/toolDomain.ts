export type Tool = "select" | "rect" | "roundrect" | "ellipse" | "triangle" | "diamond" | "text" | "line" | "arrow" | "connector" | "path" | "image" | "dimension";
export type ToolShortcuts = Record<Tool, string>;

export const SHAPE_KINDS = ["rect", "roundrect", "ellipse", "triangle", "diamond"];
export const LINE_KINDS = ["line", "path", "connector"];
export const TEXT_KINDS = ["text", "math"];

export const toolNames: Record<Tool, string> = {
  select: "Select",
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
  dimension: "Dimension",
};

export const TOOL_LABELS: Array<[Tool, string]> = [
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
  ["dimension", "Dimension"],
];

export const DEFAULT_TOOL_SHORTCUTS: ToolShortcuts = {
  select: "v",
  rect: "r",
  roundrect: "u",
  ellipse: "o",
  triangle: "g",
  diamond: "d",
  text: "t",
  line: "l",
  arrow: "a",
  connector: "c",
  path: "p",
  image: "i",
  dimension: "m",
};

export const normalizeToolShortcuts = (value: unknown): ToolShortcuts => {
  const source = value && typeof value === "object" ? value as Partial<Record<Tool, unknown>> : {};
  const used = new Set<string>();
  return Object.fromEntries(TOOL_LABELS.map(([tool]) => {
    const candidate = typeof source[tool] === "string" ? source[tool].toLowerCase() : DEFAULT_TOOL_SHORTCUTS[tool];
    const shortcut = candidate === "" || /^[a-z0-9]$/.test(candidate) ? candidate : DEFAULT_TOOL_SHORTCUTS[tool];
    if (!shortcut || used.has(shortcut)) return [tool, ""];
    used.add(shortcut);
    return [tool, shortcut];
  })) as ToolShortcuts;
};

export const dashToDisplay = (v: string | undefined) =>
  v === "on 4pt off 3pt" || v === "dashed" ? "dashed" : v === "on 0pt off 2pt" || v === "dotted" ? "dotted" : "solid";
export const dashToModel = (v: string) => (v === "dashed" ? "on 4pt off 3pt" : v === "dotted" ? "on 0pt off 2pt" : "");
export const arrowToDisplay = (v: string | undefined) => (v === "<-" ? "start" : v === "<->" ? "both" : v === "->" ? "end" : "none");
export const arrowToModel = (v: string) => (v === "start" ? "<-" : v === "both" ? "<->" : v === "end" ? "->" : "");
