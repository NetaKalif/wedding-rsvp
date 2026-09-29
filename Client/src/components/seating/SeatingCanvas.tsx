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
  parseDragPayload,
  tableAtPoint,
  tableDisplayName,
  tableOccupancy,
} from "./logic";

interface SeatingCanvasProps {
  layout: SeatingLayout;
  items: SeatingItem[];
  assignments: SeatingAssignment[];
  selectedItemId: number | null;
  /** When set, the canvas is in switch-guests mode: this table awaits a partner. */
  switchSourceId: number | null;
  stageRef: React.RefObject<Konva.Stage | null>;
  onSelect: (id: number | null) => void;
  onItemChange: (id: number, changes: Partial<SeatingItem>) => void;
  onDropNewItem: (entry: BankEntry, label: string | null, xCm: number, yCm: number) => void;
  onDropGuest: (eventGuestId: number, tableId: number) => void;
  onOpenItem: (id: number) => void;
  onPickSwitchTarget: (tableId: number) => void;
  onCancelSwitch: () => void;
}

interface ViewState { scale: number; x: number; y: number; }

const ZOOM_FACTOR = 1.06;

export const SeatingCanvas: React.FC<SeatingCanvasProps> = ({
  layout, items, assignments, selectedItemId, switchSourceId, stageRef,
  onSelect, onItemChange, onDropNewItem, onDropGuest, onOpenItem,
  onPickSwitchTarget, onCancelSwitch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewState | null>(null);
  // The table currently under a dragged guest — highlighted as the drop target
  const [dropTableId, setDropTableId] = useState<number | null>(null);

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

  // Attach the transformer to the selected node
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const node = selectedItemId != null ? stage.findOne(`#item-${selectedItemId}`) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedItemId, items, stageRef]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

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
        onClick={(e) => {
          if (e.target === stageRef.current || e.target.name() === "room") {
            if (switchSourceId != null) onCancelSwitch();
            else onSelect(null);
          }
        }}
        onTap={(e) => {
          if (e.target === stageRef.current || e.target.name() === "room") {
            if (switchSourceId != null) onCancelSwitch();
            else onSelect(null);
          }
        }}
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
              isSelected={item.id === selectedItemId}
              isOverlapping={overlappingIds.has(item.id)}
              isDropTarget={item.id === dropTableId}
              isSwitchMode={switchSourceId != null}
              isSwitchSource={item.id === switchSourceId}
              roomWidthCm={layout.room_width_cm}
              roomHeightCm={layout.room_height_cm}
              onSelect={onSelect}
              onChange={onItemChange}
              onOpenItem={onOpenItem}
              onPickSwitchTarget={onPickSwitchTarget}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={selectedItem?.shape === "rect"}
            keepRatio={selectedItem?.shape === "circle"}
            enabledAnchors={
              selectedItem?.shape === "circle"
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
      {switchSourceId != null && (
        <div className="switch-banner" dir="rtl" data-testid="switch-banner">
          <span>
            {`בחרו שולחן להחלפת האורחים עם ${(() => {
              const source = items.find((i) => i.id === switchSourceId);
              return source ? tableDisplayName(source) : "";
            })()}`}
          </span>
          <button type="button" onClick={onCancelSwitch}>ביטול</button>
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
