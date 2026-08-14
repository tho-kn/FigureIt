import { TOOL_LABELS, type Tool, type ToolShortcuts } from "./toolDomain";

const ToolIcon = ({ kind, size = 16 }: { kind: Tool; size?: number }) => {
  switch (kind) {
    case "select":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4l7 17 2.5-6.5L20 12 4 4z" />
        </svg>
      );
    case "rect":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
        </svg>
      );
    case "roundrect":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="6" />
        </svg>
      );
    case "ellipse":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="12" rx="9" ry="7" />
        </svg>
      );
    case "triangle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 3 22 20 2 20" />
        </svg>
      );
    case "diamond":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 22 12 12 22 2 12" />
        </svg>
      );
    case "text":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </svg>
      );
    case "line":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="20" x2="20" y2="4" />
          <circle cx="4" cy="20" r="2.5" fill="currentColor" />
          <circle cx="20" cy="4" r="2.5" fill="currentColor" />
        </svg>
      );
    case "arrow":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="19" x2="19" y2="5" />
          <polyline points="9 5 19 5 19 15" />
        </svg>
      );
    case "connector":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="4" cy="5" r="2" fill="currentColor" />
          <path d="M4 5h8a4 4 0 0 1 4 4v10" />
          <polyline points="12 15 16 19 20 15" />
        </svg>
      );
    case "path":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <circle cx="11" cy="11" r="1.5" fill="currentColor" />
        </svg>
      );
    case "image":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="2" fill="currentColor" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "dimension":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="21" x2="21" y2="3" />
          <line x1="1.5" y1="19.5" x2="4.5" y2="22.5" />
          <line x1="19.5" y1="1.5" x2="22.5" y2="4.5" />
          <line x1="9" y1="15" x2="15" y2="9" />
        </svg>
      );
  }
};

export type EditorToolbarProps = {
  tool: Tool;
  shortcuts: ToolShortcuts;
  desktop: boolean;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  texFileInputRef: React.RefObject<HTMLInputElement | null>;
  onSelectTool: (id: Tool) => void;
  onPlaceImage: (file: File | undefined) => void;
  onOpenTexFile: (file: File) => void;
};

export function EditorToolbar({
  tool,
  shortcuts,
  desktop,
  imageInputRef,
  texFileInputRef,
  onSelectTool,
  onPlaceImage,
  onOpenTexFile,
}: EditorToolbarProps) {
  return (
    <aside className="toolstrip" aria-label="Tools">
      {TOOL_LABELS.map(([id, label]) => {
        const tip = shortcuts[id] ? `${label} · ${shortcuts[id].toUpperCase()}` : label;
        return (
          <button
            key={id}
            aria-label={label}
            data-tip={tip}
            title={tip}
            className={tool === id ? "active" : ""}
            disabled={id === "image" && !desktop}
            onClick={() => onSelectTool(id)}
          >
            <ToolIcon kind={id} />
          </button>
        );
      })}
      <input ref={imageInputRef} aria-label="Image file" type="file" accept="image/*" hidden onChange={(event) => onPlaceImage(event.target.files?.[0])} />
      <input
        ref={texFileInputRef}
        aria-label="TeX file"
        type="file"
        accept=".tex,.tikz,.latex,text/plain"
        hidden
        onChange={(event) => {
          const f = event.target.files?.[0];
          if (f) onOpenTexFile(f);
          event.target.value = "";
        }}
      />
    </aside>
  );
}

const commonShortcuts = [
  ["Open project", "⌘/Ctrl O"],
  ["Save .tex", "⌘/Ctrl S"],
  ["Undo / redo", "⌘/Ctrl Z · ⇧⌘/Ctrl Z"],
  ["Copy / paste", "⌘/Ctrl C · ⌘/Ctrl V"],
  ["Duplicate", "⌘/Ctrl D"],
  ["Group / ungroup", "⌘/Ctrl G · ⇧⌘/Ctrl G"],
  ["Disable snapping while dragging", "Ctrl"],
];

export function KeyboardShortcutsDialog({
  shortcuts,
  onChange,
  onReset,
  onClose,
}: {
  shortcuts: ToolShortcuts;
  onChange: (tool: Tool, shortcut: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-dialog-title" onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <header>
          <h2 id="shortcut-dialog-title">Keyboard shortcuts</h2>
          <button aria-label="Close keyboard shortcuts" onClick={onClose}>×</button>
        </header>
        <p>Tool shortcuts use one letter or number without modifiers. Reusing a key removes it from the previous tool.</p>
        <div className="shortcut-grid">
          {TOOL_LABELS.map(([tool, label]) => (
            <label key={tool}>
              <span>{label}</span>
              <input aria-label={`${label} shortcut`} maxLength={1} value={shortcuts[tool].toUpperCase()} onChange={(event) => onChange(tool, event.target.value)} />
            </label>
          ))}
        </div>
        <h3>Common commands</h3>
        <dl className="shortcut-list">
          {commonShortcuts.map(([label, shortcut]) => <div key={label}><dt>{label}</dt><dd><kbd>{shortcut}</kbd></dd></div>)}
        </dl>
        <footer>
          <button onClick={onReset}>Reset defaults</button>
          <button className="export" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
