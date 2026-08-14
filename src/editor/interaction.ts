import { anchors, connectorAnchorPoint, PX_PER_CM } from "../model";
import type { ConnectorBinding, SceneGeometry, SceneNode, ScenePoint } from "../model";

export type CanvasPoint = { x: number; y: number };

export type Drag = {
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

export type DragPreview = {
  id: string;
  mode: Drag["mode"];
  dx: number;
  dy: number;
  geometry?: Partial<SceneGeometry>;
  rotation?: number;
  marquee?: { start: CanvasPoint; current: CanvasPoint };
  snappedAnchor?: { node: SceneNode; binding: ConnectorBinding; point: ScenePoint };
};

export type SmartGuide = { orientation: "h" | "v"; coord: number; start: number; end: number };

export const editorNumber = (value: number, digits = 3) => Number(value.toFixed(digits));

export const canvasPoint = (canvas: SVGSVGElement, clientX: number, clientY: number, canvasWidth = 800, canvasHeight = 520): CanvasPoint => {
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

export const computeNodeBounds = (node: SceneNode): { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number } | undefined => {
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

export const computePathD = (rawPoints: ScenePoint[], routing: string | undefined, canvasHeight: number): string => {
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

export const previewDrag = (drag: Drag, point: CanvasPoint, nodes: SceneNode[] = [], snapEnabled = true, canvasWidth = 800, canvasHeight = 520): { preview: DragPreview; guides: SmartGuide[] } => {
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
