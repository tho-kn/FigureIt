import { useEffect, useRef, useState } from "react";

export type TransformMode = "rotate" | "scale";
export type PivotPreference = "selection" | "artboard";

export type TransformDialogProps = {
  mode: TransformMode;
  pivotPreference: PivotPreference;
  onApply: (value: number) => void;
  onPivotPreferenceChange: (preference: PivotPreference) => void;
  onClose: () => void;
};

const DEFAULTS: Record<TransformMode, string> = { rotate: "90", scale: "1.5" };

/** Modal asking for the rotation angle or scale factor and the pivot to use. */
export function TransformDialog({ mode, pivotPreference, onApply, onPivotPreferenceChange, onClose }: TransformDialogProps) {
  const [value, setValue] = useState(DEFAULTS[mode]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsed = Number(value);
  const valid =
    Number.isFinite(parsed) && (mode === "scale" ? parsed > 0 && parsed <= 10_000 : true);
  const title = mode === "rotate" ? "Rotate selection" : "Scale selection";

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transform-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && valid) onApply(parsed);
        }}
      >
        <header>
          <h2 id="transform-dialog-title">{title}</h2>
          <button aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button>
        </header>
        <label style={{ display: "block", margin: "12px 0" }}>
          <span>{mode === "rotate" ? "Angle (degrees)" : "Scale factor"}</span>
          <input
            ref={inputRef}
            aria-label={mode === "rotate" ? "Rotation angle in degrees" : "Scale factor"}
            type="number"
            step={mode === "rotate" ? 1 : 0.1}
            min={mode === "scale" ? 0.01 : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        <fieldset style={{ border: "none", margin: "12px 0", padding: 0 }}>
          <legend>Transform about</legend>
          {(
            [
              ["selection", "Selection center (bounding box)"],
              ["artboard", "Artboard center (global)"],
            ] as Array<[PivotPreference, string]>
          ).map(([option, label]) => (
            <label key={option} style={{ display: "block", margin: "4px 0" }}>
              <input
                type="radio"
                name="transform-pivot"
                checked={pivotPreference === option}
                onChange={() => onPivotPreferenceChange(option)}
              />{" "}
              {label}
            </label>
          ))}
        </fieldset>
        <footer style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button className="export" disabled={!valid} onClick={() => valid && onApply(parsed)}>
            {mode === "rotate" ? "Rotate" : "Scale"}
          </button>
        </footer>
      </section>
    </div>
  );
}
