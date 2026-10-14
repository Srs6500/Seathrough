# Physics tutor — local source data (not deployed)

This folder is for **local** downloads and PDF ingest only. It is gitignored except this README.

| Path | Purpose |
|------|---------|
| `*.pdf` | Source textbooks (Crowell, Schnick, etc.) |
| `chunks/ingested.json` | Output of `npm run ingest:physics` |
| `vfpt-svgs/` | Raw VFPt / Wikimedia downloads (may include duplicates) |
| `vfpt-svgs/_downloads/` | One-off drops from the repo root |
| `_local/` | Screenshots and other scratch files |

**What ships with the app**

- Diagrams served to users: `public/physics/vfpt/` (synced curated copies)
- Seed + full textbook RAG: `src/lib/physics-tutor/chunks/` (`electrostatics.seed.json`, `ingested.json`)

After adding SVGs here, copy the ones you want live into `public/physics/vfpt/` (same filename the picker uses).

After `npm run ingest:physics`, copy the richer corpus into the ship path:

```bash
cp Physics-tutor-data/chunks/ingested.json src/lib/physics-tutor/chunks/ingested.json
```
