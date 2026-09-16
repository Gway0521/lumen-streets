"""Build immutable, bounded GeoJSON building tiles and an offline audit archive.

Example: python scripts/buildings/build.py --bounds 139.73 35.65 139.75 35.67
         --output .cache/building-tiles/tokyo-v1
"""
import argparse
import gzip
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path

from shapely.geometry import box, shape

from model import VERSION, conflate, resolve, tile_feature
from providers import Downloads, load, raster_candidates

ZOOM = 14


def tile_xy(lon, lat):
    n = 2**ZOOM
    return (min(n - 1, max(0, int((lon + 180) / 360 * n))),
            min(n - 1, max(0, int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))))


def tile_bounds(x0, y0, x1, y1):
    n = 2**ZOOM
    lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return [x0 / n * 360 - 180, lat(y1 + 1), (x1 + 1) / n * 360 - 180, lat(y0)]


def partition(bounds, maximum=64):
    if len(bounds) != 4 or not all(math.isfinite(n) for n in bounds):
        raise ValueError("Four finite bounds required")
    w, s, e, n = bounds
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ValueError("Use a bounded WGS84 rectangle; split antimeridian regions")
    x0, y0 = tile_xy(w, n)
    x1, y1 = tile_xy(e, s)
    if (x1 - x0 + 1) * (y1 - y0 + 1) > maximum:
        raise ValueError(f"Build exceeds {maximum} tiles; partition the region")
    return [x0, y0, x1, y1], tile_bounds(x0, y0, x1, y1)


def in_coverage(spec, bounds):
    return not spec.get("bounds") or box(*bounds).intersects(box(*spec["bounds"]))


def clean_json(value):
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)  # date/decimal values from GeoParquet retain their text


def encode(value):
    return json.dumps(clean_json(value), ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def validate_source(spec):
    for key in ("id", "adapter", "license", "attribution"):
        if not isinstance(spec.get(key), str) or not spec[key].strip():
            raise ValueError(f"Source needs {key}")
    # Data licenses remain separate from the application's AGPL. The public
    # pipeline admits reviewed redistributable inputs; GBA is not a default.
    if spec["license"] not in ("ODbL-1.0", "CC-BY-4.0", "CC0-1.0", "CDLA-Permissive-2.0", "ODC-By-1.0"):
        raise ValueError(f"Unreviewed data license for {spec['id']}: {spec['license']}")


def build(config, bounds, output, cache, max_tiles=64, max_records=250000, reference_year=2026):
    tile_range, snapped = partition(bounds, max_tiles)
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output must be new/empty; publish immutable versions")
    if config.get("version") != 1:
        raise ValueError("Unsupported source registry version")
    download = Downloads(cache)
    active = [config["base"], *[s for s in config.get("supplements", [])
              if s.get("enabled", True) and in_coverage(s, snapped)]]
    for spec in active:
        validate_source(spec)
    if len({s["id"] for s in active}) != len(active):
        raise ValueError("Source IDs must be unique")
    # A small query halo supplies neighbouring match candidates. Source polygons
    # are never clipped, so large boundary buildings keep their full geometry.
    x0, y0, x1, y1 = tile_range
    halo = [max(-180, snapped[0]-.002), max(-85, snapped[1]-.002),
            min(180, snapped[2]+.002), min(85, snapped[3]+.002)]
    records = load(active[0], halo, download, max_records)
    if not records:
        raise ValueError("Base extract is empty; no authoritative empty coverage is published")
    if len({r["id"] for r in records}) != len(records):
        raise ValueError("Duplicate base source IDs")
    report = dict(version=VERSION, requested_bounds=bounds, bounds=snapped,
                  tile_bounds=tile_range, reference_year=reference_year,
                  sources=[], counts={}, inputs=download.receipts)
    supplements = []
    for spec in active[1:]:
        supplement = load(spec, halo, download, max_records)
        count = conflate(records, supplement, halo)
        report["sources"].append(dict(id=spec["id"], records=len(supplement), matches=count))
        supplements.extend(supplement)
    for spec in config.get("rasters", []):
        if spec.get("enabled", True) and in_coverage(spec, halo):
            validate_source(spec)
            raster_candidates(records, spec)
            active.append(spec)
    for spec in active:
        if spec.get("path"):
            with Path(spec["path"]).open("rb") as stream:
                report["inputs"].append(dict(source=spec["id"], sha256=hashlib.file_digest(stream, "sha256").hexdigest()))
    resolve(records, halo, reference_year)
    selected = [r for r in records if not r.get("hide_3d") and shape(r["geometry"]).intersects(box(*snapped))]
    report["counts"] = dict(buildings=len(selected),
        original_height_missing=sum(number_missing(r) for r in selected),
        conflict=sum(r["conflict"] for r in selected),
        methods=dict(Counter(r["resolved"]["method"] for r in selected)),
        selected_sources=dict(Counter(r["resolved"]["source"] for r in selected)))
    tiles = {(x,y): [] for y in range(y0, y1+1) for x in range(x0, x1+1)}
    for r in selected:
        f = tile_feature(r)
        w, s, e, n = shape(r["geometry"]).bounds
        xa, ya = tile_xy(w, n)
        xb, yb = tile_xy(e, s)
        # Uncut footprints appear in each intersecting tile; the runtime dedups
        # stable IDs across tiles. Holes, tall border buildings and parts survive.
        for y in range(max(y0, ya), min(y1, yb)+1):
            for x in range(max(x0, xa), min(x1, xb)+1):
                tiles[x,y].append(f)
    payloads = {}
    for (x,y), features in tiles.items():
        features.sort(key=lambda f: f["id"])
        data = encode(dict(type="FeatureCollection", features=features))
        if len(data) > 8 * 1024**2:
            raise ValueError(f"Tile {x}/{y} exceeds 8 MiB; simplify footprints offline or use a finer format")
        payloads[x,y] = data
    output.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    for (x,y), data in sorted(payloads.items()):
        path = output / "tiles" / str(ZOOM) / str(x) / f"{y}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        digest.update(data)
    # Full raw properties, nulls, candidates, rejected matches and source receipts
    # stay in the offline archive, not in every browser tile.
    with (output / "audit.jsonl.gz").open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as audit:
            for r in sorted([*records, *supplements], key=lambda r: r["id"]):
                audit.write(encode(r) + b"\n")
    public_sources = [{k: v for k,v in s.items() if k not in ("path",)} for s in active]
    report["sources_registry"] = public_sources
    report["content_sha256"] = digest.hexdigest()
    report["tile_count"] = len(tiles)
    report["tile_bytes"] = sum(map(len, payloads.values()))
    (output / "report.json").write_bytes(encode(report))
    # Write manifest last: incomplete builds are never advertised to browsers.
    manifest = dict(version=VERSION, zoom=ZOOM, revision=digest.hexdigest(),
        regions=[dict(tile_bounds=tile_range, tiles="tiles/{z}/{x}/{y}.json")],
        attribution=[s["attribution"] for s in active],
        sources=public_sources, audit="audit.jsonl.gz", report="report.json")
    (output / "manifest.json").write_bytes(encode(manifest))
    return report


def number_missing(record):
    from model import number
    return number(record["raw_height"]) is None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="data/building-sources.json")
    parser.add_argument("--bounds", type=float, nargs=4, required=True, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", default=".cache/building-sources")
    parser.add_argument("--max-tiles", type=int, default=64)
    parser.add_argument("--max-records", type=int, default=250000)
    parser.add_argument("--reference-year", type=int, default=2026)
    args = parser.parse_args()
    config_path = Path(args.config).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    for spec in [config["base"], *config.get("supplements", []), *config.get("rasters", [])]:
        if spec.get("path"):
            spec["path"] = str((config_path.parent / spec["path"]).resolve())
    report = build(config, args.bounds, args.output, args.cache, args.max_tiles, args.max_records, args.reference_year)
    print(json.dumps(report["counts"], indent=2))
    print(f"Wrote {report['tile_count']} tiles to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
