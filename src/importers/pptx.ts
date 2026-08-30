import JSZip from "jszip";
import type { NodeKind, SceneNode, SceneStyle } from "../model";
import type { ImportOptions, ImportOutcome, ImportedAsset } from "./types";

const EMU_PER_CM = 360000;
const MAX_SLIDES = 30;
const MAX_ASSET_BYTES = 900_000;
const MAX_TOTAL_ASSET_BYTES = 25_000_000;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_BYTES = 100_000_000;
const MAX_XML_BYTES = 5_000_000;
const MAX_NODES = 10_000;

type Box = { x: number; y: number; w: number; h: number };
type AxisMap = { a: number; b: number };
type CoordMap = { x: AxisMap; y: AxisMap };
type Theme = Map<string, string>;
type SceneBox = { x: number; y: number; width: number; height: number };

const identityMap = (): CoordMap => ({ x: { a: 0, b: 1 }, y: { a: 0, b: 1 } });
const applyAxis = (map: AxisMap, value: number) => map.a + map.b * value;
const emuCm = (value: number) => value / EMU_PER_CM;
const r6 = (value: number) => Number(value.toFixed(6));
const expandedSize = (entry: unknown): number => (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

const kids = (el: Element | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((child) => child.localName === name) : [];
const kid = (el: Element | undefined, name: string): Element | undefined => kids(el, name)[0];
const descendant = (el: Element | undefined, name: string): Element | undefined =>
  el ? el.getElementsByTagNameNS("*", name)[0] : undefined;
const attrOf = (el: Element | undefined, name: string): string | undefined => {
  if (!el) return undefined;
  const match = el.getAttributeNames().find((attr) => attr.split(":").at(-1) === name);
  return match === undefined ? undefined : (el.getAttribute(match) ?? undefined);
};
const numAttr = (el: Element | undefined, name: string): number | undefined => {
  const raw = attrOf(el, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseXml = (text: string): Document => {
  const parsed = new DOMParser().parseFromString(text, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) throw new Error("malformed_xml");
  return parsed;
};
const xmlText = async (zip: JSZip, path: string): Promise<string> => {
  const file = zip.file(path);
  if (!file) throw new Error(`missing_${path}`);
  if (expandedSize(file) > MAX_XML_BYTES) throw new Error("xml_too_large");
  const text = await file.async("string");
  if (text.length > MAX_XML_BYTES) throw new Error("xml_too_large");
  return text;
};

const resolveSchemeToken = (token: string, theme: Theme): string | undefined => {
  const alias = token === "bg1" ? "lt1" : token === "tx1" ? "dk1" : token === "bg2" ? "lt2" : token === "tx2" ? "dk2" : token;
  return theme.get(alias);
};

const colorWithin = (container: Element | undefined, theme: Theme): string | undefined => {
  if (!container) return undefined;
  const hex = attrOf(descendant(container, "srgbClr"), "val") ?? attrOf(descendant(container, "sysClr"), "lastClr");
  if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  const token = attrOf(descendant(container, "schemeClr"), "val");
  return token ? resolveSchemeToken(token, theme) : undefined;
};

const fillOf = (spPr: Element | undefined, theme: Theme): string | undefined => {
  if (!spPr || kid(spPr, "noFill")) return undefined;
  const solid = kid(spPr, "solidFill");
  if (solid) return colorWithin(solid, theme);
  const gradient = kid(spPr, "gradFill");
  if (gradient) return colorWithin(kid(kid(gradient, "gsLst"), "gs"), theme);
  return undefined;
};

type LineEnds = { head: boolean; tail: boolean };

const lineStyleOf = (
  spPr: Element | undefined,
  theme: Theme,
): Pick<SceneStyle, "stroke" | "strokeWidth" | "dash" | "arrow"> & { ends: LineEnds } => {
  const ln = kid(spPr, "ln");
  const ends: LineEnds = {
    head: (attrOf(kid(ln, "headEnd"), "type") ?? "none") !== "none",
    tail: (attrOf(kid(ln, "tailEnd"), "type") ?? "none") !== "none",
  };
  if (!ln || kid(ln, "noFill")) return { ends };
  const dashRaw = attrOf(kid(ln, "prstDash"), "val");
  const dash =
    dashRaw && /dash/.test(dashRaw) ? "dashed" : dashRaw && /dot/.test(dashRaw) ? "dotted" : undefined;
  return {
    ...colorWithin(kid(ln, "solidFill"), theme) ? { stroke: colorWithin(kid(ln, "solidFill"), theme)! } : {},
    ...(numAttr(ln, "w") !== undefined ? { strokeWidth: emuCm(numAttr(ln, "w")!) } : {}),
    ...(dash ? { dash } : {}),
    ...(ends.head && ends.tail ? { arrow: "<->" as const } : ends.tail ? { arrow: "->" as const } : ends.head ? { arrow: "<-" as const } : {}),
    ends,
  };
};

type TextInfo = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  color?: string;
};

const textOf = (txBody: Element | undefined, theme: Theme): TextInfo | undefined => {
  if (!txBody) return undefined;
  const paragraphs = kids(txBody, "p");
  const lines = paragraphs.map((paragraph) =>
    Array.from(paragraph.children)
      .map((child) =>
        child.localName === "br" ? "\n" : child.localName === "r" || child.localName === "fld" ? (descendant(child, "t")?.textContent ?? "") : "",
      )
      .join(""),
  );
  const text = lines.join("\n");
  if (!text.trim()) return undefined;
  const runProperties = descendant(txBody, "rPr");
  const algn = attrOf(kid(kid(paragraphs[0], "pPr"), "algn") ? kid(kid(paragraphs[0], "pPr"), "algn") : undefined, "val") ?? attrOf(kid(kid(paragraphs[0], "pPr") ?? txBody, "algn"), "val");
  const anchor = attrOf(kid(txBody, "bodyPr"), "anchor");
  const fontSizeRaw = numAttr(runProperties, "sz");
  const color = colorWithin(kid(runProperties, "solidFill"), theme);
  return {
    text,
    ...(attrOf(runProperties, "b") === "1" ? { bold: true } : {}),
    ...(attrOf(runProperties, "i") === "1" ? { italic: true } : {}),
    ...(attrOf(runProperties, "strike") === "sngStrike" ? { strike: true } : {}),
    ...(fontSizeRaw !== undefined ? { fontSize: Math.round(fontSizeRaw / 100) } : {}),
    ...(algn === "ctr" ? { align: "center" as const } : algn === "r" ? { align: "right" as const } : algn === "l" ? { align: "left" as const } : {}),
    ...(anchor === "ctr" ? { valign: "middle" as const } : anchor === "b" ? { valign: "bottom" as const } : anchor === "t" ? { valign: "top" as const } : {}),
    ...(color ? { color } : {}),
  };
};

const presetKind = (prst: string): NodeKind | undefined => {
  if (["rect", "flowChartProcess", "flowChartAlternateProcess"].includes(prst)) return "rect";
  if (["roundRect", "flowChartTerminator", "flowChartDelay", "flowChartDisplay"].includes(prst)) return "roundrect";
  if (["ellipse", "flowChartConnector", "flowChartOffpageConnector"].includes(prst)) return "ellipse";
  if (["triangle", "rtTriangle", "flowChartMerge", "flowChartExtract"].includes(prst)) return "triangle";
  if (["diamond", "flowChartDecision"].includes(prst)) return "diamond";
  if (prst.startsWith("bentConnector") || prst.startsWith("curvedConnector")) return "line";
  return prst === "line" || prst === "straightConnector1" ? "line" : undefined;
};

type Frame = { box?: Box; rot?: number; flipH: boolean; flipV: boolean };

const frameOf = (xfrm: Element | undefined): Frame => {
  if (!xfrm) return { flipH: false, flipV: false };
  const x = numAttr(kid(xfrm, "off"), "x");
  const y = numAttr(kid(xfrm, "off"), "y");
  const w = numAttr(kid(xfrm, "ext"), "cx");
  const h = numAttr(kid(xfrm, "ext"), "cy");
  const rot = numAttr(xfrm, "rot");
  return {
    ...(x !== undefined && y !== undefined && w !== undefined && h !== undefined
      ? { box: { x, y, w, h } }
      : {}),
    ...(rot !== undefined && rot !== 0 ? { rot: -rot / 60000 } : {}),
    flipH: attrOf(xfrm, "flipH") === "1",
    flipV: attrOf(xfrm, "flipV") === "1",
  };
};

const childMap = (parent: CoordMap, xfrm: Element | undefined): CoordMap => {
  const frame = frameOf(xfrm);
  if (!xfrm || !frame.box) return parent;
  const chExtW = numAttr(kid(xfrm, "chExt"), "cx") ?? frame.box.w;
  const chExtH = numAttr(kid(xfrm, "chExt"), "cy") ?? frame.box.h;
  return {
    x: { a: applyAxis(parent.x, frame.box.x), b: parent.x.b * ((frame.box.w || 1) / (chExtW || 1)) },
    y: { a: applyAxis(parent.y, frame.box.y), b: parent.y.b * ((frame.box.h || 1) / (chExtH || 1)) },
  };
};

type Placer = {
  box: (absoluteEmu: Box) => SceneBox;
  point: (xEmu: number, yEmu: number) => { x: number; y: number };
};

type SlideContext = {
  slideNumber: number;
  theme: Theme;
  rels: Map<string, string>;
  zip: JSZip;
  assets: ImportedAsset[];
  assetsByPath: Map<string, ImportedAsset | null>;
  budget: { nodes: number; assetBytes: number };
  warnings: string[];
};

const mediaExtension = (path: string): string => {
  const raw = path.split(".").at(-1)?.toLowerCase() ?? "png";
  if (!["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(raw)) return "png";
  return raw === "jpeg" ? "jpg" : raw;
};

const assetForEmbed = async (context: SlideContext, embedId: string | undefined): Promise<ImportedAsset | undefined> => {
  const target = embedId ? context.rels.get(embedId) : undefined;
  if (!target) return undefined;
  const path = target.includes("media/") ? `ppt/${target.slice(target.indexOf("media/")).replace(/^\//, "")}` : undefined;
  if (path && context.assetsByPath.has(path)) return context.assetsByPath.get(path) ?? undefined;
  const file = path ? context.zip.file(path) : undefined;
  if (!file) return undefined;
  const bytes = await file.async("uint8array");
  if (bytes.byteLength > MAX_ASSET_BYTES || context.budget.assetBytes + bytes.byteLength > MAX_TOTAL_ASSET_BYTES) {
    context.warnings.push("Skipped an embedded image above the project asset size limit");
    context.assetsByPath.set(path!, null);
    return undefined;
  }
  let index = context.assets.length + 1;
  let name = `slide${context.slideNumber}-media${index}.${mediaExtension(path!)}`;
  while (context.assets.some((asset) => asset.name === name)) {
    index += 1;
    name = `slide${context.slideNumber}-media${index}.${mediaExtension(path!)}`;
  }
  const asset: ImportedAsset = { name, bytes };
  context.assets.push(asset);
  context.budget.assetBytes += bytes.byteLength;
  context.assetsByPath.set(path!, asset);
  return asset;
};

const drawingName = (element: Element, kind: "sp" | "pic" | "cxnSp" | "grpSp"): string | undefined => {
  const containerName = kind === "pic" ? "nvPicPr" : kind === "cxnSp" ? "nvCxnSpPr" : kind === "grpSp" ? "nvGrpSpPr" : "nvSpPr";
  return attrOf(kid(kid(element, containerName), "cNvPr"), "name");
};

const makeNode = (kind: NodeKind, name: string, extra: Partial<SceneNode>): SceneNode => ({
  id: crypto.randomUUID(),
  kind,
  name,
  visible: true,
  locked: false,
  transform: { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 },
  prefix: "\n",
  source: "",
  ...extra,
});

const textStyleOf = (info: NonNullable<ReturnType<typeof textOf>>): SceneStyle["textStyle"] => ({
  fontFamily: "sans",
  ...(info.fontSize !== undefined ? { fontSize: info.fontSize } : {}),
  ...(info.bold !== undefined ? { bold: info.bold } : {}),
  ...(info.italic !== undefined ? { italic: info.italic } : {}),
  ...(info.strike !== undefined ? { strike: info.strike } : {}),
  ...(info.align ? { align: info.align } : {}),
  ...(info.valign ? { valign: info.valign } : {}),
});

const rotationTransform = (rot: number | undefined) =>
  rot === undefined ? undefined : ({ translate: { x: 0, y: 0 }, rotate: rot, xScale: 1, yScale: 1 } as const);

const buildShape = async (
  element: Element,
  kindHint: "sp" | "pic" | "cxnSp",
  coordMap: CoordMap,
  context: SlideContext,
  placer: Placer,
): Promise<SceneNode | undefined> => {
  const spPr = kid(element, "spPr");
  const xfrm = kid(spPr, "xfrm");
  const frame = frameOf(xfrm);
  if (!frame.box) return undefined;
  const absolute: Box = {
    x: applyAxis(coordMap.x, frame.box.x),
    y: applyAxis(coordMap.y, frame.box.y),
    w: frame.box.w * coordMap.x.b,
    h: frame.box.h * coordMap.y.b,
  };
  const scene = placer.box(absolute);
  const prst = attrOf(kid(spPr, "prstGeom"), "prst") ?? "";
  const info = kindHint === "pic" ? undefined : textOf(kid(element, "txBody"), context.theme);
  const name = drawingName(element, kindHint);

  if (kindHint === "pic") {
    const blip = descendant(element, "blip");
    const asset = await assetForEmbed(context, attrOf(blip, "embed"));
    if (!asset) {
      context.warnings.push("Skipped an embedded image that could not be resolved");
      return undefined;
    }
    return makeNode("image", name ?? "Image", {
      geometry: { x: r6(scene.x), y: r6(scene.y), width: r6(scene.width), height: r6(scene.height) },
      image: { href: asset.name, width: r6(scene.width), height: r6(scene.height) },
    });
  }

  const style = lineStyleOf(spPr, context.theme);
  const isLinePreset = ["line", "straightConnector1"].includes(prst) || prst.startsWith("bentConnector") || prst.startsWith("curvedConnector");

  if ((kindHint === "cxnSp" || isLinePreset) && !info) {
    const start = placer.point(frame.flipH ? absolute.x + absolute.w : absolute.x, frame.flipV ? absolute.y + absolute.h : absolute.y);
    const end = placer.point(frame.flipH ? absolute.x : absolute.x + absolute.w, frame.flipV ? absolute.y : absolute.y + absolute.h);
    const arrowed = style.ends.head || style.ends.tail;
    return makeNode(arrowed ? "connector" : "line", name ?? "Line", {
      geometry: { points: [{ x: r6(start.x), y: r6(start.y) }, { x: r6(end.x), y: r6(end.y) }] },
      style: {
        stroke: style.stroke ?? "#26334d",
        ...(style.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {}),
        ...(style.dash ? { dash: style.dash } : {}),
        ...(arrowed ? { arrow: style.arrow ?? "->" } : {}),
      },
      ...(rotationTransform(frame.rot) ? { transform: rotationTransform(frame.rot)! } : {}),
    });
  }

  const shapeKind = presetKind(prst);
  if (!shapeKind && !info) {
    context.warnings.push(`Skipped unsupported PowerPoint geometry "${prst}"`);
    return undefined;
  }
  const fill = fillOf(spPr, context.theme);
  const isTextBox = !shapeKind || (!fill && !style.stroke && Boolean(info));
  return makeNode(isTextBox ? "text" : shapeKind!, name ?? (isTextBox ? "Text" : "Shape"), {
    geometry: { x: r6(scene.x), y: r6(scene.y), width: r6(scene.width), height: r6(scene.height) },
    style: {
      ...(isTextBox
        ? { ...(info?.color ? { stroke: info.color } : {}) }
        : {
            ...(fill ? { fill } : {}),
            stroke: style.stroke ?? "#26334d",
            opacity: 1,
            ...(style.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {}),
            ...(style.dash ? { dash: style.dash } : {}),
            ...(style.arrow && style.ends.head ? { arrow: style.arrow } : {}),
          }),
      ...(info ? { textStyle: textStyleOf(info) } : {}),
    },
    ...(info ? { text: info.text } : {}),
    ...(isTextBox ? {} : rotationTransform(frame.rot) ? { transform: rotationTransform(frame.rot)! } : {}),
  });
};

const walkTree = async (
  tree: Element,
  coordMap: CoordMap,
  context: SlideContext,
  placer: Placer,
): Promise<{ nodes: SceneNode[]; unsupported: number }> => {
  const nodes: SceneNode[] = [];
  const append = (node: SceneNode) => {
    context.budget.nodes += 1;
    if (context.budget.nodes > MAX_NODES) throw new Error("too_many_nodes");
    nodes.push(node);
  };
  let unsupported = 0;
  for (const child of Array.from(tree.children)) {
    if (child.localName === "sp" || child.localName === "cxnSp") {
      const built = await buildShape(child, child.localName, coordMap, context, placer);
      if (built) append(built);
    } else if (child.localName === "pic") {
      const built = await buildShape(child, "pic", coordMap, context, placer);
      if (built) append(built);
    } else if (child.localName === "grpSp") {
      const groupProperties = kid(child, "grpSpPr");
      const inner = childMap(coordMap, kid(groupProperties, "xfrm"));
      const nested = await walkTree(child, inner, context, placer);
      unsupported += nested.unsupported;
      if (nested.nodes.length >= 2) {
        const left = Math.min(...nested.nodes.map((node) => node.geometry?.x ?? 0));
        const top = Math.min(...nested.nodes.map((node) => node.geometry?.y ?? 0));
        const right = Math.max(...nested.nodes.map((node) => (node.geometry?.x ?? 0) + (node.geometry?.width ?? 0)));
        const bottom = Math.max(...nested.nodes.map((node) => (node.geometry?.y ?? 0) + (node.geometry?.height ?? 0)));
        const groupFrame = frameOf(kid(groupProperties, "xfrm"));
        append(
          makeNode("group", drawingName(child, "grpSp") ?? "Group", {
            geometry: { x: r6(left), y: r6(top), width: r6(right - left), height: r6(bottom - top) },
            children: nested.nodes,
            ...(groupFrame.rot !== undefined ? { transform: rotationTransform(groupFrame.rot)! } : {}),
          }),
        );
      } else {
        nodes.push(...nested.nodes);
      }
    } else if (child.localName === "graphicFrame") {
      unsupported += 1;
    }
  }
  return { nodes, unsupported };
};

const parseRels = (relsDocument: Document): Map<string, string> => {
  const rels = new Map<string, string>();
  for (const relationship of Array.from(relsDocument.getElementsByTagNameNS("*", "Relationship"))) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) rels.set(id, target);
  }
  return rels;
};

export const importPptx = async (file: File, options: ImportOptions): Promise<ImportOutcome> => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("archive_too_large");
  let expandedBytes = 0;
  for (const entry of entries) {
    expandedBytes += expandedSize(entry);
    if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error("archive_too_large");
  }
  const presentation = parseXml(await xmlText(zip, "ppt/presentation.xml"));
  const slideSize = descendant(presentation.documentElement, "sldSz");
  const slideWidthCm = emuCm(numAttr(slideSize, "cx") ?? 12192000);
  const slideHeightCm = emuCm(numAttr(slideSize, "cy") ?? 6858000);

  const slides = Object.keys(zip.files)
    .map((path) => ({ path, number: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1] }))
    .filter((entry): entry is { path: string; number: string } => entry.number !== undefined)
    .sort((a, b) => Number(a.number) - Number(b.number));
  if (!slides.length) throw new Error("no_slides");

  const warnings: string[] = [];
  if (slides.length > MAX_SLIDES) warnings.push(`Imported the first ${MAX_SLIDES} of ${slides.length} slides`);
  const selected = slides.slice(0, MAX_SLIDES);

  let theme: Theme = new Map();
  try {
    const themeFile = zip.file("ppt/theme/theme1.xml");
    if (themeFile) {
      theme = new Map();
      const scheme = descendant(parseXml(await themeFile.async("string")).documentElement, "clrScheme");
      for (const entry of scheme ? Array.from(scheme.children) : []) {
        const hex = attrOf(descendant(entry, "srgbClr"), "val") ?? attrOf(descendant(entry, "sysClr"), "lastClr");
        if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) theme.set(entry.localName, `#${hex}`);
      }
    }
  } catch {
    warnings.push("Slide theme colors could not be read; using fallback colors");
  }

  const gapCm = 0.5;
  const fit = Math.min(options.targetWidthCm / slideWidthCm, options.targetHeightCm / slideHeightCm);
  const scale = fit > 0 ? fit : 1;
  const bandTopY = options.targetHeightCm / 2 + (slideHeightCm * scale) / 2;

  const operations: SceneNode[] = [];
  const assets: ImportedAsset[] = [];
  const assetsByPath = new Map<string, ImportedAsset | null>();
  const budget = { nodes: 0, assetBytes: 0 };

  for (const [index, slide] of selected.entries()) {
    const context: SlideContext = {
      slideNumber: Number(slide.number),
      theme,
      rels: new Map(),
      zip,
      assets,
      assetsByPath,
      budget,
      warnings,
    };
    try {
      const relsPath = `ppt/slides/_rels/slide${slide.number}.xml.rels`;
      if (zip.file(relsPath)) context.rels = parseRels(parseXml(await xmlText(zip, relsPath)));
    } catch {
      warnings.push("Slide relationships could not be read");
    }
    const document = parseXml(await xmlText(zip, slide.path));
    const tree = descendant(document.documentElement, "spTree");
    if (!tree) continue;
    const baseX = index * (slideWidthCm * scale + gapCm);
    const placer: Placer = {
      box: (emuBox) => ({
        x: baseX + emuCm(emuBox.x) * scale,
        y: bandTopY - emuCm(emuBox.y + emuBox.h) * scale,
        width: emuCm(emuBox.w) * scale,
        height: emuCm(emuBox.h) * scale,
      }),
      point: (xEmu, yEmu) => ({ x: baseX + emuCm(xEmu) * scale, y: bandTopY - emuCm(yEmu) * scale }),
    };
    const built = await walkTree(tree, identityMap(), context, placer);
    operations.push(...built.nodes);
    if (built.unsupported) warnings.push(`Skipped ${built.unsupported} unsupported object(s) such as tables or charts`);
  }

  return {
    label: `Imported ${selected.length} slide${selected.length === 1 ? "" : "s"} from ${file.name.replace(/\.pptx$/i, "")}`,
    operations: operations.map((node) => ({ type: "insert" as const, node })),
    assets,
    warnings: [...new Set(warnings)],
  };
};
