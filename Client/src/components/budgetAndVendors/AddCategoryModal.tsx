import React, { useState } from "react";
import { CustomModalLayout, Box, Text } from "@wix/design-system";
import { BudgetCategoryName } from "../../types";

interface AddCategoryModalProps {
  existingCategories: BudgetCategoryName[];
  onSave: (name: BudgetCategoryName) => Promise<void>;
  onClose: () => void;
}

export const CATEGORY_ICONS: { [key in BudgetCategoryName]: string } = {
  אולם: "🏛️",
  קייטרינג: "🍽️",
  צילום: "📷",
  מוזיקה: "🎵",
  עיצוב: "🎨",
  לבוש: "👗",
  טיפוח: "💄",
  תחבורה: "🚗",
  מלון: "🏨",
  אחר: "📦",
};
const ALL_CATEGORIES = Object.keys(CATEGORY_ICONS) as BudgetCategoryName[];

const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
  existingCategories,
  onSave,
  onClose,
}) => {
  const [selectedCategory, setSelectedCategory] =
    useState<BudgetCategoryName | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableCategories = ALL_CATEGORIES.filter(
    (cat) => !existingCategories.includes(cat)
  );

  const handleSubmit = async () => {
    if (!selectedCategory) return;
    setIsSubmitting(true);
    try {
      await onSave(selectedCategory);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CustomModalLayout
      title="הוספת קטגוריה"
      primaryButtonText={isSubmitting ? "שומר..." : "הוסף קטגוריה"}
      primaryButtonOnClick={handleSubmit}
      primaryButtonProps={{ disabled: !selectedCategory || isSubmitting }}
      secondaryButtonText="ביטול"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="400px"
      className="modal"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="16px" paddingTop="12px">
            <Text weight="bold">בחר קטגוריה</Text>
            {availableCategories.length === 0 ? (
              <Text secondary>כל הקטגוריות כבר נוספו.</Text>
            ) : (
              <Box
                direction="horizontal"
                gap="10px"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                }}
              >
                {availableCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "12px 8px",
                      border:
                        selectedCategory === cat
                          ? "2px solid #3182ce"
                          : "1px solid #e2e8f0",
                      borderRadius: 8,
                      background:
                        selectedCategory === cat ? "#ebf8ff" : "#ffffff",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <span style={{ fontSize: "1.5rem" }}>
                      {CATEGORY_ICONS[cat]}
                    </span>
                    <span
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: selectedCategory === cat ? 600 : 400,
                        color: selectedCategory === cat ? "#2b6cb0" : "#4a5568",
                      }}
                    >
                      {cat}
                    </span>
                  </button>
                ))}
              </Box>
            )}
          </Box>
        </div>
      }
    />
  );
};

export default AddCategoryModal;
