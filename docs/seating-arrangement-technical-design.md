# Seating Arrangement — Technical Design

Status: **draft for review** (2026-09-29). Product design: [seating-arrangement-product-design.md](seating-arrangement-product-design.md).

## Decisions (agreed)

- **Canvas**: `react-konva` (+ `konva`) — built-in drag, `Transformer` for resize/rotate
  handles, stage-level zoom/pan, `stage.toDataURL()` for PNG export. Two new client deps.
- **Persistence**: normalized tables (items + assignments as rows, FK cascades), not a
  JSON blob.
- **Export**: fully client-side — PNG from the Konva stage, print-optimized page →
  browser print-to-PDF (native Hebrew/RTL), xlsx lists via the existing exceljs pattern.

## Units and coordinates

- All geometry is stored in **integer centimeters** (`x_cm`, `width_cm`, …) — no floats
  in the DB, no pixel values persisted. The venue "20m × 30m" is stored as 2000 × 3000.
- The canvas renders at `scale = px-per-cm`, derived from stage size / room size, and
  zoom multiplies it. Konva's coordinate space is LTR/top-left origin regardless of the
  page's RTL direction — only the surrounding panels are RTL.
- Grid snapping = round to 50cm, implemented as pure functions in `logic.ts`.
- **`width_cm`/`height_cm` always mean the bounding box** — for circles both equal the
  diameter (`width_cm === height_cm`, app-validated). This applies to `seating_items`
  and `custom_table_presets` alike: one geometry shape keeps rendering, snapping,
  overlap checks, and preset→item instantiation branch-free, and the circle form simply
  shows a single "diameter" field that writes both columns.

## Database (Server/src/dbUtils.ts → initializeTables)

Four new tables, following existing conventions (`CREATE TABLE IF NOT EXISTS`,
snake_case, cascade FKs, app-layer validation instead of CHECK constraints). **The same
DDL must also be added to `Server/test/globalSetup.ts` (`createTables`)** — the test DB
schema is duplicated there by design.

```sql
CREATE TABLE IF NOT EXISTS seating_layouts (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  room_width_cm INTEGER NOT NULL,
  room_height_cm INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seating_items (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- 'table' | 'object' (app-validated)
  shape TEXT NOT NULL,             -- 'circle' | 'rect'  (square = rect w==h)
  label TEXT,                      -- table name ("שולחן ילדים") or object name ("עמדת DJ")
  table_number INTEGER,            -- tables only; assigned client-side (max+1)
  capacity INTEGER,                -- tables only
  x_cm INTEGER NOT NULL,
  y_cm INTEGER NOT NULL,
  width_cm INTEGER NOT NULL,
  height_cm INTEGER NOT NULL,
  rotation_deg INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seating_assignments (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES seating_items(id) ON DELETE CASCADE,
  event_guest_id INTEGER NOT NULL UNIQUE REFERENCES event_guests(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_table_presets (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
  name TEXT NOT NULL,
  shape TEXT NOT NULL,
  width_cm INTEGER NOT NULL,       -- bounding box; circle: width = height = diameter
  height_cm INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)            -- mirrors budget_categories
);
```

Why this shape:

- `seating_assignments.event_guest_id UNIQUE` enforces "a party is atomic, one table
  per event" in the DB (event_guests is already event-scoped, so a global UNIQUE works).
- Deleting a table cascades its assignments; removing a guest from the event (or
  deleting the guest/event) unseats them automatically — no orphan cleanup code.
- Occupancy is **never stored** — it's always derived live from
  `assignments ⋈ event_guests.rsvp_status`, which is what makes RSVP sync automatic.
- `custom_table_presets` keys on `user_id` (data owner), so linked partners share the
  bank via `resolveDataOwner`, like everything else.

New `Database` methods (one per query, in a `// ==== Seating Methods ====` banner):
`getSeatingLayout`, `upsertSeatingLayout`, `getSeatingItems`, `createSeatingItem`,
`updateSeatingItems` (batch geometry update), `deleteSeatingItem`,
`getSeatingAssignments` (joined with `event_guests` → `guests` for name/counts),
`assignGuestToItem` (upsert on `event_guest_id` — assigning an already-seated guest
**moves** them), `unassignGuest`, `getCustomTablePresets`, `createCustomTablePreset`,
`deleteCustomTablePreset`.

## API (Server/src/app.ts, new `==== Seating Endpoints ====` section after Event Routes)

Every route follows the canonical skeleton: `resolveDataOwner(req.auth.userID)` →
`getEventById` → `if (!event || event.user_id !== dataOwner) return 404` → query →
`res.json(rows)`; errors 400/404/500 with plain-text messages. Item/assignment routes
additionally verify the item belongs to `:eventId`.

| Route | Purpose |
|---|---|
| `GET /events/:eventId/seating` | One-shot page load: `{ layout, items, assignments }` (assignments joined with guest name + rsvp fields) |
| `PATCH /events/:eventId/seating/layout` | Upsert room dimensions |
| `POST /events/:eventId/seating/items` | Create item on drop → returns the row (client swaps its temp id for the real `id`) |
| `PATCH /events/:eventId/seating/items` | **Batch** geometry/props update `[{id, x_cm, …}, …]` — the debounced autosave target |
| `DELETE /events/:eventId/seating/items/:itemId` | Delete item (assignments cascade) |
| `POST /events/:eventId/seating/items/:itemId/guests` | `{ eventGuestId }` — assign; upsert semantics = move if already seated |
| `DELETE /events/:eventId/seating/guests/:eventGuestId` | Unassign |
| `GET /table-presets` / `POST /table-presets` / `DELETE /table-presets/:id` | Custom table bank (user-owned, not event-scoped) |

Rationale for per-operation writes (vs. full-layout sync): item creation returns a real
DB id immediately, so assignments never reference temp ids; drags/resizes coalesce into
the one debounced batch PATCH; no diff/merge logic on the server.

**Autosave**: geometry changes buffer client-side and flush via the batch PATCH,
debounced ~800ms (and on tab switch/unmount via `beforeunload`/cleanup flush).
Structural ops (create/delete/assign) fire immediately. Last-write-wins between
partners, per the product design.

## Client (Client/src/components/seating/)

New deps: `konva`, `react-konva`. New route `/seating` in `App.tsx` + a launch card in
`WeddingDashboard`. V1 targets the primary event (`useAuth().weddingInfo`); everything
is keyed by `event_id`, so a future event switcher is a one-line change.

```
components/seating/
  SeatingDashboard.tsx      // route container: Header, loads GET /seating, owns all state
  SeatingCanvas.tsx         // Konva Stage: room rect, grid, zoom/pan, items layer
  CanvasItem.tsx            // one table/object: shape + label + occupancy badge + fill color
  ItemTransformer.tsx       // Konva Transformer wiring (resize objects, rotate rects)
  panel/ObjectsBank.tsx     // preset tables, objects, custom presets, "new preset" button
  panel/GuestsPanel.tsx     // guest list + existing filters + unassigned filter + progress line
  TableModal.tsx            // click-a-table modal: guest list, add/remove, edit props
  CustomPresetModal.tsx     // create custom table preset
  logic.ts                  // pure: snapping, cm↔px, occupancy, fill state, collision,
                            //       needs-attention derivation, export row builders
  logic.test.ts
  export.ts                 // stage→PNG download, print-view assembly, exceljs lists
  css/Seating.css
```

**State** lives in `SeatingDashboard` (a `useReducer` over
`{ layout, items, assignments }`), *not* in `useAppData` — it's page-local. Guests and
their live `rsvp_status` come from `useAppData().eventGuestsByEventId[eventId]` (with
`refreshEventGuests` on mount), so RSVP changes made elsewhere flow in on next load.

**Derived, never stored** (all in `logic.ts`, unit-tested):
- `occupancy(item)` = Σ seat counts of its assignments — confirmed `rsvp_status` for
  approved guests, `number_of_guests` (tentative) for pending, 0 for declined.
- fill state: empty / partial / full / over → table fill color + `seated/capacity` badge.
- needs-attention list = assignments whose event_guest is declined (`rsvp_status === 0`).
- overlap detection: rotated-rect/circle intersection tests (flag, don't block).
- progress line: seated confirmed vs. total confirmed.

**Undo/redo**: a client-side snapshot stack over geometry edits
(move/resize/rotate/props); undo diffs the restored snapshot against current state and
feeds the differences through the normal autosave buffer so the server converges.
Structural ops (create/delete) **clear** the history instead of being undoable —
replaying an inverse create would mint a new DB id and silently invalidate every later
snapshot that references the old one. Not persisted.

**Drag & drop across the DOM/Konva boundary** (bank → canvas, guest row → table):
HTML5 `draggable` rows with a typed payload; the stage container's `onDrop` calls
`stage.setPointersPositions(e)` then converts pointer → stage coords (standard
react-konva pattern). Drop-on-table hit-testing via `stage.getIntersection`. Within the
canvas, Konva's own `draggable` handles item moves with a snap-on-dragend.

**Zoom/pan**: wheel-zoom about the pointer (scale clamp ~0.2–4×), stage drag on empty
space to pan. Initial fit-to-screen scale from room dims.

**RTL note**: panels/modals are `dir="rtl"` with Hebrew strings inline (house style);
the Konva stage itself is coordinate-based and unaffected. Hebrew labels render fine in
canvas text.

## Export (client-side)

1. **PNG**: clone-render the stage at fixed resolution (`pixelRatio` bumped, transformer
   and selection UI hidden) → `stage.toDataURL()` → download.
2. **PDF**: a print-view (hidden route/portal) containing the PNG + per-table guest
   lists + alphabetical escort list, print CSS, `window.print()` → browser's native
   PDF with correct Hebrew/RTL.
3. **xlsx**: per-table list and escort list via `exceljs`, mirroring
   `rsvp/logic.ts`'s `guestExportColumns/Row` pattern.

No server involvement; no new media-token resource needed.

## Types

- `Server/src/types.ts`: new "Seating types" section — `SeatingLayout`, `SeatingItem`,
  `SeatingAssignment` (with joined-guest optional fields, commented per house style),
  `CustomTablePreset`, plus `SEATING_ITEM_KINDS = ["table","object"]` and
  `SEATING_SHAPES = ["circle","rect"]` const arrays for app-layer validation
  (the gifts pattern).
- `Client/src/types.ts`: mirrored interfaces + UI-only types (selection, drag payloads)
  local to the feature.

## Testing (per repo policy: every behavior gets a test)

**Server** — new `Server/test/flows/seating.test.ts` (black-box axios against the test
server, seeded wedding event id=1, guests 2–4):
- layout upsert; item create/batch-update/delete; ownership 404s (foreign event);
- assign → returns assignment; re-assign moves (UNIQUE upsert); unassign;
- delete item → assignments gone; capacity/shape validation 400s;
- presets CRUD + `UNIQUE(user_id, name)` conflict; partner (`resolveDataOwner`) access.
- **Add the four tables' DDL to `test/globalSetup.ts`.**

**Client** — `seating/logic.test.ts` (pure functions: snapping, occupancy across
pending/confirmed/declined, fill state, overlap, escort-list building, export rows) +
a `SeatingDashboard` render test (mocked httpClient) covering tab switch, guest drag
payload, and the progress line.

## Implementation milestones

1. **Server foundation**: DDL (+ globalSetup), Database methods, all routes, flow tests.
2. **Canvas core**: deps, route/card, layout setup form, stage with grid/zoom/pan,
   drop tables/objects from bank, move/resize/rotate/delete, autosave, undo/redo.
3. **Guests phase**: guests tab with filters, drag-to-table, table modal, occupancy
   badges/colors, needs-attention, progress line.
4. **Custom presets + export**: preset modal/bank, PNG, print view, xlsx.

Each milestone lands with its tests; full suite runs before each commit (house rule).
