import React, { useState, useEffect } from "react";
import { User } from "../../types";
import { httpRequests } from "../../httpClient";
import {
  Modal,
  SidePanel,
  FormField,
  Input,
  Button,
  Box,
  Text,
  Loader,
} from "@wix/design-system";

interface SwitchUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserID: string;
  onSwitchUser: (user: User) => void;
}

export const SwitchUserModal: React.FC<SwitchUserModalProps> = ({
  isOpen,
  onClose,
  currentUserID,
  onSwitchUser,
}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUserID]);

  useEffect(() => {
    const filtered = users.filter(
      (user) =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [users, searchTerm]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const allUsers = await httpRequests.getUsers(currentUserID);
      setUsers(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      alert("שגיאה בטעינת משתמשים. אנא נסו שנית.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setSearchTerm("");
  };

  const handleSwitchUser = (user: User) => {
    onSwitchUser(user);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen}>
    <SidePanel
      onCloseButtonClick={handleClose}
      skin="floating"
      height="600px"
      width="500px"
    >
      <SidePanel.Header title="החלפת משתמש" />
      <SidePanel.Content>
        <Box direction="vertical" gap={4}>
          <FormField label="חיפוש משתמשים">
            <Input
              placeholder="חיפוש לפי שם או אימייל..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </FormField>

          {loading ? (
            <Box align="center" paddingTop={4} paddingBottom={4}>
              <Loader />
              <Text>טוען משתמשים...</Text>
            </Box>
          ) : (
            <Box direction="vertical" gap={2} maxHeight="400px" overflow="auto">
              {filteredUsers.length === 0 ? (
                <Box align="center" paddingTop={4} paddingBottom={4}>
                  <Text size="medium" secondary>
                    {searchTerm
                      ? "לא נמצאו משתמשים התואמים לחיפוש."
                      : "אין משתמשים זמינים."}
                  </Text>
                </Box>
              ) : (
                filteredUsers.map((user) => (
                  <Box
                    key={user.userID}
                    padding={3}
                    border="1px solid"
                    borderColor="D3"
                    borderRadius="6px"
                    align="space-between"
                  >
                    <Box direction="vertical" gap={1}>
                      <Text weight="bold">{user.name}</Text>
                      <Text size="small" secondary>
                        {user.email}
                      </Text>
                    </Box>
                    <Button
                      size="small"
                      priority={
                        user.userID === currentUserID ? "secondary" : "primary"
                      }
                      disabled={user.userID === currentUserID}
                      onClick={() => handleSwitchUser(user)}
                    >
                      {user.userID === currentUserID
                        ? "משתמש נוכחי"
                        : "התחבר כמשתמש זה"}
                    </Button>
                  </Box>
                ))
              )}
            </Box>
          )}
        </Box>
      </SidePanel.Content>
    </SidePanel>
    </Modal>
  );
};
