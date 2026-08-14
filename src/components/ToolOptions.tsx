import type { SceneNode, SceneTextStyle } from "../model";
import {
  LINE_KINDS,
  SHAPE_KINDS,
  TEXT_KINDS,
  arrowToDisplay,
  arrowToModel,
  dashToDisplay,
  dashToModel,
  toolNames,
  type Tool,
} from "./toolDomain";

const alignOptions: Array<{ mode: "left" | "center" | "right" | "top" | "middle" | "bottom"; label: string; icon: React.ReactNode }> = [
  { mode: "left", label: "Align left", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="4" y1="3" x2="4" y2="21"/><rect x="4" y="6" width="14" height="4" rx="1"/><rect x="4" y="14" width="8" height="4" rx="1"/></svg> },
  { mode: "center", label: "Align center", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="3" x2="12" y2="21"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg> },
  { mode: "right", label: "Align right", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="20" y1="3" x2="20" y2="21"/><rect x="6" y="6" width="14" height="4" rx="1"/><rect x="12" y="14" width="8" height="4" rx="1"/></svg> },
  { mode: "top", label: "Align top", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="4" x2="21" y2="4"/><rect x="6" y="4" width="4" height="14" rx="1"/><rect x="14" y="4" width="4" height="8" rx="1"/></svg> },
  { mode: "middle", label: "Align middle", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="12" x2="21" y2="12"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg> },
  { mode: "bottom", label: "Align bottom", icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="6" width="4" height="14" rx="1"/><rect x="14" y="12" width="4" height="8" rx="1"/></svg> },
];

export type ToolOptionsProps = {
  tool: Tool;
  active: SceneNode | undefined;
  selectedCount: number;
  snapEnabled: boolean;
  gridEnabled: boolean;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  shapeTarget: { fill: string; stroke: string; strokeWidth: number };
  onShapeChange: (patch: { fill?: string; stroke?: string; strokeWidth?: number }) => void;
  textTarget: SceneTextStyle;
  onTextChange: (patch: SceneTextStyle) => void;
  lineTarget: { stroke: string; strokeWidth: number; dash: string; arrow: string };
  onLineChange: (patch: { stroke?: string; strokeWidth?: number; dash?: string; arrow?: string }) => void;
  onRouting: (routing: "straight" | "elbow" | "curved") => void;
  onDimensionLabel: (value: string) => void;
  onAlign: (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
};

export function ToolOptions({
  tool,
  active,
  selectedCount,
  snapEnabled,
  gridEnabled,
  onToggleSnap,
  onToggleGrid,
  shapeTarget,
  onShapeChange,
  textTarget,
  onTextChange,
  lineTarget,
  onLineChange,
  onRouting,
  onDimensionLabel,
  onAlign,
  onDistribute,
}: ToolOptionsProps) {
  const validHex = (value: string) => (/^#[\da-f]{6}$/i.test(value) ? value : "#000000");

  if (tool === "select") {
    return (
      <>
        <button
          className={`opt-toggle ${snapEnabled ? "active" : ""}`}
          onClick={onToggleSnap}
          title="Toggle smart snapping guides"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="3" x2="8" y2="3"/><line x1="16" y1="3" x2="20" y2="3"/></svg>
          Snap
        </button>
        <button
          className={`opt-toggle ${gridEnabled ? "active" : ""}`}
          onClick={onToggleGrid}
          title="Toggle grid pattern"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          Grid
        </button>
        {selectedCount >= 2 && (
          <div className="opt-group" role="group" aria-label="Align selected layers">
            {alignOptions.map((option) => (
              <button key={option.mode} aria-label={option.label} onClick={() => onAlign(option.mode)} title={option.label}>
                {option.icon}
              </button>
            ))}
            <button aria-label="Distribute horizontally" disabled={selectedCount < 3} onClick={() => onDistribute("horizontal")} title="Distribute Horizontally">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="18" y="5" width="4" height="14" rx="1"/></svg>
            </button>
            <button aria-label="Distribute vertically" disabled={selectedCount < 3} onClick={() => onDistribute("vertical")} title="Distribute Vertically">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="2" width="14" height="4" rx="1"/><rect x="5" y="10" width="14" height="4" rx="1"/><rect x="5" y="18" width="14" height="4" rx="1"/></svg>
            </button>
          </div>
        )}
        <span className="opt-hint">
          {selectedCount ? `${selectedCount} selected` : "Drag on the canvas to marquee-select; drag shapes to move them."}
        </span>
      </>
    );
  }

  if (SHAPE_KINDS.includes(tool)) {
    return (
      <>
        <label className="opt-field">
          <span>Fill</span>
          <span className="opt-color">
            <input type="color" className="color-picker-input" aria-label="Tool fill color" value={validHex(shapeTarget.fill)} onChange={(e) => onShapeChange({ fill: e.target.value })} />
            <input aria-label="Tool fill" value={shapeTarget.fill} onChange={(e) => onShapeChange({ fill: e.target.value })} />
          </span>
        </label>
        <label className="opt-field">
          <span>Stroke</span>
          <span className="opt-color">
            <input type="color" className="color-picker-input" aria-label="Tool stroke color" value={validHex(shapeTarget.stroke)} onChange={(e) => onShapeChange({ stroke: e.target.value })} />
            <input aria-label="Tool stroke" value={shapeTarget.stroke} onChange={(e) => onShapeChange({ stroke: e.target.value })} />
          </span>
        </label>
        <div className="opt-field">
          <span>Width</span>
          <input className="opt-number" aria-label="Tool stroke width" type="number" min="0" step="0.01" value={shapeTarget.strokeWidth} onChange={(e) => onShapeChange({ strokeWidth: Math.max(0, Number(e.target.value)) })} />
        </div>
        <span className="opt-hint">
          {active && SHAPE_KINDS.includes(active.kind)
            ? `Editing the selected ${toolNames[tool as keyof typeof toolNames] ?? tool}.`
            : `Options apply to the next ${toolNames[tool as keyof typeof toolNames] ?? tool}.`}
        </span>
      </>
    );
  }

  if (tool === "text") {
    const setText = (patch: SceneTextStyle) => onTextChange(patch);
    return (
      <>
        <label className="opt-field">
          <span>Font</span>
          <select aria-label="Tool font family" value={textTarget.fontFamily ?? "sans"} onChange={(e) => setText({ fontFamily: e.target.value as SceneTextStyle["fontFamily"] })}>
            <option value="sans">Sans (Modern)</option>
            <option value="serif">Serif (LaTeX)</option>
            <option value="mono">Mono (Code)</option>
          </select>
        </label>
        <label className="opt-field">
          <span>Size</span>
          <input className="opt-number" aria-label="Tool font size" type="number" min="6" max="96" value={textTarget.fontSize ?? 14} onChange={(e) => setText({ fontSize: Math.max(6, Number(e.target.value)) })} />
        </label>
        <div className="opt-group" role="group" aria-label="Tool text formatting">
          <button aria-label="Tool bold" className={textTarget.bold ? "active" : ""} onClick={() => setText({ bold: !textTarget.bold })} title="Toggle Bold"><b>B</b></button>
          <button aria-label="Tool italic" className={textTarget.italic ? "active" : ""} onClick={() => setText({ italic: !textTarget.italic })} title="Toggle Italic"><i>I</i></button>
          <button aria-label="Tool strike" className={textTarget.strike ? "active" : ""} onClick={() => setText({ strike: !textTarget.strike })} title="Toggle Strikethrough"><s>S</s></button>
          <button aria-label="Tool align left" className={textTarget.align === "left" ? "active" : ""} onClick={() => setText({ align: "left" })} title="Align Left">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
          </button>
          <button aria-label="Tool align center" className={!textTarget.align || textTarget.align === "center" ? "active" : ""} onClick={() => setText({ align: "center" })} title="Align Center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
          </button>
          <button aria-label="Tool align right" className={textTarget.align === "right" ? "active" : ""} onClick={() => setText({ align: "right" })} title="Align Right">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <span className="opt-hint">
          {active && TEXT_KINDS.includes(active.kind)
            ? "Editing the selected text element."
            : "Options apply to the next text element."}
        </span>
      </>
    );
  }

  if (tool === "line" || tool === "arrow") {
    return (
      <>
        <label className="opt-field">
          <span>Ends</span>
          <select aria-label="Tool arrow ends" value={arrowToDisplay(lineTarget.arrow)} onChange={(e) => onLineChange({ arrow: arrowToModel(e.target.value) })}>
            <option value="none">None (—)</option>
            <option value="end">End Arrow (→)</option>
            <option value="start">Start Arrow (←)</option>
            <option value="both">Both Ends (↔)</option>
          </select>
        </label>
        <label className="opt-field">
          <span>Pattern</span>
          <select aria-label="Tool line pattern" value={dashToDisplay(lineTarget.dash)} onChange={(e) => onLineChange({ dash: dashToModel(e.target.value) })}>
            <option value="solid">Solid (—)</option>
            <option value="dashed">Dashed (---)</option>
            <option value="dotted">Dotted (···)</option>
          </select>
        </label>
        <div className="opt-field">
          <span>Width</span>
          <input className="opt-number" aria-label="Tool stroke width" type="number" min="0" step="0.01" value={lineTarget.strokeWidth} onChange={(e) => onLineChange({ strokeWidth: Math.max(0, Number(e.target.value)) })} />
        </div>
        <span className="opt-hint">
          {active && LINE_KINDS.includes(active.kind)
            ? "Drag endpoints to reshape; nearby 15° angles and shape anchors snap. Hold Ctrl to bypass."
            : `Options apply to the next ${toolNames[tool as keyof typeof toolNames] ?? tool}.`}
        </span>
      </>
    );
  }

  if (tool === "connector") {
    return (
      <>
        <label className="opt-field">
          <span>Routing</span>
          <select aria-label="Tool routing" value={active?.kind === "connector" ? (active.bindings?.routing ?? "straight") : "straight"} onChange={(e) => onRouting(e.target.value as "straight" | "elbow" | "curved")}>
            <option value="straight">Straight (—)</option>
            <option value="elbow">Elbow (↳)</option>
            <option value="curved">Curved (∿)</option>
          </select>
        </label>
        <label className="opt-field">
          <span>Ends</span>
          <select aria-label="Tool arrow ends" value={arrowToDisplay(active?.kind === "connector" ? active.style?.arrow : lineTarget.arrow)} onChange={(e) => onLineChange({ arrow: arrowToModel(e.target.value) })}>
            <option value="none">None (—)</option>
            <option value="end">End Arrow (→)</option>
            <option value="start">Start Arrow (←)</option>
            <option value="both">Both Ends (↔)</option>
          </select>
        </label>
        <span className="opt-hint">Drag between connection sites; hold Ctrl while editing an endpoint to bypass snapping.</span>
      </>
    );
  }

  if (tool === "path") {
    return (
      <>
        <label className="opt-field">
          <span>Stroke</span>
          <span className="opt-color">
            <input type="color" className="color-picker-input" aria-label="Tool stroke color" value={validHex(lineTarget.stroke)} onChange={(e) => onLineChange({ stroke: e.target.value })} />
            <input aria-label="Tool stroke" value={lineTarget.stroke} onChange={(e) => onLineChange({ stroke: e.target.value })} />
          </span>
        </label>
        <div className="opt-field">
          <span>Width</span>
          <input className="opt-number" aria-label="Tool stroke width" type="number" min="0" step="0.01" value={lineTarget.strokeWidth} onChange={(e) => onLineChange({ strokeWidth: Math.max(0, Number(e.target.value)) })} />
        </div>
        <label className="opt-field">
          <span>Pattern</span>
          <select aria-label="Tool line pattern" value={dashToDisplay(lineTarget.dash)} onChange={(e) => onLineChange({ dash: dashToModel(e.target.value) })}>
            <option value="solid">Solid (—)</option>
            <option value="dashed">Dashed (---)</option>
            <option value="dotted">Dotted (···)</option>
          </select>
        </label>
        <span className="opt-hint">Pen: click to place points, double-click or Enter to finish.</span>
      </>
    );
  }

  if (tool === "dimension") {
    return (
      <>
        {active?.kind === "dimension" && (
          <label className="opt-field">
            <span>Label</span>
            <input aria-label="Tool dimension label" value={active.text ?? ""} onChange={(e) => onDimensionLabel(e.target.value)} />
          </label>
        )}
        <span className="opt-hint">
          {active?.kind === "dimension"
            ? "Edit the label, then drag its endpoints to measure."
            : "Click Dimension to add a measure line, then drag endpoints."}
        </span>
      </>
    );
  }

  return <span className="opt-hint">Pick an image file to place it on the artboard.</span>;
}
