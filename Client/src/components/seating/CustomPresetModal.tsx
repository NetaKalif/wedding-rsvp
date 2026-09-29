import React, { useState } from "react";
import {
  CustomModalLayout,
  FormField,
  Input,
  Dropdown,
  Box,
  SectionHelper,
} from "@wix/design-system";
import { CustomTablePreset, SeatingItemKind, SeatingShape } from "../../types";
import { MIN_ITEM_CM } from "./logic";

interface CustomPresetModalProps {
  /** When set, the modal edits this existing preset instead of creating a new one. */
  preset?: CustomTablePreset | null;
  /** Kind preselected for new presets (from the bank section the user clicked). */
  initialKind?: SeatingItemKind;
  onSave: (preset: Omit<CustomTablePreset, "id" | "user_id">) => Promise<void>;
  onClose: () => void;
}

const KIND_OPTIONS = [
  { id: "table", value: "שולחן" },
  { id: "object", value: "אובייקט (עץ, עמוד, במה...)" },
];

const SHAPE_OPTIONS = [
  { id: "circle", value: "עגול" },
  { id: "rect", value: "מלבני / מרובע" },
];

const parsePositiveInt = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const CustomPresetModal: React.FC<CustomPresetModalProps> = ({
  preset, initialKind = "table", onSave, onClose,
}) => {
  const [kind, setKind] = useState<SeatingItemKind>(preset?.kind ?? initialKind);
  const [name, setName] = useState(preset?.name ?? "");
  const [shape, setShape] = useState<SeatingShape>(preset?.shape ?? "circle");
  const [widthCm, setWidthCm] = useState(preset ? String(preset.width_cm) : "");
  const [heightCm, setHeightCm] = useState(preset ? String(preset.height_cm) : "");
  const [capacity, setCapacity] = useState(preset?.capacity != null ? String(preset.capacity) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isTable = kind === "table";
  const widthNum = parsePositiveInt(widthCm);
  const heightNum = shape === "circle" ? widthNum : parsePositiveInt(heightCm);
  const capacityNum = parsePositiveInt(capacity);
  const isValid =
    name.trim().length > 0 &&
    widthNum != null && widthNum >= MIN_ITEM_CM &&
    heightNum != null && heightNum >= MIN_ITEM_CM &&
    (!isTable || capacityNum != null);

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      // Circles store the diameter in both bounding-box columns
      await onSave({
        kind,
        name: name.trim(),
        shape,
        width_cm: widthNum as number,
        height_cm: heightNum as number,
        capacity: isTable ? (capacityNum as number) : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <CustomModalLayout
      title={preset ? "עריכת פריט מותאם" : isTable ? "שולחן מותאם אישית" : "אובייקט מותאם אישית"}
      primaryButtonText={isSaving ? "שומר..." : "שמירה"}
      primaryButtonOnClick={handleSave}
      primaryButtonProps={{ disabled: !isValid || isSaving }}
      secondaryButtonText="ביטול"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="380px"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="14px" paddingTop="6px">
            {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
            <FormField label="סוג" required>
              <Dropdown
                options={KIND_OPTIONS}
                selectedId={kind}
                onSelect={(option) => option && setKind(option.id as SeatingItemKind)}
              />
            </FormField>
            <FormField label="שם" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isTable ? "לדוגמה: אביר 16" : "לדוגמה: עץ זית"}
              />
            </FormField>
            <FormField label="צורה" required>
              <Dropdown
                options={SHAPE_OPTIONS}
                selectedId={shape}
                onSelect={(option) => option && setShape(option.id as SeatingShape)}
              />
            </FormField>
            <Box direction="horizontal" gap="10px">
              {shape === "circle" ? (
                <FormField label='קוטר (ס"מ)' required>
                  <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" placeholder="180" />
                </FormField>
              ) : (
                <>
                  <FormField label='רוחב (ס"מ)' required>
                    <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" placeholder="300" />
                  </FormField>
                  <FormField label='אורך (ס"מ)' required>
                    <Input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" placeholder="100" />
                  </FormField>
                </>
              )}
              {isTable && (
                <FormField label="מקומות" required>
                  <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" placeholder="12" />
                </FormField>
              )}
            </Box>
          </Box>
        </div>
      }
    />
  );
};
