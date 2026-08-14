import { describe, expect, it } from 'vitest'
import { computeNodeBounds, computePathD, editorNumber, previewDrag } from './interaction'
import type { SceneNode } from '../model'

const shape = (overrides: Partial<SceneNode> = {}): SceneNode => ({
  id: 'n1',
  kind: 'rect',
  name: 'Rect',
  visible: true,
  locked: false,
  transform: { translate: { x: 0, y: 0 }, rotate: 0, xScale: 1, yScale: 1 },
  geometry: { x: 1, y: 1, width: 3, height: 2 },
  style: { fill: '#90baff' },
  prefix: '\n',
  source: '',
  ...overrides,
})

describe('editor interaction math', () => {
  it('computes node bounds for shapes, point lines, and text anchors', () => {
    expect(computeNodeBounds(shape())).toEqual({ minX: 1, maxX: 4, minY: 1, maxY: 3, centerX: 2.5, centerY: 2 })
    const line = shape({
      kind: 'line',
      geometry: { points: [{ x: 0, y: 0 }, { x: 2, y: 4 }] },
      style: { stroke: 'black' },
    })
    expect(computeNodeBounds(line)).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 4, centerX: 1, centerY: 2 })
    const text = shape({ kind: 'text', geometry: { x: 5, y: 6 } })
    expect(computeNodeBounds(text)).toEqual({ minX: 5, maxX: 6, minY: 6, maxY: 6.5, centerX: 5.5, centerY: 6.25 })
  })

  it('builds straight, elbow, and curved path data', () => {
    const pts = [{ x: 0, y: 0 }, { x: 2, y: 1 }]
    expect(computePathD(pts, 'straight', 10)).toContain('L')
    expect(computePathD(pts, 'elbow', 10)).toContain('L 37.7952755906 10')
    const curved = computePathD(pts, 'curved', 10)
    expect(curved).toContain('C')
    expect(computePathD([pts[0]], 'straight', 10)).toBe('')
  })

  it('returns a marquee preview without guides', () => {
    const { preview, guides } = previewDrag(
      { id: 'm', pointerId: 1, start: { x: 10, y: 10 }, mode: 'marquee' },
      { x: 50, y: 60 },
    )
    expect(preview.mode).toBe('marquee')
    expect(preview.marquee).toEqual({ start: { x: 10, y: 10 }, current: { x: 50, y: 60 } })
    expect(guides).toEqual([])
  })

  it('snaps a moving shape to another shape edge', () => {
    const other = shape({ id: 'n2', geometry: { x: 8, y: 1, width: 3, height: 2 } })
    // move n1 so its right edge (4) approaches n2's left edge (8)
    const { preview, guides } = previewDrag(
      { id: 'n1', pointerId: 1, start: { x: 10, y: 10 }, mode: 'move' },
      { x: 10 + 3.999 * 37.7952755906, y: 10 },
      [shape(), other],
    )
    expect(preview.dx).toBeCloseTo(4, 5)
    expect(guides.length).toBeGreaterThan(0)
  })

  it('snaps an endpoint drag to a connection site', () => {
    const target = shape({ geometry: { x: 5, y: 1, width: 3, height: 2 } })
    // target right-edge site sits at model (8, 2); client coords are y-up flipped over a 520px canvas
    const px = 37.7952755906
    const { preview } = previewDrag(
      { id: 'line1', pointerId: 1, start: { x: 0, y: 0 }, mode: 'point', points: [{ x: 0, y: 0 }, { x: 6, y: 2 }], pointIndex: 1 },
      { x: 8 * px, y: 520 - 2 * px },
      [target],
    )
    expect(preview.snappedAnchor?.binding.anchor).toBe('right')
    expect(preview.geometry?.points).toHaveLength(2)
  })

  it.each([
    ['horizontal', { x: 4, y: 0.2 }, 0],
    ['vertical', { x: 0.2, y: 4 }, 90],
    ['diagonal', { x: 4, y: 3.6 }, 45],
  ])('snaps a line endpoint to a nearby %s angle', (_name, raw, expectedAngle) => {
    const px = 37.7952755906
    const { preview } = previewDrag(
      { id: 'line1', pointerId: 1, start: { x: 0, y: 0 }, mode: 'point', points: [{ x: 0, y: 0 }, { x: 2, y: 1 }], pointIndex: 1 },
      { x: raw.x * px, y: 520 - raw.y * px },
    )
    const point = preview.geometry?.points?.[1]
    expect(point).toBeDefined()
    expect(Math.atan2(point!.y, point!.x) * 180 / Math.PI).toBeCloseTo(expectedAngle, 5)
  })

  it('preserves the raw endpoint when snapping is bypassed', () => {
    const px = 37.7952755906
    const raw = { x: 4, y: 0.2 }
    const target = shape({ geometry: { x: 1, y: -1, width: 3, height: 2 } })
    const { preview } = previewDrag(
      { id: 'line1', pointerId: 1, start: { x: 0, y: 0 }, mode: 'point', points: [{ x: 0, y: 0 }, { x: 2, y: 1 }], pointIndex: 1 },
      { x: raw.x * px, y: 520 - raw.y * px },
      [target],
      false,
    )
    expect(preview.geometry?.points?.[1]).toEqual(raw)
    expect(preview.snappedAnchor).toBeUndefined()
  })

  it('rounds numbers to a fixed number of digits', () => {
    expect(editorNumber(1.234567)).toBe(1.235)
    expect(editorNumber(1.234567, 1)).toBe(1.2)
  })
})
