# AGENTS.md

You have free rein to edit this codebase. I have everything tracked in Git, so be careful before running destructive Git commands.

When you fix something that was in the below "Roadmap", please remove it from the list.

If you can accomplish something with less code, please do so. If you can accomplish something with more code but better readability, please do so.

## Roadmap

Built from [DESIGN.md](DESIGN.md). Each item should be one reviewable change. Items are numbered so they can be approved by number; when one is done, delete it and leave the other numbers alone.

### Milestone 5: Mobile support

- On screens with less width, move the directory area to the top above the map. not overlapping z-wise. hide the title & subtitle. only show the search. The directory should be hidden unless user opens it, and when its open, it takes the whole screen hiding the map. #TODO: refine this

### Milestone 6: Nether highway

- **Bring back the Nether highway.** Remove `nether` from `PAUSED` in `src/main.ts` so its portals and lines show on the map and in the directory again, and fix whatever needs fixing for it to render well alongside the political layer.

### Milestone 7: Backups

- **Backups.** A `backup` service that dumps Postgres nightly into the backups volume. Verify that pushes to the layers remote work after every commit.

### Milestone 8: Dynmap

- Through a nightly scraping job scraping our Dynmap instance (http://dynmap.elgeis.com:10102/), a Leaflet tile layer replaces the static dynmap.jpg. #TODO refine this