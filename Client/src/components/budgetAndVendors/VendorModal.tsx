import React, { useState, useEffect, useRef } from "react";
import {
  CustomModalLayout,
  FormField,
  Input,
  NumberInput,
  Dropdown,
  InputArea,
  Checkbox,
  Box,
  Button,
  Text,
  Divider,
  SectionHelper,
} from "@wix/design-system";
import { Upload, FileText, X } from "lucide-react";
import {
  VendorWithPayments,
  VendorStatus,
  BudgetCategoryWithSpending,
  VendorFile,
  Vendor,
} from "../../types";
import { VENDOR_STATUS_OPTIONS_DD } from "./BudgetDashboard";

interface VendorModalProps {
  vendor: VendorWithPayments | null;
  categories: BudgetCategoryWithSpending[];
  selectedCategoryId: number | null;
  onSave: (
    vendorData: Pick<
      Vendor,
      | "name"
      | "job_title"
      | "category_id"
      | "agreed_cost"
      | "status"
      | "phone"
      | "email"
      | "notes"
      | "is_favorite"
    >,
    files?: File[]
  ) => Promise<void>;
  onClose: () => void;
}

const VendorModal: React.FC<VendorModalProps> = ({
  vendor,
  categories,
  selectedCategoryId,
  onSave,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    job_title: "",
    category_id: selectedCategoryId || 0,
    agreed_cost: 0,
    status: "יצרנו קשר" as VendorStatus,
    phone: "",
    email: "",
    notes: "",
    is_favorite: false,
  });
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (vendor) {
      setFormData({
        name: vendor.name,
        job_title: vendor.job_title || "",
        category_id: vendor.category_id,
        agreed_cost: vendor.agreed_cost,
        status: vendor.status,
        phone: vendor.phone || "",
        email: vendor.email || "",
        notes: vendor.notes || "",
        is_favorite: vendor.is_favorite,
      });
      setNewFiles([]);
    } else if (selectedCategoryId) {
      setFormData((prev) => ({ ...prev, category_id: selectedCategoryId }));
    }
  }, [vendor, selectedCategoryId]);

  const handleSubmit = async () => {
    if (!formData.name || !formData.category_id) return;
    setIsSubmitting(true);
    try {
      await onSave(
        {
          name: formData.name,
          job_title: formData.job_title || undefined,
          category_id: formData.category_id,
          agreed_cost: formData.agreed_cost || 0,
          status: formData.status,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          notes: formData.notes || undefined,
          is_favorite: formData.is_favorite,
        },
        newFiles.length > 0 ? newFiles : undefined
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      setFileError("גודל הקובץ חייב להיות פחות מ-100MB");
      return;
    }
    setFileError(null);
    setNewFiles((prev) => [...prev, file]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeNewFile = (index: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const categoryOptions = categories.map((cat) => ({
    id: cat.category_id,
    value: cat.name,
  }));

  const isFormValid = formData.name && formData.category_id;
  const existingFiles: VendorFile[] = vendor?.files || [];

  const renderFiles = (
    fileName: string,
    fileSize: number,
    showDeleteButton: boolean = false,
    index?: number
  ) => {
    return (
      <Box
        key={fileName}
        direction="horizontal"
        verticalAlign="middle"
        gap="8px"
        padding="8px 12px"
      >
        <FileText size={16} style={{ color: "#3182ce", flexShrink: 0 }} />
        <Text size="small">{fileName}</Text>
        <Text size="tiny">{formatFileSize(fileSize)}</Text>
        {showDeleteButton && (
          <Button
            size="tiny"
            skin="light"
            onClick={() => removeNewFile(index || 0)}
          >
            <X size={14} style={{ color: "#c53030" }} />
          </Button>
        )}
      </Box>
    );
  };
  return (
    <CustomModalLayout
      title={vendor ? "עריכת ספק" : "הוספת ספק"}
      primaryButtonText={isSubmitting ? "שומר..." : vendor ? "שמור שינויים" : "הוסף ספק"}
      primaryButtonOnClick={handleSubmit}
      primaryButtonProps={{ disabled: !isFormValid || isSubmitting }}
      secondaryButtonText="ביטול"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="400px"
      className="modal"
      maxHeight="80vh"
      overflowY="auto"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="18px" paddingTop="12px">
            <FormField label="שם הספק" required>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="הכנס שם ספק"
              />
            </FormField>

            <FormField label="תפקיד">
              <Input
                value={formData.job_title}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    job_title: e.target.value,
                  }))
                }
                placeholder="לדוגמה: DJ, להקה, צלם..."
              />
            </FormField>

            <FormField label="קטגוריה" required>
              <Dropdown
                options={categoryOptions}
                selectedId={formData.category_id || undefined}
                onSelect={(option) =>
                  setFormData((prev) => ({
                    ...prev,
                    category_id: option.id as number,
                  }))
                }
                placeholder="בחר קטגוריה"
              />
            </FormField>

            <FormField label="עלות מוסכמת (₪)">
              <NumberInput
                value={formData.agreed_cost}
                onChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    agreed_cost: value ?? 0,
                  }))
                }
                min={0}
                step={100}
                placeholder="הכנס עלות"
              />
            </FormField>

            <FormField label="סטטוס">
              <Dropdown
                options={VENDOR_STATUS_OPTIONS_DD}
                selectedId={formData.status}
                onSelect={(option) =>
                  setFormData((prev) => ({
                    ...prev,
                    status: option.id as VendorStatus,
                  }))
                }
              />
            </FormField>

            <FormField label="טלפון">
              <Input
                value={formData.phone}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="הכנס מספר טלפון"
              />
            </FormField>

            <FormField label="אימייל">
              <Input
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="הכנס כתובת אימייל"
              />
            </FormField>

            <FormField label="הערות">
              <InputArea
                value={formData.notes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="הוסף הערות על הספק..."
                rows={3}
              />
            </FormField>

            <Checkbox
              checked={formData.is_favorite}
              onChange={() =>
                setFormData((prev) => ({
                  ...prev,
                  is_favorite: !prev.is_favorite,
                }))
              }
            >
              סמן כמועדף ⭐
            </Checkbox>
            <Divider />
            <Box direction="vertical" gap="12px">
              <Box
                direction="horizontal"
                align="space-between"
                verticalAlign="middle"
              >
                <Text weight="bold" size="small">
                  קבצים מצורפים
                </Text>
                <Button
                  size="tiny"
                  skin="light"
                  prefixIcon={<Upload size={14} />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  העלה קובץ
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt"
                />
              </Box>

              {existingFiles.map((file) =>
                renderFiles(file.file_name, file.file_size)
              )}

              {newFiles.map((file, index) =>
                renderFiles(file.name, file.size, true, index)
              )}

              {existingFiles.length === 0 && newFiles.length === 0 && (
                <Text secondary size="tiny">
                  אין קבצים מצורפים
                </Text>
              )}
              {fileError && (
                <SectionHelper skin="danger">{fileError}</SectionHelper>
              )}
            </Box>
          </Box>
        </div>
      }
    />
  );
};

export default VendorModal;
