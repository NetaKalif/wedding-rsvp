import React from "react";
import "./css/SendModalTabs.css";

/**
 * Full-width two-tab header shared by the send modals (manual send and
 * "send and go"). A hand-rolled replacement for the design-system <Tabs>,
 * which truncates/overflows the Hebrew titles inside the RTL side panels.
 */

interface SendModalTabsProps {
  items: { id: string; title: string }[];
  activeId: string;
  onChange: (id: string) => void;
}

const SendModalTabs: React.FC<SendModalTabsProps> = ({ items, activeId, onChange }) => (
  <div className="send-modal-tabs" role="tablist">
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={activeId === item.id}
        className={`send-modal-tab${activeId === item.id ? " active" : ""}`}
        onClick={() => onChange(item.id)}
      >
        {item.title}
      </button>
    ))}
  </div>
);

export default SendModalTabs;
