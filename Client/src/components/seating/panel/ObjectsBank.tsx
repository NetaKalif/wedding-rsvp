import React from "react";
import { Button, Text } from "@wix/design-system";
import { Trash2, Plus, Pencil } from "lucide-react";
import { CustomTablePreset } from "../../../types";
import { BankEntry, DRAG_MIME, PRESET_OBJECTS, PRESET_TABLES } from "../logic";

interface ObjectsBankProps {
  customPresets: CustomTablePreset[];
  onAddPresetClick: (kind: "table" | "object") => void;
  onEditPreset: (preset: CustomTablePreset) => void;
  onDeletePreset: (presetId: number) => void;
}

const setDragPayload = (e: React.DragEvent, entry: BankEntry) => {
  // Tables get auto-numbered on drop, so their label stays null; objects carry their name
  const label = entry.kind === "object" ? entry.name : null;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: "new-item", entry, label }));
  e.dataTransfer.effectAllowed = "copy";
};

const sizeCaption = (entry: BankEntry): string => {
  const size = entry.shape === "circle"
    ? `קוטר ${entry.width_cm / 100} מ׳`
    : `${entry.width_cm / 100}×${entry.height_cm / 100} מ׳`;
  return entry.capacity != null ? `${size} · ${entry.capacity} מקומות` : size;
};

const BankCard: React.FC<{ entry: BankEntry; onEdit?: () => void; onDelete?: () => void }> = ({
  entry, onEdit, onDelete,
}) => (
  <div
    className="bank-card"
    draggable
    onDragStart={(e) => setDragPayload(e, entry)}
    title="גררו אל האולם"
  >
    <div
      className={`bank-shape bank-shape-${entry.shape} bank-shape-${entry.kind}`}
      style={entry.color ? { backgroundColor: entry.color } : undefined}
    />
    <div className="bank-card-text">
      <Text size="small" weight="bold">{entry.name}</Text>
      <Text size="tiny" secondary>{sizeCaption(entry)}</Text>
    </div>
    {onDelete && (
      <button className="bank-delete" onClick={onDelete} title="מחיקת שולחן מותאם" type="button">
        <Trash2 size={14} />
      </button>
    )}
    {onEdit && (
      <button className="bank-edit" onClick={onEdit} title="עריכת שולחן מותאם" type="button">
        <Pencil size={14} />
      </button>
    )}
  </div>
);

export const ObjectsBank: React.FC<ObjectsBankProps> = ({
  customPresets, onAddPresetClick, onEditPreset, onDeletePreset,
}) => {
  const customEntries: Array<{ entry: BankEntry; preset: CustomTablePreset }> = customPresets.map((p) => ({
    preset: p,
    entry: {
      key: `custom-${p.id}`,
      name: p.name,
      kind: p.kind,
      shape: p.shape,
      width_cm: p.width_cm,
      height_cm: p.height_cm,
      capacity: p.capacity,
    },
  }));
  const customTables = customEntries.filter(({ preset }) => preset.kind === "table");
  const customObjects = customEntries.filter(({ preset }) => preset.kind === "object");

  const renderCustom = ({ entry, preset }: { entry: BankEntry; preset: CustomTablePreset }) => (
    <BankCard
      key={entry.key}
      entry={entry}
      onEdit={() => onEditPreset(preset)}
      onDelete={() => onDeletePreset(preset.id)}
    />
  );

  return (
    <div className="objects-bank">
      <div className="bank-section">
        <Text weight="bold">שולחנות</Text>
        <div className="bank-grid">
          {PRESET_TABLES.map((entry) => <BankCard key={entry.key} entry={entry} />)}
          {customTables.map(renderCustom)}
        </div>
        <Button size="small" skin="light" prefixIcon={<Plus size={14} />} onClick={() => onAddPresetClick("table")}>
          שולחן מותאם אישית
        </Button>
      </div>

      <div className="bank-section">
        <Text weight="bold">אובייקטים</Text>
        <div className="bank-grid">
          {PRESET_OBJECTS.map((entry) => <BankCard key={entry.key} entry={entry} />)}
          {customObjects.map(renderCustom)}
        </div>
        <Button size="small" skin="light" prefixIcon={<Plus size={14} />} onClick={() => onAddPresetClick("object")}>
          אובייקט מותאם אישית
        </Button>
      </div>
    </div>
  );
};
