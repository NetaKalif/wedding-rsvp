import React, { useState } from "react";
import {
  CustomModalLayout,
  FormField,
  NumberInput,
  DatePicker,
  InputArea,
  Box,
} from "@wix/design-system";

interface PaymentModalProps {
  onSave: (paymentData: {
    amount: number;
    payment_date: string;
    notes?: string;
  }) => Promise<void>;
  onClose: () => void;
}

const PaymentModal: React.FC<PaymentModalProps> = ({ onSave, onClose }) => {
  const [formData, setFormData] = useState({
    amount: 0,
    payment_date: new Date(),
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!formData.amount || !formData.payment_date) return;
    setIsSubmitting(true);
    try {
      await onSave({
        amount: formData.amount,
        payment_date: formData.payment_date.toISOString().split("T")[0],
        notes: formData.notes || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = formData.amount > 0 && formData.payment_date;

  return (
    <CustomModalLayout
      title="הוספת תשלום"
      primaryButtonText={isSubmitting ? "שומר..." : "הוסף תשלום"}
      primaryButtonOnClick={handleSubmit}
      primaryButtonProps={{ disabled: !isFormValid || isSubmitting }}
      secondaryButtonText="ביטול"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="400px"
      className="modal"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="18px" padding="12px">
            <FormField label="סכום (₪)" required>
              <NumberInput
                value={formData.amount}
                onChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    amount: value ?? 0,
                  }))
                }
                min={0}
                placeholder="הכנס סכום תשלום"
              />
            </FormField>

            <FormField label="תאריך תשלום" required>
              <DatePicker
                value={formData.payment_date}
                onChange={(date) =>
                  setFormData((prev) => ({
                    ...prev,
                    payment_date: date,
                  }))
                }
                placeholderText="בחר תאריך"
                width="100%"
              />
            </FormField>

            <FormField label="הערות">
              <InputArea
                value={formData.notes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="הוסף הערות על התשלום..."
                rows={3}
              />
            </FormField>
          </Box>
        </div>
      }
    />
  );
};

export default PaymentModal;
