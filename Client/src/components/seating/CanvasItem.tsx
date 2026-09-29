import React from "react";
import { Group, Rect, Circle, Text } from "react-konva";
import Konva from "konva";
import { SeatingItem } from "../../types";
import {
  FILL_COLORS,
  fillState,
  MIN_ITEM_CM,
  snapToGrid,
  TableOccupancy,
  tableDisplayName,
} from "./logic";

// All coordinates are in cm — the Stage is scaled, so no px conversion here.

interface CanvasItemProps {
  item: SeatingItem;
  occupancy: TableOccupancy | null; // null for objects
  isSelected: boolean;
  isOverlapping: boolean;
  /** A guest is being dragged and this table is under the cursor. */
  isDropTarget: boolean;
  /** Switch-guests mode: a source table is chosen and awaits a target table. */
  isSwitchMode: boolean;
  /** This item IS the switch source — greyed out and not pickable. */
  isSwitchSource: boolean;
  roomWidthCm: number;
  roomHeightCm: number;
  onSelect: (id: number) => void;
  onChange: (id: number, changes: Partial<SeatingItem>) => void;
  onOpenItem: (id: number) => void;
  onPickSwitchTarget: (tableId: number) => void;
}

const OBJECT_FILL = "#e8e4f5";

export const CanvasItem: React.FC<CanvasItemProps> = ({
  item, occupancy, isSelected, isOverlapping, isDropTarget, isSwitchMode, isSwitchSource,
  roomWidthCm, roomHeightCm, onSelect, onChange, onOpenItem, onPickSwitchTarget,
}) => {
  const halfW = item.width_cm / 2;
  const halfH = item.height_cm / 2;
  const isTable = item.kind === "table";

  const fill = isTable
    ? FILL_COLORS[fillState(occupancy?.seated ?? 0, item.capacity)]
    : item.color ?? OBJECT_FILL;
  const stroke = isDropTarget ? "#2e7d32" : isOverlapping ? "#d84a4a" : isSelected ? "#3899ec" : "#7a7a7a";

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    // node position is the item's center (see Group offset below)
    const x = snapToGrid(node.x() - halfW);
    const y = snapToGrid(node.y() - halfH);
    const clampedX = Math.min(Math.max(x, 0), Math.max(0, roomWidthCm - item.width_cm));
    const clampedY = Math.min(Math.max(y, 0), Math.max(0, roomHeightCm - item.height_cm));
    node.position({ x: clampedX + halfW, y: clampedY + halfH });
    onChange(item.id, { x_cm: clampedX, y_cm: clampedY });
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Group;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    let width = Math.max(MIN_ITEM_CM, Math.round(item.width_cm * scaleX));
    let height = Math.max(MIN_ITEM_CM, Math.round(item.height_cm * scaleY));
    if (item.shape === "circle") {
      // Bounding-box invariant: circles keep width === height (the diameter)
      width = height = Math.max(width, height);
    }
    const rotation = Math.round(node.rotation()) % 360;
    const x_cm = Math.round(node.x() - width / 2);
    const y_cm = Math.round(node.y() - height / 2);
    onChange(item.id, { width_cm: width, height_cm: height, rotation_deg: rotation, x_cm, y_cm });
  };

  const shapeProps = {
    fill: isDropTarget ? "#d4edda" : fill,
    stroke,
    strokeWidth: isSelected || isOverlapping || isDropTarget ? 6 : 3,
    dash: isOverlapping && !isDropTarget ? [12, 8] : undefined,
  };

  // In switch mode clicks pick the swap target (the source itself is inert)
  const handleClick = () => {
    if (isSwitchMode) {
      if (isTable && !isSwitchSource) onPickSwitchTarget(item.id);
      return;
    }
    onSelect(item.id);
  };

  return (
    <Group
      id={`item-${item.id}`}
      x={item.x_cm + halfW}
      y={item.y_cm + halfH}
      rotation={item.rotation_deg}
      draggable={!isSwitchMode}
      opacity={isSwitchSource ? 0.35 : 1}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={() => !isSwitchMode && onOpenItem(item.id)}
      onDblTap={() => !isSwitchMode && onOpenItem(item.id)}
      onDragStart={() => onSelect(item.id)}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      {item.shape === "circle" ? (
        <Circle radius={halfW} {...shapeProps} />
      ) : (
        <Rect x={-halfW} y={-halfH} width={item.width_cm} height={item.height_cm} cornerRadius={8} {...shapeProps} />
      )}
      <Text
        text={isTable ? tableDisplayName(item) : item.label ?? ""}
        x={-halfW}
        y={isTable ? -34 : -17}
        width={item.width_cm}
        align="center"
        fontSize={30}
        fontStyle="bold"
        fill="#333"
        listening={false}
      />
      {isTable && (
        <Text
          text={`${occupancy?.seated ?? 0}/${item.capacity ?? "?"}${occupancy?.hasTentative ? " ?" : ""}${occupancy?.hasDeclined ? " ✕" : ""}`}
          x={-halfW}
          y={4}
          width={item.width_cm}
          align="center"
          fontSize={28}
          fill={occupancy && item.capacity != null && occupancy.seated > item.capacity ? "#c62828" : "#555"}
          listening={false}
        />
      )}
    </Group>
  );
};
