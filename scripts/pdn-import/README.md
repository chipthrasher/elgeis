# PDN import (one-time, already done)

**This was a one-time import.** It created the polygons in `layers/political/` from `flyingmappdn.pdn`, the Paint.NET file the political map used to be drawn in. `layers/` is now the source of truth, and the political map is edited there, not in the PDN. These scripts are kept as a record of how the data was made, not as part of the build.

The PDN itself isn't in the repo. At 118 MB, it's too big for GitHub.

## What it did

The PDN's **Borders** layer has one flat, semi-transparent fill per nation, separated by 1-pixel black outlines, at about one pixel per block. `import_pdn.py`:

1. Gives each outline pixel to the nearest fill, so every pixel belongs to exactly one region. The PDN's solid 5-pixel frame around the image is ignored.
2. Splits each color into separate territories, dropping specks.
3. Traces the territories into polygons that share their border edges, then simplifies each shared border once with [topojson](https://github.com/mattijn/topojson) (3-block tolerance, topology preserved). Neighbors end up with identical borders, with no gaps or overlaps.
4. Matches each territory to a nation in `layers/political/`: by exact color first, then by the earlier polygons traced from the old map image, with a few overrides (`FORCE`, `PER_REGION`) for colors that two nations share.
5. Folds small islands into the nearest large territory of the same nation.

`write-layer.ts` then replaces every `pol_` file in `layers/political/` with the result, leaving the nations (`ent_` files) alone. Polygons get new random IDs each run.

The nations' colors were also updated to the PDN's exact fill colors at the time, by hand.

## Running it again

Only do this to start over from a PDN. It replaces every political polygon, including any edits made since.

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/pdn-import/requirements.txt
.venv/bin/python scripts/pdn-import/import_pdn.py path/to/flyingmappdn.pdn regions.json
node scripts/pdn-import/write-layer.ts regions.json
npm run build
```

`--traces-ref` (default `0a13ed4^`, the last commit with the image traces) is the git commit whose polygons are used to match nations.
