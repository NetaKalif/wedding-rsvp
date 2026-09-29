import React, { useState } from "react";
import {
  CustomModalLayout,
  FormField,
  Input,
  Box,
} from "@wix/design-system";
import { SeatingItem } from "../../types";
import { MIN_ITEM_CM, OBJECT_COLORS } from "./logic";

interface ObjectModalProps {
  object: SeatingItem;
  /** Applies label/dimensions/color as one undoable action. */
  onApply: (changes: Partial<SeatingItem>) => void | Promise<void>;
  onClose: () => void;
}

const parsePositiveInt = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const ObjectModal: React.FC<ObjectModalProps> = ({ object, onApply, onClose }) => {
  const [label, setLabel] = useState(object.label ?? "");
  const [widthCm, setWidthCm] = useState(String(object.width_cm));
  const [heightCm, setHeightCm] = useState(String(object.height_cm));
  const [color, setColor] = useState(object.color ?? OBJECT_COLORS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const widthNum = parsePositiveInt(widthCm);
  const heightNum = object.shape === "circle" ? widthNum : parsePositiveInt(heightCm);
  const isValid =
    widthNum != null && widthNum >= MIN_ITEM_CM &&
    heightNum != null && heightNum >= MIN_ITEM_CM;

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    setIsSaving(true);
    try {
      await Promise.resolve(onApply({
        label: label.trim() || null,
        width_cm: widthNum,
        height_cm: heightNum,
        color,
      }));
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <CustomModalLayout
      title={object.label?.trim() || "עריכת אובייקט"}
      primaryButtonText={isSaving ? "שומר..." : "שמירה"}
      primaryButtonOnClick={() => void handleSave()}
      primaryButtonProps={{ disabled: !isValid || isSaving }}
      secondaryButtonText="סגירה"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="380px"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="14px" paddingTop="6px">
            <FormField label="שם">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="לדוגמה: עמדת DJ"
              />
            </FormField>

            <Box direction="horizontal" gap="10px">
              {object.shape === "circle" ? (
                <FormField label='קוטר (ס"מ)' required>
                  <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" />
                </FormField>
              ) : (
                <>
                  <FormField label='רוחב (ס"מ)' required>
                    <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" />
                  </FormField>
                  <FormField label='אורך (ס"מ)' required>
                    <Input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" />
                  </FormField>
                </>
              )}
            </Box>

            <FormField label="צבע">
              <div className="color-swatches">
                {OBJECT_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`color-swatch ${color === swatch ? "color-swatch-active" : ""}`}
                    style={{ backgroundColor: swatch }}
                    title="צבע האובייקט"
                    onClick={() => setColor(swatch)}
                  />
                ))}
                <input
                  type="color"
                  className="color-swatch color-swatch-custom"
                  title="צבע מותאם אישית"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            </FormField>
          </Box>
        </div>
      }
    />
  );
};
