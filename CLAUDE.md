# CLAUDE.md — AirWatch Project Intelligence

## What This Project Is

AirWatch is a multi-tenant air quality monitoring SaaS platform built for Hills and Field Company Limited (HFCL), an NCEC Type A environmental consultancy in Saudi Arabia. It lets HFCL monitor air quality stations across clients, and gives each client a read-only portal to view their own station data.

## Owner

Sohaib — owner of Hills and Field. He does NOT code. Every change must be made by Claude Code. He directs, Claude Code executes. Never ask him to edit code manually or run complex terminal commands. Keep instructions to single copy-paste commands when needed.

## Architecture

```
airwatch/
├── database/
│   ├── schema.sql         # Supabase PostgreSQL schema (run once)
│   └── SETUP.md           # Human-readable setup guide
├── backend/
│   ├── main.py            # FastAPI — polls APIs, stores in Supabase, WebSocket
│   ├── requirements.txt   # Python deps
│   ├── Dockerfile         # For Railway deployment
│   ├── railway.toml       # Railway config
│   └── .env.example       # Environment template
├── frontend/
│   ├── src/
│   │   ├── main.jsx       # React entry point
│   │   ├── App.jsx        # Root component — auth, routing, sidebar layout
│   │   ├── index.css      # Global styles, glass variables, animations
│   │   ├── lib/
│   │   │   ├── supabase.js  # Supabase client + all data query functions
│   │   │   └── utils.js     # Glass helpers, AQI levels, NCEC thresholds, demo data
│   │   ├── pages/
│   │   │   ├── Login.jsx         # Login page
│   │   │   ├── Dashboard.jsx     # Main dashboard — map, AQI gauge, pollutant cards, weather, advisory
│   │   │   ├── Charts.jsx        # Charts tab — per-gas charts, multi-overlay, data table
│   │   │   └── AdminStations.jsx # Admin — station CRUD + field mapping
│   │   └── components/          # Reusable components (added as needed)
│   ├── public/
│   │   └── favicon.svg
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── vercel.json
│   └── .env.example
├── .gitignore
├── CLAUDE.md              # THIS FILE — project intelligence for Claude Code
└── README.md              # Setup + deployment guide
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite | Fast, simple, no framework overhead |
| Charts | Recharts | Declarative, works with React |
| Maps | Leaflet + react-leaflet | Free, no API key needed |
| Icons | Lucide React | Consistent SVG icons, no emoji |
| Styling | Inline styles (liquid glass morphism) | No CSS framework needed, full control |
| Backend | FastAPI (Python) | Async, WebSocket support, simple |
| Database | Supabase (PostgreSQL) | Auth + DB + Storage + RLS in one |
| Auth | Supabase Auth | Email/password, role-based |
| Frontend Hosting | Vercel | Auto-deploys from GitHub |
| Backend Hosting | Railway | Docker support, auto-deploys |

## Design System — Liquid Glass Morphism

EVERY component must follow these rules:

### Colors
- Background: `#E8E4DE` (warm light)
- Text: `#1C1917` (primary), `#57534E` (mid), `#78716C` (muted), `#A8A29E` (faint)
- Brand green: `#16A34A`
- AQI colors: green `#16A34A`, yellow `#CA8A04`, orange `#EA580C`, red `#DC2626`, purple `#7C3AED`, maroon `#991B1B`
- Pollutant colors: PM2.5 `#3B82F6`, PM10 `#8B5CF6`, SO₂ `#F59E0B`, NO₂ `#06B6D4`, O₃ `#EC4899`, CO `#10B981`

### Glass Card Style
```js
// Main glass card
{
  background: 'rgba(255,255,255,0.42)',
  backdropFilter: 'blur(24px) saturate(1.6)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
  borderRadius: 22,
  border: '1px solid rgba(255,255,255,0.55)',
  boxShadow: '0 2px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.7)',
}

// Inner glass element
{
  background: 'rgba(255,255,255,0.30)',
  backdropFilter: 'blur(12px)',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.45)',
}
```

### Typography
- Display font: `'Instrument Sans'` (Google Fonts)
- Mono font: `'DM Mono'` (Google Fonts) — for data values, timestamps
- CSS variables: `var(--font)` and `var(--mono)`
- Never use Inter, Roboto, Arial, or system fonts

### Animations
- Entry: `glassIn` keyframe (opacity + translateY + blur)
- Hover: `translateY(-2px) scale(1.01)` with box-shadow increase
- Staggered delays: 0.05s increments
- Always respect `prefers-reduced-motion`

### Icons
- Always use Lucide React icons (`lucide-react`)
- NEVER use emoji as icons
- Size: 12-18px for UI, 24-36px for feature icons

## Data Flow

1. Backend `main.py` polls station APIs every N seconds
2. Data stored in Supabase `readings` table
3. Frontend queries Supabase directly (using anon key + RLS)
4. WebSocket pushes "update" event so frontend knows to refetch
5. Row Level Security ensures clients only see their own stations

## Multi-Tenancy via Row Level Security

- Every station belongs to an `organization`
- Every user belongs to an `organization` via `profiles`
- RLS policies on ALL tables ensure users only see their org's data
- Admin users (role='admin', org='hfcl') can see everything
- Client users (role='viewer' or 'manager') see only their org's data

## User Roles

| Role | Can Do |
|------|--------|
| admin | Everything — manage all orgs, stations, users, settings |
| manager | View all their org's stations, download reports |
| viewer | View assigned stations only (read-only) |

## API Data Sources

| Source | Type | Config |
|--------|------|--------|
| EnggEnv | REST API | `api_base_url` + `device_id` in station config |
| AQICN | Public API | Geo-based lookup, needs `AQICN_TOKEN` |
| OpenWeatherMap | Public API | Weather supplement, needs `OWM_API_KEY` |

## NCEC Standards (Saudi Arabia)

| Pollutant | 1-hour | 24-hour | Annual |
|-----------|--------|---------|--------|
| PM2.5 | — | 35 µg/m³ | 15 µg/m³ |
| PM10 | — | 340 µg/m³ | 80 µg/m³ |
| SO₂ | 350 µg/m³ | 80 µg/m³ | — |
| NO₂ | 200 µg/m³ | — | 40 µg/m³ |
| O₃ | 200 µg/m³ | — | — |
| CO | 40 mg/m³ | — | — |

## Common Tasks for Claude Code

### Adding a new page
1. Create `frontend/src/pages/NewPage.jsx`
2. Add import + route in `frontend/src/App.jsx`
3. Add nav item to `NAV_CLIENT` or `NAV_ADMIN` array in App.jsx

### Adding a new component
1. Create `frontend/src/components/ComponentName.jsx`
2. Import where needed (page or other component)
3. Use `glass()` or `glassInner()` from `lib/utils.js` for styling

### Changing station field mapping
This is done in the Admin Panel UI — no code change needed.

### Adding a new API data source
1. Add poll function in `backend/main.py` (follow `poll_enggenv` pattern)
2. Call it in `poll_all()` function
3. No frontend changes needed — data flows through same `readings` table

### Deploying changes
```bash
git add -A && git commit -m "description" && git push
```
Vercel and Railway auto-deploy on push.

## Environment Variables

### Frontend (.env or Vercel env vars)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Backend (.env or Railway env vars)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
AQICN_TOKEN=xxx
OWM_API_KEY=xxx
FRONTEND_URL=https://airwatch.vercel.app
POLL_INTERVAL=300
```

## Things to NEVER Do

- Never use emoji as icons
- Never use Inter, Roboto, or Arial fonts
- Never break the glass morphism aesthetic
- Never expose the service_role key in frontend code
- Never modify RLS policies without understanding multi-tenancy impact
- Never store passwords or secrets in code — always use env vars
- The company name is always "Hills and Field" (not "Hills & Field")
- Brand color is teal green, not lavender/indigo
