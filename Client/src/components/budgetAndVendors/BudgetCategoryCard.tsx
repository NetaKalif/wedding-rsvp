import React, { useState } from "react";
import {
  Box,
  Text,
  Button,
  Card,
  IconButton,
  Divider,
  Modal,
} from "@wix/design-system";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  BudgetCategoryWithSpending,
  VendorWithPayments,
  Vendor,
} from "../../types";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { useAppData } from "../../hooks/useAppData";
import { useConfirm } from "../../hooks/useConfirm";
import VendorCard from "./VendorCard";
import VendorModal from "./VendorModal";

const recalcCategory = (vendors: VendorWithPayments[]) => ({
  agreed_cost: vendors
    .filter((v) => v.status !== "יצרנו קשר")
    .reduce((sum, v) => sum + v.agreed_cost, 0),
  actual_spending: vendors.reduce((sum, v) => sum + v.total_paid, 0),
});

const recalcBudgetTotals = (
  categories: BudgetCategoryWithSpending[],
  totalBudget: number,
  estimatedGuests: number
) => {
  const planned = categories.reduce((sum, c) => sum + c.agreed_cost, 0);
  const spent = categories.reduce((sum, c) => sum + c.actual_spending, 0);
  return {
    planned_expenses: planned,
    total_expenses: spent,
    remaining_budget: totalBudget - planned,
    usage_percentage: totalBudget > 0 ? (planned / totalBudget) * 100 : 0,
    price_per_guest: estimatedGuests > 0 ? planned / estimatedGuests : 0,
  };
};

interface BudgetCategoryCardProps {
  category: BudgetCategoryWithSpending;
  icon: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  formatCurrency: (amount: number) => string;
  highlightedVendorId?: number | null;
}

const BudgetCategoryCard: React.FC<BudgetCategoryCardProps> = ({
  category,
  icon,
  isExpanded,
  onToggleExpand,
  formatCurrency,
  highlightedVendorId,
}) => {
  const { user } = useAuth();
  const { setBudgetOverview, refreshBudget } = useAppData();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorWithPayments | null>(null);

  const handleDeleteCategory = async () => {
    if (!user) return;
    const ok = await confirm({ message: `למחוק את הקטגוריה ״${category.name}״? כל הספקים בקטגוריה יימחקו גם כן.` });
    if (!ok) return;
    setBudgetOverview((prev) => {
      if (!prev) return prev;
      const cats = prev.categories.filter((c) => c.category_id !== category.category_id);
      return { ...prev, categories: cats, ...recalcBudgetTotals(cats, prev.total_budget, prev.estimated_guests) };
    });
    try {
      await httpRequests.deleteBudgetCategory(user.userID, category.category_id);
    } catch (error) {
      console.error("Error deleting category:", error);
      refreshBudget();
    }
  };

  const handleAddVendor = () => { setEditingVendor(null); setShowVendorModal(true); };
  const handleEditVendor = (vendor: VendorWithPayments) => { setEditingVendor(vendor); setShowVendorModal(true); };

  const handleSaveVendor = async (
    vendorData: Pick<Vendor, "name" | "job_title" | "category_id" | "agreed_cost" | "status" | "phone" | "email" | "notes" | "is_favorite">,
    files?: File[]
  ) => {
    if (!user) return;
    try {
      let savedVendor: Vendor | null = null;
      if (editingVendor) {
        savedVendor = await httpRequests.updateVendor(user.userID, editingVendor.vendor_id, vendorData, files);
      } else {
        savedVendor = await httpRequests.addVendor(user.userID, { ...vendorData, category_id: category.category_id }, files);
      }
      setShowVendorModal(false);
      setEditingVendor(null);

      if (!savedVendor) { refreshBudget(); return; }

      // Vendor moved to a different category — full refresh is simpler
      if (editingVendor && savedVendor.category_id !== category.category_id) {
        refreshBudget();
        return;
      }

      setBudgetOverview((prev) => {
        if (!prev) return prev;
        let updatedCats: BudgetCategoryWithSpending[];

        const agreedCost = Number(savedVendor!.agreed_cost);
        if (editingVendor) {
          updatedCats = prev.categories.map((cat) => {
            const idx = cat.vendors.findIndex((v) => v.vendor_id === savedVendor!.vendor_id);
            if (idx === -1) return cat;
            const existing = cat.vendors[idx];
            const updated: VendorWithPayments = {
              ...existing,
              ...savedVendor!,
              agreed_cost: agreedCost,
              payments: existing.payments,
              files: existing.files,
              total_paid: existing.total_paid,
              remaining_balance: agreedCost - existing.total_paid,
              category_name: cat.name,
            };
            const vendors = [...cat.vendors.slice(0, idx), updated, ...cat.vendors.slice(idx + 1)];
            return { ...cat, ...recalcCategory(vendors), vendors };
          });
        } else {
          updatedCats = prev.categories.map((cat) => {
            if (cat.category_id !== category.category_id) return cat;
            const newVendor: VendorWithPayments = {
              ...savedVendor!,
              agreed_cost: agreedCost,
              payments: [],
              files: [],
              total_paid: 0,
              remaining_balance: agreedCost,
              category_name: cat.name,
            };
            const vendors = [...cat.vendors, newVendor];
            return { ...cat, ...recalcCategory(vendors), vendors };
          });
        }

        return { ...prev, categories: updatedCats, ...recalcBudgetTotals(updatedCats, prev.total_budget, prev.estimated_guests) };
      });

      // If files were attached, refresh in background to get file metadata from server
      if (files && files.length > 0) refreshBudget();
    } catch (error) {
      console.error("Error saving vendor:", error);
      refreshBudget();
    }
  };

  const handleDeleteVendor = async (vendorId: number) => {
    if (!user) return;
    const vendorName = category.vendors.find((v) => v.vendor_id === vendorId)?.name ?? "ספק";
    const ok = await confirm({ message: `למחוק את ״${vendorName}״ וכל התשלומים שלו?` });
    if (!ok) return;
    setBudgetOverview((prev) => {
      if (!prev) return prev;
      const updatedCats = prev.categories.map((cat) => {
        if (!cat.vendors.some((v) => v.vendor_id === vendorId)) return cat;
        const vendors = cat.vendors.filter((v) => v.vendor_id !== vendorId);
        return { ...cat, ...recalcCategory(vendors), vendors };
      });
      return { ...prev, categories: updatedCats, ...recalcBudgetTotals(updatedCats, prev.total_budget, prev.estimated_guests) };
    });
    try {
      await httpRequests.deleteVendor(user.userID, vendorId);
    } catch (error) {
      console.error("Error deleting vendor:", error);
      refreshBudget();
    }
  };

  const handleToggleFavorite = async (vendorId: number) => {
    if (!user) return;
    const toggle = () =>
      setBudgetOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map((cat) => ({
            ...cat,
            vendors: cat.vendors.map((v) =>
              v.vendor_id === vendorId ? { ...v, is_favorite: !v.is_favorite } : v
            ),
          })),
        };
      });
    toggle();
    try {
      await httpRequests.toggleVendorFavorite(user.userID, vendorId);
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toggle(); // rollback by toggling back
    }
  };

  const handleDownloadFile = (fileId: number) => {
    if (!user) return;
    window.open(httpRequests.getVendorFileDownloadUrl(user.userID, fileId), "_blank");
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!user) return;
    const ok = await confirm({ message: "למחוק קובץ זה?" });
    if (!ok) return;
    setBudgetOverview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: prev.categories.map((cat) => ({
          ...cat,
          vendors: cat.vendors.map((v) => ({
            ...v,
            files: v.files.filter((f) => f.file_id !== fileId),
          })),
        })),
      };
    });
    try {
      await httpRequests.deleteVendorFile(user.userID, fileId);
    } catch (error) {
      console.error("Error deleting file:", error);
      refreshBudget();
    }
  };

  return (
    <>
      {ConfirmDialog}
      <Card>
        <Card.Content>
          <div onClick={onToggleExpand} style={{ cursor: "pointer" }}>
            <Box direction="vertical" align="space-between" verticalAlign="middle">
              <Box direction="horizontal" verticalAlign="middle" gap="8px">
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <Text size="medium">{icon}</Text>
                <Text weight="bold">{category.name}</Text>
                <Text size="tiny" secondary>({category.vendors.length} ספקים)</Text>
              </Box>

              <div onClick={(e) => e.stopPropagation()}>
                <Box direction="horizontal" verticalAlign="middle" gap="12px">
                  <Text weight="bold" skin="primary">
                    מתוכנן:{formatCurrency(category.agreed_cost)}
                  </Text>
                  <Text weight="bold" skin="success">
                    שולם:{formatCurrency(category.actual_spending)}
                  </Text>
                  <IconButton
                    size="tiny"
                    skin="light"
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(); }}
                    style={{ color: "red" }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </Box>
              </div>
            </Box>
          </div>

          {isExpanded && (
            <Box direction="vertical" marginTop="16px">
              <Divider />
              <Box
                direction="horizontal"
                align="space-between"
                verticalAlign="middle"
                marginTop="16px"
                marginBottom="12px"
              >
                <Text weight="bold" size="small">ספקים</Text>
                <Button size="tiny" prefixIcon={<Plus size={14} />} onClick={handleAddVendor}>
                  הוסף ספק
                </Button>
              </Box>

              {category.vendors.length === 0 ? (
                <Box align="center" padding="16px">
                  <Text secondary size="small">
                    אין ספקים עדיין. הוסף את הספק הראשון לקטגוריה זו.
                  </Text>
                </Box>
              ) : (
                <Box direction="vertical" gap="10px">
                  {category.vendors.map((vendor) => (
                    <VendorCard
                      key={vendor.vendor_id}
                      vendor={vendor}
                      onEdit={() => handleEditVendor(vendor)}
                      onDelete={() => handleDeleteVendor(vendor.vendor_id)}
                      onToggleFavorite={() => handleToggleFavorite(vendor.vendor_id)}
                      onDownloadFile={handleDownloadFile}
                      onDeleteFile={handleDeleteFile}
                      formatCurrency={formatCurrency}
                      isHighlighted={highlightedVendorId === vendor.vendor_id}
                    />
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Card.Content>
      </Card>

      <Modal
        isOpen={showVendorModal}
        onRequestClose={() => { setShowVendorModal(false); setEditingVendor(null); }}
      >
        <VendorModal
          vendor={editingVendor}
          categories={[category]}
          selectedCategoryId={category.category_id}
          onSave={handleSaveVendor}
          onClose={() => { setShowVendorModal(false); setEditingVendor(null); }}
        />
      </Modal>
    </>
  );
};

export default BudgetCategoryCard;
