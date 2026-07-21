# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent npm projects, no workspace tooling tying them together:

- `Server/` — Express + TypeScript API (`Server/src/app.ts` is the entry point; run scripts from inside `Server/`)
- `Client/` — React 18 + TypeScript SPA bootstrapped with CRA, built via `craco` (run scripts from inside `Client/`)

## Commands

### Server (`cd Server`)

- `npm run dev` — run the API locally with live reload (`ts-node-dev`), reading env from `Server/.server.env`
- `npm run build:prod` / `npm run start:prod` — compile with `tsc` to `dist/` and run the compiled output
- `npm test` — run the Jest integration suite (`--runInBand`; the suite hits a real Postgres instance and a mock WhatsApp server, so it needs the services below running first)

Running the full test suite requires four terminals from `Server/`, in order:

```bash
npm run test:db:start   # spins up a throwaway Postgres in Docker on :5433
npm run test:server     # starts the API pointed at that test DB (env inlined in the script)
npm run mock-wa         # starts a mock WhatsApp API on :3001
npm test                # runs Jest against the running server
```

Tear down with `npm run test:db:stop` when done. Test env values (other than the ones the `test:server` script inlines) live in `Server/.server.test.env`, which must be created manually (see README for the required keys).

To run a single test file: `npx jest test/flows/rsvp-approve.test.ts --runInBand` (server + mock WhatsApp must already be running). Test files live under `Server/test/flows/`; shared test helpers are in `Server/test/helpers/` and `Server/test/mock-whatsapp/`.

### Client (`cd Client`)

- `npm start` — run the dev server (craco/CRA)
- `npm run build` — production build (`CI=false craco build`)
- `npm test` — CRA/Jest + React Testing Library unit tests (`craco test`)

## Architecture

### Server: one file per concern, no framework-level routing split

`Server/src/app.ts` defines every Express route directly (no router modules) and is organized into clearly commented sections: public routes (health check, WhatsApp webhook, Google auth) → `authenticateMiddleware` (applied globally below this point via `app.use`) → guest/RSVP routes → task routes → admin routes → partner/collaboration routes → budget/vendor routes → event routes → a `setInterval`-driven scheduler for reminders/thank-yous. When adding a new endpoint, find the matching `==== Section ====` comment block rather than creating a new file.

Key supporting modules:
- `dbUtils.ts` — a single `Database` singleton class (`Database.connect()`) wrapping `pg.Pool`; owns schema creation (`initializeTables`, run on every boot) and every query. All persistence goes through this class — no ORM.
- `auth.ts` — Google ID token verification, session JWT issuance/verification, and the `authenticateMiddleware`/`requireAdmin` Express middleware. Also defines `MEDIA_ROUTE_PATTERNS`, the routes that authenticate via a short-lived `?mediaToken=` query param instead of an `Authorization` header (needed because `<img src>`/`<a href>` can't carry custom headers).
- `utils.ts` — WhatsApp send/receive logic: `sendWhatsAppMessage`, inbound button/text reply handling, image upload to Meta, and activity logging (`logMessage`/`batchLogMessageResults`).
- `whatsappTokenManager.ts` — caches/refreshes the Meta Graph API access token.
- `types.ts` — shared domain types (`User`, `Event`, `EventGuest`, etc.) imported throughout `app.ts` and `dbUtils.ts`.

**Multi-user/partner model:** a `userID` (Google `sub`) can be linked to a partner account via `primary_user_id`. Almost every data-owning route calls `resolveDataOwner(req.auth.userID)` (→ `db.getEffectiveUserID`) before touching guests/events/tasks/budget data, so that both partners in a linked pair operate on the same underlying data. When adding a new data-owning endpoint, resolve the data owner the same way rather than using `req.auth.userID` directly.

**Events model:** a "wedding" is just the event row flagged `is_primary`; there is no separate wedding table. Additional (non-primary) events reuse the same `events`/`event_guests` tables and inherit bride/groom names from the primary event when unset. RSVPs, guest scoping, and reminders are all per-event.

**Scheduled messaging:** a single in-process `setInterval` (60s tick) drives both wedding-day/day-before reminders and post-wedding thank-you messages across all users' events, guarded by `lastExecutionMinute` to avoid double-sends within the same minute and by per-event `send_reminder`/`send_thank_you` flags. There's no external cron/queue — this only runs while the Node process is up.

### Client: two top-level context providers gate all routing

`App.tsx` wraps everything in `AuthProvider` (`hooks/useAuth.tsx`) then `AppDataProvider` (`hooks/useAppData.tsx`); `AppContent` blocks on `authLoading || isDataLoading` before rendering routes, and redirects to `PendingApprovalPage` if the signed-in user hasn't been approved yet (see the server's user-approval flow in `/auth/google`). Feature areas live under `components/<feature>/` (`rsvp`, `budgetAndVendors`, `tasks`, `userDashboard`, `welcomePage`, `admin`, `pendingApproval`, `global`) and each is routed to directly from `App.tsx` — there's no nested route config.

`httpClient.ts` is the sole layer that talks to the API: it attaches the session JWT (from `useAuth`) as a Bearer token to every request. New API calls should go through this client rather than raw `fetch`.

Admin impersonation (`/auth/impersonate` on the server) lets an admin act as another user by minting a session token with `actor` set to the admin's real ID — `resolveDataOwner`/`authenticateMiddleware` unwrap this transparently, but audit logging (`logMessage`) uses `req.auth.actorUserID` where the real actor's identity needs to be preserved.

## Testing policy

**Every change or new feature MUST be covered by a test.** No bug fix, behavior change, or new feature is complete until it has an accompanying test that exercises it (and fails without the change). Treat writing the test as a required part of the task, not an optional follow-up.
