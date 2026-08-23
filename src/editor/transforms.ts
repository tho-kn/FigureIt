import type { SceneGeometry, SceneNode, Transform } from "../model";

export type Pivot = { x: number; y: number };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number; centerX: number; centerY: number };

export type NodeChange = { geometry?: SceneGeometry; transform?: Partial<Transform> };

const r6 = (value: number) => Number(value.toFixed(6));

const rotatePointAbout = (point: Pivot, pivot: Pivot, degrees: number): Pivot => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: r6(pivot.x + dx * cos - dy * sin), y: r6(pivot.y + dx * sin + dy * cos) };
};

const scalePointAbout = (point: Pivot, pivot: Pivot, factor: number): Pivot => ({
  x: r6(pivot.x + (point.x - pivot.x) * factor),
  y: r6(pivot.y + (point.y - pivot.y) * factor),
});

/**
 * Union bounds over every node with usable geometry, in effective scene
 * coordinates (geometry + translate). Undefined when nothing contributes.
 */
export const selectionBounds = (nodes: SceneNode[]): Bounds | undefined => {
  let bounds: Bounds | undefined;
  for (const node of nodes) {
    if (node.kind === "raw" || !node.geometry) continue;
    const translate = node.transform.translate;
    const geometry = node.geometry;
    let candidate: Bounds | undefined;
    if (geometry.points?.length) {
      const xs = geometry.points.map((point) => point.x + translate.x);
      const ys = geometry.points.map((point) => point.y + translate.y);
      candidate = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), centerX: 0, centerY: 0 };
    } else if (geometry.x !== undefined && geometry.y !== undefined) {
      candidate = {
        minX: geometry.x + translate.x,
        minY: geometry.y + translate.y,
        maxX: geometry.x + translate.x + (geometry.width ?? 0),
        maxY: geometry.y + translate.y + (geometry.height ?? 0),
        centerX: 0,
        centerY: 0,
      };
    }
    if (!candidate) continue;
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, candidate.minX),
          minY: Math.min(bounds.minY, candidate.minY),
          maxX: Math.max(bounds.maxX, candidate.maxX),
          maxY: Math.max(bounds.maxY, candidate.maxY),
          centerX: 0,
          centerY: 0,
        }
      : candidate;
  }
  if (!bounds) return undefined;
  bounds.centerX = (bounds.minX + bounds.maxX) / 2;
  bounds.centerY = (bounds.minY + bounds.maxY) / 2;
  return bounds;
};

/** Flattens groups into their descendants because group children own the real geometry. */
export const expandTransformTargets = (nodes: SceneNode[]): SceneNode[] =>
  nodes.flatMap((node) => (node.kind === "group" ? expandTransformTargets(node.children ?? []) : [node]));

const boxCenter = (geometry: SceneGeometry, translate: Transform["translate"]): Pivot | undefined =>
  geometry.x !== undefined && geometry.y !== undefined
    ? { x: geometry.x + translate.x + (geometry.width ?? 0) / 2, y: geometry.y + translate.y + (geometry.height ?? 0) / 2 }
    : undefined;

const boxFromCenter = (center: Pivot, width: number, height: number, translate: Transform["translate"]): Pick<SceneGeometry, "x" | "y"> => ({
  x: r6(center.x - width / 2 - translate.x),
  y: r6(center.y - height / 2 - translate.y),
});

const hasBox = (geometry: SceneGeometry): boolean => geometry.points === undefined && geometry.width !== undefined && geometry.height !== undefined;

/**
 * Per-primitive coordinate transform operators.
 *
 * Every operator works on effective coordinates (geometry + translate) so the
 * result matches what the canvas renders, and returns a partial property
 * change suitable for an `update_properties` scene transaction operation.
 *
 * - Box kinds (rect, ellipse, images, sized text boxes) keep their axis-aligned
 *   box: flips mirror its position, while rotation and scaling move the box
 *   center and adjust size; rotation accumulates on the node transform so
 *   rendering and TikZ serialization stay exact.
 * - Point kinds (lines, paths, connectors, dimensions, bare text anchors) map
 *   every vertex through the operator, which keeps polylines and elbow or
 *   curved routing intact.
 */
export const flipHorizontal = (node: SceneNode, axisX: number): NodeChange => {
  const geometry = node.geometry;
  if (!geometry || node.kind === "group") return {};
  const translate = node.transform.translate;
  if (geometry.points?.length) {
    return { geometry: { points: geometry.points.map((point) => ({ x: r6(mirror(point.x + translate.x, axisX) - translate.x), y: point.y })) } };
  }
  if (geometry.x !== undefined && geometry.y !== undefined) {
    const width = geometry.width ?? 0;
    const height = geometry.height ?? 0;
    const center = boxCenter(geometry, translate);
    if (!center) return {};
    const mirroredX = hasBox(geometry)
      ? mirror(center.x, axisX)
      : mirror(geometry.x + translate.x, axisX);
    return { geometry: boxFromCenter({ x: mirroredX, y: center.y }, width, height, translate) };
  }
  return {};
};

export const flipVertical = (node: SceneNode, axisY: number): NodeChange => {
  const geometry = node.geometry;
  if (!geometry || node.kind === "group") return {};
  const translate = node.transform.translate;
  if (geometry.points?.length) {
    return { geometry: { points: geometry.points.map((point) => ({ x: point.x, y: r6(mirror(point.y + translate.y, axisY) - translate.y) })) } };
  }
  if (geometry.x !== undefined && geometry.y !== undefined) {
    const width = geometry.width ?? 0;
    const height = geometry.height ?? 0;
    const center = boxCenter(geometry, translate);
    if (!center) return {};
    const mirroredY = hasBox(geometry)
      ? mirror(center.y, axisY)
      : mirror(geometry.y + translate.y, axisY);
    return { geometry: boxFromCenter({ x: center.x, y: mirroredY }, width, height, translate) };
  }
  return {};
};

export const rotateAroundPivot = (node: SceneNode, degrees: number, pivot: Pivot): NodeChange => {
  const geometry = node.geometry;
  if (!geometry || !Number.isFinite(degrees) || node.kind === "group") return {};
  const translate = node.transform.translate;
  if (geometry.points?.length) {
    return {
      geometry: {
        points: geometry.points.map((point) => {
          const rotated = rotatePointAbout({ x: point.x + translate.x, y: point.y + translate.y }, pivot, degrees);
          return { x: r6(rotated.x - translate.x), y: r6(rotated.y - translate.y) };
        }),
      },
    };
  }
  const center = boxCenter(geometry, translate);
  if (!center) return {};
  const width = geometry.width ?? 0;
  const height = geometry.height ?? 0;
  const rotated = rotatePointAbout(center, pivot, degrees);
  return {
    geometry: boxFromCenter(rotated, width, height, translate),
    transform: { rotate: r6(node.transform.rotate + degrees) },
  };
};

export const scaleAroundPivot = (node: SceneNode, factor: number, pivot: Pivot): NodeChange => {
  const geometry = node.geometry;
  if (!geometry || !Number.isFinite(factor) || factor <= 0 || factor > 10_000 || node.kind === "group") return {};
  const translate = node.transform.translate;
  if (geometry.points?.length) {
    return {
      geometry: {
        points: geometry.points.map((point) => {
          const scaled = scalePointAbout({ x: point.x + translate.x, y: point.y + translate.y }, pivot, factor);
          return { x: r6(scaled.x - translate.x), y: r6(scaled.y - translate.y) };
        }),
      },
    };
  }
  const center = boxCenter(geometry, translate);
  if (!center) return {};
  const width = r6((geometry.width ?? 0) * factor);
  const height = r6((geometry.height ?? 0) * factor);
  const scaled = scalePointAbout(center, pivot, factor);
  return { geometry: { ...boxFromCenter(scaled, width, height, translate), width, height } };
};

const mirror = (value: number, axis: number) => 2 * axis - value;
