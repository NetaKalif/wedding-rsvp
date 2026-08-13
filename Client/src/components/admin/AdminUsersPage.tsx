import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { httpRequests, AdminUserRow } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { Box, Text, IconButton, Loader, Heading, FormField, Input, Table, TableColumn, Badge, PopoverMenu } from "@wix/design-system";
import { RowDataDefaultType } from "@wix/design-system/dist/types/Table/DataTable";
import { Check, X, LogIn, ShieldCheck, Trash2, ChevronUp, ChevronDown, MessageSquare, UserX, MoreVertical, Clock } from "lucide-react";
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

type SortField = "name" | "email" | "status" | "messaging" | "partner" | "wedding" | "deletion";

const getSortValue = (row: AdminUserRow, field: SortField): string | number => {
  switch (field) {
    case "name":
      return row.name.toLowerCase();
    case "email":
      return row.email.toLowerCase();
    case "status":
      return row.status;
    case "messaging":
      return row.messagingPermissionStatus === "approved" ? 2 : row.hasPendingMessageRequest ? 1 : 0;
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

  const handleSetMessagingPermission = (userID: string, approved: boolean) =>
    withAction(
      userID,
      () => httpRequests.setMessagingPermission(userID, approved),
      "שגיאה בעדכון הרשאת שליחת הודעות. אנא נסו שנית.",
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

  const handleRevokeApproval = (row: AdminUserRow) => {
    if (!window.confirm(`לבטל את האישור של ${row.name}? הנתונים יישמרו, אך המשתמש יחזור לסטטוס "ממתין לאישור" ולא יוכל להיכנס עד שיאושר מחדש.`)) return;
    withAction(row.userID, () => httpRequests.revokeUserApproval(row.userID), "שגיאה בביטול האישור. אנא נסו שנית.");
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
      render: (row: AdminUserRow) =>
        isMobile ? (
          row.status === "approved" ? (
            <Check size={18} style={{ color: "#38a169" }} aria-label="מאושר" />
          ) : row.status === "declined" ? (
            <X size={18} style={{ color: "#e74c3c" }} aria-label="נדחה" />
          ) : (
            <Clock size={18} style={{ color: "#d69e2e" }} aria-label="ממתין לאישור" />
          )
        ) : (
          <Badge uppercase={false} skin={STATUS_SKINS[row.status]}>
            {STATUS_LABELS[row.status]}
          </Badge>
        ),
      align: "start",
      width: isMobile ? "50px" : "110px",
      showOnMobile: true,
    },
    {
      title: sortableTitle(isMobile ? "הודעות" : "הרשאת הודעות", "messaging"),
      render: (row: AdminUserRow) =>
        isMobile ? (
          row.messagingPermissionStatus === "approved" ? (
            <Check size={18} style={{ color: "#38a169" }} aria-label="מאושרת" />
          ) : row.hasPendingMessageRequest ? (
            <Clock size={18} style={{ color: "#d69e2e" }} aria-label="ממתין לאישור" />
          ) : (
            <X size={18} style={{ color: "#e74c3c" }} aria-label="אין הרשאה" />
          )
        ) : row.messagingPermissionStatus === "approved" ? (
          <Badge uppercase={false} skin="neutralSuccess">מאושרת</Badge>
        ) : row.hasPendingMessageRequest ? (
          <Badge uppercase={false} skin="warningLight">ממתין לאישור</Badge>
        ) : (
          <Badge uppercase={false} skin="neutralDanger">אין הרשאה</Badge>
        ),
      align: "start",
      width: isMobile ? "50px" : "130px",
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

        if (isActioning) return <Loader size="tiny" />;

        return (
          <PopoverMenu
            textSize="small"
            placement="bottom"
            appendTo="window"
            triggerElement={
              <IconButton size="tiny" skin="transparent" className="admin-action-icon-btn">
                <MoreVertical size={16} style={{ color: "#000" }} />
              </IconButton>
            }
          >
            {[
              row.status === "pending" && (
                <PopoverMenu.MenuItem
                  key="approve"
                  text="אישור משתמש"
                  prefixIcon={<Check size={14} />}
                  onClick={() => handleApprove(row.userID)}
                />
              ),
              row.status === "pending" && (
                <PopoverMenu.MenuItem
                  key="decline"
                  text="דחיית משתמש"
                  skin="destructive"
                  prefixIcon={<X size={14} />}
                  onClick={() => handleDecline(row.userID)}
                />
              ),
              row.status === "approved" && (
                <PopoverMenu.MenuItem
                  key="messaging"
                  text={
                    row.messagingPermissionStatus === "approved"
                      ? "ביטול הרשאת שליחת הודעות"
                      : "אישור הרשאת שליחת הודעות"
                  }
                  prefixIcon={<MessageSquare size={14} />}
                  onClick={() =>
                    handleSetMessagingPermission(row.userID, row.messagingPermissionStatus !== "approved")
                  }
                />
              ),
              row.status === "approved" && !isSelf && (
                <PopoverMenu.MenuItem
                  key="impersonate"
                  text="התחברות כמשתמש זה"
                  prefixIcon={<LogIn size={14} />}
                  onClick={() => handleImpersonate(row)}
                />
              ),
              row.status === "approved" && !isSelf && (
                <PopoverMenu.MenuItem
                  key="revoke"
                  text="ביטול אישור — החזרה לסטטוס ממתין"
                  skin="destructive"
                  prefixIcon={<UserX size={14} />}
                  onClick={() => handleRevokeApproval(row)}
                />
              ),
              hasActiveDeletionCountdown && (
                <PopoverMenu.MenuItem
                  key="cancel-deletion"
                  text="ביטול מחיקה מתוזמנת"
                  prefixIcon={<ShieldCheck size={14} />}
                  onClick={() => handleCancelDeletion(row.userID)}
                />
              ),
              !isSelf && (
                <PopoverMenu.MenuItem
                  key="delete"
                  text="מחיקת משתמש"
                  skin="destructive"
                  prefixIcon={<Trash2 size={14} />}
                  onClick={() => handleDelete(row)}
                />
              ),
            ].filter(Boolean)}
          </PopoverMenu>
        );
      },
      align: "start",
      width: "70px",
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
            כל המשתמשים במערכת: אישור/דחייה, הרשאת שליחת הודעות, התחברות כמשתמש, מחיקה, וסטטוס מחיקת נתונים.
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
