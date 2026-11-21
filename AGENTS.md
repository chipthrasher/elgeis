# AGENTS.md

You have free rein to edit this codebase. I have everything tracked in Git, so be careful before running destructive Git commands.

When you fix something that was in the below "Roadmap", please remove it from the list.

If you can accomplish something with less code, please do so. If you can accomplish something with more code but better readability, please do so.

## Roadmap

Built from [DESIGN.md](DESIGN.md). Each item should be one reviewable change. Items are numbered so they can be approved by number; when one is done, delete it and leave the other numbers alone.

### Milestone 5: Mobile support

Below 768px wide (`@media (max-width: 48rem)`), the layout changes. Desktop stays as it is.

- **Mobile layout.** The sidebar becomes a bar across the top, above the map in the page flow (not floating over it), holding only the search box and a "Directory" button; the title, subtitle, "Try making your own maps" line, and the footer link are hidden. The map fills the rest of the screen. The directory is hidden until the button is pressed, then takes the whole screen below the search bar and hides the map; the button becomes "Map" to close it. Typing in the search opens the directory, and choosing a result closes it and pans the map there, as clicking a result does now. Use `100dvh`, not `100vh`, so the browser's address bar doesn't push the map off screen. Mostly CSS, plus a little JS in `sidebar.ts` for the button.
- **Mobile map controls.** The account box collapses to a single "Account" button that opens it, and the editor panel opens full screen over the map with its close button in reach. The coordinate readout, which follows the mouse, shows the block at the middle of the screen instead (with a small crosshair there), since there's no mouse to hover. The layers control starts collapsed to its icon. Hover cards show on tap.

### Milestone 6: Nether highway

- **Bring back the Nether highway.** Remove `nether` from `PAUSED` in `src/main.ts` so its portals and lines show on the map and in the directory again, and fix whatever needs fixing for it to render well alongside the political layer.

### Milestone 7: Backups

- **Backups.** A `backup` service that dumps Postgres nightly into the backups volume. Verify that pushes to the layers remote work after every commit.

### Milestone 8: Dynmap

Our Dynmap is at http://dynmap.elgeis.com:10102/. Its tiles are at `/tiles/<world>/<map>/<rx>_<ry>/<zoom prefix><tx>_<ty>.<ext>`, and `/up/configuration` lists its worlds and maps. Check both against the real server before building on them: it wasn't reachable when this was written.

- **Scrape the Dynmap nightly.** A `dynmap` service in `compose.yaml` downloads the Overworld's flat map tiles that cover the world border (-5500 to 5500), at full resolution and each zoomed-out level, a few requests at a time so the server isn't swamped. It saves them in Leaflet's own `<zoom>/<x>/<y>.<ext>` layout (at zoom 0, tile x = floor(x / 128) and y = floor(z / 128), one pixel per block), so the frontend needs no knowledge of Dynmap's scheme. Each scrape goes into a fresh folder in a `tiles` volume, which replaces the old one only once it's complete, so a failed or half-done scrape never shows. It runs once at start if the volume is empty. Caddy serves the volume at `/tiles/`.
- **Draw the scraped tiles.** In `map.ts`, an `L.tileLayer('/tiles/{z}/{x}/{y}.<ext>')` with `maxNativeZoom: 0` (scaled up past that) and bounds at the world border replaces the `dynmap.jpg` image overlay, keeping its name in the layers control, its opacity, and its place at the bottom. Then delete `dynmap.jpg`.
