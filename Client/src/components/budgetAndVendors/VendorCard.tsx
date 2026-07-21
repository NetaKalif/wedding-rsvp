import React, { useState } from "react";
import {
  Text,
  Button,
  Box,
  Badge,
  IconButton,
  Modal,
} from "@wix/design-system";
import {
  Star,
  Edit2,
  Trash2,
  Plus,
  Phone,
  Mail,
  ChevronDown,
  ChevronRight,
  X,
  FileText,
  Download,
  Paperclip,
} from "lucide-react";
import { Payment, VendorStatus, VendorWithPayments } from "../../types";
import { useAuth } from "../../hooks/useAuth";
import { useAppData } from "../../hooks/useAppData";
import { useConfirm } from "../../hooks/useConfirm";
import { httpRequests } from "../../httpClient";
import PaymentModal from "./PaymentModal";

interface VendorCardProps {
  vendor: VendorWithPayments;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onDownloadFile: (fileId: number) => void;
  onDeleteFile: (fileId: number) => void;
  formatCurrency: (amount: number) => string;
  isHighlighted?: boolean;
}

const toNum = (v: number | string) => (typeof v === "string" ? parseFloat(v) : v);

const calcVendorStatus = (totalPaid: number, agreedCost: number, currentStatus: VendorStatus): VendorStatus => {
  if (!(["שולם", "שולם חלקית", "הוזמן"] as VendorStatus[]).includes(currentStatus)) return currentStatus;
  if (totalPaid >= agreedCost && agreedCost > 0) return "שולם";
  if (totalPaid > 0) return "שולם חלקית";
  return "הוזמן";
};

const VendorCard: React.FC<VendorCardProps> = ({
  vendor,
  onEdit,
  onDelete,
  onToggleFavorite,
  onDownloadFile,
  onDeleteFile,
  formatCurrency,
  isHighlighted,
}) => {
  const { user } = useAuth();
  const { setBudgetOverview, refreshBudget } = useAppData();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showPayments, setShowPayments] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const applyPaymentUpdate = (updatedPayments: Payment[]) => {
    const newTotalPaid = updatedPayments.reduce((sum, p) => sum + toNum(p.amount), 0);
    const newStatus = calcVendorStatus(newTotalPaid, vendor.agreed_cost, vendor.status);

    setBudgetOverview((prev) => {
      if (!prev) return prev;
      const updatedCats = prev.categories.map((cat) => ({
        ...cat,
        vendors: cat.vendors.map((v) => {
          if (v.vendor_id !== vendor.vendor_id) return v;
          return {
            ...v,
            payments: updatedPayments,
            total_paid: newTotalPaid,
            remaining_balance: v.agreed_cost - newTotalPaid,
            status: newStatus,
          };
        }),
        actual_spending: cat.vendors
          .map((v) => (v.vendor_id === vendor.vendor_id ? newTotalPaid : v.total_paid))
          .reduce((sum, n) => sum + n, 0),
      }));
      return {
        ...prev,
        categories: updatedCats,
        total_expenses: updatedCats.reduce((sum, c) => sum + c.actual_spending, 0),
      };
    });
  };

  const handleSavePayment = async (paymentData: { amount: number; payment_date: string; notes?: string }) => {
    if (!user) return;
    try {
      const newPayment = await httpRequests.addPayment(
        vendor.vendor_id,
        paymentData.amount,
        paymentData.payment_date,
        paymentData.notes
      );
      setShowPaymentModal(false);
      applyPaymentUpdate([...vendor.payments, { ...newPayment, amount: toNum(newPayment.amount) }]);
    } catch (error) {
      console.error("Error adding payment:", error);
      refreshBudget();
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    if (!user) return;
    const payment = vendor.payments.find((p) => p.payment_id === paymentId);
    const ok = await confirm({ message: `למחוק תשלום של ${payment ? toNum(payment.amount).toLocaleString("he-IL") + " ₪" : ""}?` });
    if (!ok) return;
    // Optimistic remove
    const optimisticPayments = vendor.payments.filter((p) => p.payment_id !== paymentId);
    applyPaymentUpdate(optimisticPayments);
    try {
      await httpRequests.deletePayment(paymentId);
    } catch (error) {
      console.error("Error deleting payment:", error);
      refreshBudget();
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const files = vendor.files || [];

  const getStatusSkin = (status: string) => {
    switch (status) {
      case "שולם": return "neutralSuccess";
      case "שולם חלקית": return "warningLight";
      case "יצרנו קשר": return "neutralDanger";
      default: return "neutralLight";
    }
  };

  return (
    <Box
      className={`vendor-card ${vendor.is_favorite ? "favorite" : ""} ${isHighlighted ? "highlighted" : ""}`}
      dataHook={`vendor-${vendor.vendor_id}`}
      direction="vertical"
      gap="8px"
    >
      <Box direction="horizontal" align="space-between" verticalAlign="middle">
        <Box direction="horizontal" verticalAlign="middle" gap="6px">
          <IconButton
            size="tiny"
            skin="transparent"
            onClick={onToggleFavorite}
            aria-label={vendor.is_favorite ? "הסר ממועדפים" : "הוסף למועדפים"}
          >
            <Star
              size={16}
              fill={vendor.is_favorite ? "#f6ad55" : "none"}
              style={{ color: vendor.is_favorite ? "#f6ad55" : "#a0aec0" }}
            />
          </IconButton>
          <Text weight="bold">
            {vendor.name}
            {vendor.job_title && (
              <Text size="tiny" secondary style={{ marginRight: 6, fontWeight: 400 }}>
                ({vendor.job_title})
              </Text>
            )}
          </Text>
        </Box>
        <Badge size="tiny" skin={getStatusSkin(vendor.status)}>
          {vendor.status}
        </Badge>
      </Box>

      <Box direction="horizontal" gap="12px" verticalAlign="middle">
        <Text size="small" secondary>מחיר: {formatCurrency(vendor.agreed_cost)}</Text>
        <Text size="small" weight="bold" skin="success">שולם: {formatCurrency(vendor.total_paid)}</Text>
        {vendor.remaining_balance > 0 && (
          <Text size="small" skin="error">נותר: {formatCurrency(vendor.remaining_balance)}</Text>
        )}
      </Box>

      {(vendor.phone || vendor.email) && (
        <Box direction="horizontal" gap="12px" verticalAlign="middle">
          {vendor.phone && (
            <a href={`tel:${vendor.phone}`} style={{ color: "#3182ce", textDecoration: "none", fontSize: "0.85rem" }}>
              <Phone size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} />
              {vendor.phone}
            </a>
          )}
          {vendor.email && (
            <a href={`mailto:${vendor.email}`} style={{ color: "#3182ce", textDecoration: "none", fontSize: "0.85rem" }}>
              <Mail size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} />
              {vendor.email}
            </a>
          )}
        </Box>
      )}

      {vendor.notes && (
        <Text size="tiny" secondary style={{ fontStyle: "italic" }}>{vendor.notes}</Text>
      )}

      <Box direction="horizontal" gap="8px">
        <Button size="tiny" prefixIcon={<Plus size={14} />} onClick={() => setShowPaymentModal(true)}>
          תשלום
        </Button>
        <Button size="tiny" skin="light" prefixIcon={<Edit2 size={14} />} onClick={onEdit}>
          עריכה
        </Button>
        <Button size="tiny" skin="destructive" prefixIcon={<Trash2 size={14} />} onClick={onDelete} />
      </Box>

      <Box direction="vertical" gap="8px">
        <Box direction="horizontal" gap="8px">
          {vendor.payments.length > 0 && (
            <Button
              size="tiny"
              skin="light"
              prefixIcon={showPayments ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => setShowPayments(!showPayments)}
            >
              {vendor.payments.length} תשלומים
            </Button>
          )}
          {files.length > 0 && (
            <Button
              size="tiny"
              skin="light"
              prefixIcon={showFiles ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => setShowFiles(!showFiles)}
            >
              <Paperclip size={14} />
              {files.length} קבצים
            </Button>
          )}
        </Box>
      </Box>

      {showPayments && vendor.payments.length > 0 && (
        <Box direction="vertical" gap="6px" paddingTop="12px" className="payments-list">
          {vendor.payments.map((payment) => (
            <Box
              key={payment.payment_id}
              direction="horizontal"
              align="space-between"
              verticalAlign="middle"
              padding="8px 12px"
              backgroundColor="white"
              borderRadius="6px"
            >
              <Text size="small" weight="bold" style={{ color: "#38a169" }}>
                {formatCurrency(toNum(payment.amount))}
              </Text>
              <Text size="tiny" secondary>{formatDate(payment.payment_date)}</Text>
              {payment.notes && <Text size="tiny" secondary style={{ flex: 1 }}>{payment.notes}</Text>}
              <IconButton
                size="tiny"
                skin="transparent"
                onClick={() => handleDeletePayment(payment.payment_id)}
                aria-label="מחק תשלום"
              >
                <X size={14} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {showFiles && files.length > 0 && (
        <Box direction="vertical" gap="6px" paddingTop="12px" className="payments-list">
          {files.map((file) => (
            <Box
              key={file.file_id}
              direction="horizontal"
              align="space-between"
              verticalAlign="middle"
              gap="10px"
              padding="8px 12px"
              backgroundColor="white"
              borderRadius="6px"
            >
              <FileText size={16} style={{ color: "#3182ce", flexShrink: 0 }} />
              <Text size="small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file.file_name}
              </Text>
              <Text size="tiny" secondary>{formatFileSize(file.file_size)}</Text>
              <Button size="tiny" skin="light" prefixIcon={<Download size={14} />} onClick={() => onDownloadFile(file.file_id)} aria-label="הורד קובץ" />
              <IconButton size="tiny" skin="transparent" onClick={() => onDeleteFile(file.file_id)} aria-label="מחק קובץ">
                <X size={14} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Modal isOpen={showPaymentModal} onRequestClose={() => setShowPaymentModal(false)}>
        <PaymentModal onSave={handleSavePayment} onClose={() => setShowPaymentModal(false)} />
      </Modal>
      {ConfirmDialog}
    </Box>
  );
};

export default VendorCard;
