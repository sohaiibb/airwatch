# AirWatch — Air Quality Monitoring Platform

Multi-tenant air quality monitoring dashboard for Hills and Field Company Limited.
Liquid glass morphism UI • Real-time data • NCEC compliance • Multi-client portal

---

## Setup Guide (One-Time)

You do 5 things in your browser, then Claude Code handles the rest.

### Step 1: Create Supabase Project (browser — 3 min)

1. Go to https://supabase.com → Sign up (use GitHub login)
2. Click **New Project**
3. Name: `airwatch`
4. Password: (save this somewhere)
5. Region: **Southeast Asia (Singapore)**
6. Click **Create**
7. Wait 2 minutes

### Step 2: Set Up Database (browser — 2 min)

1. In Supabase dashboard → **SQL Editor** (left sidebar)
2. Click **New Query**
3. Open the file `database/schema.sql` from this project
4. Copy ALL contents → Paste → Click **Run**
5. Should say "Success"

### Step 3: Create Storage Buckets (browser — 1 min)

1. Click **Storage** in left sidebar
2. Create 3 buckets:
   - `logos` (set to Public)
   - `reports` (keep Private)
   - `avatars` (set to Public)

### Step 4: Create Your Admin Account (browser — 2 min)

1. Click **Authentication** → **Users** → **Add User**
2. Email: your email
3. Password: your password
4. Toggle ON: **Auto Confirm User**
5. Click **Create User**
6. Copy the **User UID** shown

7. Go to **SQL Editor** → New Query → Paste this (replace YOUR_UID):
```sql
INSERT INTO profiles (id, org_id, full_name, role)
VALUES (
    'YOUR_UID_HERE',
    (SELECT id FROM organizations WHERE slug = 'hfcl'),
    'Sohaib',
    'admin'
);
```
8. Click **Run**

### Step 5: Get Your Keys (browser — 1 min)

1. Click **Settings** (gear) → **API**
2. Save these 3 values:
   - **Project URL** → `https://xxxxx.supabase.co`
   - **anon key** → `eyJhbGci...`
   - **service_role key** → `eyJhbGci...` (keep this SECRET)

---

## Deploy with Claude Code (Terminal)

After the browser steps above, open Terminal on your Mac and run:

```bash
claude
```

Then tell Claude Code:

```
I have an AirWatch project at ~/Documents/airwatch.
My Supabase URL is: https://xxxxx.supabase.co
My Supabase anon key is: eyJ...
My Supabase service role key is: eyJ...

Please:
1. Create a GitHub repo called "airwatch"
2. Set up the frontend .env with my Supabase URL and anon key
3. Set up the backend .env with my Supabase URL and service role key
4. Push everything to GitHub
5. Tell me how to connect Vercel and Railway
```

Claude Code will handle everything.

### Connect Vercel (browser — 2 min)

1. Go to https://vercel.com → Sign in with GitHub
2. Click **Import Project** → Select `airwatch`
3. Set root directory to `frontend`
4. Add environment variables:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
5. Click **Deploy**

### Connect Railway (browser — 2 min)

1. Go to https://railway.app → Sign in with GitHub
2. Click **New Project** → **Deploy from GitHub** → Select `airwatch`
3. Set root directory to `backend`
4. Add environment variables:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
   - `AQICN_TOKEN` = your AQICN token (get free at https://aqicn.org/data-platform/token/)
   - `OWM_API_KEY` = your OpenWeatherMap key (get free at https://openweathermap.org/api)
   - `FRONTEND_URL` = your Vercel URL (e.g. https://airwatch-xxx.vercel.app)
   - `POLL_INTERVAL` = 300
5. Click **Deploy**

---

## Done! Your site is live.

- Frontend: https://airwatch-xxx.vercel.app
- Backend: https://airwatch-xxx.up.railway.app
- Login with the email/password you created in Step 4

---

## Making Changes (After Setup)

Open Terminal → type `claude` → tell it what you want:

```
"Add a wind rose diagram to the charts page"
"Change the company name in the footer"
"Add a new pollutant card for H2S"
"Fix the bug where temperature shows as null"
"Add Arabic language support"
```

Claude Code reads the CLAUDE.md file, makes the changes, and pushes to GitHub.
Vercel and Railway auto-deploy in ~90 seconds.

---

## Project Structure

```
airwatch/
├── CLAUDE.md              ← Claude Code reads this to understand the project
├── README.md              ← This file
├── database/
│   └── schema.sql         ← Supabase database (run once)
├── backend/
│   ├── main.py            ← API server (polls stations, WebSocket)
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── App.jsx        ← Layout, routing, sidebar
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Dashboard.jsx
    │   │   ├── Charts.jsx
    │   │   └── AdminStations.jsx
    │   └── lib/
    │       ├── supabase.js  ← Database queries
    │       └── utils.js     ← Shared helpers
    └── package.json
```

## Estimated Monthly Cost

| Service | Cost |
|---------|------|
| Supabase | Free (500MB database) |
| Vercel | Free (hobby) |
| Railway | ~$5/mo (hobby) |
| AQICN API | Free |
| OpenWeatherMap | Free |
| **Total** | **~$5/mo** |
