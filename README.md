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

