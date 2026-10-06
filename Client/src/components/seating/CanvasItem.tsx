import React from "react";
import { Group, Rect, Circle, Text } from "react-konva";
import Konva from "konva";
import { SeatingItem } from "../../types";
import {
  FILL_COLORS,
  fillState,
  isLabelTruncated,
  MIN_ITEM_CM,
  snapRotationDeg,
  TableOccupancy,
  tableDisplayName,
  tableTopLines,
} from "./logic";

// All coordinates are in cm — the Stage is scaled, so no px conversion here.

interface CanvasItemProps {
  item: SeatingItem;
  occupancy: TableOccupancy | null; // null for objects
  isSelected: boolean;
  isOverlapping: boolean;
  /** A guest is being dragged and this table is under the cursor. */
  isDropTarget: boolean;
  /** Canvas-wide label font size in cm (a viewer preference from localStorage). */
  fontSize: number;
  onSelect: (id: number, additive: boolean) => void;
  onOpenItem: (id: number) => void;
  /**
   * Drag lifecycle is owned by the canvas: a multi-selection is moved by the
   * transformer (which makes every attached node drag along and fire its own
   * drag events), and the canvas commits the whole gesture once.
   */
  onItemDragStart: (id: number) => void;
  onItemDragEnd: (id: number, node: Konva.Node) => void;
  /** Transform (resize/rotate) commit — single-selection only. */
  onChange: (id: number, changes: Partial<SeatingItem>) => void;
  /** Full label of a truncated item on hover (null clears the tooltip). */
  onHoverLabel: (text: string | null) => void;
}

const OBJECT_FILL = "#e8e4f5";

export const CanvasItem: React.FC<CanvasItemProps> = ({
  item, occupancy, isSelected, isOverlapping, isDropTarget,
  fontSize, onSelect, onOpenItem,
  onItemDragStart, onItemDragEnd, onChange, onHoverLabel,
}) => {
  const halfW = item.width_cm / 2;
  const halfH = item.height_cm / 2;
  const isTable = item.kind === "table";
  const labelText = isTable ? tableDisplayName(item) : item.label ?? "";
  // Table labels wrap to extra lines instead of being cut, so only object
  // labels (single-line, ellipsized) get the hover tooltip.
  const labelTruncated = !isTable && isLabelTruncated(labelText, fontSize, item.width_cm);

  const { numberLine, capacityLine } = tableTopLines(item, occupancy);
  const smallFont = Math.round(fontSize * 0.93);

  const fill = isTable
    ? FILL_COLORS[fillState(occupancy?.seated ?? 0, item.capacity)]
    : item.color ?? OBJECT_FILL;
  const stroke = isDropTarget ? "#2e7d32" : isOverlapping ? "#d84a4a" : isSelected ? "#3899ec" : "#7a7a7a";

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
    // Lock onto 0/90/180/270 when close — the transformer snaps visually,
    // this makes the committed value exact as well.
    const rotation = snapRotationDeg(node.rotation());
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

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    const evt = e.evt as MouseEvent;
    onSelect(item.id, Boolean(evt?.shiftKey || evt?.ctrlKey || evt?.metaKey));
  };

  return (
    <Group
      id={`item-${item.id}`}
      x={item.x_cm + halfW}
      y={item.y_cm + halfH}
      rotation={item.rotation_deg}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={() => onOpenItem(item.id)}
      onDblTap={() => onOpenItem(item.id)}
      onDragStart={() => onItemDragStart(item.id)}
      onDragEnd={(e) => onItemDragEnd(item.id, e.target)}
      onTransformEnd={handleTransformEnd}
      onMouseEnter={() => labelTruncated && onHoverLabel(labelText)}
      onMouseLeave={() => onHoverLabel(null)}
    >
      {item.shape === "circle" ? (
        <Circle radius={halfW} {...shapeProps} />
      ) : (
        <Rect x={-halfW} y={-halfH} width={item.width_cm} height={item.height_cm} cornerRadius={8} {...shapeProps} />
      )}
      {isTable ? (
        <>
          {/* Table number topmost, capacity under it, label below the center —
              the label wraps to extra lines instead of being cut, growing
              downward from the center. */}
          {numberLine != null && (
            <Text
              text={numberLine}
              x={-halfW}
              y={-(smallFont + 4) - (smallFont + 6)}
              width={item.width_cm}
              align="center"
              fontSize={smallFont}
              fontStyle="bold"
              fill="#333"
              wrap="none"
              listening={false}
            />
          )}
          <Text
            text={capacityLine}
            x={-halfW}
            y={-(smallFont + 4)}
            width={item.width_cm}
            align="center"
            fontSize={smallFont}
            fill={occupancy && item.capacity != null && occupancy.seated > item.capacity ? "#c62828" : "#555"}
            wrap="none"
            listening={false}
          />
          <Text
            text={labelText}
            x={-halfW}
            y={4}
            width={item.width_cm}
            align="center"
            fontSize={fontSize}
            fontStyle="bold"
            fill="#333"
            wrap="word"
            listening={false}
          />
        </>
      ) : (
        <Text
          text={labelText}
          x={-halfW}
          y={-(fontSize / 2 + 2)}
          width={item.width_cm}
          align="center"
          fontSize={fontSize}
          fontStyle="bold"
          fill="#333"
          wrap="none"
          ellipsis
          listening={false}
        />
      )}
    </Group>
  );
};
