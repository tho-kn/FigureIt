import { Fragment } from "react";
import type { SceneNode } from "../model";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

const KindIcon = ({ kind, size = 13 }: { kind: string; size?: number }) => {
  switch (kind) {
    case "rect":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="1"/></svg>;
    case "roundrect":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="5"/></svg>;
    case "ellipse":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>;
    case "triangle":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 3 21 20 3 20"/></svg>;
    case "diamond":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 12 12 22 2 12"/></svg>;
    case "text":
    case "math":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>;
    case "line":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor"/><circle cx="20" cy="4" r="2" fill="currentColor"/></svg>;
    case "arrow":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>;
    case "connector":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h8a4 4 0 0 1 4 4v8"/><polyline points="12 15 16 19 20 15"/></svg>;
    case "path":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>;
    case "image":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>;
    case "dimension":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="21" x2="21" y2="3"/><line x1="1.5" y1="19.5" x2="4.5" y2="22.5"/><line x1="19.5" y1="1.5" x2="22.5" y2="4.5"/><line x1="9" y1="15" x2="15" y2="9"/></svg>;
    case "group":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7l4-4h6l2 4"/></svg>;
    case "raw":
    default:
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  }
};

export type LayersPanelProps = {
  nodes: SceneNode[];
  selected: string[];
  collapsedGroups: Set<string>;
  search: string;
  editingNameId: string | null;
  onToggleCollapsed: (id: string) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onEditName: (id: string | null) => void;
  onToggleVisible: (id: string, solo: boolean) => void;
  onToggleLocked: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onGroup: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
};

function LayerRow({
  node,
  depth,
  ancestorVisible,
  ancestorLocked,
  selected,
  collapsedGroups,
  search,
  editingNameId,
  onToggleCollapsed,
  onSelect,
  onRename,
  onEditName,
  onToggleVisible,
  onToggleLocked,
  onMove,
  onReorder,
}: {
  node: SceneNode;
  depth: number;
  ancestorVisible: boolean;
  ancestorLocked: boolean;
  selected: string[];
  collapsedGroups: Set<string>;
  search: string;
  editingNameId: string | null;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onEditName: (id: string | null) => void;
  onToggleVisible: (id: string, solo: boolean) => void;
  onToggleLocked: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (draggedId: string, targetId: string) => void;
}) {
  const isGroup = node.kind === "group";
  const isCollapsed = collapsedGroups.has(node.id);
  const matchesSearch = !search || (node.name ?? node.kind).toLowerCase().includes(search.toLowerCase()) || node.kind.toLowerCase().includes(search.toLowerCase());

  return (
    <Fragment key={node.id}>
      {matchesSearch && (
        <div
          className={`layer ${selected.includes(node.id) ? "selected" : ""}`}
          draggable={!node.locked}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId && draggedId !== node.id) onReorder(draggedId, node.id);
          }}
          style={{
            paddingLeft: 4 + depth * 14,
            opacity: ancestorVisible && node.visible ? 1 : 0.45,
          }}
        >
          <span className="layer-drag-handle" title="Drag to reorder">⠿</span>
          {isGroup ? (
            <button
              className="layer-fold"
              aria-label={isCollapsed ? "Expand group" : "Collapse group"}
              onClick={() => onToggleCollapsed(node.id)}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span className="layer-icon"><KindIcon kind={node.kind} size={12} /></span>
          )}
          {editingNameId === node.id ? (
            <input
              className="layer-rename-input"
              autoFocus
              defaultValue={node.name ?? node.kind}
              onBlur={(e) => {
                onEditName(null);
                if (e.target.value !== (node.name ?? node.kind)) onRename(node.id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") onEditName(null);
              }}
            />
          ) : (
            <button
              className="layer-name"
              onDoubleClick={() => onEditName(node.id)}
              onClick={(event) => onSelect(node.id, event.shiftKey)}
            >
              {node.name ?? node.kind}
            </button>
          )}
          <button
            aria-label={
              node.visible
                ? `Hide ${node.name ?? node.kind}`
                : `Show ${node.name ?? node.kind}`
            }
            onClick={(e) => onToggleVisible(node.id, e.altKey)}
            title="Click to toggle, Alt+Click to solo"
          >
            {node.visible ? "◉" : "○"}
          </button>
          <button
            aria-label={
              node.locked || ancestorLocked
                ? `Unlock ${node.name ?? node.kind}`
                : `Lock ${node.name ?? node.kind}`
            }
            disabled={ancestorLocked}
            onClick={() => onToggleLocked(node.id)}
          >
            {node.locked || ancestorLocked ? "🔒" : "🔓"}
          </button>
          <div className="layer-actions">
            <button
              aria-label={`Move ${node.name ?? node.kind} up`}
              title="Move up"
              onClick={(e) => {
                e.stopPropagation();
                onMove(node.id, -1);
              }}
            >
              ▲
            </button>
            <button
              aria-label={`Move ${node.name ?? node.kind} down`}
              title="Move down"
              onClick={(e) => {
                e.stopPropagation();
                onMove(node.id, 1);
              }}
            >
              ▼
            </button>
          </div>
        </div>
      )}
      {!isCollapsed && node.children?.map((child) => (
        <LayerRow
          key={child.id}
          node={child}
          depth={depth + 1}
          ancestorVisible={ancestorVisible && node.visible}
          ancestorLocked={ancestorLocked || node.locked}
          selected={selected}
          collapsedGroups={collapsedGroups}
          search={search}
          editingNameId={editingNameId}
          onToggleCollapsed={onToggleCollapsed}
          onSelect={onSelect}
          onRename={onRename}
          onEditName={onEditName}
          onToggleVisible={onToggleVisible}
          onToggleLocked={onToggleLocked}
          onMove={onMove}
          onReorder={onReorder}
        />
      ))}
    </Fragment>
  );
}

export function LayersPanel({
  nodes,
  selected,
  collapsedGroups,
  search,
  editingNameId,
  onToggleCollapsed,
  onSearchChange,
  onSelect,
  onRename,
  onEditName,
  onToggleVisible,
  onToggleLocked,
  onMove,
  onReorder,
  onGroup,
  onAlign,
  onDistribute,
}: LayersPanelProps) {
  return (
    <>
      <div className="panel-title">
        <button
          aria-label="Group selected layers"
          disabled={selected.length < 2}
          onClick={onGroup}
        >
          Group
        </button>
      </div>
      <input
        className="layer-search"
        placeholder="Filter layers..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <div className="layer-list">
        {nodes.map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            depth={0}
            ancestorVisible={true}
            ancestorLocked={false}
            selected={selected}
            collapsedGroups={collapsedGroups}
            search={search}
            editingNameId={editingNameId}
            onToggleCollapsed={onToggleCollapsed}
            onSelect={onSelect}
            onRename={onRename}
            onEditName={onEditName}
            onToggleVisible={onToggleVisible}
            onToggleLocked={onToggleLocked}
            onMove={onMove}
            onReorder={onReorder}
          />
        ))}
      </div>
      {selected.length > 1 && (
        <div className="layer-arrange" aria-label="Align selected layers">
          <button aria-label="Align left" onClick={() => onAlign("left")} title="Align Left">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="4" y1="3" x2="4" y2="21"/><rect x="4" y="6" width="14" height="4" rx="1"/><rect x="4" y="14" width="8" height="4" rx="1"/></svg>
          </button>
          <button aria-label="Align center" onClick={() => onAlign("center")} title="Align Center (H)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="3" x2="12" y2="21"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>
          </button>
          <button aria-label="Align right" onClick={() => onAlign("right")} title="Align Right">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="20" y1="3" x2="20" y2="21"/><rect x="6" y="6" width="14" height="4" rx="1"/><rect x="12" y="14" width="8" height="4" rx="1"/></svg>
          </button>
          <button aria-label="Align top" onClick={() => onAlign("top")} title="Align Top">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="4" x2="21" y2="4"/><rect x="6" y="4" width="4" height="14" rx="1"/><rect x="14" y="4" width="4" height="8" rx="1"/></svg>
          </button>
          <button aria-label="Align middle" onClick={() => onAlign("middle")} title="Align Middle (V)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="12" x2="21" y2="12"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>
          </button>
          <button aria-label="Align bottom" onClick={() => onAlign("bottom")} title="Align Bottom">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="6" width="4" height="14" rx="1"/><rect x="14" y="12" width="4" height="8" rx="1"/></svg>
          </button>
          <button aria-label="Distribute horizontally" disabled={selected.length < 3} onClick={() => onDistribute("horizontal")} title="Distribute Horizontally">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="18" y="5" width="4" height="14" rx="1"/></svg>
          </button>
          <button aria-label="Distribute vertically" disabled={selected.length < 3} onClick={() => onDistribute("vertical")} title="Distribute Vertically">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="2" width="14" height="4" rx="1"/><rect x="5" y="10" width="14" height="4" rx="1"/><rect x="5" y="18" width="14" height="4" rx="1"/></svg>
          </button>
        </div>
      )}
    </>
  );
}
