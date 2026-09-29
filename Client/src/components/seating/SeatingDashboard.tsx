import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Loader, Modal, PopoverMenu, Text, Input, FormField } from "@wix/design-system";
import { ChevronDown } from "@wix/wix-ui-icons-common";
import "@wix/design-system/styles.global.css";
import Konva from "konva";
import { Undo2, Redo2, Trash2, Copy, Eraser, Image as ImageIcon, Printer, FileSpreadsheet, Ruler } from "lucide-react";
import Header from "../global/Header";
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../hooks/useConfirm";
import { useAppData } from "../../hooks/useAppData";
import { httpRequests } from "../../httpClient";
import {
  CustomTablePreset,
  SeatingAssignment,
  SeatingItem,
  SeatingItemKind,
  SeatingLayout,
} from "../../types";
import { SeatingCanvas } from "./SeatingCanvas";
import { ObjectsBank } from "./panel/ObjectsBank";
import { GuestsPanel } from "./panel/GuestsPanel";
import { TableModal } from "./TableModal";
import { CustomPresetModal } from "./CustomPresetModal";
import {
  BankEntry,
  buildDuplicate,
  clampToRoom,
  nextTableNumber,
  OBJECT_COLORS,
  remapItemId,
  SeatingBatchableEntry,
  SeatingHistoryEntry,
  snapToGrid,
} from "./logic";
import { downloadDataUrl, downloadSeatingXlsx, openPrintView, stageToRoomPng } from "./export";
import "./css/Seating.css";

const AUTOSAVE_DEBOUNCE_MS = 800;
const HISTORY_LIMIT = 50;

// Geometry/props fields that flow through the debounced autosave buffer
type ItemChanges = Partial<Pick<SeatingItem,
  "x_cm" | "y_cm" | "width_cm" | "height_cm" | "rotation_deg" | "label" | "capacity" | "table_number" | "color">>;

export const SeatingDashboard: React.FC = () => {
  const { weddingInfo } = useAuth();
  const { eventGuestsByEventId, refreshEventGuests } = useAppData();
  const eventId = weddingInfo?.id ?? null;
  const eventGuests = useMemo(
    () => (eventId != null ? eventGuestsByEventId[eventId] ?? [] : []),
    [eventGuestsByEventId, eventId],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [layout, setLayout] = useState<SeatingLayout | null>(null);
  const [items, setItems] = useState<SeatingItem[]>([]);
  const [assignments, setAssignments] = useState<SeatingAssignment[]>([]);
  const [presets, setPresets] = useState<CustomTablePreset[]>([]);

  const [activeTab, setActiveTab] = useState<"objects" | "guests">("objects");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [modalTableId, setModalTableId] = useState<number | null>(null);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<CustomTablePreset | null>(null);
  const [presetModalKind, setPresetModalKind] = useState<SeatingItemKind>("table");
  const [showLayoutForm, setShowLayoutForm] = useState(false);

  // Canvas-scoped undo/redo: field updates AND create/delete are all entries.
  // Undoing a delete recreates the item (new DB id) and restores its guests;
  // remapItemId keeps both stacks pointing at the fresh id.
  const [past, setPast] = useState<SeatingHistoryEntry[]>([]);
  const [future, setFuture] = useState<SeatingHistoryEntry[]>([]);
  const historyBusy = useRef(false); // undo/redo hit the API — no overlapping runs

  const stageRef = useRef<Konva.Stage | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  // Custom color-picker session: the color when the picker opened, so the whole
  // drag through the palette becomes ONE history entry (pushed on blur)
  const colorSessionStart = useRef<string | null | undefined>(undefined);

  // ==================== Autosave (debounced batch PATCH) ====================

  const saveBuffer = useRef<Map<number, ItemChanges>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAutosave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (eventId == null || saveBuffer.current.size === 0) return;
    const updates = Array.from(saveBuffer.current.entries()).map(([id, changes]) => ({ id, ...changes }));
    saveBuffer.current = new Map();
    try {
      await httpRequests.updateSeatingItems(eventId, updates);
    } catch {
      // Re-buffer so the next edit retries the failed save
      updates.forEach(({ id, ...changes }) => {
        saveBuffer.current.set(id, { ...changes, ...saveBuffer.current.get(id) });
      });
    }
  }, [eventId]);

  const bufferChanges = useCallback((id: number, changes: ItemChanges) => {
    saveBuffer.current.set(id, { ...saveBuffer.current.get(id), ...changes });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
  }, [flushAutosave]);

  useEffect(() => () => { void flushAutosave(); }, [flushAutosave]);

  // ==================== Load ====================

  useEffect(() => {
    if (eventId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const [seating, tablePresets] = await Promise.all([
          httpRequests.getSeating(eventId),
          httpRequests.getTablePresets(),
          refreshEventGuests(eventId),
        ]);
        if (cancelled) return;
        setLayout(seating.layout);
        setItems(seating.items);
        setAssignments(seating.assignments);
        setPresets(tablePresets);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ==================== History ====================

  const pushHistory = useCallback((entry: SeatingHistoryEntry) => {
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), entry]);
    setFuture([]);
  }, []);

  /** Apply field changes locally and buffer them for autosave. */
  const applyUpdate = useCallback((itemId: number, fields: Partial<SeatingItem>) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...fields } : i)));
    bufferChanges(itemId, fields as ItemChanges);
  }, [bufferChanges]);

  /** Delete an item on the server + locally; returns the assignments it had. */
  const removeItem = useCallback(async (item: SeatingItem): Promise<SeatingAssignment[]> => {
    if (eventId == null) throw new Error("no event");
    const captured = assignments.filter((a) => a.item_id === item.id);
    await httpRequests.deleteSeatingItem(eventId, item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setAssignments((prev) => prev.filter((a) => a.item_id !== item.id)); // cascades server-side
    setSelectedItemId((sel) => (sel === item.id ? null : sel));
    saveBuffer.current.delete(item.id);
    return captured;
  }, [eventId, assignments]);

  /** Assign (or move) a guest on the server + locally. Shared by handlers and undo/redo. */
  const doAssign = useCallback(async (eventGuestId: number, tableId: number) => {
    if (eventId == null) throw new Error("no event");
    const saved = await httpRequests.assignGuestToTable(eventId, tableId, eventGuestId);
    const guest = eventGuests.find((g) => g.id === eventGuestId);
    const enriched: SeatingAssignment = {
      ...saved,
      rsvp_status: guest?.rsvp_status,
      name: guest?.name,
      number_of_guests: guest?.number_of_guests,
    };
    // Upsert semantics: a re-assigned guest moved tables
    setAssignments((prev) => [...prev.filter((a) => a.event_guest_id !== eventGuestId), enriched]);
  }, [eventId, eventGuests]);

  const doUnassign = useCallback(async (eventGuestId: number) => {
    if (eventId == null) throw new Error("no event");
    await httpRequests.unassignGuest(eventId, eventGuestId);
    setAssignments((prev) => prev.filter((a) => a.event_guest_id !== eventGuestId));
  }, [eventId]);

  /** Recreate an item (new DB id) and re-seat the guests it had; returns the new id. */
  const recreateItem = useCallback(async (
    item: SeatingItem,
    storedAssignments: SeatingAssignment[],
  ): Promise<number> => {
    if (eventId == null) throw new Error("no event");
    const { id, event_id, ...fields } = item;
    const created = await httpRequests.createSeatingItem(eventId, fields);
    const restored: SeatingAssignment[] = [];
    for (const a of storedAssignments) {
      try {
        const saved = await httpRequests.assignGuestToTable(eventId, created.id, a.event_guest_id);
        const guest = eventGuests.find((g) => g.id === a.event_guest_id);
        restored.push({
          ...saved,
          rsvp_status: guest?.rsvp_status,
          name: guest?.name,
          number_of_guests: guest?.number_of_guests,
        });
      } catch { /* guest may have left the event since — skip */ }
    }
    setItems((prev) => [...prev, created]);
    setAssignments((prev) => [...prev, ...restored]);
    return created.id;
  }, [eventId, eventGuests]);

  /** Inverse of a single batchable entry (update/assign/unassign). */
  const undoSingle = useCallback(async (entry: SeatingBatchableEntry) => {
    if (entry.type === "update") {
      applyUpdate(entry.itemId, entry.before);
    } else if (entry.type === "assign") {
      // Put the guest back where they came from (or unassign if they were free)
      if (entry.previousItemId != null) await doAssign(entry.eventGuestId, entry.previousItemId);
      else await doUnassign(entry.eventGuestId);
    } else {
      await doAssign(entry.eventGuestId, entry.itemId);
    }
  }, [applyUpdate, doAssign, doUnassign]);

  /** Re-applies a single batchable entry forward. */
  const redoSingle = useCallback(async (entry: SeatingBatchableEntry) => {
    if (entry.type === "update") {
      applyUpdate(entry.itemId, entry.after);
    } else if (entry.type === "assign") {
      await doAssign(entry.eventGuestId, entry.itemId);
    } else {
      await doUnassign(entry.eventGuestId);
    }
  }, [applyUpdate, doAssign, doUnassign]);

  const undo = useCallback(async () => {
    if (historyBusy.current || past.length === 0) return;
    historyBusy.current = true;
    const entry = past[past.length - 1];
    try {
      if (entry.type === "update" || entry.type === "assign" || entry.type === "unassign") {
        await undoSingle(entry);
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [...f, entry]);
      } else if (entry.type === "batch") {
        // One user action (a modal save) — revert all of it, last op first
        for (let i = entry.entries.length - 1; i >= 0; i--) await undoSingle(entry.entries[i]);
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [...f, entry]);
      } else if (entry.type === "create") {
        // Inverse of create is delete; capture the guests seated since, so redo restores them
        const captured = await removeItem(entry.item);
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [...f, { ...entry, assignments: captured }]);
      } else {
        // Inverse of delete is recreate — new DB id, so remap both stacks
        const newId = await recreateItem(entry.item, entry.assignments);
        const [moved] = remapItemId([entry], entry.item.id, newId);
        setPast((p) => remapItemId(p.slice(0, -1), entry.item.id, newId));
        setFuture((f) => [...remapItemId(f, entry.item.id, newId), moved]);
      }
    } catch { /* API failed — leave the stacks untouched */ } finally {
      historyBusy.current = false;
    }
  }, [past, undoSingle, removeItem, recreateItem]);

  const redo = useCallback(async () => {
    if (historyBusy.current || future.length === 0) return;
    historyBusy.current = true;
    const entry = future[future.length - 1];
    try {
      if (entry.type === "update" || entry.type === "assign" || entry.type === "unassign") {
        await redoSingle(entry);
        setFuture((f) => f.slice(0, -1));
        setPast((p) => [...p, entry]);
      } else if (entry.type === "batch") {
        for (const sub of entry.entries) await redoSingle(sub);
        setFuture((f) => f.slice(0, -1));
        setPast((p) => [...p, entry]);
      } else if (entry.type === "create") {
        const newId = await recreateItem(entry.item, entry.assignments);
        const [moved] = remapItemId([entry], entry.item.id, newId);
        setFuture((f) => remapItemId(f.slice(0, -1), entry.item.id, newId));
        setPast((p) => [...remapItemId(p, entry.item.id, newId), moved]);
      } else {
        const captured = await removeItem(entry.item);
        setFuture((f) => f.slice(0, -1));
        setPast((p) => [...p, { ...entry, assignments: captured }]);
      }
    } catch { /* API failed — leave the stacks untouched */ } finally {
      historyBusy.current = false;
    }
  }, [future, redoSingle, removeItem, recreateItem]);

  // ==================== Item operations ====================

  const handleItemChange = useCallback((id: number, changes: Partial<SeatingItem>) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const before: Partial<SeatingItem> = {};
    Object.keys(changes).forEach((f) => { (before as any)[f] = (current as any)[f]; });
    pushHistory({ type: "update", itemId: id, before, after: changes });
    applyUpdate(id, changes);
  }, [items, pushHistory, applyUpdate]);

  const createItemOnCanvas = useCallback(async (fields: Omit<SeatingItem, "id" | "event_id">) => {
    if (eventId == null) return;
    try {
      const item = await httpRequests.createSeatingItem(eventId, fields);
      setItems((prev) => [...prev, item]);
      setSelectedItemId(item.id);
      pushHistory({ type: "create", item, assignments: [] });
    } catch { /* server rejected — nothing was added */ }
  }, [eventId, pushHistory]);

  const handleDropNewItem = useCallback(async (entry: BankEntry, label: string | null, xCm: number, yCm: number) => {
    if (!layout) return;
    const pos = clampToRoom({
      x_cm: snapToGrid(Math.round(xCm - entry.width_cm / 2)),
      y_cm: snapToGrid(Math.round(yCm - entry.height_cm / 2)),
      width_cm: entry.width_cm,
      height_cm: entry.height_cm,
    }, layout.room_width_cm, layout.room_height_cm);
    await createItemOnCanvas({
      kind: entry.kind,
      shape: entry.shape,
      label,
      table_number: entry.kind === "table" ? nextTableNumber(items) : null,
      capacity: entry.capacity,
      x_cm: pos.x_cm,
      y_cm: pos.y_cm,
      width_cm: entry.width_cm,
      height_cm: entry.height_cm,
      rotation_deg: 0,
      color: entry.color ?? null,
    });
  }, [layout, items, createItemOnCanvas]);

  // Duplicates the item only — guests stay at the original table
  const handleDuplicateItem = useCallback(async (id: number) => {
    const source = items.find((i) => i.id === id);
    if (!source || !layout) return;
    await createItemOnCanvas(buildDuplicate(source, items, layout.room_width_cm, layout.room_height_cm));
  }, [items, layout, createItemOnCanvas]);

  const handleDeleteItem = useCallback(async (id: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    try {
      const captured = await removeItem(item);
      pushHistory({ type: "delete", item, assignments: captured });
    } catch { /* keep state — delete failed */ }
  }, [items, removeItem, pushHistory]);

  // Clean canvas: wipes every item (guests become unassigned). Not undoable —
  // the confirmation dialog is the guard — so the history is cleared with it.
  const handleClearCanvas = useCallback(async () => {
    if (eventId == null || items.length === 0) return;
    const confirmed = await confirm({
      title: "ניקוי הקנבס",
      message: `למחוק את כל ${items.length} השולחנות והאובייקטים מהאולם? האורחים יחזרו לרשימת הלא-משובצים. לא ניתן לבטל פעולה זו.`,
      confirmText: "נקה הכל",
    });
    if (!confirmed) return;
    try {
      await httpRequests.clearSeatingItems(eventId);
      setItems([]);
      setAssignments([]);
      setSelectedItemId(null);
      saveBuffer.current = new Map();
      setPast([]);
      setFuture([]);
    } catch { /* keep state — clear failed */ }
  }, [eventId, items.length, confirm]);

  // Delete key removes the selected item (unless typing in an input or a modal is open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedItemId == null || modalTableId != null || showPresetModal || showLayoutForm) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      void handleDeleteItem(selectedItemId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItemId, modalTableId, showPresetModal, showLayoutForm, handleDeleteItem]);

  // ==================== Assignments ====================

  const handleAssignGuest = useCallback(async (eventGuestId: number, tableId: number) => {
    const previousItemId = assignments.find((a) => a.event_guest_id === eventGuestId)?.item_id ?? null;
    if (previousItemId === tableId) return; // dropped back on the same table — no-op
    try {
      await doAssign(eventGuestId, tableId);
      pushHistory({ type: "assign", eventGuestId, itemId: tableId, previousItemId });
    } catch { /* assignment rejected server-side */ }
  }, [assignments, doAssign, pushHistory]);

  const handleUnassignGuest = useCallback(async (eventGuestId: number) => {
    const current = assignments.find((a) => a.event_guest_id === eventGuestId);
    if (!current) return;
    try {
      await doUnassign(eventGuestId);
      pushHistory({ type: "unassign", eventGuestId, itemId: current.item_id });
    } catch { /* keep state — unassign failed */ }
  }, [assignments, doUnassign, pushHistory]);

  /**
   * The table-modal save: props changes + staged guest removals/additions are
   * applied together and recorded as ONE batch history entry — a single undo
   * reverts the whole save.
   */
  const handleTableModalSave = useCallback(async (
    tableId: number,
    changes: Partial<SeatingItem>,
    guestChanges: { assign: number[]; unassign: number[] },
  ) => {
    const current = items.find((i) => i.id === tableId);
    if (!current) return;
    const subEntries: SeatingBatchableEntry[] = [];

    // Only the fields that actually changed enter the entry (and the buffer)
    const diff: Partial<SeatingItem> = {};
    const before: Partial<SeatingItem> = {};
    Object.entries(changes).forEach(([field, value]) => {
      if ((current as any)[field] !== value) {
        (diff as any)[field] = value;
        (before as any)[field] = (current as any)[field];
      }
    });
    if (Object.keys(diff).length > 0) {
      applyUpdate(tableId, diff);
      subEntries.push({ type: "update", itemId: tableId, before, after: diff });
    }

    for (const eventGuestId of guestChanges.unassign) {
      try {
        await doUnassign(eventGuestId);
        subEntries.push({ type: "unassign", eventGuestId, itemId: tableId });
      } catch { /* skip failed op; the rest still applies */ }
    }
    for (const eventGuestId of guestChanges.assign) {
      const previousItemId = assignments.find((a) => a.event_guest_id === eventGuestId)?.item_id ?? null;
      try {
        await doAssign(eventGuestId, tableId);
        subEntries.push({ type: "assign", eventGuestId, itemId: tableId, previousItemId });
      } catch { /* skip failed op; the rest still applies */ }
    }

    if (subEntries.length > 0) pushHistory({ type: "batch", entries: subEntries });
  }, [items, assignments, applyUpdate, doUnassign, doAssign, pushHistory]);

  // ==================== Presets ====================

  const handleSavePreset = useCallback(async (preset: Omit<CustomTablePreset, "id" | "user_id">) => {
    if (editingPreset) {
      const saved = await httpRequests.updateTablePreset(editingPreset.id, preset);
      setPresets((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    } else {
      const saved = await httpRequests.addTablePreset(preset);
      setPresets((prev) => [...prev, saved]);
    }
  }, [editingPreset]);

  const openPresetModal = useCallback((preset: CustomTablePreset | null, kind: SeatingItemKind = "table") => {
    setEditingPreset(preset);
    setPresetModalKind(preset?.kind ?? kind);
    setShowPresetModal(true);
  }, []);

  const handleDeletePreset = useCallback(async (presetId: number) => {
    try {
      await httpRequests.deleteTablePreset(presetId);
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
    } catch { /* keep state */ }
  }, []);

  // ==================== Export ====================

  const withCleanStage = useCallback(async (): Promise<string | null> => {
    if (!stageRef.current || !layout) return null;
    setSelectedItemId(null); // detach transformer handles before capturing
    await new Promise((resolve) => setTimeout(resolve, 100));
    return stageToRoomPng(stageRef.current, layout);
  }, [layout]);

  const eventTitle = weddingInfo?.bride_name && weddingInfo?.groom_name
    ? `${weddingInfo.bride_name} ו${weddingInfo.groom_name}`
    : weddingInfo?.ceremony_name ?? "";

  const handleExportPng = useCallback(async () => {
    const dataUrl = await withCleanStage();
    if (dataUrl) downloadDataUrl(dataUrl, "seating_floor_plan.png");
  }, [withCleanStage]);

  const handleExportPrint = useCallback(async () => {
    const dataUrl = await withCleanStage();
    if (dataUrl) openPrintView(dataUrl, items, assignments, eventTitle);
  }, [withCleanStage, items, assignments, eventTitle]);

  const handleExportXlsx = useCallback(() => downloadSeatingXlsx(items, assignments), [items, assignments]);

  // ==================== Layout form ====================

  const [roomWidthM, setRoomWidthM] = useState("");
  const [roomHeightM, setRoomHeightM] = useState("");

  const parseMeters = (raw: string): number | null => {
    const meters = Number(raw);
    if (!Number.isFinite(meters) || meters <= 0 || meters > 500) return null;
    return Math.round(meters * 100);
  };

  const layoutFormValid = parseMeters(roomWidthM) != null && parseMeters(roomHeightM) != null;

  const handleSaveLayout = useCallback(async () => {
    if (eventId == null) return;
    const widthCm = parseMeters(roomWidthM);
    const heightCm = parseMeters(roomHeightM);
    if (widthCm == null || heightCm == null) return;
    try {
      const saved = await httpRequests.saveSeatingLayout(eventId, widthCm, heightCm);
      setLayout(saved);
      setShowLayoutForm(false);
    } catch { /* keep form open */ }
  }, [eventId, roomWidthM, roomHeightM]);

  const openLayoutForm = useCallback(() => {
    setRoomWidthM(layout ? String(layout.room_width_cm / 100) : "");
    setRoomHeightM(layout ? String(layout.room_height_cm / 100) : "");
    setShowLayoutForm(true);
  }, [layout]);

  // ==================== Render ====================

  const modalTable = modalTableId != null ? items.find((i) => i.id === modalTableId) ?? null : null;
  const selectedItem = selectedItemId != null ? items.find((i) => i.id === selectedItemId) ?? null : null;

  if (isLoading) {
    return (
      <div className="seating-dashboard" dir="rtl">
        <Header showBackToDashboardButton={true} />
        <Box align="center" verticalAlign="middle" height="60vh"><Loader size="medium" /></Box>
      </div>
    );
  }

  if (eventId == null || loadError) {
    return (
      <div className="seating-dashboard" dir="rtl">
        <Header showBackToDashboardButton={true} />
        <Box align="center" padding="48px">
          <Text>{eventId == null ? "יש להגדיר את פרטי החתונה לפני תכנון ההושבה" : "טעינת נתוני ההושבה נכשלה"}</Text>
        </Box>
      </div>
    );
  }

  return (
    <div className="seating-dashboard" dir="rtl">
      <Header showBackToDashboardButton={true} />

      <div className="seating-toolbar">
        {/* Right side (RTL): title + general canvas tools */}
        <div className="toolbar-side">
          <h1 className="seating-title">סידורי הושבה</h1>
          <div className="toolbar-group">
            <Button size="small" skin="light" prefixIcon={<Ruler size={14} />} onClick={openLayoutForm}>
              {layout ? `גודל האולם: ${layout.room_width_cm / 100}×${layout.room_height_cm / 100} מ׳` : "הגדרת גודל האולם"}
            </Button>
            <Button size="small" skin="light" onClick={() => void undo()} disabled={past.length === 0} prefixIcon={<Undo2 size={14} />}>בטל</Button>
            <Button size="small" skin="light" onClick={() => void redo()} disabled={future.length === 0} prefixIcon={<Redo2 size={14} />}>בצע שוב</Button>
            <Button
              size="small"
              skin="destructive"
              priority="secondary"
              disabled={items.length === 0}
              onClick={handleClearCanvas}
              prefixIcon={<Eraser size={14} />}
            >
              ניקוי הקנבס
            </Button>
          </div>
        </div>

        {/* Left side (RTL): tools for the selected item + export */}
        <div className="toolbar-side">
          {selectedItem && (
            <div className="toolbar-group toolbar-group-selection">
              {selectedItem.kind === "object" && (
                <div className="color-swatches" data-testid="color-swatches">
                  {OBJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch ${(selectedItem.color ?? OBJECT_COLORS[0]) === color ? "color-swatch-active" : ""}`}
                      style={{ backgroundColor: color }}
                      title="צבע האובייקט"
                      onClick={() => handleItemChange(selectedItem.id, { color })}
                    />
                  ))}
                  <input
                    type="color"
                    className="color-swatch color-swatch-custom"
                    title="צבע מותאם אישית"
                    value={selectedItem.color ?? OBJECT_COLORS[0]}
                    onFocus={() => { colorSessionStart.current = selectedItem.color ?? null; }}
                    onChange={(e) => applyUpdate(selectedItem.id, { color: e.target.value })}
                    onBlur={(e) => {
                      const before = colorSessionStart.current;
                      colorSessionStart.current = undefined;
                      if (before !== undefined && before !== e.target.value) {
                        setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), {
                          type: "update",
                          itemId: selectedItem.id,
                          before: { color: before },
                          after: { color: e.target.value },
                        }]);
                        setFuture([]);
                      }
                    }}
                  />
                </div>
              )}
              <Button
                size="small"
                skin="light"
                onClick={() => handleDuplicateItem(selectedItem.id)}
                prefixIcon={<Copy size={14} />}
              >
                שכפול
              </Button>
              <Button
                size="small"
                skin="destructive"
                priority="secondary"
                onClick={() => handleDeleteItem(selectedItem.id)}
                prefixIcon={<Trash2 size={14} />}
              >
                מחיקה
              </Button>
            </div>
          )}
          <div className="toolbar-group">
            <PopoverMenu
              triggerElement={
                <Button size="small" priority="secondary" disabled={!layout}>
                  <ChevronDown /> ייצוא
                </Button>
              }
            >
              <PopoverMenu.MenuItem
                text="תמונה (PNG)"
                prefixIcon={<ImageIcon size={14} />}
                onClick={() => void handleExportPng()}
              />
              <PopoverMenu.MenuItem
                text="הדפסה / PDF"
                prefixIcon={<Printer size={14} />}
                onClick={() => void handleExportPrint()}
              />
              <PopoverMenu.MenuItem
                text="Excel"
                prefixIcon={<FileSpreadsheet size={14} />}
                onClick={handleExportXlsx}
              />
            </PopoverMenu>
          </div>
        </div>
      </div>

      <div className="seating-workspace">
        <div className="seating-canvas-area" dir="ltr">
          {layout ? (
            <SeatingCanvas
              layout={layout}
              items={items}
              assignments={assignments}
              selectedItemId={selectedItemId}
              stageRef={stageRef}
              onSelect={setSelectedItemId}
              onItemChange={handleItemChange}
              onDropNewItem={handleDropNewItem}
              onDropGuest={handleAssignGuest}
              onOpenTable={setModalTableId}
            />
          ) : (
            <div className="seating-empty-state" dir="rtl">
              <Text weight="bold">בואו נתחיל — מה גודל האולם?</Text>
              <Text size="small" secondary>הגדירו את מידות האולם במטרים וקבלו קנבס בקנה מידה אמיתי</Text>
              <Button onClick={openLayoutForm}>הגדרת גודל האולם</Button>
            </div>
          )}
        </div>

        <div className="seating-side-panel">
          <div className="seating-tabs">
            <button
              type="button"
              className={`seating-tab ${activeTab === "objects" ? "seating-tab-active" : ""}`}
              onClick={() => setActiveTab("objects")}
            >
              שולחנות ואובייקטים
            </button>
            <button
              type="button"
              className={`seating-tab ${activeTab === "guests" ? "seating-tab-active" : ""}`}
              onClick={() => setActiveTab("guests")}
            >
              אורחים
            </button>
          </div>
          {activeTab === "objects" ? (
            <ObjectsBank
              customPresets={presets}
              onAddPresetClick={(kind) => openPresetModal(null, kind)}
              onEditPreset={(preset) => openPresetModal(preset)}
              onDeletePreset={handleDeletePreset}
            />
          ) : (
            <GuestsPanel
              eventGuests={eventGuests}
              assignments={assignments}
              items={items}
              onUnassign={handleUnassignGuest}
              onHighlightTable={setSelectedItemId}
            />
          )}
        </div>
      </div>

      <Modal isOpen={modalTable != null} onRequestClose={() => setModalTableId(null)} shouldCloseOnOverlayClick>
        {modalTable && (
          <TableModal
            table={modalTable}
            items={items}
            assignments={assignments}
            eventGuests={eventGuests}
            onApply={(changes, guestChanges) => handleTableModalSave(modalTable.id, changes, guestChanges)}
            onClose={() => setModalTableId(null)}
          />
        )}
      </Modal>

      <Modal isOpen={showPresetModal} onRequestClose={() => setShowPresetModal(false)} shouldCloseOnOverlayClick>
        <CustomPresetModal
          key={editingPreset?.id ?? `new-${presetModalKind}`}
          preset={editingPreset}
          initialKind={presetModalKind}
          onSave={handleSavePreset}
          onClose={() => setShowPresetModal(false)}
        />
      </Modal>

      {ConfirmDialog}

      <Modal isOpen={showLayoutForm} onRequestClose={() => setShowLayoutForm(false)} shouldCloseOnOverlayClick>
        <div className="layout-form-modal" dir="rtl">
          <Box direction="vertical" gap="14px" padding="24px" backgroundColor="white" borderRadius="8px">
            <Text weight="bold">גודל האולם</Text>
            {layout && items.length > 0 && (
              <Text size="tiny" secondary>שינוי גודל האולם לא מזיז פריטים קיימים</Text>
            )}
            <Box direction="horizontal" gap="10px">
              <FormField label="רוחב (מטרים)" required>
                <Input value={roomWidthM} onChange={(e) => setRoomWidthM(e.target.value)} type="number" placeholder="20" />
              </FormField>
              <FormField label="אורך (מטרים)" required>
                <Input value={roomHeightM} onChange={(e) => setRoomHeightM(e.target.value)} type="number" placeholder="30" />
              </FormField>
            </Box>
            <Box direction="horizontal" gap="8px">
              <Button size="small" onClick={handleSaveLayout} disabled={!layoutFormValid}>שמירה</Button>
              <Button size="small" skin="light" onClick={() => setShowLayoutForm(false)}>ביטול</Button>
            </Box>
          </Box>
        </div>
      </Modal>
    </div>
  );
};
