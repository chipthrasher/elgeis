# DESIGN

The goal is to make a community supported map. It's not for real life, it's for a Minecraft server with limited size coordinates. Thus, it's a square map of size 11k x 11k, with coordinates from top left (-5500, -5500) to bottom right (5500, 5500).

Right now, this repo has a lot of functionality for the Nether highway with lines & portals. You can click, hover, search. However, this will no longer be the only layer on this map. There will also be a layer for the "political map", which shows polygons of which countries' land claims exist.

To make this possible we need to define layers. Layers need to be able to have certain objects in them, such as:
- Polygons
  - Name
- Lines
- Landmarks (points)
Objects should all have a unique ID

Ideally all the Nelt map functionality would be generalized into a layer. That's hard because the Nelt map has its own search, hover, and click behavior for its circles, and its data was generated from Google Sheets. The JS in `js/` should be loosely coupled, so the little that's specific to the Nelt map is kept apart from what's generalized.

Layers should have 1 to many Admins (users) who can approve change requests. Change requests are basically diffs to the layer. Like adding a polygon or changing a polygon's points. Ideally the layer should be formatted in a way that can have diffs.

## Layers

- **Each layer has a dimension**, `overworld` or `nether`, and stores coordinates native to that dimension. Nether layers are scaled by 8 when rendered, so people can enter the exact Nether block positions they see in game.
- **Each layer has a schema that its admins edit.** The schema lists the layer's fields, each with a type: `text`, `url`, `flag`, or `reference` (to another object or entity). It also says which field is the title. Flags and text fields can have an icon from a fixed icon set, e.g. the Nether layer's National, End, IBWH, and Warning. The editor form, popups, and hover cards are generated from the schema.
- **Search, hover, and click are generic.** Search covers a layer's text fields and coordinates. Hovering or clicking an object highlights the objects it references, so a portal highlights its highway line without any Nether-specific JS.
- **Any object can be hidden.** `hidden` is an ordinary property, so hiding or unhiding an object is just an `update` in a change request. Hidden objects are left out of the public static JSON.
- **Derived geometry is stored, not computed at render time.** When a Nether portal is placed, the editor suggests a connector to the nearest highway line. The connector is saved as an ordinary LineString on the object, so the renderer only draws stored geometry and reviewers see connectors in the diff.

## Political map

- **Nations are entities.** An entity (`ent_` prefix) has a name, color, and wiki URL, and it's stored as an object in the political layer. Polygons and other layers (like Nether portals) reference entities by ID. A nation can have several polygons, or none, and renaming one only touches one object.
- **Each polygon stores its own full border.** There are no TopoJSON-style shared arcs, which would make one border edit touch two nations. Instead, the editor snaps to the vertices of neighboring polygons. The review view warns about overlaps and gaps with neighbors, but doesn't block approval.
- **Disputed territory is its own polygon** that lists its claimant entities. It renders hatched in their colors and is exempt from overlap warnings.

## Community layers

- **Any account can create a new layer.** Once saved, it exists right away, and its creator is its first admin.
- **Community layers are hidden by default.** The official layers (the political map and the Nether highway) show by default. To see a community layer, a viewer opens the list of community layers and enables it.
- **The layers being viewed are stored in a URL param** (e.g. `?layers=political,nether,lay_3k9x2m`), so people can share custom views. This works alongside the existing `q` search param.

## Change requests

- **Any account can submit** a change request to any layer. Nothing goes live until a layer admin approves it, so open submission is low-risk.
- **Each account can have at most 10 open change requests** at once.
- **A change request is a list of operations:** `add`, `update`, or `delete`. Each operation records the version of the object it changes (`baseVersion`). If that object changes before the request is approved, the request goes stale and the author has to update it.
- **Admins review on the map.** The old shape shows in red and the new one in green, with a list of changed properties beside it. They don't read a text diff of coordinates.

## Data format

- **Objects are GeoJSON:** Point, LineString, and Polygon/MultiPolygon (holes allowed). Coordinates are integer Minecraft block positions, `[x, z]`.
- **IDs are random, permanent, and prefixed by type**, e.g. `pol_8f3k2a`. They're never derived from names, so renaming a nation doesn't change its ID.

## Moderation

- **Site admins** are a small set of accounts with power over the whole site.
- **Bans are site-wide.** A site admin can ban an account from submitting change requests to any layer.
- **Site admins can hide or delete community layers.** Hiding is reversible and drops the layer from the community list; deleting removes it.
- **Site admins decide which layers are official** and shown by default. The political map and the Nether highway start out official.

## Storage

To start we will likely have 2 big layers and maybe 30 community supported smaller layers. The political map may store 300 polygons, some of which have 100-plus XY points making up their border, plus metadata for each polygon. That's only a few hundred KB, so size isn't a constraint.

Storage is split between git and Postgres:

- **Git holds the approved layer data.** Each layer is a folder of GeoJSON files, one file per object, written with consistent formatting so diffs stay clean. The backend is the only thing that writes to the repo. Each approved change request becomes one commit, with the requester as author and the approving admin in the commit message. History, reverts, and backups (by pushing to a remote) come from git.
- **Approving writes git first, then Postgres.** Approvals run one at a time, so two admins can't collide on the repo. Each commit message includes the change request ID. On startup, the backend checks recent commits against Postgres and marks any request that was committed but never marked approved, which repairs a crash between the two writes.
- **Postgres holds everything else:** pending change requests (drafts, submitted, rejected, stale), review comments, layer admins, and app state like rate limits and the email notification queue. User accounts and sessions live there too.
- **Past borders come from git history.** There's no time slider for now, so objects don't need dates. If we add a slider later, we'll decide then whether dates use real-world time, Elgeis lore time, or both.
- **The public map reads static JSON.** After each commit, the backend builds each layer into a single static JSON file, so the public map stays fast and cacheable.

## Backend

The backend is Node.js with TypeScript, using [Hono](https://hono.dev/) for routing, `pg` with [Kysely](https://kysely.dev/) for Postgres, and the `git` CLI for commits and pushes. TypeScript lets the browser editor and the backend share one validation module, so they always agree on what a valid change request is.

## Authentication

Auth runs inside the backend using [Better Auth](https://www.better-auth.com/), which is MIT-licensed and stores its tables in our Postgres. There's no separate auth service.

- **Users sign in with an email link.** Clicking the link verifies the email, so there are no passwords to store or reset. Mail goes out over SMTP.
- **Users pick any username.** It doesn't have to match their Minecraft player name.
- **Sessions are cookies.** The backend gets the current user from Better Auth on each request.
- **Email is the only way in, so sessions last a long time.** If SMTP breaks or sign-in links land in spam, people who are already signed in stay signed in. Passkeys (a Better Auth plugin) could be added later as a second way to sign in.
- **Site admins and bans use Better Auth's admin plugin.** Layer admins live in our own table, because they're set per layer.

## Deployment

The whole site runs with Docker Compose, like most self-hosted software. `docker compose up -d` starts everything, on a laptop or a server.

- **Services:**
  - `proxy`: [Caddy](https://caddyserver.com/). It serves the frontend and the built layer JSON, and routes `/api` to the backend.
  - `backend`: the API, including auth. It's the only writer to the layers git repo.
  - `postgres`: the database.
  - `backup`: dumps Postgres on a schedule into a backups volume.
- **One HTTP port is exposed.** HTTPS and exposing the site to the internet are up to whoever runs it: a reverse proxy, a tunnel, or whatever they already use.
- **Configuration lives in `.env`:** the site URL, trusted proxy addresses, the database password, the auth secret, and SMTP settings. A committed `.env.example` lists every variable.
- **Data lives in named volumes:** the layers git repo, the built layer JSON, Postgres, and Postgres backups.
- **Backups:** the backend pushes the layers repo to a git remote after every commit, and the `backup` service dumps Postgres nightly. The operator copies the backups volume off the machine. Losing Postgres loses only pending change requests and accounts; approved map data is safe in git.

### Dev

- **`compose.dev.yaml` adds dev-only changes:** frontend files mounted from your checkout, the backend in watch mode, and [Mailpit](https://mailpit.axllent.org/) to catch sign-in emails instead of sending them.
- **A seed script creates a test site admin and a test regular user.**

## Migrating off Google Sheets

Done. The Sheet was imported once (portals and highway lines into the Nether layer, nations into political-layer entities, computed connectors as stored LineStrings, `Hide` rows as hidden objects), and then retired along with `cache.sh` and the import script. The political polygons were traced once from the map's Paint.NET file (see `scripts/pdn-import/`). `layers/` is now the only source of map data.
