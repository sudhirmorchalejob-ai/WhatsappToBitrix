# 💬 WhatsApp → Bitrix24 Lead Integration & 2-Way Dashboard

A multi-tenant production integration platform between **WhatsApp (WhatsBox / Meta Gateway)** and **Bitrix24 CRM**. Automates lead creation from incoming WhatsApp messages, auto-replies, and outbound campaigns, while providing 2-way operator messaging directly from Bitrix24 to WhatsApp.

---

## 🚀 Key Features

1. **Automatic Lead Creation**: Incoming WhatsApp messages automatically create or resolve contacts and open leads in Bitrix24 CRM.
2. **2-Way Operator Messaging**: Replies typed by operators in Bitrix24 CRM are automatically sent back to the customer's WhatsApp.
3. **React Single Page Application (SPA)**: Built with **Vite + React 19 + Tailwind/Custom Dark Glassmorphism CSS**.
4. **Webhook Setup & Auto-Sync**: Configure Bitrix24 REST webhooks and WhatsApp channel credentials with live connection testing and one-click auto-sync.
5. **Real-time Audit Logs**: Live tracking for `Lead Created`, `Bitrix24 Reply`, `Contacts Synced`, and message logs.

---

## 📂 Project Directory Structure

```text
whatsappintegration/
├── package.json              # Main backend configuration & build scripts
├── .env                      # Server environment configuration
├── test-lead-creation.js     # Script to simulate incoming WhatsApp message lead creation
├── test-operator-reply.js    # Script to simulate Bitrix24 2-way operator reply
├── public/                   # Compiled static files served by Express (built React app)
│   ├── index.html
│   └── assets/
├── src/                      # Express backend source code
│   ├── app.js
│   ├── server.js
│   ├── config/               # Environment & database config
│   ├── controllers/          # API & Webhook route controllers
│   ├── services/             # Core business logic (Customer, Lead, Sync, Bitrix, WhatsBox)
│   ├── repositories/         # Prisma database repositories
│   └── webhooks/             # Webhook handlers for WhatsApp & Bitrix24
└── frontend/                 # React SPA source code (Vite + React 19)
    ├── package.json          # Frontend dependencies
    ├── vite.config.js        # Configured to output builds directly to ../public
    └── src/
        ├── App.jsx           # App Root & tab routing
        ├── index.css         # Modern Dark Glassmorphism CSS
        └── components/       # Login, Dashboard, Leads, Webhooks, Audit Logs
```

---

## 🔐 Default Admin Credentials

- **Email**: `admin@system.com`
- **Password**: `Admin@123456`

---

## 💻 How to Run the Application

### Option A: Unified Production Mode (Recommended)

Run the backend server which serves the pre-built React application from `public/`.

#### Step 1: Open Terminal in the Root Directory
```bash
cd C:\Users\Rspl\Downloads\whatsappintegration
```

#### Step 2: Build the React Frontend
```bash
npm run build:frontend
```
*(This compiles the React code into `public/index.html` and `public/assets/`)*

#### Step 3: Start the Backend Server
```bash
npm start
```
- Server starts on: **`http://localhost:9191`**
- Open **`http://localhost:9191`** in your browser to access the dashboard.

---

### Option B: Separate Development Mode (Frontend Dev + Backend Dev)

If you want live hot-reloading for React while modifying UI code:

#### 1️⃣ Start Backend Server (Terminal 1)
```bash
cd C:\Users\Rspl\Downloads\whatsappintegration
npm run dev
```
*(Backend runs on `http://localhost:9191`)*

#### 2️⃣ Start Frontend Vite Dev Server (Terminal 2)
```bash
cd C:\Users\Rspl\Downloads\whatsappintegration\frontend
npm run dev
```
- Vite dev server starts on: **`http://localhost:5173`**
- Open **`http://localhost:5173`** in your browser (API requests automatically proxy to `http://localhost:9191`).

---

## 🧪 Testing 2-Way Connection via Command Line

You can verify lead creation and 2-way messaging without waiting for external webhooks:

### 1. Test Inbound WhatsApp Message $\rightarrow$ Bitrix24 Lead Creation
```bash
cd C:\Users\Rspl\Downloads\whatsappintegration
node test-lead-creation.js
```

### 2. Test Bitrix24 Operator Reply $\rightarrow$ WhatsApp Message
```bash
cd C:\Users\Rspl\Downloads\whatsappintegration
node test-operator-reply.js
```

---

## ⚙️ Environment Configuration (`.env`)

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `9191` | Server HTTP port |
| `DATABASE_URL` | `postgresql://...` | Neon PostgreSQL database connection string |
| `BITRIX24_WEBHOOK_URL` | `https://your-domain.bitrix24.com/rest/1/xxx/` | Bitrix24 Inbound REST Webhook URL |
| `WHATSAPP_WEBHOOK_URL` | `https://your-server.com/webhooks/whatsbox` | Gateway webhook endpoint |

---

## 📝 API Webhook Endpoints

- **WhatsApp Inbound Webhook**: `POST http://localhost:9191/webhooks/whatsbox`
- **Bitrix24 Webhook Handler**: `POST http://localhost:9191/webhooks/bitrix24`
- **Health Check**: `GET http://localhost:9191/health`
