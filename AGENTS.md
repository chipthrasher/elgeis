# AGENTS.md

You have free rein to edit this codebase. I have everything tracked in Git, so be careful before running destructive Git commands.

When you fix something that was in the below "Roadmap", please remove it from the list.

If you can accomplish something with less code, please do so. If you can accomplish something with more code but better readability, please do so.

## Roadmap

Built from [DESIGN.md](DESIGN.md). Each item should be one reviewable change. Items are numbered so they can be approved by number; when one is done, delete it and leave the other numbers alone.


### Milestone 2: Backend skeleton

7. **Docker Compose.** `proxy` (Caddy serving the frontend and built JSON, routing `/api`), `backend` (Hono "hello"), `postgres`, plus `.env.example`. `compose.dev.yaml` mounts the frontend, runs the backend in watch mode, and adds Mailpit.
8. **Database and migrations.** Kysely setup, a migration runner, and the base tables: layers, layer admins, change requests, comments, and app state.
9. **Authentication.** Better Auth with email-link sign-in over SMTP, usernames, long-lived cookie sessions, and the admin plugin. Sign-in UI on the map. Seed script for a test site admin and a test regular user.

### Milestone 3: Change requests

10. **Change request API.** Create/edit/submit/withdraw drafts made of `add`/`update`/`delete` ops with `baseVersion`, validated with the shared module. Limit of 10 open requests per account. Mark requests stale when their base objects change.
11. **Approval pipeline.** Approvals run one at a time: apply ops to the layers repo, commit (requester as author, admin and CR ID in the message), rebuild static JSON, mark approved in Postgres, push to the remote. On startup, reconcile recent commits against Postgres.
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
20. **Retire Google Sheets.** Final import, freeze the Sheet, delete `cache.sh` and the TSV loading code, and replace the "Let us know" Google Form link with change requests.