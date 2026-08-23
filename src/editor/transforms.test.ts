import { describe, expect, it } from "vitest";
import type { SceneNode } from "../model";
import {
  expandTransformTargets,
  flipHorizontal,
  flipVertical,
  rotateAroundPivot,
  scaleAroundPivot,
  selectionBounds,
} from "./transforms";

let nextId = 0;
const node = (overrides: Partial<SceneNode>): SceneNode => ({
  id: `node-${nextId++}`,
  kind: "rect",
  visible: true,
  locked: false,
  transform: { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 },
  prefix: "",
  source: "",
  ...overrides,
});

const boxNode = (x: number, y: number, width = 2, height = 1) =>
  node({ geometry: { x, y, width, height } });

const lineNode = (points: Array<[number, number]>) =>
  node({ kind: "line", geometry: { points: points.map(([x, y]) => ({ x, y })) } });

describe("selectionBounds", () => {
  it("unions boxes and point lists", () => {
    const bounds = selectionBounds([boxNode(0, 0), lineNode([[5, 5], [6, 6]])]);
    expect(bounds).toMatchObject({ minX: 0, minY: 0, maxX: 6, maxY: 6, centerX: 3, centerY: 3 });
  });

  it("includes translate and skips raw nodes", () => {
    const shifted = boxNode(1, 1);
    shifted.transform.translate = { x: 1, y: 2 };
    const bounds = selectionBounds([node({ kind: "raw", source: "% junk" }), shifted]);
    expect(bounds).toMatchObject({ minX: 2, minY: 3, maxX: 4, maxY: 4 });
  });

  it("returns undefined without usable geometry", () => {
    expect(selectionBounds([node({ kind: "raw", source: "x" })])).toBeUndefined();
  });
});

describe("expandTransformTargets", () => {
  it("flattens groups to their descendants", () => {
    const child = boxNode(0, 0);
    const group = node({ kind: "group", children: [child, boxNode(3, 3)] });
    expect(expandTransformTargets([group])).toHaveLength(2);
  });
});

describe("flipHorizontal", () => {
  it("mirrors a box about the axis through its own center, leaving it unchanged", () => {
    const target = boxNode(2, 3);
    const change = flipHorizontal(target, 3);
    expect(change.geometry?.x).toBeCloseTo(2);
  });

  it("mirrors a box across an external axis", () => {
    const change = flipHorizontal(boxNode(4, 0, 2, 1), 0);
    expect(change.geometry?.x).toBe(-6);
    expect(change.geometry?.width).toBeUndefined();
  });

  it("mirrors every vertex of point kinds including translate", () => {
    const target = lineNode([[1, 1], [3, 1]]);
    target.transform.translate = { x: 10, y: 0 };
    const change = flipHorizontal(target, 0);
    // Effective vertices sit at 11..13; mirrored to -11..-13 and stored
    // relative to the +10 translate.
    expect(change.geometry?.points).toEqual([
      { x: -21, y: 1 },
      { x: -23, y: 1 },
    ]);
  });
});

describe("flipVertical", () => {
  it("mirrors y coordinates about the axis", () => {
    const change = flipVertical(lineNode([[0, 2], [1, 5]]), 2);
    expect(change.geometry?.points).toEqual([
      { x: 0, y: 2 },
      { x: 1, y: -1 },
    ]);
  });
});

describe("rotateAroundPivot", () => {
  it("rotates point vertices exactly and leaves the transform alone", () => {
    const change = rotateAroundPivot(lineNode([[1, 0], [2, 0]]), 90, { x: 0, y: 0 });
    expect(change.geometry?.points).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ]);
    expect(change.transform).toBeUndefined();
  });

  it("moves a box center on the circle and accumulates rotation", () => {
    const target = boxNode(4, -0.5, 2, 1); // center (5, 0)
    const change = rotateAroundPivot(target, 90, { x: 0, y: 0 }); // center -> (0, 5)
    expect(change.geometry?.x).toBeCloseTo(-1, 3);
    expect(change.geometry?.y).toBeCloseTo(4.5, 3);
    expect(change.geometry?.width).toBeUndefined(); // size preserved via merge
    expect(change.transform?.rotate).toBe(90);
  });

  it("keeps an existing rotation when accumulating", () => {
    const target = boxNode(0, 0);
    target.transform.rotate = 30;
    const change = rotateAroundPivot(target, 15, { x: 1, y: 1 });
    expect(change.transform?.rotate).toBe(45);
  });

  it("rejects non-finite degrees", () => {
    expect(rotateAroundPivot(boxNode(0, 0), Number.NaN, { x: 0, y: 0 })).toEqual({});
  });
});

describe("scaleAroundPivot", () => {
  it("scales point vertices away from the pivot", () => {
    const change = scaleAroundPivot(lineNode([[1, 1], [2, 1]]), 2, { x: 0, y: 0 });
    expect(change.geometry?.points).toEqual([
      { x: 2, y: 2 },
      { x: 4, y: 2 },
    ]);
  });

  it("scales box size and position about the artboard pivot", () => {
    const target = boxNode(1, 1, 2, 1); // center (2, 1.5)
    const change = scaleAroundPivot(target, 3, { x: 0, y: 0 }); // center -> (6, 4.5)
    expect(change.geometry?.width).toBe(6);
    expect(change.geometry?.height).toBe(3);
    expect(change.geometry?.x).toBeCloseTo(3, 3);
    expect(change.geometry?.y).toBeCloseTo(3, 3);
  });

  it("scaling about the selection pivot keeps the box in place", () => {
    const target = boxNode(2, 3, 2, 1); // center (3, 3.5)
    const bounds = selectionBounds([target])!;
    const change = scaleAroundPivot(target, 2, { x: bounds.centerX, y: bounds.centerY });
    expect(change.geometry?.x).toBeCloseTo(1, 3);
    expect(change.geometry?.y).toBeCloseTo(2.5, 3);
    expect(change.geometry?.width).toBe(4);
  });

  it("rejects invalid factors", () => {
    expect(scaleAroundPivot(boxNode(0, 0), 0, { x: 0, y: 0 })).toEqual({});
    expect(scaleAroundPivot(boxNode(0, 0), -2, { x: 0, y: 0 })).toEqual({});
  });
});
