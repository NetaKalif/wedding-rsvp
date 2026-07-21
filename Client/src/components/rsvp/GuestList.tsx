import "./css/GuestsList.css";
import {
  EventGuest,
  FilterOptions,
  Guest,
  RsvpStatus,
  User,
} from "../../types";

import React, { useEffect, useState } from "react";
import {
  Badge,
  Button,
  NumberInput,
  Table,
  Modal,
  Box,
  Text,
  TableColumn,
} from "@wix/design-system";
import { Check, ChevronDown, ChevronUp, Clock, Pencil, Trash2, X } from "lucide-react";
import { filterGuests, getRsvpStatus } from "./logic";
import { httpRequests } from "../../httpClient";
import { useAppData } from "../../hooks/useAppData";
import { useConfirm } from "../../hooks/useConfirm";
import SearchAndFilterBar from "./SearchAndFilterBar";
import EditGuestModal from "./EditGuestModal";
import { RowDataDefaultType } from "@wix/design-system/dist/types/Table/DataTable";

interface GuestListProps {
  eventGuests: EventGuest[];
  eventId: number;
  userID: User["userID"];
  onEventGuestsChange: (guests: EventGuest[]) => void;
  primaryGuestsList: Guest[];
  /** Override the delete action. Defaults to deleting from the global guests table. */
  onDeleteGuest?: (guest: EventGuest) => Promise<void>;
}

const GuestList: React.FC<GuestListProps> = ({
  eventGuests,
  eventId,
  userID,
  onEventGuestsChange,
  primaryGuestsList,
  onDeleteGuest: onDeleteGuestProp,
}) => {
  const { setGuests } = useAppData();
  const { confirm, ConfirmDialog } = useConfirm();

  const onDeleteGuest = async (guest: EventGuest) => {
    const ok = await confirm({ message: `למחוק את ${guest.name} מרשימת האורחים?`, confirmText: "מחק" });
    if (!ok) return;

    if (onDeleteGuestProp) {
      await onDeleteGuestProp(guest);
      return;
    }
    if (!guest.guest_id) return;
    // Optimistic: remove immediately
    onEventGuestsChange(eventGuests.filter((g) => g.guest_id !== guest.guest_id));
    try {
      await httpRequests.deleteGuest(guest.guest_id);
      setGuests((prev) => prev.filter((g) => g.id !== guest.guest_id));
    } catch (error) {
      console.error("Error deleting guest:", error);
      onEventGuestsChange(eventGuests); // rollback
    }
  };

  const [sortField, setSortField] = useState<keyof EventGuest>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    whose: [],
    circle: [],
    rsvpStatus: [],
    searchTerm: "",
  });
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);
  const [rsvpModal, setRsvpModal] = useState<{
    isOpen: boolean;
    guest: EventGuest | null;
    value: number | undefined;
  }>({ isOpen: false, guest: null, value: undefined });
  const [editGuestModal, setEditGuestModal] = useState<{
    isOpen: boolean;
    guest: EventGuest | null;
  }>({ isOpen: false, guest: null });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const filteredGuests = filterGuests(eventGuests, filterOptions);
  const sortedGuests = [...filteredGuests].sort((a, b) => {
    const fieldA = a[sortField];
    const fieldB = b[sortField];

    if (fieldA == null && fieldB == null) return 0;
    if (fieldA == null) return 1;
    if (fieldB == null) return -1;

    if (fieldA < fieldB) return sortDirection === "asc" ? -1 : 1;
    if (fieldA > fieldB) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const renderSortIcon = (field: keyof EventGuest) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? <ChevronUp /> : <ChevronDown />;
  };
  const handleSort = (field: keyof EventGuest) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleRsvpSave = async () => {
    if (!rsvpModal.guest) return;
    const guestId = rsvpModal.guest.guest_id;
    const newValue = rsvpModal.value ?? null;

    // Optimistic update — close modal and reflect change immediately
    onEventGuestsChange(eventGuests.map(g =>
      g.guest_id === guestId ? { ...g, rsvp_status: newValue } : g
    ));
    setRsvpModal({ isOpen: false, guest: null, value: undefined });

    try {
      const updatedEventGuests = await httpRequests.setRSVP(eventId, guestId, newValue);
      onEventGuestsChange(updatedEventGuests);
    } catch (error) {
      console.error("Error saving RSVP:", error);
      const fresh = await httpRequests.getEventGuests(eventId);
      onEventGuestsChange(fresh);
    }
  };

  const renderRsvpStatus = (status: RsvpStatus) => {
    switch (status) {
      case "confirmed":
        return isMobile ? (
          <Check color="green" />
        ) : (
          <Badge uppercase={false} skin="neutralSuccess">
            מאושר
          </Badge>
        );
      case "declined":
        return isMobile ? (
          <X color="red" />
        ) : (
          <Badge uppercase={false} skin="neutralDanger">
            סירוב
          </Badge>
        );
      default:
        return isMobile ? (
          <Clock color="orange" />
        ) : (
          <Badge uppercase={false} skin="warningLight">
            ממתין
          </Badge>
        );
    }
  };

  const columns: (TableColumn<RowDataDefaultType> & {
    showOnMobile: boolean;
  })[] = [
    {
      title: (
        <span onClick={() => handleSort("name")}>
          שם {renderSortIcon("name")}
        </span>
      ),
      render: (row: EventGuest) => row.name,
      showOnMobile: true,
      align: "start",
    },
    {
      title: <span>טלפון {renderSortIcon("phone")}</span>,
      render: (row: EventGuest) => row.phone,
      showOnMobile: false,
      align: "start",
    },
    {
      title: (
        <span onClick={() => handleSort("whose")}>
          מוזמן ע״י {renderSortIcon("whose")}
        </span>
      ),
      render: (row: EventGuest) => row.whose,
      showOnMobile: false,
      align: "start",
    },
    {
      title: (
        <span onClick={() => handleSort("circle")}>
          מעגל {renderSortIcon("circle")}
        </span>
      ),
      render: (row: EventGuest) => row.circle,
      showOnMobile: false,
      align: "start",
    },
    {
      title: <span>סטטוס אישור</span>,
      render: (row: EventGuest) =>
        renderRsvpStatus(getRsvpStatus(row.rsvp_status)),
      showOnMobile: true,
      align: "start",
    },
    {
      title: (
        <span onClick={() => handleSort("rsvp_status")}>
          מספר מאושרים {renderSortIcon("rsvp_status")}
        </span>
      ),
      render: (row: EventGuest) => (
        <span
          style={{ cursor: "pointer" }}
          onClick={() =>
            setRsvpModal({
              isOpen: true,
              guest: row,
              value: row.rsvp_status ?? undefined,
            })
          }
        >
          <Badge
            skin={
              row.rsvp_status === undefined || row.rsvp_status === null
                ? "warningLight"
                : row.rsvp_status > 0
                ? "neutralSuccess"
                : "neutralDanger"
            }
          >
            {row.rsvp_status ?? "P"}
          </Badge>
        </span>
      ),
      showOnMobile: true,
      align: "start",
    },
    {
      title: <span>מספר אורחים</span>,
      render: (row: EventGuest) => row.number_of_guests,
      showOnMobile: true,
      align: "start",
    },
    {
      title: "פעולות",
      render: (row: EventGuest) => (
        <Box gap="8px" justifyItems="start">
          <Button
            onClick={() => setEditGuestModal({ isOpen: true, guest: row })}
            skin="standard"
            priority="secondary"
            size="small"
            justifySelf="start"
          >
            <Pencil />
          </Button>
          <Button
            onClick={() => onDeleteGuest(row)}
            skin="destructive"
            size="small"
            justifySelf="start"
          >
            <Trash2 />
          </Button>
        </Box>
      ),
      showOnMobile: false,
      align: "start",
    },
  ];

  const mobileColumns = columns.filter((column) => column.showOnMobile);

  return (
    <div className="guest-list-container">
      <SearchAndFilterBar
        guestsList={eventGuests}
        setFilterOptions={setFilterOptions}
        filterOptions={filterOptions}
      />
      <Table
        data={sortedGuests}
        columns={isMobile ? mobileColumns : columns}
        rowVerticalPadding="medium"
      >
        <Table.Content />
      </Table>
      <div className="number-of-guests-shown">
        מציג {sortedGuests.length} מתוך {eventGuests.length} אורחים
      </div>

      <Modal
        isOpen={rsvpModal.isOpen}
        onRequestClose={() =>
          setRsvpModal({ isOpen: false, guest: null, value: undefined })
        }
        shouldCloseOnOverlayClick
      >
        <Box
          background="WHITE"
          borderRadius="10px"
          direction="vertical"
          gap="16px"
          padding="24px"
          align="center"
        >
          <Text weight="bold" size="medium">
            שינוי מספר מאושרים עבור {rsvpModal.guest?.name}
          </Text>
          <NumberInput
            value={rsvpModal.value}
            onChange={(value) =>
              setRsvpModal((prev) => ({
                ...prev,
                value: value ?? undefined,
              }))
            }
            min={0}
            placeholder="הזן מספר מאושרים"
            size="medium"
          />
          <Box direction="horizontal" gap="12px">
            <Button onClick={handleRsvpSave} size="small">
              שמירה
            </Button>
            <Button
              onClick={() =>
                setRsvpModal({
                  isOpen: false,
                  guest: null,
                  value: undefined,
                })
              }
              priority="secondary"
              size="small"
            >
              ביטול
            </Button>
          </Box>
        </Box>
      </Modal>

      <Modal isOpen={editGuestModal.isOpen}>
        {editGuestModal.guest && (
          <EditGuestModal
            guest={editGuestModal.guest}
            primaryGuestsList={primaryGuestsList}
            setIsEditGuestModalOpen={(isOpen) =>
              setEditGuestModal((prev) => ({ ...prev, isOpen }))
            }
            userID={userID}
            eventId={eventId}
            onEventGuestsChange={onEventGuestsChange}
          />
        )}
      </Modal>
      {ConfirmDialog}
    </div>
  );
};

export default GuestList;
