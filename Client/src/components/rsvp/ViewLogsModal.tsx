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
  const [searchQuery, setSearchQuery] = useState("");

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

  const filteredLogs = logs.filter((log) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      log.message.toLowerCase().includes(searchLower) ||
      log.id.toString().includes(searchLower) ||
      formatTimestamp(log.createdAt).includes(searchQuery)
    );
  });

  return (
    <SidePanel
      onCloseButtonClick={handleClose}
      skin="floating"
      height="600px"
      width="800px"
    >
      <SidePanel.Header title="יומן מערכת" />
      <SidePanel.Content>
        <div className="logs-content-wrapper">
          {!loading && !error && logs.length > 0 && (
            <div className="logs-search-bar">
              <input
                type="text"
                placeholder="חיפוש ברשומות..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="logs-search-input"
              />
            </div>
          )}
          <div className="logs-main-area">
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
                ) : filteredLogs.length === 0 ? (
                  <div className="logs-empty">אין תוצאות עבור החיפוש</div>
                ) : (
                  <div className="logs-container">
                    {filteredLogs.map((log) => (
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
        </div>
        <div className="logs-footer">
          <Button onClick={handleClose}>סגירה</Button>
        </div>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default ViewLogsModal;
