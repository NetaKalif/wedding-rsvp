import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  CustomModalLayout,
  Dropdown,
  FormField,
  Heading,
  Input,
  Modal,
  NumberInput,
  Search,
  SectionHelper,
  Table,
  TableColumn,
  Text,
} from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import {
  Coins,
  Download,
  Gift as GiftIcon,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Gift, GiftType, Guest } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { useAppData } from "../../hooks/useAppData";
import { useConfirm } from "../../hooks/useConfirm";
import Header from "../global/Header";
import AddGiftGuestModal from "./AddGiftGuestModal";
import {
  buildGuestGiftRows,
  displayedRsvpCount,
  formatCurrency,
  getGiftStats,
  GIFT_TYPE_OPTIONS,
  giftTypeLabel,
  guestHasGift,
  GuestGiftRow,
  handleGiftsExport,
} from "./logic";
import { RowDataDefaultType } from "@wix/design-system/dist/types/Table/DataTable";
import "./css/GiftsDashboard.css";

export const GiftsDashboard: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { guests, events, eventGuestsByEventId, updateEventGuests } = useAppData();
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();

  const [gifts, setGifts] = useState<Gift[]>([]);

  // Gift entry form
  const [guestSearchTerm, setGuestSearchTerm] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [rsvpValue, setRsvpValue] = useState<number | undefined>(undefined);
  const [isSavingRsvp, setIsSavingRsvp] = useState(false);
  const [giftType, setGiftType] = useState<GiftType | null>(null);
  const [otherText, setOtherText] = useState("");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);

  // Gift edit modal
  const [editGiftModal, setEditGiftModal] = useState<{
    gift: Gift;
    guestName: string;
  } | null>(null);
  const [editGiftType, setEditGiftType] = useState<GiftType | null>(null);
  const [editOtherText, setEditOtherText] = useState("");
  const [editAmount, setEditAmount] = useState<number | undefined>(undefined);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Table
  const [tableSearchTerm, setTableSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"name" | "amount">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);

  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!user) return;
    httpRequests
      .getGifts()
      .then(setGifts)
      .catch((error) => console.error("Error loading gifts:", error));
  }, [user]);

  const primaryEvent = events.find((e) => e.is_primary);
  const primaryEventGuests = primaryEvent
    ? eventGuestsByEventId[primaryEvent.id] ?? []
    : [];

  const rows = useMemo(
    () => buildGuestGiftRows(guests, primaryEventGuests, gifts),
    [guests, primaryEventGuests, gifts]
  );
  const stats = useMemo(() => getGiftStats(rows), [rows]);

  const filteredRows = rows.filter((row) => {
    if (!tableSearchTerm) return true;
    const { name, phone, whose, circle } = row.guest;
    return [name, phone, whose, circle].some((field) =>
      field?.includes(tableSearchTerm)
    );
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    const valueA = sortField === "name" ? a.guest.name : a.totalAmount;
    const valueB = sortField === "name" ? b.guest.name : b.totalAmount;
    if (valueA < valueB) return sortDirection === "asc" ? -1 : 1;
    if (valueA > valueB) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field: "name" | "amount") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "amount" ? "desc" : "asc");
    }
  };

  const selectedGuestRsvp = selectedGuest
    ? primaryEventGuests.find((eg) => eg.guest_id === selectedGuest.id) ?? null
    : null;
  const selectedGuestHasGift = guestHasGift(gifts, selectedGuest?.id);

  const selectGuest = (guest: Guest) => {
    setSelectedGuest(guest);
    setGuestSearchTerm(guest.name);
    const rsvp = primaryEventGuests.find((eg) => eg.guest_id === guest.id);
    setRsvpValue(rsvp?.rsvp_status ?? undefined);
  };

  const clearGuestSelection = () => {
    setSelectedGuest(null);
    setGuestSearchTerm("");
    setRsvpValue(undefined);
  };

  const handleRsvpUpdate = async () => {
    if (!selectedGuest?.id || !primaryEvent) return;
    setIsSavingRsvp(true);
    try {
      const updated = await httpRequests.setRSVP(
        primaryEvent.id,
        selectedGuest.id,
        rsvpValue ?? null
      );
      updateEventGuests(primaryEvent.id, updated);
    } catch (error) {
      console.error("Error updating RSVP:", error);
    } finally {
      setIsSavingRsvp(false);
    }
  };

  const handleAddGift = async () => {
    if (!selectedGuest?.id || !giftType || !amount || amount <= 0) return;
    if (giftType === "other" && !otherText.trim()) return;
    if (guestHasGift(gifts, selectedGuest.id)) return;
    setIsSubmitting(true);
    try {
      const gift = await httpRequests.addGift(
        selectedGuest.id,
        giftType,
        amount,
        giftType === "other" ? otherText.trim() : null
      );
      setGifts((prev) => [gift, ...prev]);
      clearGuestSelection();
      setGiftType(null);
      setOtherText("");
      setAmount(undefined);
    } catch (error) {
      console.error("Error adding gift:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditGift = (gift: Gift, guestName: string) => {
    setEditGiftModal({ gift, guestName });
    setEditGiftType(gift.gift_type);
    setEditOtherText(gift.other_description ?? "");
    setEditAmount(gift.amount);
  };

  const closeEditGift = () => {
    setEditGiftModal(null);
    setEditGiftType(null);
    setEditOtherText("");
    setEditAmount(undefined);
  };

  const handleEditGiftSave = async () => {
    if (!editGiftModal || !editGiftType || !editAmount || editAmount <= 0) return;
    if (editGiftType === "other" && !editOtherText.trim()) return;
    setIsSavingEdit(true);
    try {
      const updated = await httpRequests.updateGift(
        editGiftModal.gift.gift_id,
        editGiftType,
        editAmount,
        editGiftType === "other" ? editOtherText.trim() : null
      );
      setGifts((prev) =>
        prev.map((g) => (g.gift_id === updated.gift_id ? updated : g))
      );
      closeEditGift();
    } catch (error) {
      console.error("Error updating gift:", error);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteGift = async (gift: Gift, guestName: string) => {
    const ok = await confirm({
      message: `למחוק את המתנה של ${guestName} (${formatCurrency(gift.amount)})?`,
      confirmText: "מחק",
    });
    if (!ok) return;
    try {
      await httpRequests.deleteGift(gift.gift_id);
      setGifts((prev) => prev.filter((g) => g.gift_id !== gift.gift_id));
    } catch (error) {
      console.error("Error deleting gift:", error);
    }
  };

  const guestSearchOptions =
    guestSearchTerm.length > 0 && !selectedGuest
      ? guests
          .filter((g) => g.name.includes(guestSearchTerm))
          .slice(0, 10)
          .map((g) => ({
            id: g.id!,
            value: `${g.name}${g.phone ? ` (${g.phone})` : ""}`,
          }))
      : [];

  const columns: (TableColumn<RowDataDefaultType> & { showOnMobile: boolean })[] = [
    {
      title: (
        <span className="sortable-title" onClick={() => handleSort("name")}>
          שם
        </span>
      ),
      render: (row: GuestGiftRow) => row.guest.name,
      showOnMobile: true,
      align: "start",
    },
    {
      title: <span>טלפון</span>,
      render: (row: GuestGiftRow) =>
        row.guest.phone ? (
          <span className="guest-phone">{row.guest.phone}</span>
        ) : (
          "-"
        ),
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>מוזמן ע״י</span>,
      render: (row: GuestGiftRow) => row.guest.whose,
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>מעגל</span>,
      render: (row: GuestGiftRow) => row.guest.circle,
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>מספר מאושרים</span>,
      render: (row: GuestGiftRow) => displayedRsvpCount(row),
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>מספר אורחים</span>,
      render: (row: GuestGiftRow) => row.guest.number_of_guests,
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>מתנה</span>,
      render: (row: GuestGiftRow) =>
        row.gifts.length === 0 ? (
          "-"
        ) : (
          <Box direction="vertical" gap="4px">
            {row.gifts.map((gift) => (
              <Box key={gift.gift_id} gap="6px" verticalAlign="middle">
                <Badge uppercase={false} skin="neutralLight">
                  {giftTypeLabel(gift)}
                </Badge>
                {/* Per-gift amount only adds information when there is more
                    than one gift — otherwise it duplicates the total column. */}
                {row.gifts.length > 1 && (
                  <Text size="small" className="gift-amount">
                    {formatCurrency(gift.amount)}
                  </Text>
                )}
                <Pencil
                  size={14}
                  className="gift-edit-icon"
                  onClick={() => openEditGift(gift, row.guest.name)}
                />
                <Trash2
                  size={14}
                  className="gift-delete-icon"
                  onClick={() => handleDeleteGift(gift, row.guest.name)}
                />
              </Box>
            ))}
          </Box>
        ),
      showOnMobile: true,
      align: "start",
    },
    {
      title: (
        <span className="sortable-title" onClick={() => handleSort("amount")}>
          סה״כ מתנה
        </span>
      ),
      render: (row: GuestGiftRow) =>
        row.gifts.length > 0 ? (
          <Text size="small" weight="bold" className="gift-total">
            {formatCurrency(row.totalAmount)}
          </Text>
        ) : (
          "-"
        ),
      showOnMobile: true,
      align: "start",
    },
  ];

  const mobileColumns = columns.filter((column) => column.showOnMobile);

  if (authLoading || !user) return null;

  return (
    <>
      <Header showBackToDashboardButton={true} />
      <div className="gifts-dashboard" dir="rtl">
        <Box
          direction="vertical"
          gap="24px"
          padding="24px 0"
          width="80%"
          minWidth="400px"
          maxWidth="1200px"
        >
          {/* Header */}
          <Box direction="vertical" gap="4px">
            <Heading size="large">מתנות חתונה</Heading>
            <Text size="small" secondary>
              רשמו את המתנות שקיבלתם מהאורחים ועקבו אחר הסכומים
            </Text>
          </Box>

          {/* Stats */}
          <Card>
            <Card.Content>
              <Box
                direction="horizontal"
                align="center"
                gap="16px"
                padding="8px"
                className="gift-stats-row"
              >
                <Box className="gift-stat" direction="vertical" align="center">
                  <Text weight="bold" size="medium" className="gift-stat-value">
                    <HandCoins size={20} style={{ marginLeft: 6, verticalAlign: "middle" }} />
                    {formatCurrency(stats.totalAmount)}
                  </Text>
                  <Text size="small" secondary className="gift-stat-label">
                    סה״כ מתנות
                  </Text>
                </Box>
                <Box className="gift-stat" direction="vertical" align="center">
                  <Text weight="bold" size="medium" className="gift-stat-value">
                    <Coins size={20} style={{ marginLeft: 6, verticalAlign: "middle" }} />
                    {formatCurrency(stats.averagePerGuest)}
                  </Text>
                  <Text size="small" secondary className="gift-stat-label">
                    ממוצע לאורח
                  </Text>
                </Box>
                <Box className="gift-stat" direction="vertical" align="center">
                  <Text weight="bold" size="medium" className="gift-stat-value">
                    <Users size={20} style={{ marginLeft: 6, verticalAlign: "middle" }} />
                    {stats.gifterGuestCount}
                  </Text>
                  <Text size="small" secondary className="gift-stat-label">
                    אורחים שנתנו מתנה
                  </Text>
                </Box>
              </Box>
            </Card.Content>
          </Card>

          {/* Gift entry form */}
          <Card>
            <Card.Header
              title="רישום מתנה"
              suffix={
                <Button
                  size="small"
                  priority="secondary"
                  prefixIcon={<Plus size={16} />}
                  onClick={() => setShowAddGuest(true)}
                >
                  אורח לא מוזמן
                </Button>
              }
            />
            <Card.Content>
              <Box direction="vertical" gap="16px">
                <FormField label="אורח">
                  <Search
                    placeholder="חיפוש אורח לפי שם..."
                    value={guestSearchTerm}
                    onChange={(e) => {
                      setGuestSearchTerm(e.target.value);
                      setSelectedGuest(null);
                    }}
                    onClear={clearGuestSelection}
                    options={guestSearchOptions}
                    onSelect={(option) => {
                      const guest = guests.find((g) => g.id === option.id);
                      if (guest) selectGuest(guest);
                    }}
                  />
                </FormField>

                {selectedGuest && (
                  <Box
                    direction="vertical"
                    gap="12px"
                    className="selected-guest-details"
                  >
                    <Box gap="16px" verticalAlign="middle" className="selected-guest-info">
                      <Text weight="bold">{selectedGuest.name}</Text>
                      {selectedGuest.phone && (
                        <Text size="small" secondary>
                          {selectedGuest.phone}
                        </Text>
                      )}
                      <Text size="small" secondary>
                        מוזמן ע״י: {selectedGuest.whose}
                      </Text>
                      <Text size="small" secondary>
                        מעגל: {selectedGuest.circle}
                      </Text>
                      <Text size="small" secondary>
                        מספר אורחים: {selectedGuest.number_of_guests}
                      </Text>
                    </Box>
                    {selectedGuestRsvp ? (
                      <Box gap="12px" verticalAlign="middle">
                        <Text size="small">מספר מאושרים:</Text>
                        <Box width="100px">
                          <NumberInput
                            size="small"
                            value={rsvpValue}
                            onChange={(value) => setRsvpValue(value ?? undefined)}
                            min={0}
                            placeholder="ממתין"
                          />
                        </Box>
                        <Button
                          size="tiny"
                          priority="secondary"
                          disabled={
                            isSavingRsvp ||
                            (rsvpValue ?? null) === (selectedGuestRsvp.rsvp_status ?? null)
                          }
                          onClick={handleRsvpUpdate}
                        >
                          {isSavingRsvp ? "מעדכן..." : "עדכון אישור הגעה"}
                        </Button>
                      </Box>
                    ) : (
                      <Badge uppercase={false} skin="neutralStandard">
                        לא מוזמן לחתונה
                      </Badge>
                    )}
                    {selectedGuestHasGift && (
                      <SectionHelper appearance="standard">
                        לאורח זה כבר רשומה מתנה — ניתן לערוך או למחוק אותה
                        מהטבלה למטה.
                      </SectionHelper>
                    )}
                  </Box>
                )}

                <Box gap="12px" verticalAlign="bottom" className="gift-form-row">
                  <Box width="200px">
                    <FormField label="סוג מתנה">
                      <Dropdown
                        placeholder="בחרו סוג מתנה"
                        options={GIFT_TYPE_OPTIONS}
                        selectedId={giftType ?? undefined}
                        onSelect={(option) => setGiftType(option.id as GiftType)}
                      />
                    </FormField>
                  </Box>
                  {giftType === "other" && (
                    <Box width="200px">
                      <FormField label="פירוט">
                        <Input
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          placeholder="למשל: שובר מתנה"
                        />
                      </FormField>
                    </Box>
                  )}
                  <Box width="160px">
                    <FormField label="סכום (₪)">
                      <NumberInput
                        value={amount}
                        onChange={(value) => setAmount(value ?? undefined)}
                        min={0}
                        placeholder="0"
                      />
                    </FormField>
                  </Box>
                  <Button
                    prefixIcon={<GiftIcon size={16} />}
                    disabled={
                      !selectedGuest ||
                      selectedGuestHasGift ||
                      !giftType ||
                      !amount ||
                      amount <= 0 ||
                      (giftType === "other" && !otherText.trim()) ||
                      isSubmitting
                    }
                    onClick={handleAddGift}
                  >
                    {isSubmitting ? "שומר..." : "הוספת מתנה"}
                  </Button>
                </Box>
              </Box>
            </Card.Content>
          </Card>

          {/* Guests table */}
          <Card>
            <Card.Header
              title="אורחים ומתנות"
              suffix={
                <Button
                  size="small"
                  priority="secondary"
                  prefixIcon={<Download size={16} />}
                  onClick={() => handleGiftsExport(sortedRows)}
                >
                  ייצוא לאקסל
                </Button>
              }
            />
            <Card.Content>
              <Box direction="vertical" gap="12px">
                <Box width="250px">
                  <Search
                    placeholder="חיפוש בטבלה..."
                    value={tableSearchTerm}
                    onChange={(e) => setTableSearchTerm(e.target.value)}
                    onClear={() => setTableSearchTerm("")}
                  />
                </Box>
                <Table
                  data={sortedRows}
                  columns={isMobile ? mobileColumns : columns}
                  rowVerticalPadding="medium"
                >
                  <Table.Content />
                </Table>
                <div className="number-of-guests-shown">
                  מציג {sortedRows.length} מתוך {rows.length} אורחים
                </div>
              </Box>
            </Card.Content>
          </Card>
        </Box>

        <AddGiftGuestModal
          isOpen={showAddGuest}
          onClose={() => setShowAddGuest(false)}
          onGuestAdded={selectGuest}
        />

        <Modal
          isOpen={editGiftModal !== null}
          onRequestClose={closeEditGift}
          shouldCloseOnOverlayClick
        >
          <CustomModalLayout
            title={`עריכת מתנה של ${editGiftModal?.guestName ?? ""}`}
            primaryButtonText={isSavingEdit ? "שומר..." : "שמירה"}
            primaryButtonOnClick={handleEditGiftSave}
            primaryButtonProps={{
              disabled:
                isSavingEdit ||
                !editGiftType ||
                !editAmount ||
                editAmount <= 0 ||
                (editGiftType === "other" && !editOtherText.trim()),
            }}
            secondaryButtonText="ביטול"
            secondaryButtonOnClick={closeEditGift}
            width="400px"
            content={
              <div dir="rtl">
                <Box direction="vertical" gap="16px" paddingTop="12px">
                  <FormField label="סוג מתנה">
                    <Dropdown
                      options={GIFT_TYPE_OPTIONS}
                      selectedId={editGiftType ?? undefined}
                      onSelect={(option) => setEditGiftType(option.id as GiftType)}
                    />
                  </FormField>
                  {editGiftType === "other" && (
                    <FormField label="פירוט">
                      <Input
                        value={editOtherText}
                        onChange={(e) => setEditOtherText(e.target.value)}
                        placeholder="למשל: שובר מתנה"
                      />
                    </FormField>
                  )}
                  <FormField label="סכום (₪)">
                    <NumberInput
                      value={editAmount}
                      onChange={(value) => setEditAmount(value ?? undefined)}
                      min={0}
                    />
                  </FormField>
                </Box>
              </div>
            }
          />
        </Modal>
        {ConfirmDialog}
      </div>
    </>
  );
};
