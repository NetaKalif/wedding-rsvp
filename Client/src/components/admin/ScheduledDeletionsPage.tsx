import React, { useEffect, useState, useCallback } from "react";
import { httpRequests, ScheduledDeletion } from "../../httpClient";
import { Box, Text, Button, Loader, Heading } from "@wix/design-system";
import Header from "../global/Header";

const DELETION_DAYS = 60;

const daysUntilDeletion = (weddingDate: string): number => {
  const deletionDate = new Date(weddingDate);
  deletionDate.setDate(deletionDate.getDate() + DELETION_DAYS);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((deletionDate.getTime() - Date.now()) / msPerDay);
};

const ScheduledDeletionsPage = () => {
  const [deletions, setDeletions] = useState<ScheduledDeletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningUserID, setActioningUserID] = useState<string | null>(null);

  const fetchDeletions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await httpRequests.getScheduledDeletions();
      setDeletions(rows);
    } catch (error) {
      console.error("Error fetching scheduled deletions:", error);
      alert("שגיאה בטעינת מחיקות מתוזמנות. אנא נסו שנית.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeletions();
  }, [fetchDeletions]);

  const handleCancel = async (userID: string) => {
    setActioningUserID(userID);
    try {
      await httpRequests.cancelScheduledDeletion(userID);
      await fetchDeletions();
    } catch (error) {
      console.error("Error cancelling scheduled deletion:", error);
      alert("שגיאה בביטול המחיקה. אנא נסו שנית.");
    } finally {
      setActioningUserID(null);
    }
  };

  return (
    <div className="admin-scheduled-deletions-page" dir="rtl">
      <Header showBackToDashboardButton={true} />
      <Box direction="vertical" gap="24px" padding="24px 16px">
        <Box direction="vertical" gap="4px">
          <Heading size="large">מחיקות מתוזמנות</Heading>
          <Text size="small" secondary>
            חשבונות שיימחקו אוטומטית 60 יום לאחר החתונה, וניתן לבטל את המחיקה שלהם.
          </Text>
        </Box>

        {loading ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Loader />
            <Text>טוען נתונים...</Text>
          </Box>
        ) : deletions.length === 0 ? (
          <Box align="center" paddingTop="SP4" paddingBottom="SP4">
            <Text secondary>אין מחיקות מתוזמנות כרגע.</Text>
          </Box>
        ) : (
          <Box direction="vertical" gap="SP2" maxWidth="700px">
            {deletions.map((deletion) => (
              <Box
                key={deletion.userID}
                padding="SP3"
                border="1px solid"
                borderColor="D3"
                borderRadius="6px"
                align="space-between"
                verticalAlign="middle"
              >
                <Box direction="vertical" gap="SP1">
                  <Text weight="bold">{deletion.name}</Text>
                  <Text size="small" secondary>
                    {deletion.email} | חתונה: {deletion.weddingDate}
                  </Text>
                  <Text size="small" secondary>
                    {deletion.cancelledAt
                      ? "המחיקה בוטלה"
                      : `מחיקה בעוד ${daysUntilDeletion(deletion.weddingDate)} ימים${
                          deletion.warningSentAt ? " (נשלח מייל התראה)" : " (טרם נשלח מייל התראה)"
                        }`}
                  </Text>
                </Box>
                <Box gap="SP2">
                  <Button
                    size="small"
                    priority="secondary"
                    skin="destructive"
                    disabled={actioningUserID === deletion.userID || !!deletion.cancelledAt}
                    onClick={() => handleCancel(deletion.userID)}
                  >
                    ביטול מחיקה
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

export default ScheduledDeletionsPage;
