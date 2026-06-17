import React, { useState } from "react";
import { Box, CustomModalLayout, Modal, Text } from "@wix/design-system";

interface ConfirmOptions {
  message: string;
  title?: string;
  confirmText?: string;
}

export const useConfirm = () => {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = (options: ConfirmOptions | string): Promise<boolean> => {
    const normalized = typeof options === "string" ? { message: options } : options;
    return new Promise((resolve) => {
      setState({ options: normalized, resolve });
    });
  };

  const handleConfirm = () => {
    state?.resolve(true);
    setState(null);
  };

  const handleCancel = () => {
    state?.resolve(false);
    setState(null);
  };

  const ConfirmDialog = state ? (
    <Modal isOpen onRequestClose={handleCancel}>
      <CustomModalLayout
        title={state.options.title ?? "אישור מחיקה"}
        primaryButtonText={state.options.confirmText ?? "מחק"}
        primaryButtonOnClick={handleConfirm}
        primaryButtonProps={{ skin: "destructive" } as any}
        secondaryButtonText="ביטול"
        secondaryButtonOnClick={handleCancel}
        onCloseButtonClick={handleCancel}
        width="420px"
        content={
          <Box padding="12px 0">
            <Text>{state.options.message}</Text>
          </Box>
        }
      />
    </Modal>
  ) : null;

  return { confirm, ConfirmDialog };
};
