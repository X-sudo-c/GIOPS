# GIOP Field — Flutter Mobile App

Field app for the Grid Intelligent Operating Platform (Ghana ECG/NEDCo MVP).  
Map-first UX inspired by **QField** — browse, identify, and capture directly on the map.

## Features

- **Map** (home) — full-screen OSM map, navigation-style location puck with heading wedge, live compass/GPS bearing, heading-up follow mode
- **Add** (on map) — crosshair placement, GPS snap, attribute form → staging API
- **Meter** — photo → OCR (`:5002`) → confirm → telemetry (`:5000`)
- **Settings** — configure backend URLs (persisted locally)
- **Offline** — failed captures queue locally; map shows last cached nodes

## Map tools (bottom toolbar)

| Tool | Action |
|------|--------|
| **Pan** | Browse map; tap a node to open its attributes |
| **Add** | Crosshair placement — pan, tap map, **GPS**, or **Here** → save form |
| **Layers** | Toggle master / your staging / others / queued; sync pending uploads |
| **Locate / Heading** | Center on GPS, rotate map so you face forward (tap **N** in status bar to reset north-up) |
| **Reload** | Refresh nodes from API |

Marker colors: green = master, orange = your staging, purple = others' staging, grey = queued offline.

## Prerequisites

Backend services running locally:

```bash
npx supabase start                    # :54321 REST, :54322 Postgres
docker start my-memgraph giop-martin giop-timescale
cd sync-service && uvicorn main:app --host 0.0.0.0 --port 5000 --reload
cd ocr-service && uvicorn main:app --host 0.0.0.0 --port 5002 --reload
```

Apply migrations (through `00009_staging_schema.sql`):

```bash
npx supabase db reset
```

After changing `supabase/config.toml` schemas, restart Supabase so PostgREST exposes the `staging` schema.

## Run the app

```bash
cd mobile
flutter pub get
flutter run
```

## Dev networking

| Target | Sync / OCR / Supabase host |
|--------|----------------------------|
| Android emulator | `http://10.0.2.2:<port>` (default preset) |
| iOS simulator | `http://127.0.0.1:<port>` (localhost preset) |
| Physical phone | `http://<your-lan-ip>:<port>` |

Ports: **5000** sync-service, **5002** ocr-service, **54321** Supabase REST.

Use **Settings → Android emulator preset** or **Localhost preset**, then **Save**.

## Smoke tests

### 1. Grid map

Open **Map** tab. OSM tiles, blue GPS dot, seed nodes (Pokuaa, Anyaa, Mallam). Tap a marker in Pan mode for attributes.

### 2. Field capture (on map)

Tap **Add** → pan crosshair to location (or **GPS** / **Here**) → fill name → **Save to staging**.

Expect `validation: PENDING_FIELD`. Orange marker appears on map and in backoffice.

### 3. Meter OCR + telemetry

**Meter** tab → camera/gallery → **Extract with OCR** → confirm → **Confirm & submit telemetry**.

Test serial `ECG-12345678` should resolve to meter MRID `d0000000-0000-0000-0000-000000000001`.

### 4. API curl (without app)

```bash
curl -X POST http://localhost:5000/api/v1/field/nodes \
  -H "Content-Type: application/json" \
  -d '{"name":"Curl Test Node","longitude":-0.285,"latitude":5.64}'
```

## Project layout

```
mobile/lib/
  config/api_config.dart
  services/giop_api.dart, capture_service.dart, offline_db.dart
  models/asset_node.dart
  screens/map_screen.dart, meter_screen.dart, settings_screen.dart
  widgets/field_capture_sheet.dart, layer_panel_sheet.dart, map_crosshair.dart
  main.dart
```
