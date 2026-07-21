import React, { useState, useEffect } from "react";
import { Button, Loader, SidePanel } from "@wix/design-system";
import { ClientLog } from "../../types";
import { httpRequests } from "../../httpClient";
import "./css/ViewLogsModal.css";

interface ViewLogsModalProps {
  setIsViewLogsModalOpen: (isOpen: boolean) => void;
}

const ViewLogsModal: React.FC<ViewLogsModalProps> = ({
  setIsViewLogsModalOpen,
}) => {
  const [logs, setLogs] = useState<ClientLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError(null);
        const fetchedLogs = await httpRequests.getLogs();
        setLogs(fetchedLogs);
      } catch (err) {
        setError("שגיאה בטעינת הרשומות");
        console.error("Error fetching logs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("he-IL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const handleClose = () => {
    setIsViewLogsModalOpen(false);
  };

  return (
    <SidePanel
      onCloseButtonClick={handleClose}
      skin="floating"
      height="600px"
      width="800px"
    >
      <SidePanel.Header title="יומן מערכת" />
      <SidePanel.Content>
        <div style={{ minHeight: "400px", maxHeight: "500px" }}>
          {loading && (
            <div className="logs-loading">
              <Loader />
            </div>
          )}

          {error && <div className="logs-error">{error}</div>}

          {!loading && !error && (
            <>
              {logs.length === 0 ? (
                <div className="logs-empty">לא נמצאו רשומות</div>
              ) : (
                <div className="logs-container">
                  {logs.map((log) => (
                    <div key={log.id} className="log-entry">
                      <div className="log-header">
                        <span className="log-timestamp">
                          {formatTimestamp(log.createdAt)}
                        </span>
                        <span className="log-id">ID: {log.id}</span>
                      </div>
                      <div className="log-message">{log.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="logs-footer">
          <Button onClick={handleClose}>סגירה</Button>
        </div>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default ViewLogsModal;
