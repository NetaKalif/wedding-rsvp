import React from "react";
import { Box, CustomModalLayout, Modal, Text } from "@wix/design-system";
import { EventGuest } from "../../types";

/**
 * Popup listing the guests behind a targeted invitation send: either the
 * guests whose invitation delivery failed, or guests added after the
 * invitation went out. Shared by the send modal's (i) icons and the
 * undelivered-guests banner.
 */

interface TargetedGuestListModalProps {
  target: "failed" | "unsent";
  /** The already-filtered guests of the category. */
  guests: EventGuest[];
  onClose: () => void;
}

const TargetedGuestListModal: React.FC<TargetedGuestListModalProps> = ({
  target,
  guests,
  onClose,
}) => (
  <Modal isOpen onRequestClose={onClose}>
    <CustomModalLayout
      title={
        target === "failed"
          ? "אורחים שההזמנה לא נמסרה אליהם"
          : "אורחים חדשים שטרם קיבלו הזמנה"
      }
      primaryButtonText="סגירה"
      primaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="400px"
      className="modal"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="8px">
            {target === "failed" ? (
              <>
                <Text size="small" secondary>
                  ההזמנה לא נמסרה לאורחים הבאים — כנראה בגלל מספר שגוי. בדקו
                  ותקנו את המספרים ברשימת האורחים, ואז שלחו אליהם מחדש:
                </Text>
                {guests.map((eg) => (
                  <Box key={eg.guest_id} direction="vertical" gap="2px">
                    <Text size="small" weight="bold">
                      {eg.name} {eg.phone ? `(${eg.phone})` : ""}
                    </Text>
                    <Text size="tiny" secondary>
                      {eg.last_send_error}
                    </Text>
                  </Box>
                ))}
              </>
            ) : (
              <>
                <Text size="small" secondary>
                  האורחים הבאים נוספו אחרי שההזמנה כבר נשלחה, ולכן טרם קיבלו
                  אותה:
                </Text>
                {guests.map((eg) => (
                  <Text size="small" weight="bold" key={eg.guest_id}>
                    {eg.name} {eg.phone ? `(${eg.phone})` : ""}
                  </Text>
                ))}
              </>
            )}
          </Box>
        </div>
      }
    />
  </Modal>
);

export default TargetedGuestListModal;
