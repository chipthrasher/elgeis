# AGENTS.md

You have free rein to edit this codebase. I have everything tracked in Git, so be careful before running destructive Git commands.

When you fix something that was in the below "Roadmap", please remove it from the list.

If you can accomplish something with less code, please do so. If you can accomplish something with more code but better readability, please do so.

## Roadmap

Built from [DESIGN.md](DESIGN.md). Each item should be one reviewable change. Items are numbered so they can be approved by number; when one is done, delete it and leave the other numbers alone.

### Milestone 5: Mobile support

Below 768px wide (`@media (max-width: 48rem)`), the layout changes. Desktop stays as it is.

- **Mobile map controls.** The account box collapses to a single "Account" button that opens it, and the editor panel opens full screen over the map with its close button in reach. The coordinate readout, which follows the mouse, shows the block at the middle of the screen instead (with a small crosshair there), since there's no mouse to hover. The layers control starts collapsed to its icon. Hover cards show on tap.

### Milestone 6: Nether highway

- **Bring back the Nether highway.** Remove `nether` from `PAUSED` in `src/main.ts` so its portals and lines show on the map and in the directory again, and fix whatever needs fixing for it to render well alongside the political layer.

### Milestone 7: Backups

- **Backups.** A `backup` service that dumps Postgres nightly into the backups volume. Verify that pushes to the layers remote work after every commit.

### Milestone 8: Dynmap

Our Dynmap is at http://dynmap.elgeis.com:10102/ (`/up/configuration` lists its worlds and maps). We use the Overworld's top-down map: world `8302018`, map `flat2`, 128px PNG tiles at 16px per block, with 7 zoomed-out levels. A tile is at `/tiles/8302018/flat2/<rx>_<ry>/<zoom><tx>_<ty>.png`, where:

- `<zoom>` is empty at full size, or one `z` per zoomed-out level then `_` (`zz_` is 2 levels out). At `n` levels out, a tile covers `8 × 2^n` blocks a side, and `tx`/`ty` are multiples of `2^n`.
- `tx = floor(x / 8)` and `ty = floor(-z / 8)` in full-size tile units (`ty` grows northward), and the folder is `rx = floor(tx / 32)`, `ry = floor(ty / 32)` (the server seems to ignore the folder, but use the right one).
- Tiles answer `If-None-Match` with `304` when unchanged, and missing tiles come back as a 143-byte blank PNG.

`n` levels out is Leaflet zoom `4 - n` (one pixel per block is zoom 0), so a Leaflet tile `(x, y)` at zoom `4 - n` is the Dynmap tile `tx = x × 2^n`, `ty = -(y + 1) × 2^n`.

- **Scrape the Dynmap nightly.** A `dynmap` service in `compose.yaml` downloads the tiles covering the world border (-5500 to 5500) from 2 to 7 levels out (Leaflet zooms 2 to -3, which is as far in as our map goes), about 160k tiles, a few at a time so the server isn't swamped. It saves them in Leaflet's own `<zoom>/<x>/<y>.png` layout in a `tiles` volume, so the frontend needs no knowledge of Dynmap's scheme, and keeps each tile's ETag beside it, so a nightly run only downloads what changed. Each tile is written to a temporary file and renamed into place, so a half-done run never shows a broken tile. It runs once at start if the volume is empty. Caddy serves the volume at `/tiles/`.
- **Draw the scraped tiles.** In `map.ts`, an `L.tileLayer('/tiles/{z}/{x}/{y}.png', { tileSize: 128, minNativeZoom: -3, maxNativeZoom: 2 })` bounded at the world border replaces the `dynmap.jpg` image overlay, keeping its name in the layers control, its opacity, and its place at the bottom. Then delete `dynmap.jpg`.
