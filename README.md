# 💍 Wedding RSVP & Planning Platform

A full-stack wedding management application that helps couples organize their special day — from guest RSVPs and automated messaging to budget tracking and task management.

![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-4.9-3178C6?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql)

## ✨ Features

### 📋 RSVP Management

- Import guest lists from Excel spreadsheets
- Track guest responses in real-time
- Automated WhatsApp messaging for invitations, reminders, and thank-you notes
- Search, filter, and organize guests by groups

### 💰 Budget & Vendor Tracking

- Set and monitor wedding budget by category
- Track vendor payments and contracts
- Visual budget overview with spending insights

### ✅ Task Management

- Pre-built wedding planning task templates
- Custom task creation with due dates
- Progress tracking with visual indicators

### 👫 Couple's Dashboard

- Wedding countdown timer
- Partner collaboration features
- Centralized planning hub

### 🔐 Authentication

- Secure Google OAuth login
- Multi-user support for couples

---

## 🛠️ Tech Stack

**Frontend:**

- React 18 with TypeScript
- React Query for server state management
- React Router for navigation
- Wix Design System components

**Backend:**

- Node.js with Express
- TypeScript
- PostgreSQL (Neon serverless)

**Integrations:**

- WhatsApp Business API
- Google OAuth 2.0

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js** (v18 or higher)
2. **PostgreSQL Database** — [Neon](https://neon.tech) provides a free serverless option
3. **WhatsApp Business Account** — Set up via [Meta for Developers](https://developers.facebook.com/)
4. **Google Cloud Project** — For OAuth authentication

### Environment Variables

#### Server (`./Server/.env`)

```env
DATABASE_URL=your_postgres_connection_string
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token
```

#### Client (`./Client/.env`)

```env
REACT_APP_SERVER_URL=your_server_url
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
REACT_APP_GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/wedding-rsvp.git
   cd wedding-rsvp
   ```

2. **Start the Server**

   ```bash
   cd Server
   npm install
   npm run start
   ```

3. **Start the Client** (in a new terminal)

   ```bash
   cd Client
   npm install
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

---

## 🧪 Running Tests

The test suite covers full RSVP flows, multi-event routing, guest management, and event management. Tests run against a real local database and a mock WhatsApp server, so no real WhatsApp account is needed.

### Prerequisites

- [Docker](https://www.docker.com/) — for the local test database

### Setup (one-time)

```bash
cd Server
npm install
```

Create `Server/.server.test.env`:

```env
DATABASE_URL=postgres://postgres:test@localhost:5433/wedding_test
WHATSAPP_PHONE_NUMBER_ID=test-phone-id
WHATSAPP_API_BASE_URL=http://localhost:3001
WHATSAPP_ACCESS_TOKEN=mock-access-token
REAL_SERVER_URL=http://localhost:8080
```

### Running the test suite

Open four terminals from the `Server/` directory:

```bash
# Terminal 1 — start the local test database (Docker)
npm run test:db:start

# Terminal 2 — start the server pointed at the test database
npm run test:server

# Terminal 3 — start the mock WhatsApp API
npm run mock-wa

# Terminal 4 — run the tests
npm test
```

When finished:

```bash
npm run test:db:stop
```

### What's tested

| File | Coverage |
|---|---|
| `rsvp-approve.test.ts` | Approve, decline, pending, and mistake-correction flows |
| `rsvp-edge-cases.test.ts` | Invalid replies, out-of-range numbers, unknown phones, RSVP changes |
| `rsvp-filters.test.ts` | `rsvpReminder` / `weddingReminder` recipient filtering, `guestIds` scoping |
| `multi-event-rsvp.test.ts` | Per-event guest targeting, cross-event RSVP isolation |
| `guest-management.test.ts` | Add, assign, remove from event, delete guest |
| `event-management.test.ts` | Event listing, creation, auth checks, error handling |

---

## 🌐 Local Development with WhatsApp Webhooks

To receive WhatsApp responses locally, you'll need to expose your server using [ngrok](https://ngrok.com/):

```bash
ngrok http 3001
```

Then configure the generated ngrok URL in your [Meta Developer Console](https://developers.facebook.com/) webhook settings.

---

## 📁 Project Structure

```
wedding-rsvp/
├── Client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Feature-based components
│   │   │   ├── rsvp/       # Guest management & messaging
│   │   │   ├── budgetAndVendors/
│   │   │   ├── tasks/
│   │   │   ├── userDashboard/
│   │   │   └── welcomePage/
│   │   ├── hooks/          # Custom React hooks
│   │   └── types.ts        # TypeScript definitions
│   └── public/
│
└── Server/                 # Node.js backend
    └── src/
        ├── app.ts          # Express server entry
        ├── dbUtilsPostgresNeon.ts
        ├── messages.ts     # WhatsApp message templates
        └── utils.ts
```

---

## 📝 License

© 2024 RSVP by Neta Kalif. All rights reserved.
