import React, { useEffect, useState, useCallback } from "react";
import { User } from "../../types";
import { httpRequests } from "../../httpClient";
import { Box, Text, Button, Loader, Heading } from "@wix/design-system";
import Header from "../global/Header";

const AdminApprovalsPage = () => {
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningUserID, setActioningUserID] = useState<string | null>(null);

  const fetchPendingUsers = useCallback(async () => {
    setLoading(true);
    try {
      const users = await httpRequests.getPendingUsers();
      setPendingUsers(users);
    } catch (error) {
      console.error("Error fetching pending users:", error);
      alert("שגיאה בטעינת בקשות הרשמה. אנא נסו שנית.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPendingUsers();
  }, [fetchPendingUsers]);

  const handleApprove = async (userID: string) => {
    setActioningUserID(userID);
    try {
      await httpRequests.approveUser(userID);
      await fetchPendingUsers();
    } catch (error) {
      console.error("Error approving user:", error);
      alert("שגיאה באישור המשתמש. אנא נסו שנית.");
    } finally {
      setActioningUserID(null);
    }
  };

  const handleDecline = async (userID: string) => {
    setActioningUserID(userID);
    try {
      await httpRequests.declineUser(userID);
      await fetchPendingUsers();
    } catch (error) {
      console.error("Error declining user:", error);
      alert("שגיאה בדחיית המשתמש. אנא נסו שנית.");
    } finally {
      setActioningUserID(null);
    }
  };

  return (
    <div className="admin-approvals-page" dir="rtl">
      <Header showBackToDashboardButton={true} />
      <Box direction="vertical" gap="24px" padding="24px 16px">
        <Box direction="vertical" gap="4px">
          <Heading size="large">בקשות הרשמה ממתינות</Heading>
          <Text size="small" secondary>
            אישור או דחייה של משתמשים חדשים שממתינים לגישה למערכת.
          </Text>
        </Box>

        {loading ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Loader />
            <Text>טוען בקשות...</Text>
          </Box>
        ) : pendingUsers.length === 0 ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Text secondary>אין בקשות הרשמה ממתינות כרגע.</Text>
          </Box>
        ) : (
          <Box direction="vertical" gap="SP2" maxWidth="600px">
            {pendingUsers.map((user) => (
              <Box
                key={user.userID}
                padding="SP3"
                border="1px solid"
                borderColor="D3"
                borderRadius="6px"
                align="space-between"
                verticalAlign="middle"
              >
                <Box direction="vertical" gap="SP1">
                  <Text weight="bold">{user.name}</Text>
                  <Text size="small" secondary>
                    {user.email}
                  </Text>
                </Box>
                <Box gap="SP2">
                  <Button
                    size="small"
                    priority="primary"
                    disabled={actioningUserID === user.userID}
                    onClick={() => handleApprove(user.userID)}
                  >
                    אישור
                  </Button>
                  <Button
                    size="small"
                    priority="secondary"
                    skin="destructive"
                    disabled={actioningUserID === user.userID}
                    onClick={() => handleDecline(user.userID)}
                  >
                    דחייה
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </div>
  );
};

export default AdminApprovalsPage;
