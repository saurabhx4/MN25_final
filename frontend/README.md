# Mn 25 — Manganese Mining Intelligence Platform

Hackathon prototype (SIH 2026 · SIH26009). Uses **Prototype Simulation Data** only — no connection to any organization's private systems, and no claim of confirmed manganese reserves from satellite data alone.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Recharts (charts), Leaflet (geospatial map)
- Hand-written CSS design system (tokens in `app/globals.css`) — no Tailwind, to avoid adding a dependency the original project didn't have
- Local API routes with deterministic synthetic mining data

## Run
```bash
npm install
npm run dev
```
Open http://localhost:3000.

Production build:
```bash
npm run build
npm start
```

## Structure
```
app/            routing shell, layout, global styles, API routes
components/     Landing, SignIn, AppShell (sidebar/topbar/nav), Chatbot, MineMap, Charts, Drawer, Brand
components/pages/   Overview, MineIntelligence, ProductionAI, RiskCenter, ActionCenter, DataModels, SettingsPage
components/ui/  small shared primitives (Kpi card)
lib/data.ts     synthetic data + prospectivity/scenario/recommendation logic — swap for real APIs later
```

## Flow
Landing → Sign In (Organization / Employee, demo auth) → App Shell → Overview → Mine Intelligence →
Production AI (what-if simulator) → Risk Center → AI Action Center → Data & Models.
"Explore Intelligence" on the landing page skips sign-in for a quick demo walkthrough.

## Notes
- Leaflet uses OpenStreetMap tiles at low opacity for the geospatial layer; the app still works if the tile service is unavailable — analytical data stays local.
- The Mn 25 AI assistant (floating button) uses predefined demo responses, structured so a real model/API can be substituted in `components/Chatbot.tsx`'s `answer()` function.
- ML labels represent prototype logic (`lib/data.ts`). For production, replace the local calculation layer with real model services and a geospatial database.
- This build was assembled without network access to run `npm install`/`npm run build` — please run both locally and report any errors so they can be fixed quickly.

## Landing visual asset
The landing-page Mars uses an equirectangular Mars surface texture sourced from Solar System Scope via Wikimedia Commons (CC BY 4.0) and animated with CSS lighting/motion. The texture is loaded remotely so the project archive remains lightweight.
