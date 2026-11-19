# Elgeis Map

## Developing

You need Node 22.18 or newer (see `.nvmrc`).

```sh
npm install
npm run dev    # serve the map at http://localhost:8000
npm run lint   # ESLint and TypeScript
npm test
```

Map data lives in `layers/<id>/`: a `layer.json` manifest plus one GeoJSON file per object. `npm run build` validates it and writes the static layer JSON and the bundled JavaScript to `dist/`, which isn't committed.

### The whole site

`npm run dev` only serves the map. To run everything (the backend, Postgres, and [Mailpit](http://localhost:8025) to catch email), you need Docker:

```sh
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

The site is at http://localhost:8080. The frontend rebuilds and the backend restarts when you edit files. After changing `package.json`, run the command again so the images are rebuilt.

## Deploying

The site runs with Docker Compose. Copy `.env.example` to `.env`, fill it in, and start it:

```sh
docker compose up -d --build
```

It serves plain HTTP on `HTTP_PORT`. To put it on the internet:

- **Use HTTPS.** Put it behind a reverse proxy or tunnel that terminates HTTPS, and set `SITE_URL` to the public `https://` address. Sign-in links and cookies are built from `SITE_URL`.
- **Pass on the client's address.** Have your proxy send `X-Forwarded-For` and `X-Forwarded-Proto`, and list its address in `TRUSTED_PROXIES`. Otherwise every visitor looks like your proxy, and rate limits lump them together. The default, `private_ranges`, trusts localhost and private networks.
- **Set up SPF and DKIM** for the domain that sign-in email comes from, or it will land in spam.
- **Back up.** Approved map data is pushed to a git remote after every change. Copy the `backups` volume, which holds nightly Postgres dumps, off the machine regularly.
