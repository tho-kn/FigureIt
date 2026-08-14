import type { SceneNode, SceneOperation, SceneStyle, SceneTextStyle } from "../model";
import { PX_PER_CM } from "../model";
import { editorNumber } from "../editor/interaction";

const paletteColors = [
  "#ffffff", "#f1f5f9", "#cbd5e1", "#64748b", "#1e293b",
  "#2b4c7e", "#3b82f6", "#0ea5e9", "#06b6d4", "#10b981",
  "#84cc16", "#eab308", "#f97316", "#ef4444", "#ec4899", "#8b5cf6"
];

export type CanvasPreset = { label: string; width: number; height: number };

export type InspectorPanelProps = {
  active: SceneNode | undefined;
  copiedStyle: SceneStyle | null;
  canvasSize: { width: number; height: number };
  selectedCount: number;
  canvasPresets: CanvasPreset[];
  onUpdate: (op: SceneOperation, label?: string) => void;
  onDelete: () => void;
  onAlignToCanvas: (axis: "h" | "v") => void;
  onMatchSize: (dim: "width" | "height" | "both") => void;
  onDuplicate: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  onSetCanvasSize: (size: { width: number; height: number }) => void;
  onSelectAll: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
};

export function InspectorPanel({
  active,
  copiedStyle,
  canvasSize,
  selectedCount,
  canvasPresets,
  onUpdate,
  onDelete,
  onAlignToCanvas,
  onMatchSize,
  onDuplicate,
  onCopyStyle,
  onPasteStyle,
  onSetCanvasSize,
  onSelectAll,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}: InspectorPanelProps) {
  return (
          <>
            {active ? (
            <>
              <label>
                Name
                <input
                  aria-label="Layer name"
                  value={active.name ?? ""}
                  onChange={(event) =>
                    onUpdate(
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
                      onUpdate({
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
                      onUpdate({
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
                      onUpdate(
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
                      onUpdate(
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
                      onUpdate({
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
                <select aria-label="Fill type" value={active.style?.gradient ? "gradient" : active.style?.fill === "none" ? "none" : "solid"} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: event.target.value === "gradient" ? { fill: undefined, gradient: active.style?.gradient ?? { start: active.style?.fill ?? "#90baff", end: "#ffffff", angle: 0 } } : event.target.value === "none" ? { fill: "none", gradient: undefined } : { fill: active.style?.fill === "none" ? "#90baff" : active.style?.fill ?? "#90baff", gradient: undefined } })}>
                  <option value="solid">Solid</option><option value="gradient">Gradient</option><option value="none">No fill</option>
                </select>
              </label>
              <label>
                Fill
                <div className="color-input-wrap">
                  <input
                    type="color"
                    className="color-picker-input"
                    aria-label="Fill color picker"
                    disabled={Boolean(active.style?.gradient) || active.style?.fill === "none"}
                    value={active.style?.fill && /^#[\da-f]{6}$/i.test(active.style.fill) ? active.style.fill : "#3b82f6"}
                    onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { fill: event.target.value } })}
                  />
                  <input
                    aria-label="Fill color"
                    disabled={Boolean(active.style?.gradient) || active.style?.fill === "none"}
                    value={active.style?.fill ?? ""}
                    onChange={(event) =>
                      onUpdate({
                        type: "update_properties",
                        id: active.id,
                        style: { fill: event.target.value },
                      })
                    }
                  />
                </div>
                {!active.style?.gradient && active.style?.fill !== "none" && (
                  <div className="color-swatches" aria-label="Fill palette swatches">
                    {paletteColors.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`color-swatch ${active.style?.fill === hex ? "active" : ""}`}
                        style={{ backgroundColor: hex }}
                        title={`Set fill ${hex}`}
                        onClick={() => onUpdate({ type: "update_properties", id: active.id, style: { fill: hex } })}
                      />
                    ))}
                  </div>
                )}
              </label>
              {active.style?.gradient && <div className="field-grid">
                <label>Gradient start<input aria-label="Gradient start" value={active.style.gradient.start} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, start: event.target.value } } })} /></label>
                <label>Gradient end<input aria-label="Gradient end" value={active.style.gradient.end} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, end: event.target.value } } })} /></label>
                <label>Angle<input aria-label="Gradient angle" type="number" value={active.style.gradient.angle} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { gradient: { ...active.style!.gradient!, angle: Number(event.target.value) } } })} /></label>
              </div>}
              <label>
                Stroke
                <div className="color-input-wrap">
                  <input
                    type="color"
                    className="color-picker-input"
                    aria-label="Stroke color picker"
                    value={active.style?.stroke && /^#[\da-f]{6}$/i.test(active.style.stroke) ? active.style.stroke : "#26334d"}
                    onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { stroke: event.target.value } })}
                  />
                  <input
                    aria-label="Stroke color"
                    value={active.style?.stroke ?? ""}
                    onChange={(event) =>
                      onUpdate({
                        type: "update_properties",
                        id: active.id,
                        style: { stroke: event.target.value },
                      })
                    }
                  />
                </div>
                <div className="color-swatches" aria-label="Stroke palette swatches">
                  {paletteColors.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={`color-swatch ${active.style?.stroke === hex ? "active" : ""}`}
                      style={{ backgroundColor: hex }}
                      title={`Set stroke ${hex}`}
                      onClick={() => onUpdate({ type: "update_properties", id: active.id, style: { stroke: hex } })}
                    />
                  ))}
                </div>
              </label>

              <label>
                Text
                <textarea
                  aria-label="Text content"
                  rows={3}
                  placeholder="Enter text (Shift+Enter for newline)..."
                  value={active.text ?? ""}
                  onChange={(event) => onUpdate({ type: "update_properties", id: active.id, text: event.target.value }, "Edit text")}
                />
              </label>
              <div className="field-grid" style={{ marginTop: 2 }}>
                <label>
                  Font
                  <select
                    aria-label="Font family"
                    value={active.style?.textStyle?.fontFamily ?? "sans"}
                    onChange={(event) =>
                      onUpdate({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          ...active.style,
                          textStyle: {
                            ...active.style?.textStyle,
                            fontFamily: event.target.value as SceneTextStyle["fontFamily"],
                          },
                        },
                      }, "Change font")
                    }
                  >
                    <option value="sans">Sans (Modern)</option>
                    <option value="serif">Serif (LaTeX)</option>
                    <option value="mono">Mono (Code)</option>
                  </select>
                </label>
                <label>
                  Size (pt)
                  <input
                    aria-label="Font size"
                    type="number"
                    min="6"
                    max="96"
                    value={active.style?.textStyle?.fontSize ?? (["text", "math"].includes(active.kind) ? 14 : 12)}
                    onChange={(event) =>
                      onUpdate({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          ...active.style,
                          textStyle: {
                            ...active.style?.textStyle,
                            fontSize: Math.max(6, Number(event.target.value)),
                          },
                        },
                      }, "Change font size")
                    }
                  />
                </label>
              </div>
              <div className="format-bar" aria-label="Text formatting">
                <button
                  type="button"
                  aria-label="Bold text"
                  className={active.style?.textStyle?.bold ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          bold: !active.style?.textStyle?.bold,
                        },
                      },
                    }, "Toggle bold")
                  }
                  title="Toggle Bold (B)"
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  aria-label="Italic text"
                  className={active.style?.textStyle?.italic ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          italic: !active.style?.textStyle?.italic,
                        },
                      },
                    }, "Toggle italic")
                  }
                  title="Toggle Italic (I)"
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  aria-label="Strikethrough text"
                  className={active.style?.textStyle?.strike ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          strike: !active.style?.textStyle?.strike,
                        },
                      },
                    }, "Toggle strikethrough")
                  }
                  title="Toggle Strikethrough (S)"
                >
                  <s>S</s>
                </button>
                <button
                  type="button"
                  aria-label="Toggle math mode"
                  className={active.text?.startsWith("$") && active.text.endsWith("$") ? "active" : ""}
                  onClick={() => {
                    const current = active.text ?? "";
                    const next = current.startsWith("$") && current.endsWith("$") ? current.slice(1, -1) : `$${current}$`;
                    onUpdate({ type: "update_properties", id: active.id, text: next }, "Toggle math mode");
                  }}
                  title="Toggle LaTeX Math Mode ($...$)"
                >
                  ∑
                </button>
                <div style={{ width: 1, height: 16, background: "#384155", margin: "0 2px" }} />
                <button
                  type="button"
                  aria-label="Text align left"
                  className={active.style?.textStyle?.align === "left" ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "left",
                        },
                      },
                    }, "Align text left")
                  }
                  title="Align Left"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                </button>
                <button
                  type="button"
                  aria-label="Text align center"
                  className={(!active.style?.textStyle?.align || active.style?.textStyle?.align === "center") ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "center",
                        },
                      },
                    }, "Align text center")
                  }
                  title="Align Center"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
                </button>
                <button
                  type="button"
                  aria-label="Text align right"
                  className={active.style?.textStyle?.align === "right" ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          align: "right",
                        },
                      },
                    }, "Align text right")
                  }
                  title="Align Right"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
                </button>
                <div style={{ width: 1, height: 16, background: "#384155", margin: "0 2px" }} />
                <button
                  type="button"
                  aria-label="Text align top"
                  className={active.style?.textStyle?.valign === "top" ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "top",
                        },
                      },
                    }, "Align text top")
                  }
                  title="Align Top"
                >
                  ⤊
                </button>
                <button
                  type="button"
                  aria-label="Text align middle"
                  className={(!active.style?.textStyle?.valign || active.style?.textStyle?.valign === "middle") ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "middle",
                        },
                      },
                    }, "Align text middle")
                  }
                  title="Align Middle"
                >
                  ⬍
                </button>
                <button
                  type="button"
                  aria-label="Text align bottom"
                  className={active.style?.textStyle?.valign === "bottom" ? "active" : ""}
                  onClick={() =>
                    onUpdate({
                      type: "update_properties",
                      id: active.id,
                      style: {
                        ...active.style,
                        textStyle: {
                          ...active.style?.textStyle,
                          valign: "bottom",
                        },
                      },
                    }, "Align text bottom")
                  }
                  title="Align Bottom"
                >
                  ⤋
                </button>
              </div>

              <div className="section-actions" style={{ marginBottom: "10px", marginTop: "10px" }}>
                <button onClick={onCopyStyle} title="Copy style (Format Painter)">Copy Style</button>
                <button disabled={!copiedStyle} onClick={onPasteStyle} title="Paste copied style">Paste Style</button>
              </div>

              <div className="field-grid">
                <label>
                  Stroke width
                  <input aria-label="Stroke width" type="number" min="0" step="0.01" value={active.style?.strokeWidth ?? 0} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { strokeWidth: Math.max(0, Number(event.target.value)) } })} />
                </label>
                <label>
                  Line pattern
                  <select
                    aria-label="Line pattern"
                    value={
                      active.style?.dash === "on 4pt off 3pt" || active.style?.dash === "dashed"
                        ? "dashed"
                        : active.style?.dash === "on 0pt off 2pt" || active.style?.dash === "dotted"
                          ? "dotted"
                          : "solid"
                    }
                    onChange={(event) =>
                      onUpdate({
                        type: "update_properties",
                        id: active.id,
                        style: {
                          dash:
                            event.target.value === "solid"
                              ? ""
                              : event.target.value === "dashed"
                                ? "on 4pt off 3pt"
                                : "on 0pt off 2pt",
                        },
                      })
                    }
                  >
                    <option value="solid">Solid (—)</option>
                    <option value="dashed">Dashed (---)</option>
                    <option value="dotted">Dotted (···)</option>
                  </select>
                </label>
              </div>
              <div className="field-grid">
                <label>
                  Opacity
                  <input aria-label="Opacity" type="number" min="0" max="1" step="0.05" value={active.style?.opacity ?? 1} onChange={(event) => onUpdate({ type: "update_properties", id: active.id, style: { opacity: Math.min(1, Math.max(0, Number(event.target.value))) } })} />
                </label>
              </div>

              {["line", "path", "connector"].includes(active.kind) && (
                <>
                <div className="field-grid">
                  <label>
                    Arrow ends
                    <select
                      aria-label="Line ends"
                      value={
                        active.style?.arrow === "<-"
                          ? "start"
                          : active.style?.arrow === "<->"
                            ? "both"
                            : active.style?.arrow === "->" || (active.kind === "connector" && active.style?.arrow === undefined)
                              ? "end"
                              : "none"
                      }
                      onChange={(event) =>
                        onUpdate({
                          type: "update_properties",
                          id: active.id,
                          style: {
                            arrow:
                              event.target.value === "start"
                                ? "<-"
                                : event.target.value === "both"
                                  ? "<->"
                                  : event.target.value === "end"
                                    ? "->"
                                    : "",
                          },
                        })
                      }
                    >
                      <option value="none">None (—)</option>
                      <option value="end">End Arrow (→)</option>
                      <option value="start">Start Arrow (←)</option>
                      <option value="both">Both Ends (↔)</option>
                    </select>
                  </label>
                  <label>
                    Routing
                    <select
                      aria-label="Connector route"
                      value={active.bindings?.routing ?? "straight"}
                      onChange={(event) =>
                        onUpdate(
                          {
                            type: "update_properties",
                            id: active.id,
                            bindings: {
                              ...active.bindings,
                              routing: event.target.value as "straight" | "elbow" | "curved",
                            },
                          },
                          "Change connector route",
                        )
                      }
                    >
                      <option value="straight">Straight (—)</option>
                      <option value="elbow">Elbow (↳)</option>
                      <option value="curved">Curved (∿)</option>
                    </select>
                  </label>
                </div>
                <div className="section-actions" style={{ marginTop: 4 }}>
                  <button
                    aria-label="Add waypoint"
                    title="Add waypoint / vertex to line or connector"
                    onClick={() => {
                      const pts = active.geometry?.points ?? [{ x: 1, y: 1 }, { x: 4, y: 3 }];
                      if (pts.length >= 2) {
                        const mid = {
                          x: editorNumber((pts[0].x + pts[1].x) / 2),
                          y: editorNumber((pts[0].y + pts[1].y) / 2),
                        };
                        const newPoints = [pts[0], mid, ...pts.slice(1)];
                        onUpdate(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: newPoints },
                          },
                          "Add waypoint to line",
                        );
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14"/></svg>
                    Add Waypoint
                  </button>
                  {active.geometry?.points && active.geometry.points.length > 2 && (
                    <button
                      aria-label="Remove waypoint"
                      title="Remove last intermediate waypoint"
                      onClick={() => {
                        const pts = active.geometry!.points!;
                        const newPoints = [pts[0], ...pts.slice(2)];
                        onUpdate(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: newPoints },
                          },
                          "Remove waypoint",
                        );
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14"/></svg>
                      Remove Waypoint
                    </button>
                  )}
                  <button
                    aria-label="Reverse direction"
                    title="Reverse start and end endpoints"
                    onClick={() => {
                      const pts = active.geometry?.points;
                      if (pts && pts.length >= 2) {
                        const rev = [...pts].reverse();
                        const bindings = active.bindings ? {
                          ...active.bindings,
                          start: active.bindings.end,
                          end: active.bindings.start,
                        } : undefined;
                        onUpdate(
                          {
                            type: "update_properties",
                            id: active.id,
                            geometry: { points: rev },
                            ...(bindings ? { bindings } : {}),
                          },
                          "Reverse line direction",
                        );
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                    Reverse
                  </button>
                </div>
              </>
              )}
              <div className="section-actions">
                <button onClick={() => onAlignToCanvas("h")} title="Center horizontally on canvas">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="2" x2="12" y2="22"/><rect x="4" y="7" width="16" height="10" rx="2"/></svg>
                  Center Canvas H
                </button>
                <button onClick={() => onAlignToCanvas("v")} title="Center vertically on canvas">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="2" y1="12" x2="22" y2="12"/><rect x="7" y="4" width="10" height="16" rx="2"/></svg>
                  Center Canvas V
                </button>
                {selectedCount > 1 && (
                  <>
                    <button onClick={() => onMatchSize("width")} title="Match width of active shape">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/></svg>
                      Match Width
                    </button>
                    <button onClick={() => onMatchSize("height")} title="Match height of active shape">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/></svg>
                      Match Height
                    </button>
                  </>
                )}
              </div>
              <div className="arrange">
                <button
                  aria-label={
                    active.locked
                      ? "Unlock selected layer"
                      : "Lock selected layer"
                  }
                  onClick={() =>
                    onUpdate({
                      type: "set_metadata",
                      id: active.id,
                      locked: !active.locked,
                    })
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d={active.locked ? "M7 11V7a5 5 0 0 1 10 0v4" : "M7 11V7a5 5 0 0 1 9.9-1"}/></svg>
                  {active.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  aria-label={
                    active.visible
                      ? "Hide selected layer"
                      : "Show selected layer"
                  }
                  onClick={() =>
                    onUpdate({
                      type: "set_metadata",
                      id: active.id,
                      visible: !active.visible,
                    })
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {active.visible ? "Hide" : "Show"}
                </button>
                <button
                  aria-label="Bring forward"
                  onClick={onBringForward}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="18 15 12 9 6 15"/></svg>
                  Forward
                </button>
                <button aria-label="Send backward" onClick={onSendBackward}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="6 9 12 15 18 9"/></svg>
                  Backward
                </button>
                <button aria-label="Bring to front" onClick={onBringToFront}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
                  To front
                </button>
                <button aria-label="Send to back" onClick={onSendToBack}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
                  To back
                </button>
                <button aria-label="Duplicate selected layer" onClick={onDuplicate}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Duplicate
                </button>
                <button aria-label="Flip horizontal" disabled={active.kind === "group"} onClick={() => onUpdate({ type: "transform", id: active.id, transform: { xScale: -active.transform.xScale } }, "Flip horizontal")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="8 4 4 8 8 12"/><line x1="4" y1="8" x2="20" y2="8"/><polyline points="16 20 20 16 16 12"/><line x1="20" y1="16" x2="4" y2="16"/></svg>
                  Flip H
                </button>
                <button aria-label="Flip vertical" disabled={active.kind === "group"} onClick={() => onUpdate({ type: "transform", id: active.id, transform: { yScale: -active.transform.yScale } }, "Flip vertical")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="4 8 8 4 12 8"/><line x1="8" y1="4" x2="8" y2="20"/><polyline points="20 16 16 20 12 16"/><line x1="16" y1="20" x2="16" y2="4"/></svg>
                  Flip V
                </button>
                <button
                  aria-label="Ungroup selected layer"
                  disabled={active.kind !== "group"}
                  onClick={() =>
                    onUpdate(
                      { type: "ungroup", id: active.id },
                      "Ungroup selection",
                    )
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="10" x2="14" y2="14"/></svg>
                  Ungroup
                </button>
                <button
                  onClick={() =>
                    onDelete()
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="canvas-inspector">
              <h3 style={{ fontSize: "12px", color: "#8a99b5", marginBottom: "8px" }}>Canvas Properties</h3>
              <label>
                Preset
                <select
                  value={`${canvasSize.width}x${canvasSize.height}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split("x").map(Number);
                    if (w && h) onSetCanvasSize({ width: w, height: h });
                  }}
                >
                  {canvasPresets.map((p) => (
                    <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label>
                  Width (px)
                  <input
                    type="number"
                    min="300"
                    max="3000"
                    step="20"
                    value={canvasSize.width}
                    onChange={(e) => onSetCanvasSize({ ...canvasSize, width: Math.max(200, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  Height (px)
                  <input
                    type="number"
                    min="200"
                    max="3000"
                    step="20"
                    value={canvasSize.height}
                    onChange={(e) => onSetCanvasSize({ ...canvasSize, height: Math.max(150, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  Width (cm)
                  <input
                    type="number"
                    step="0.5"
                    value={Number((canvasSize.width / PX_PER_CM).toFixed(1))}
                    onChange={(e) => onSetCanvasSize({ ...canvasSize, width: Math.round(Number(e.target.value) * PX_PER_CM) })}
                  />
                </label>
                <label>
                  Height (cm)
                  <input
                    type="number"
                    step="0.5"
                    value={Number((canvasSize.height / PX_PER_CM).toFixed(1))}
                    onChange={(e) => onSetCanvasSize({ ...canvasSize, height: Math.round(Number(e.target.value) * PX_PER_CM) })}
                  />
                </label>
              </div>
              <div className="button-group" style={{ marginTop: "12px" }}>
                <button onClick={() => onAlignToCanvas("h")}>Center Horizontally</button>
                <button onClick={() => onAlignToCanvas("v")}>Center Vertically</button>
                <button onClick={onSelectAll}>Select All (⌘A)</button>
              </div>
            </div>
          )}
          </>
  );
}
