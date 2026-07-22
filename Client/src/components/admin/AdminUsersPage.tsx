import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { httpRequests, AdminUserRow } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { Box, Text, IconButton, Tooltip, Loader, Heading, FormField, Input, Table, TableColumn, Badge } from "@wix/design-system";
import { RowDataDefaultType } from "@wix/design-system/dist/types/Table/DataTable";
import { Check, X, LogIn, ShieldCheck, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import Header from "../global/Header";
import "./css/AdminUsersPage.css";

const DELETION_DAYS = 60;

const daysUntilDeletion = (weddingDate: string): number => {
  const deletionDate = new Date(weddingDate);
  deletionDate.setDate(deletionDate.getDate() + DELETION_DAYS);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((deletionDate.getTime() - Date.now()) / msPerDay);
};

// Positive: wedding is upcoming. Negative: wedding already happened that many days ago.
const daysUntilWedding = (weddingDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const wedding = new Date(weddingDate);
  wedding.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((wedding.getTime() - today.getTime()) / msPerDay);
};

const STATUS_LABELS: Record<AdminUserRow["status"], string> = {
  pending: "ממתין לאישור",
  approved: "מאושר",
  declined: "נדחה",
};

const STATUS_SKINS: Record<AdminUserRow["status"], "warningLight" | "neutralSuccess" | "neutralDanger"> = {
  pending: "warningLight",
  approved: "neutralSuccess",
  declined: "neutralDanger",
};

const ICON_COLOR_DISABLED = "#a0aec0";
const ICON_COLOR_APPROVE = "#38a169";
const ICON_COLOR_DESTRUCTIVE = "#e74c3c";
const ICON_COLOR_NEUTRAL = "#3182ce";

type SortField = "name" | "email" | "status" | "partner" | "wedding" | "deletion";

const getSortValue = (row: AdminUserRow, field: SortField): string | number => {
  switch (field) {
    case "name":
      return row.name.toLowerCase();
    case "email":
      return row.email.toLowerCase();
    case "status":
      return row.status;
    case "partner":
      return (row.partnerName || row.linkedToName || "").toLowerCase();
    case "wedding":
      return row.weddingDate ? daysUntilWedding(row.weddingDate) : Infinity;
    case "deletion":
      return row.weddingDate ? daysUntilDeletion(row.weddingDate) : Infinity;
  }
};

const AdminUsersPage = () => {
  const { user, switchUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [actioningUserID, setActioningUserID] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await httpRequests.getAllUsersDetailed();
      setUsers(rows);
    } catch (error) {
      console.error("Error fetching users:", error);
      alert("שגיאה בטעינת רשימת המשתמשים. אנא נסו שנית.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const withAction = async (userID: string, action: () => Promise<void>, errorMessage: string) => {
    setActioningUserID(userID);
    try {
      await action();
      await fetchUsers();
    } catch (error) {
      console.error(errorMessage, error);
      alert(errorMessage);
    } finally {
      setActioningUserID(null);
    }
  };

  const handleApprove = (userID: string) =>
    withAction(userID, () => httpRequests.approveUser(userID), "שגיאה באישור המשתמש. אנא נסו שנית.");

  const handleDecline = (userID: string) =>
    withAction(userID, () => httpRequests.declineUser(userID), "שגיאה בדחיית המשתמש. אנא נסו שנית.");

  const handleCancelDeletion = (userID: string) =>
    withAction(
      userID,
      () => httpRequests.cancelScheduledDeletion(userID),
      "שגיאה בביטול המחיקה. אנא נסו שנית.",
    );

  const handleImpersonate = async (row: AdminUserRow) => {
    setActioningUserID(row.userID);
    try {
      await switchUser({ userID: row.userID, name: row.name, email: row.email });
      navigate("/");
    } catch (error) {
      console.error("Error impersonating user:", error);
      alert("שגיאה בהתחברות כמשתמש זה. אנא נסו שנית.");
    } finally {
      setActioningUserID(null);
    }
  };

  const handleDelete = (row: AdminUserRow) => {
    if (!window.confirm(`למחוק לצמיתות את המשתמש ${row.name} (${row.email})? הפעולה אינה הפיכה.`)) return;
    withAction(row.userID, () => httpRequests.adminDeleteUser(row.userID), "שגיאה במחיקת המשתמש. אנא נסו שנית.");
  };

  const filteredUsers = users.filter(
    (row) =>
      row.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const valueA = getSortValue(a, sortField);
    const valueB = getSortValue(b, sortField);
    if (valueA < valueB) return sortDirection === "asc" ? -1 : 1;
    if (valueA > valueB) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const sortableTitle = (label: string, field: SortField) => (
    <span onClick={() => handleSort(field)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label} {renderSortIcon(field)}
    </span>
  );

  const columns: (TableColumn<RowDataDefaultType> & { showOnMobile: boolean })[] = [
    {
      title: sortableTitle("שם", "name"),
      render: (row: AdminUserRow) => (
        <span>
          {row.name} {row.userID === user?.userID && "(את/ה)"}
        </span>
      ),
      align: "start",
      showOnMobile: true,
    },
    {
      title: sortableTitle("אימייל", "email"),
      render: (row: AdminUserRow) => row.email,
      align: "start",
      showOnMobile: false,
    },
    {
      title: sortableTitle("סטטוס", "status"),
      render: (row: AdminUserRow) => (
        <Badge uppercase={false} skin={STATUS_SKINS[row.status]}>
          {STATUS_LABELS[row.status]}
        </Badge>
      ),
      align: "start",
      width: "110px",
      showOnMobile: true,
    },
    {
      title: sortableTitle("קישור בן/בת זוג", "partner"),
      render: (row: AdminUserRow) =>
        row.partnerName ? `בן/בת זוג: ${row.partnerName}` : row.linkedToName ? `מקושר/ת עם: ${row.linkedToName}` : "—",
      align: "start",
      showOnMobile: false,
    },
    {
      title: sortableTitle("ימים עד לחתונה", "wedding"),
      render: (row: AdminUserRow) => {
        if (!row.weddingDate) return "—";
        const days = daysUntilWedding(row.weddingDate);
        if (days > 0) return `בעוד ${days}`;
        if (days === 0) return "היום!";
        return `לפני ${Math.abs(days)}`;
      },
      align: "start",
      showOnMobile: false,
    },
    {
      title: sortableTitle("מחיקת נתונים", "deletion"),
      render: (row: AdminUserRow) =>
        row.weddingDate ? (
          row.cancelledAt ? (
            "המחיקה בוטלה"
          ) : (
            <span>
              בעוד {daysUntilDeletion(row.weddingDate)} ימים
              <br />
              {row.warningSentAt ? "(נשלח מייל התראה)" : "(טרם נשלח מייל התראה)"}
            </span>
          )
        ) : (
          "—"
        ),
      align: "start",
      showOnMobile: false,
    },
    {
      title: "פעולות",
      showOnMobile: true,
      render: (row: AdminUserRow) => {
        const isSelf = row.userID === user?.userID;
        const isActioning = actioningUserID === row.userID;
        const hasActiveDeletionCountdown = !!row.weddingDate && !row.cancelledAt;
        const approveDisabled = isActioning;
        const declineDisabled = isActioning;
        const impersonateDisabled = isActioning || isSelf;
        const cancelDeletionDisabled = isActioning;
        const deleteDisabled = isActioning || isSelf;

        return (
          <Box gap="4px">
            {row.status === "pending" && (
              <>
                <Tooltip content="אישור">
                  <IconButton
                    size="tiny"
                    skin="transparent"
                    className="admin-action-icon-btn"
                    disabled={approveDisabled}
                    onClick={() => handleApprove(row.userID)}
                  >
                    <Check size={14} style={{ color: approveDisabled ? ICON_COLOR_DISABLED : ICON_COLOR_APPROVE }} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="דחייה">
                  <IconButton
                    size="tiny"
                    skin="transparent"
                    className="admin-action-icon-btn"
                    disabled={declineDisabled}
                    onClick={() => handleDecline(row.userID)}
                  >
                    <X size={14} style={{ color: declineDisabled ? ICON_COLOR_DISABLED : ICON_COLOR_DESTRUCTIVE }} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {row.status === "approved" && (
              <Tooltip content="התחברות כמשתמש זה">
                <IconButton
                  size="tiny"
                  skin="transparent"
                  className="admin-action-icon-btn"
                  disabled={impersonateDisabled}
                  onClick={() => handleImpersonate(row)}
                >
                  <LogIn size={14} style={{ color: impersonateDisabled ? ICON_COLOR_DISABLED : ICON_COLOR_NEUTRAL }} />
                </IconButton>
              </Tooltip>
            )}
            {hasActiveDeletionCountdown && (
              <Tooltip content="ביטול מחיקה מתוזמנת">
                <IconButton
                  size="tiny"
                  skin="transparent"
                  className="admin-action-icon-btn"
                  disabled={cancelDeletionDisabled}
                  onClick={() => handleCancelDeletion(row.userID)}
                >
                  <ShieldCheck
                    size={14}
                    style={{ color: cancelDeletionDisabled ? ICON_COLOR_DISABLED : ICON_COLOR_APPROVE }}
                  />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip content="מחיקת משתמש">
              <IconButton
                size="tiny"
                skin="transparent"
                className="admin-action-icon-btn"
                disabled={deleteDisabled}
                onClick={() => handleDelete(row)}
              >
                <Trash2 size={14} style={{ color: deleteDisabled ? ICON_COLOR_DISABLED : ICON_COLOR_DESTRUCTIVE }} />
              </IconButton>
            </Tooltip>
          </Box>
        );
      },
      align: "start",
    },
  ];

  const mobileColumns = columns.filter((column) => column.showOnMobile);

  return (
    <div className="admin-users-page" dir="rtl">
      <Header showBackToDashboardButton={true} />
      <Box direction="vertical" gap="24px" padding="24px 16px">
        <Box direction="vertical" gap="4px">
          <Heading size="large">ניהול משתמשים</Heading>
          <Text size="small" secondary>
            כל המשתמשים במערכת: אישור/דחייה, התחברות כמשתמש, מחיקה, וסטטוס מחיקת נתונים.
          </Text>
        </Box>

        <Box maxWidth="360px">
          <FormField label="חיפוש">
            <Input
              placeholder="חיפוש לפי שם או אימייל..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </FormField>
        </Box>

        {loading ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Loader />
            <Text>טוען משתמשים...</Text>
          </Box>
        ) : filteredUsers.length === 0 ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Text secondary>
              {searchTerm ? "לא נמצאו משתמשים התואמים לחיפוש." : "אין משתמשים במערכת."}
            </Text>
          </Box>
        ) : (
          <Box
            border="1px solid"
            borderColor="D3"
            borderRadius="12px"
            style={{ overflow: "hidden" }}
          >
            <Table
              data={sortedUsers}
              columns={isMobile ? mobileColumns : columns}
              rowVerticalPadding="medium"
            >
              <Table.Content />
            </Table>
          </Box>
        )}
      </Box>
    </div>
  );
};

export default AdminUsersPage;
