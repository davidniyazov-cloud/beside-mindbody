# Beside → Mindbody Integration

Automatically syncs Beside AI receptionist calls into Mindbody.
When a call ends in Beside, this server will:

1. **Parse** the call summary to detect booking intent
2. **Find or create** the client in Mindbody
3. **Book the appointment** in Mindbody
4. **Send a confirmation** text/email to the client

---

## Setup (5 steps)

### 1. Get your Mindbody API Key
- Log in at https://developers.mindbodyonline.com
- Create an account → Create an App → copy your **API Key**
- Your **Site ID** is `38315`

### 2. Get your Mindbody Staff ID & Service ID
- Log in to Mindbody → Staff → click your profile → note the ID in the URL
- Staff → Services → note the ID of your "60 min massage" service

### 3. Configure environment variables
```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Install and run
```bash
npm install
node index.js
```

### 5. Point Beside to your webhook
- In Beside → Settings → Integrations → Webhooks
- Add webhook URL: `https://your-server.com/webhook/beside`
- Add a secret token (same as BESIDE_WEBHOOK_SECRET in .env)

---

## Webhook Endpoints

| Endpoint | Trigger |
|---|---|
| `POST /webhook/beside` | Fires on every completed call (books appointments) |
| `POST /webhook/beside/lead` | Fires on new leads (adds client to Mindbody) |
| `GET /` | Health check |

---

## What it detects automatically

**Service types** — recognizes keywords like:
- "deep tissue", "therapeutic", "sports", "relaxing/relaxation", "swedish", "prenatal", "couples"

**Date** — parses: "tomorrow", "Friday", "May 10", "next Tuesday", etc.

**Time** — parses: "2pm", "2:00 PM", "14:00", "noon", etc.

**Caller info** — name and phone number from Beside's call data

---

## Deploying to a server

For production, deploy to any Node.js host. Recommended options:

- **Railway** (easiest): https://railway.app — free tier available, deploy in 2 minutes
- **Render**: https://render.com — free tier, auto-deploys from GitHub
- **DigitalOcean**: $6/month droplet

After deploying, update your Beside webhook URL to the production URL.

---

## Files

| File | Purpose |
|---|---|
| `index.js` | Express server, webhook handlers |
| `mindbody.js` | Mindbody API client (auth, clients, appointments) |
| `parser.js` | Extracts booking intent from Beside call data |
| `.env.example` | Environment variable template |
