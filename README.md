# Elgeis Map

## Developing

You need Node 22.18 or newer (see `.nvmrc`).

```sh
npm install
npm run dev    # serve the map at http://localhost:8000
npm run lint   # ESLint and TypeScript
npm test
```

Database tests are skipped unless `DATABASE_URL` points at a Postgres server where they can create throwaway databases, e.g. `DATABASE_URL=postgres://postgres:test@localhost:5432/postgres npm test`. Migrations live in `backend/migrations/` and run when the backend starts; `node backend/migrate.ts down` undoes the last one.

Map data lives in its own repo, [chipthrasher/elgeisdata](https://github.com/chipthrasher/elgeisdata): a folder per layer, each with a `layer.json` manifest plus one GeoJSON file per object. `npm run build` and `npm run dev` clone or update it into `data/layers` (or run `npm run layers` yourself). `npm run build` validates it and writes the static layer JSON and the bundled JavaScript to `dist/`, which isn't committed.

### The whole site

`npm run dev` only serves the map. To run everything (the backend, Postgres, and [Mailpit](http://localhost:8025) to catch email), you need Docker:

```sh
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

With [Task](https://taskfile.dev) installed, `task up` starts it in the background, `task logs` follows the logs (`task logs -- backend` for one service), and `task down` stops it. Add `PROD=1` to any of them to use the production setup instead, e.g. `task up PROD=1` on the server.

The site is at http://localhost:8080. The frontend rebuilds and the backend restarts when you edit files. After changing `package.json`, run the command again so the images are rebuilt.

To sign in, create a test site admin (`admin@example.com`) and a test regular user (`user@example.com`):

```sh
docker compose exec backend node backend/seed.ts
```

Then enter one of their emails under "Sign in" and open the link from Mailpit. Any other email works too, as a new account.

## Deploying

The site runs with Docker Compose. Copy `.env.example` to `.env`, fill it in, and start it:

```sh
docker compose up -d --build
```

It serves plain HTTP on `HTTP_PORT`. To put it on the internet:

- **Use HTTPS.** Put it behind a reverse proxy or tunnel that terminates HTTPS, and set `SITE_URL` to the public `https://` address. Sign-in links and cookies are built from `SITE_URL`.
- **Pass on the client's address.** Have your proxy send `X-Forwarded-For` and `X-Forwarded-Proto`, and list its address in `TRUSTED_PROXIES`. Otherwise every visitor looks like your proxy, and rate limits lump them together. The default, `private_ranges`, trusts localhost and private networks.
- **Let the backend push the map data.** Put the private half of `elgeisdata`'s deploy key (one with write access) at `secrets/layers_deploy_key`, run `chmod 600 secrets/layers_deploy_key`, and set `LAYERS_REMOTE=git@github.com:chipthrasher/elgeisdata.git` in `.env`. The repo is cloned the first time the backend starts; if it already was over HTTPS, switch it with `docker compose exec backend git -C /data/repo remote set-url origin git@github.com:chipthrasher/elgeisdata.git`.
- **Set up SPF and DKIM** for the domain that sign-in email comes from, or it will land in spam.
- **Back up.** Approved map data is pushed to a git remote after every change. Copy the `backups` volume, which holds nightly Postgres dumps, off the machine regularly.
