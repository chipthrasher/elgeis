# DESIGN QUESTIONS

Open questions for [DESIGN.md](DESIGN.md). As each one is answered, fold the decision into DESIGN.md and remove it from here.

Data size isn't a constraint: the political layer is roughly 100–400 KB of JSON (smaller gzipped), so every layer can ship to the browser as static JSON. The questions below are what actually drive the design.

## 1. Who are the contributors, and how do they log in?

- **GitHub users:** change requests are pull requests. No backend is needed.
- **Discord-native players:** we need a submission UI plus Discord OAuth, through a small serverless function or a hosted backend like Supabase.

## 2. Where does layer data live?

Depends on #1.

- **Git (recommended to start):** `layers/<id>/layer.json` plus GeoJSON features. Admins come from CODEOWNERS, change requests are PRs, and CI validates. History, diffs and reverts come free.
- **Database (e.g. Supabase):** tables for layers, layer_admins, features, change_requests and feature_history. Needed for high change-request volume, or contributors who don't use GitHub.
- **Either way:** publish the approved state as static JSON so the public map stays fast.
- **Migration:** what happens to the Google Sheets data and `cache.sh`?

## 3. Who can submit change requests?

- Anyone (anonymous), logged-in users, or whitelisted players?
- How much anti-griefing do we need (rate limits, review queue)?

## 4. Who can create new community layers?

- Anyone, or only a superadmin?
- Do layers need a draft/published state?

## 5. Do we show past borders?

- Is git/database history enough, or do we want a time slider for viewing past borders?
- If we want the slider, features need dates (in real-world time, Elgeis lore time, or both?).

## 6. What does a change request look like?

- **Proposed:** semantic operations (`add` / `update` / `delete`), each tagged with the `baseVersion` of the object it changes. A request goes stale if that object changed since.
- **Review:** admins see a visual diff on the map (old shape in red, new in green), not a text diff of coordinates.

## 7. Data format and IDs

- **Format proposed:** GeoJSON (Point, LineString, Polygon/MultiPolygon with holes), storing integer `[x, z]` block coordinates.
- **IDs proposed:** random and permanent with a type prefix (e.g. `pol_8f3k2a`), never derived from names.
- **Files:** one file per layer, or one file per feature (smaller diffs, fewer merge conflicts)?

## 8. How do we handle shared borders between countries?

- Allow overlaps and have CI or the editor flag them?
- Have the editor snap to nearby vertices?
- Store shared border lines once, TopoJSON-style? This is correct but complex.
- How are disputed territories represented?

## 9. Are nations separate entities?

- Today nations are already shared between `colors.tsv` and the portals' `Political Entity` column.
- **Proposal:** a shared `entities` list (id, name, color, wiki URL). Polygons and portals reference it by ID.

## 10. How do we turn the Nether highway into a generic layer?

- Bake derived connector lines into the stored data at save/build time instead of computing them at render time?
- Give each layer a `dimension` (`overworld` / `nether`), store Nether data in Nether coordinates, and scale by 8 when rendering?
- **Per-layer schema:** which property is the title, which fields to show, which flags get icons (National, End, IBWH)?
- **Open:** what was the rest of "Functionality is hard because…" in DESIGN.md?
