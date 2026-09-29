# Seating Arrangement — Product Design

Status: **agreed** (2026-09-29). Next: technical design, then implementation.

## Overview

A new page for planning the wedding-day floor plan and seating, styled like a game: a
real-scale canvas of the venue on the left, a bank of draggable tables/objects and the
guest list on the right. Data is per-event (like everything else in the system) and
shared between linked partners.

Layout: canvas ~70% of screen width; right panel ~30% with two tabs — **Objects** and
**Guests** — plus a search/filter bar. The two phases (floor-plan setup, guest seating)
are **free tabs, not a wizard**: the user can move tables while seating guests and vice
versa, because RSVPs keep changing until the last week.

## Phase 1 — Space setup

- User enters the venue size in meters (e.g. 20m × 30m); the system renders a blank
  rectangular canvas at that real-world scale. V1 rooms are rectangles only.
- Canvas has a light grid (0.5m), snap-to-grid, zoom and pan.
- **Tables bank**: preset tables (round 12, round 8, square 3×3m, rectangle 10, …) are
  dragged onto the canvas. Sizes are real-world (a 12-person round ≈ 1.8m diameter) so
  density on screen reflects reality.
- **Custom tables**: user defines shape (circle / square / rectangle), physical size
  (m or cm), and guest capacity. Custom tables are saved per account for future reuse
  and appear in the bank.
- **Objects bank**: DJ stand, food buffet, dance floor, bar, stage, entrance, chuppah —
  each a sized shape, resizable and draggable. (Ship DJ/buffet/dance-floor first; the
  rest are cheap follow-ons.)
- Tables auto-number as they're dropped (1, 2, 3…) and can be renamed ("Kids table").
  The number is the canvas label at low zoom.
- Rotation and duplication of tables/objects (duplicate is how you lay out 20 identical
  rounds quickly).
- **Overlap warnings**: overlapping tables/objects are visually flagged, never blocked.
- Autosave (debounced, no save button) + undo/redo.

## Phase 2 — Guest seating

- **Guests tab** shows the event's guest list with the existing filters: search, RSVP
  status, whose, circle — plus an "unassigned only" filter. Columns: name, whose,
  circle, seat count.
- **Seat count = confirmed RSVP, always live.** A guest occupies their confirmed
  `rsvp_status` count. Pending guests can still be seated (reserving their invited
  `number_of_guests`) and are marked tentative.
- Two ways to assign:
  1. Drag a guest row onto a table. Table shows the guest in its list and updates its
     occupancy badge (e.g. `3/10`).
  2. Click a table → modal with the table's current guests; from there add/remove
     guests, and edit the table itself (name, size, capacity).
- **Parties are atomic**: a guest row sits at exactly one table, never split. Dragging
  an already-assigned guest to another table moves them.
- Assigned guests show a table badge in the guest list.
- **Fill-state coloring** on tables: empty / partial / full / over capacity, plus the
  `seated/capacity` badge.
- **Overcapacity is a warning, not a block** (`11/10` in red is allowed).
- Persistent progress line: "87 of 120 confirmed guests seated".
- **Live RSVP sync**: occupancy always reflects current RSVP data. If a seated guest's
  count changes, the table updates automatically; if a seated guest declines, they are
  flagged (red badge on the table + a "needs attention" list in the guest panel), not
  silently removed.

## Export (in v1)

- Rendered floor plan as PNG/PDF.
- Per-table guest list (table number/name → guests and counts).
- Alphabetical escort list (guest → table number).

## Out of scope for v1

- Non-rectangular rooms.
- Splitting a party across tables.
- Mobile editing (desktop-first; at most read-only on mobile).
- Chair-level seat assignment within a table.
- Real-time collaborative editing (data is shared between partners via the usual
  data-owner resolution; concurrent edits are last-write-wins).
