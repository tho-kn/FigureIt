export type Tool = "select" | "rect" | "roundrect" | "ellipse" | "triangle" | "diamond" | "text" | "line" | "arrow" | "connector" | "path" | "image" | "dimension";

export const SHAPE_KINDS = ["rect", "roundrect", "ellipse", "triangle", "diamond"];
export const LINE_KINDS = ["line", "path", "connector"];
export const TEXT_KINDS = ["text", "math"];

export const toolNames: Partial<Record<Tool, string>> = {
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

export const dashToDisplay = (v: string | undefined) =>
  v === "on 4pt off 3pt" || v === "dashed" ? "dashed" : v === "on 0pt off 2pt" || v === "dotted" ? "dotted" : "solid";
export const dashToModel = (v: string) => (v === "dashed" ? "on 4pt off 3pt" : v === "dotted" ? "on 0pt off 2pt" : "");
export const arrowToDisplay = (v: string | undefined) => (v === "<-" ? "start" : v === "<->" ? "both" : v === "->" ? "end" : "none");
export const arrowToModel = (v: string) => (v === "start" ? "<-" : v === "both" ? "<->" : v === "end" ? "->" : "");
