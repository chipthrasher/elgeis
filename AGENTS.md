# AGENTS.md

You have free rein to edit this codebase. I have everything tracked in Git, so be careful before running destructive Git commands.

When you fix something that was in the below "Roadmap", please remove it from the list.

If you can accomplish something with less code, please do so. If you can accomplish something with more code but better readability, please do so.

## Roadmap

Built from [DESIGN.md](DESIGN.md). Each item should be one reviewable change. Items are numbered so they can be approved by number; when one is done, delete it and leave the other numbers alone.

### Milestone 3: Change requests

12. **Editor UI: properties.** Submit edits to existing objects (and hide/unhide) through a form generated from the schema, then view your own requests and their status.
13. **Editor UI: geometry.** Draw and edit points, lines, and polygons (with holes) on the map. Snap to neighboring polygons' vertices. For Nether portals, suggest a connector to the nearest highway.
14. **Review UI.** Layer admins see the old shape in red, the new one in green, and a list of changed properties. Approve/reject with comments. Show warnings about overlaps and gaps with neighbors (disputed polygons exempt).

### Milestone 4: Community layers and moderation

15. **Layer admin tools.** A schema editor and adding/removing layer admins.
16. **Community layers.** Any account can create a layer, and its creator becomes its admin. A community layer list where viewers can enable hidden-by-default layers (reflected in `?layers=`).
17. **Site moderation.** Site-wide bans, hiding/deleting community layers, and marking layers official.
18. **Email notifications.** A queue in Postgres for review requests, approvals, rejections, and stale notices. Rate limits that respect the trusted proxy addresses.

### Milestone 5: Cutover

19. **Backups.** A `backup` service that dumps Postgres nightly into the backups volume. Verify that pushes to the layers remote work after every commit.
20. **Replace the Google Form.** Replace the "Let us know" Google Form link with change requests.

### Milestone 6: Nether highway

21. **Bring back the Nether highway.** Remove `nether` from `PAUSED` in `src/main.ts` so its portals and lines show on the map and in the directory again, and fix whatever needs fixing for it to render well alongside the political layer.
