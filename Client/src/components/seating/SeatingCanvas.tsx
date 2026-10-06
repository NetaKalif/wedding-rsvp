import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Transformer } from "react-konva";
import Konva from "konva";
import { Maximize } from "lucide-react";
import { SeatingAssignment, SeatingItem, SeatingLayout } from "../../types";
import { CanvasItem } from "./CanvasItem";
import {
  BankEntry,
  canvasSeatStats,
  DRAG_MIME,
  findOverlappingIds,
  fitScale,
  GRID_CM,
  GUEST_DRAG_TYPE,
  MIN_ITEM_CM,
  moveItemsBy,
  parseDragPayload,
  ROTATION_SNAPS,
  ROTATION_SNAP_TOLERANCE_DEG,
  tableAtPoint,
  tableOccupancy,
  toggleSelection,
} from "./logic";

interface SeatingCanvasProps {
  layout: SeatingLayout;
  items: SeatingItem[];
  assignments: SeatingAssignment[];
  /** Multi-selection: plain click selects one, shift/ctrl-click toggles. */
  selectedItemIds: number[];
  /** Canvas-wide label font size in cm (a viewer preference from localStorage). */
  labelFontSize: number;
  stageRef: React.RefObject<Konva.Stage | null>;
  onSelectionChange: (ids: number[]) => void;
  onItemChange: (id: number, changes: Partial<SeatingItem>) => void;
  /** One drag of a multi-selection commits all moved items as one action. */
  onMoveItems: (changes: Array<{ id: number; x_cm: number; y_cm: number }>) => void;
  onDropNewItem: (entry: BankEntry, label: string | null, xCm: number, yCm: number) => void;
  onDropGuest: (eventGuestId: number, tableId: number) => void;
  onOpenItem: (id: number) => void;
}

interface ViewState { scale: number; x: number; y: number; }

const ZOOM_FACTOR = 1.06;

/**
 * One in-flight drag gesture over a (possibly multi-) selection. The Konva
 * Transformer natively drags every attached node along and makes each of them
 * fire its own dragstart/dragend — so the FIRST dragstart opens the gesture
 * (fixing the moved ids), later dragstarts are the transformer's sibling
 * startDrag calls, and the FIRST dragend commits the whole gesture once.
 */
interface DragSession {
  ids: number[];
  startTopLeft: Map<number, { x: number; y: number }>;
}

export const SeatingCanvas: React.FC<SeatingCanvasProps> = ({
  layout, items, assignments, selectedItemIds, labelFontSize, stageRef,
  onSelectionChange, onItemChange, onMoveItems, onDropNewItem, onDropGuest, onOpenItem,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const dragSession = useRef<DragSession | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewState | null>(null);
  // The table currently under a dragged guest — highlighted as the drop target
  const [dropTableId, setDropTableId] = useState<number | null>(null);
  // Full label of a hovered item whose text is cut with an ellipsis
  const [labelTooltip, setLabelTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Track the canvas area's size (70% column, so it changes with the window)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const baseScale = useMemo(
    () => fitScale(layout.room_width_cm, layout.room_height_cm, size.width, size.height),
    [layout.room_width_cm, layout.room_height_cm, size.width, size.height],
  );

  const fitToScreen = useCallback(() => {
    setView({
      scale: baseScale,
      x: (size.width - layout.room_width_cm * baseScale) / 2,
      y: (size.height - layout.room_height_cm * baseScale) / 2,
    });
  }, [baseScale, size, layout.room_width_cm, layout.room_height_cm]);

  // Fit the room on first render and whenever the room dimensions change
  useEffect(() => {
    fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseScale]);

  // Attach the transformer to every selected node
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const nodes = selectedItemIds
      .map((id) => stage.findOne(`#item-${id}`))
      .filter((n): n is Konva.Node => n != null);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedItemIds, items, stageRef]);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedItemIds.includes(i.id)),
    [items, selectedItemIds],
  );
  // Resize/rotate are single-selection tools; a multi-selection moves as a group
  const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;

  const handleItemSelect = useCallback((id: number, additive: boolean) => {
    onSelectionChange(toggleSelection(selectedItemIds, id, additive));
  }, [selectedItemIds, onSelectionChange]);

  // ==================== Group drag ====================

  const handleItemDragStart = useCallback((id: number) => {
    // Sibling dragstarts fired by the transformer's drag sync join the open gesture
    if (dragSession.current) return;
    // Dragging an unselected item selects it alone; dragging a selected one drags the group
    const ids = selectedItemIds.includes(id) ? selectedItemIds : [id];
    if (!selectedItemIds.includes(id)) onSelectionChange([id]);
    const startTopLeft = new Map<number, { x: number; y: number }>();
    for (const itemId of ids) {
      const item = items.find((i) => i.id === itemId);
      if (item) startTopLeft.set(itemId, { x: item.x_cm, y: item.y_cm });
    }
    dragSession.current = { ids, startTopLeft };
  }, [selectedItemIds, items, onSelectionChange]);

  const handleItemDragEnd = useCallback((id: number, node: Konva.Node) => {
    const session = dragSession.current;
    if (!session) return; // the gesture was already committed by another node's dragend
    const start = session.startTopLeft.get(id);
    const item = items.find((i) => i.id === id);
    dragSession.current = null;
    if (!start || !item) return;
    // The transformer moves every attached node by the same delta — derive it
    // from whichever node's dragend fires first (node position is the center).
    const dx = node.x() - item.width_cm / 2 - start.x;
    const dy = node.y() - item.height_cm / 2 - start.y;
    const changes = moveItemsBy(
      items, session.ids, dx, dy, layout.room_width_cm, layout.room_height_cm,
    );
    // Park every node on its committed (snapped + clamped) center — React can't
    // reset a node whose props didn't change, so this is done imperatively.
    for (const change of changes) {
      const item = items.find((i) => i.id === change.id);
      const moved = stageRef.current?.findOne(`#item-${change.id}`);
      if (item && moved) {
        moved.position({
          x: change.x_cm + item.width_cm / 2,
          y: change.y_cm + item.height_cm / 2,
        });
      }
    }
    onMoveItems(changes);
  }, [items, layout.room_width_cm, layout.room_height_cm, onMoveItems, stageRef]);

  // ==================== Label tooltip ====================

  const handleHoverLabel = useCallback((text: string | null) => {
    if (text == null) { setLabelTooltip(null); return; }
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    setLabelTooltip({ text, x: pointer.x, y: pointer.y });
  }, [stageRef]);

  // ==================== Zoom / HTML5 drops ====================

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage || !view) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const oldScale = view.scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(
      Math.max(direction > 0 ? oldScale * ZOOM_FACTOR : oldScale / ZOOM_FACTOR, baseScale * 0.2),
      baseScale * 6,
    );
    const mousePoint = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale };
    setView({
      scale: newScale,
      x: pointer.x - mousePoint.x * newScale,
      y: pointer.y - mousePoint.y * newScale,
    });
  }, [view, baseScale, stageRef]);

  /**
   * Live cursor feedback while dragging over the canvas. Drag *data* is
   * unreadable during dragover, but the type list isn't — a guest drag carries
   * the GUEST_DRAG_TYPE marker, and only counts as droppable over a table:
   * elsewhere the browser shows the no-drop cursor (and suppresses the drop).
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes(GUEST_DRAG_TYPE)) {
      e.dataTransfer.dropEffect = "copy"; // new bank items can land anywhere
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointersPositions(e);
    const pos = stage.getRelativePointerPosition();
    const table = pos ? tableAtPoint(items, pos.x, pos.y) : null;
    e.dataTransfer.dropEffect = table ? "move" : "none";
    setDropTableId((prev) => (table?.id ?? null) === prev ? prev : table?.id ?? null);
  }, [items, stageRef]);

  // HTML5 drop from the side panel (new items from the bank, guests onto tables)
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropTableId(null);
    const stage = stageRef.current;
    if (!stage) return;
    const payload = parseDragPayload(e.dataTransfer.getData(DRAG_MIME));
    if (!payload) return;
    stage.setPointersPositions(e);
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    if (payload.type === "new-item") {
      onDropNewItem(payload.entry, payload.label, pos.x, pos.y);
    } else {
      const table = tableAtPoint(items, pos.x, pos.y);
      if (table) onDropGuest(payload.eventGuestId, table.id);
    }
  }, [items, onDropNewItem, onDropGuest, stageRef]);

  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let x = GRID_CM; x < layout.room_width_cm; x += GRID_CM) {
      lines.push(
        <Line key={`v${x}`} points={[x, 0, x, layout.room_height_cm]} stroke="#e0e0e0" strokeWidth={1} listening={false} />,
      );
    }
    for (let y = GRID_CM; y < layout.room_height_cm; y += GRID_CM) {
      lines.push(
        <Line key={`h${y}`} points={[0, y, layout.room_width_cm, y]} stroke="#e0e0e0" strokeWidth={1} listening={false} />,
      );
    }
    return lines;
  }, [layout.room_width_cm, layout.room_height_cm]);

  const overlappingIds = useMemo(() => findOverlappingIds(items), [items]);
  const seatStats = useMemo(() => canvasSeatStats(items, assignments), [items, assignments]);

  if (!view) return <div ref={containerRef} className="seating-canvas-container" />;

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    if (e.target === stageRef.current || e.target.name() === "room") {
      onSelectionChange([]);
    }
  };

  return (
    <div
      ref={containerRef}
      className="seating-canvas-container"
      onDragOver={handleDragOver}
      onDragLeave={() => setDropTableId(null)}
      onDrop={handleDrop}
      data-testid="seating-canvas"
    >
      <Stage
        ref={stageRef as React.RefObject<Konva.Stage>}
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // Only stage drags are pans; item drags bubble here too
          if (e.target === stageRef.current) {
            setView((v) => (v ? { ...v, x: e.target.x(), y: e.target.y() } : v));
          }
        }}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          <Rect
            name="room"
            x={0}
            y={0}
            width={layout.room_width_cm}
            height={layout.room_height_cm}
            fill="#fafafa"
            stroke="#555"
            strokeWidth={4}
          />
          {gridLines}
          {items.map((item) => (
            <CanvasItem
              key={item.id}
              item={item}
              occupancy={item.kind === "table" ? tableOccupancy(item.id, assignments) : null}
              isSelected={selectedItemIds.includes(item.id)}
              isOverlapping={overlappingIds.has(item.id)}
              isDropTarget={item.id === dropTableId}
              fontSize={labelFontSize}
              onSelect={handleItemSelect}
              onOpenItem={onOpenItem}
              onItemDragStart={handleItemDragStart}
              onItemDragEnd={handleItemDragEnd}
              onChange={onItemChange}
              onHoverLabel={handleHoverLabel}
            />
          ))}
          <Transformer
            ref={transformerRef}
            resizeEnabled={singleSelected != null}
            rotateEnabled={singleSelected?.shape === "rect"}
            rotationSnaps={ROTATION_SNAPS}
            rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
            keepRatio={singleSelected?.shape === "circle"}
            enabledAnchors={
              singleSelected?.shape === "circle"
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : undefined
            }
            boundBoxFunc={(oldBox, newBox) => {
              const minPx = MIN_ITEM_CM * view.scale;
              if (Math.abs(newBox.width) < minPx || Math.abs(newBox.height) < minPx) return oldBox;
              return newBox;
            }}
          />
        </Layer>
      </Stage>
      {/* Full name of a hovered item whose label is cut with an ellipsis */}
      {labelTooltip && (
        <div
          className="canvas-label-tooltip"
          data-testid="canvas-label-tooltip"
          style={{ left: labelTooltip.x + 12, top: labelTooltip.y + 12 }}
        >
          {labelTooltip.text}
        </div>
      )}
      {/* Seat capacity stats for the whole floor plan */}
      <div className="canvas-stats" dir="rtl" data-testid="canvas-stats">
        <span>{`סה״כ מקומות: ${seatStats.totalSeats}`}</span>
        <span className="canvas-stats-divider">·</span>
        <span>{`תפוסים: ${seatStats.takenSeats}`}</span>
        <span className="canvas-stats-divider">·</span>
        <span>{`פנויים: ${seatStats.freeSeats}`}</span>
      </div>
      {/* Zoom readout: 100% = the room fits the viewport exactly */}
      <div className="zoom-control" data-testid="zoom-control">
        <button type="button" onClick={fitToScreen} title="התאמה למסך">
          <Maximize size={14} />
        </button>
        <span>{Math.round((view.scale / baseScale) * 100)}%</span>
      </div>
    </div>
  );
};
