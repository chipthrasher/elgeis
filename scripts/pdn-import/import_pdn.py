"""One-time import of the political map's polygons from its Paint.NET file.

Kept as a record of how layers/political/ was made (see README.md). It reads the
"Borders" layer of the PDN, which holds one flat, semi-transparent fill per
nation separated by black outlines, and writes polygons whose shared borders are
identical, plus a guess at which nation each one belongs to.

Usage:
    python import_pdn.py flyingmappdn.pdn regions.json [--tolerance 3] [--traces-ref 0a13ed4^]

Then write the layer files with:
    node scripts/pdn-import/write-layer.ts regions.json
"""

import argparse, glob, json, os, subprocess
import cv2, numpy as np, pypdn, rasterio.features, topojson
from rasterio.transform import Affine
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAP_SIZE = 5500       # blocks from (0, 0) to the edge, as the base image is displayed
FILL_ALPHA = 140      # fills are this transparent; outlines are opaque black
FRAME = 5             # the PDN has a solid frame this many pixels wide around the image
SCALE = 2             # PDN pixels per working pixel (the PDN is about one pixel per block)
MIN_COLOR_PX = 1000   # colors with fewer PDN pixels are antialiasing noise
MIN_REGION_PX = 50    # smaller areas (working pixels) join their surroundings
MIN_HOLE = 100        # smaller holes (blocks^2) are stray pixels, not enclaves
BIG = 20000           # territories smaller than this (blocks^2) fold into a nearby one of the same nation

# Colors the Sheet couldn't settle on its own: shared by two nations, or not in it at all.
FORCE = {'#ffffff': 'RSV', '#00ffff': 'ICEFARM', '#713a8a': 'Goomlandia', '#ff6969': 'Lososha', '#32cd32': 'Emeraldia'}
# Colors used by separate nations, decided per region by the earlier traces (FEPB/RSV, RSV/Redstone Valley).
PER_REGION = {'#808080', '#ffffff'}


def read_regions(pdn_path):
    """Label every pixel of the Borders layer with one region, giving outlines to the nearest fill."""
    layer = next(l for l in pypdn.read(pdn_path).layers if l.name == 'Borders').image.copy()
    layer[:FRAME, :, 3] = layer[-FRAME:, :, 3] = layer[:, :FRAME, 3] = layer[:, -FRAME:, 3] = 0
    layer = layer[::SCALE, ::SCALE]
    alpha, rgb = layer[..., 3], layer[..., :3].astype(np.int32)
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    fill = alpha == FILL_ALPHA

    colors, counts = np.unique(key[fill], return_counts=True)
    colors = colors[counts * SCALE * SCALE >= MIN_COLOR_PX]
    color_ids = np.full(key.shape, -1, np.int32)
    for i, c in enumerate(colors):
        color_ids[(key == c) & fill] = i
    overlay = alpha > 0
    color_ids = fill_from_nearest(color_ids, overlay & (color_ids < 0))

    regions = np.full(key.shape, -1, np.int32)
    region_colors = []
    for i, c in enumerate(colors):
        n, parts, stats, _ = cv2.connectedComponentsWithStats((color_ids == i).astype(np.uint8), 4)
        for j in range(1, n):
            if stats[j, cv2.CC_STAT_AREA] >= MIN_REGION_PX:
                regions[parts == j] = len(region_colors)
                region_colors.append('#%06x' % c)
    regions = fill_from_nearest(regions, overlay & (regions < 0))
    return regions, region_colors


def fill_from_nearest(ids, where):
    """Give the pixels in `where` the id of the nearest pixel that has one."""
    unset = (ids < 0).astype(np.uint8)
    _, nearest = cv2.distanceTransformWithLabels(unset, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(unset == 0)
    lookup = np.zeros(nearest.max() + 1, np.int32)
    lookup[nearest[ys, xs]] = ids[ys, xs]
    out = ids.copy()
    out[where] = lookup[nearest[where]]
    return out


def vectorize(regions, region_colors, tolerance):
    """Trace regions into polygons that share edges, then simplify each shared border once."""
    blocks_per_px = 2 * MAP_SIZE / regions.shape[0]
    transform = Affine(blocks_per_px, 0, -MAP_SIZE, 0, blocks_per_px, -MAP_SIZE)
    shapes = {}
    for geom, value in rasterio.features.shapes(regions, mask=regions >= 0, connectivity=4, transform=transform):
        shapes.setdefault(int(value), []).append(shape(geom))
    features = [{'type': 'Feature', 'properties': {'color': region_colors[r]}, 'geometry': mapping(unary_union(gs))}
                for r, gs in sorted(shapes.items())]
    topo = topojson.Topology({'type': 'FeatureCollection', 'features': features},
                             prequantize=False, toposimplify=tolerance, prevent_oversimplify=True)
    return json.loads(topo.to_geojson())['features']


def load_nations(traces_ref):
    """The political layer's nations, and the earlier polygons (at traces_ref) to match against."""
    git = lambda *args: subprocess.run(['git', '-C', ROOT, *args], capture_output=True, text=True, check=True).stdout
    nations, traces = {}, []
    for path in glob.glob(os.path.join(ROOT, 'layers/political/ent_*.json')):
        o = json.load(open(path))
        nations[o['id']] = o['properties']
    for path in git('ls-tree', '--name-only', traces_ref, 'layers/political/').split():
        if os.path.basename(path).startswith('pol_'):
            o = json.loads(git('show', f'{traces_ref}:{path}'))
            traces.append((shape(o['geometry']).buffer(0), o['properties'].get('entity')))
    return nations, traces


def normalize(color):
    color = color.lower()
    return '#' + ''.join(ch * 2 for ch in color[1:]) if len(color) == 4 else color


def name_regions(features, nations, traces):
    """Match regions to nations: Sheet color first, then the earlier traces, then FORCE."""
    by_color, by_name = {}, {p['name']: i for i, p in nations.items()}
    for i, p in nations.items():
        if p.get('color'):
            by_color.setdefault(normalize(p['color']), []).append(i)

    # Which earlier-traced nation each region mostly overlaps, and a per-color vote.
    regions, votes = [], {}
    for f in features:
        g, color = shape(f['geometry']).buffer(0), f['properties']['color']
        hits = [(t.intersection(g).area, nation) for t, nation in traces if nation and t.intersects(g)]
        traced = max(hits)[1] if hits and max(hits)[0] > 0.2 * g.area else None
        if traced:
            votes.setdefault(color, {})
            votes[color][traced] = votes[color].get(traced, 0) + g.area
        regions.append((g, color, traced))
    owner = {c: max(v, key=v.get) for c, v in votes.items()}
    owner.update({c: by_name[n] for c, n in FORCE.items()})

    named = []
    for g, color, traced in regions:
        candidates = by_color.get(color, [])
        if color in PER_REGION and traced:
            nation = traced
        elif color in owner and (color in FORCE or not candidates):
            nation = owner[color]
        elif candidates:
            nation = traced if traced in candidates else candidates[0]
        else:
            nation = traced
        named.append({'entity': nation, 'geom': g})
    return named


def group_islands(named):
    """One object per territory; small islands join the nearest big territory of their nation."""
    groups = [[r] for r in named if r['geom'].area >= BIG or r['entity'] is None]
    for r in named:
        if r['geom'].area >= BIG or r['entity'] is None:
            continue
        near = [g for g in groups if g[0]['entity'] == r['entity'] and g[0]['geom'].distance(r['geom']) < 600]
        if near:
            min(near, key=lambda g: g[0]['geom'].distance(r['geom'])).append(r)
        else:
            groups.append([r])
    return [{'entity': g[0]['entity'], 'geometry': clean([p for r in g for p in getattr(r['geom'], 'geoms', [r['geom']])])}
            for g in groups]


def clean(polygons):
    """Round to whole blocks, drop speck holes, and repair rings that rounding pinched."""
    out = []
    for p in polygons:
        r = lambda ring: [(round(x), round(z)) for x, z in ring.coords]
        q = Polygon(r(p.exterior), [r(h) for h in p.interiors if Polygon(h).area >= MIN_HOLE])
        if q.is_valid:
            out.append(q)
        else:
            fixed = make_valid(q)
            out += [x for x in getattr(fixed, 'geoms', [fixed]) if x.geom_type == 'Polygon' and x.area > 0]
    result = out[0] if len(out) == 1 else MultiPolygon(out)
    return mapping(result if result.is_valid else unary_union(out))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pdn')
    parser.add_argument('out')
    parser.add_argument('--tolerance', type=float, default=3, help='how far borders may move when simplified, in blocks')
    parser.add_argument('--traces-ref', default='0a13ed4^', help='git ref with the earlier polygons to match nations against')
    args = parser.parse_args()

    regions, colors = read_regions(args.pdn)
    features = vectorize(regions, colors, args.tolerance)
    nations, traces = load_nations(args.traces_ref)
    objects = group_islands(name_regions(features, nations, traces))
    json.dump(objects, open(args.out, 'w'))
    print(f'{len(features)} regions -> {len(objects)} polygons, {sum(o["entity"] is None for o in objects)} without a nation')
