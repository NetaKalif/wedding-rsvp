import React, { useState } from "react";
import {
  Box,
  Card,
  Modal,
  CustomModalLayout,
  FormField,
  NumberInput,
  CircularProgressBar,
  Text,
} from "@wix/design-system";
import {
  PiggyBank,
  Users,
  Edit2,
  ClipboardList,
  HandCoins,
  CircleDollarSign,
} from "lucide-react";
import { BudgetOverview } from "../../types";

interface BudgetOverviewCardProps {
  budgetData: BudgetOverview | null;
  onUpdateBudget: (value: number) => Promise<void>;
  onUpdateGuests: (value: number) => Promise<void>;
  formatCurrency: (amount: number) => string;
}

type EditMode = "budget" | "guests" | null;

const BudgetOverviewCard: React.FC<BudgetOverviewCardProps> = ({
  budgetData,
  onUpdateBudget,
  onUpdateGuests,
  formatCurrency,
}) => {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editValue, setEditValue] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalBudget = budgetData?.total_budget || 0;
  const totalExpenses = budgetData?.total_expenses || 0;
  const remainingBudget = budgetData?.remaining_budget || 0;
  const usagePercentage = budgetData?.usage_percentage || 0;
  const estimatedGuests = budgetData?.estimated_guests || 0;
  const pricePerGuest = budgetData?.price_per_guest || 0;
  const plannedExpenses = budgetData?.planned_expenses || 0;

  const progressPercentage = Math.min(usagePercentage, 100);

  const openEditModal = (mode: EditMode) => {
    if (mode === "budget") {
      setEditValue(totalBudget);
    } else if (mode === "guests") {
      setEditValue(estimatedGuests);
    }
    setEditMode(mode);
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      if (editMode === "budget") {
        await onUpdateBudget(editValue);
      } else if (editMode === "guests") {
        await onUpdateGuests(editValue);
      }
      setEditMode(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getModalTitle = () => {
    if (editMode === "budget") return "עריכת תקציב";
    if (editMode === "guests") return "עריכת מספר אורחים";
    return "";
  };

  const getModalLabel = () => {
    if (editMode === "budget") return "תקציב כולל (₪)";
    if (editMode === "guests") return "מספר אורחים משוער";
    return "";
  };

  return (
    <>
      <Card>
        <Card.Content>
          <Box
            direction="horizontal"
            align="center"
            verticalAlign="middle"
            gap="32px"
            padding="8px"
            className="budget-overview-content"
          >
            <CircularProgressBar
              showProgressIndication
              value={progressPercentage}
              labelPlacement="center"
              skin={progressPercentage < 75 ? "success" : "premium"}
              error={progressPercentage >= 100}
            />

            <Box
              direction="vertical"
              gap="12px"
              className="budget-stats-container"
              align="center"
            >
              <Box
                className="budget-stat"
                direction="vertical"
              >
                <Text weight="bold" size="medium" className="budget-stat-value">
                  <PiggyBank
                    size={20}
                    style={{ marginLeft: 6, verticalAlign: "middle" }}
                  />
                  {formatCurrency(totalBudget)}
                  <Edit2
                    onClick={() => openEditModal("budget")}
                    size={12}
                    style={{
                      marginRight: 4,
                      verticalAlign: "middle",
                      opacity: 0.6,
                      cursor: 'pointer'
                    }}
                  />
                </Text>
                <Text size="small" secondary className="budget-stat-label">
                  תקציב כולל
                </Text>
              </Box>
              <Box
                direction="horizontal"
                gap="16px"
                data-testid="budget-stats-row"
              >
                <Box
                  className="budget-stat"
                  direction="vertical"
                  align="center"
                >
                  <Text
                    weight="bold"
                    size="medium"
                    className="budget-stat-value"
                    skin="primary"
                  >
                    <ClipboardList
                      size={20}
                      style={{ marginLeft: 6, verticalAlign: "middle" }}
                    />
                    {formatCurrency(plannedExpenses)}
                  </Text>
                  <Text size="small" secondary className="budget-stat-label">
                    התחיבויות
                  </Text>
                </Box>
                <Box
                  className="budget-stat"
                  direction="vertical"
                  align="center"
                >
                  <Text
                    skin="premium"
                    weight="bold"
                    size="medium"
                    className="budget-stat-value"
                    style={{
                      color: remainingBudget >= 0 ? "#38a169" : "#e53e3e",
                    }}
                  >
                    <HandCoins
                      size={20}
                      style={{ marginLeft: 6, verticalAlign: "middle" }}
                    />
                    {formatCurrency(remainingBudget)}
                  </Text>
                  <Text size="small" secondary className="budget-stat-label">
                    תקציב פנוי
                  </Text>
                </Box>
                <Box
                  className="budget-stat"
                  direction="vertical"
                  align="center"
                >
                  <Text
                    weight="bold"
                    size="medium"
                    className="budget-stat-value"
                    skin="success"
                  >
                    <CircleDollarSign
                      size={20}
                      style={{ marginLeft: 6, verticalAlign: "middle" }}
                    />
                    {formatCurrency(totalExpenses)}
                  </Text>
                  <Text size="small" secondary className="budget-stat-label">
                    שולמו
                  </Text>
                </Box>
              </Box>

              <Box
                direction="horizontal"
                gap="16px"
                data-hook="guests-stats-row"
              >
                <Box
                  className="budget-stat"
                  direction="vertical"
                >
                  <Text
                    weight="bold"
                    size="medium"
                    className="budget-stat-value"
                  >
                    <Users
                      size={20}
                      style={{ marginLeft: 6, verticalAlign: "middle" }}
                    />
                    {estimatedGuests}
                    <Edit2
                      onClick={() => openEditModal("guests")}
                      size={12}
                      style={{
                        marginRight: 4,
                        verticalAlign: "middle",
                        opacity: 0.6,
                        cursor: 'pointer'
                      }}
                    />
                  </Text>
                  <Text size="small" secondary className="budget-stat-label">
                    אורחים משוערים
                  </Text>
                </Box>

                <Box
                  className="budget-stat"
                  direction="vertical"
                  align="center"
                >
                  <Text
                    weight="bold"
                    size="medium"
                    className="budget-stat-value"
                  >
                    {formatCurrency(pricePerGuest)}
                  </Text>
                  <Text size="small" secondary className="budget-stat-label">
                    לאורח
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>
        </Card.Content>
      </Card>

      <Modal
        isOpen={editMode !== null}
        onRequestClose={() => setEditMode(null)}
      >
        <CustomModalLayout
          title={getModalTitle()}
          primaryButtonText={isSubmitting ? "שומר..." : "שמור"}
          primaryButtonOnClick={handleSave}
          primaryButtonProps={{ disabled: isSubmitting }}
          secondaryButtonText="ביטול"
          secondaryButtonOnClick={() => setEditMode(null)}
          width="400px"
          className="modal"
          content={
            <div dir="rtl">
              <Box direction="vertical" gap="16px" paddingTop="12px">
                <FormField label={getModalLabel()}>
                  <NumberInput
                    value={editValue}
                    onChange={(val) => setEditValue(val ?? 0)}
                    min={0}
                    step={editMode === "budget" ? 1000 : 10}
                  />
                </FormField>
              </Box>
            </div>
          }
        />
      </Modal>
    </>
  );
};

export default BudgetOverviewCard;
