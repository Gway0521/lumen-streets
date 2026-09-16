"""Offline providers. Network discovery is geographic, never showcase-specific."""
import hashlib
import json
import math
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import numpy as np
import rasterio
from defusedxml import ElementTree as ET
from pyproj import CRS, Transformer
from rasterio.mask import mask
from rasterio.features import geometry_mask
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import transform, unary_union

from model import candidate, normalize, number


class Downloads:
    def __init__(self, cache, budget=2 * 1024**3):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.budget, self.used, self.receipts = budget, 0, []

    def get(self, url, maximum=256 * 1024**2):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError("Data downloads require public HTTPS URLs")
        key = hashlib.sha256(url.encode()).hexdigest()
        target = self.cache / key
        meta = target.with_suffix(".json")
        if target.exists() and meta.exists():
            receipt = json.loads(meta.read_text())
            with target.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if target.stat().st_size > maximum or digest != receipt["sha256"]:
                raise ValueError("Cached source failed size/hash validation")
            self.receipts.append(receipt)
            return target
        partial = target.with_suffix(".part")
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "LumenStreets-building-preprocessor/1"})
                with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                    if urlparse(response.url).scheme != "https":
                        raise ValueError("Insecure data redirect")
                    size = 0
                    while chunk := response.read(1024**2):
                        size += len(chunk)
                        self.used += len(chunk)
                        if size > maximum or self.used > self.budget:
                            raise ValueError("Download budget exceeded; use smaller partitions")
                        output.write(chunk)
                    receipt = dict(url=url, bytes=size, etag=response.headers.get("ETag"),
                                   last_modified=response.headers.get("Last-Modified"))
                with partial.open("rb") as stream:
                    receipt["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
                partial.replace(target)
                meta.write_text(json.dumps(receipt), encoding="utf-8")
                self.receipts.append(receipt)
                return target
            except (TimeoutError, OSError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
            finally:
                partial.unlink(missing_ok=True)

    def json(self, url):
        return json.loads(self.get(url, 16 * 1024**2).read_text(encoding="utf-8"))


def connection():
    con = duckdb.connect(config={"memory_limit": "1GB", "threads": 4})
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs")
    con.execute("SET enable_progress_bar=false")
    return con


def parquet_features(con, location, bounds, crs=4326, maximum=250000, bbox_column=False):
    """Parameterized paths/bounds; stream rows after a spatially filtered query."""
    envelope = transform(Transformer.from_crs(4326, crs, always_xy=True).transform, box(*bounds))
    # EUBUCCO uses WKB, recent Overture releases may use GEOMETRY.
    columns = con.execute("DESCRIBE SELECT * FROM read_parquet(?, hive_partitioning=true)", [location]).fetchall()
    geom_type = next(t for n, t, *_ in columns if n == "geometry")
    geom = "geometry" if geom_type.startswith("GEOMETRY") else "ST_GeomFromWKB(geometry)"
    bbox_column = bbox_column or any(n == "bbox" for n, *_ in columns)
    where = "bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?" if bbox_column else f"ST_Intersects({geom}, ST_GeomFromText(?))"
    b = envelope.bounds
    params = [b[2], b[0], b[3], b[1]] if bbox_column else [envelope.wkt]
    result = con.execute(f"SELECT * EXCLUDE geometry, ST_AsGeoJSON({geom}) AS geo FROM read_parquet(?, hive_partitioning=true) WHERE {where} LIMIT ?", [location, *params, maximum + 1])
    names = [c[0] for c in result.description]
    count = 0
    projection = Transformer.from_crs(crs, 4326, always_xy=True)
    while batch := result.fetchmany(2000):
        for row in batch:
            count += 1
            if count > maximum:
                raise ValueError("Building row budget exceeded; split the build region")
            p = dict(zip(names, row))
            g = shape(json.loads(p.pop("geo")))
            if crs != 4326:
                g = transform(projection.transform, g)
            yield dict(type="Feature", id=p.get("id"), properties=p, geometry=mapping(g))


def overture(spec, bounds, downloads, maximum):
    release = spec.get("release")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release or ""):
        raise ValueError("Pin an Overture release (YYYY-MM-DD.N); never silently follow latest")
    result = []
    with connection() as con:
        con.execute("SET s3_region='us-west-2'")
        for kind in ("building", "building_part"):
            catalog = downloads.json(f"https://stac.overturemaps.org/{release}/buildings/{kind}/collection.json")
            items = [x["href"] for x in catalog["links"] if x["rel"] == "item"]
            if len(items) > 4096:
                raise ValueError("Overture STAC index exceeds discovery budget")
            # Reading all globe-wide Parquet footers can take many minutes.
            # Cache the small STAC records once per release, then query only
            # intersecting assets. Extent ordering is not assumed to match links.
            print(f"Indexing Overture {kind}: {len(items)} STAC partitions", flush=True)
            with ThreadPoolExecutor(max_workers=4) as pool:
                metadata = list(pool.map(downloads.json, items))
            locations = [m["assets"][spec.get("mirror", "aws")]["href"] for m in metadata
                         if box(*m["bbox"]).intersects(box(*bounds))]
            if not locations:
                continue
            print(f"Reading Overture {release} {kind}", flush=True)
            for f in parquet_features(con, locations, bounds, maximum=maximum, bbox_column=True):
                f["properties"]["type"] = kind
                if f["properties"].get("is_underground"):
                    continue
                result.append(normalize(f, spec))
                if len(result) > maximum:
                    raise ValueError("Combined base exceeds row budget")
            downloads.receipts.append(dict(url=locations, release=release, query_bounds=bounds))
    # Keep an outline if the extract does not include any of its actual parts.
    parents = {r["parent"] for r in result if r["part"]}
    for r in result:
        r["hide_3d"] = r["source_id"] in parents and bool(r["raw"].get("has_parts"))
    return result


def local_features(path):
    path = Path(path)
    with path.open(encoding="utf-8-sig") as stream:
        if path.suffix in (".geojsonl", ".jsonl", ".ndjson"):
            for line in stream:
                if line.strip():
                    yield json.loads(line)
        else:
            data = json.load(stream)
            yield from data["features"] if data.get("type") == "FeatureCollection" else [data]


def local_vector(spec, bounds, maximum):
    crs = spec.get("crs", 4326)
    path = spec["path"]
    if Path(path).suffix == ".parquet":
        with connection() as con:
            return [normalize(f, spec) for f in parquet_features(con, path, bounds, crs, maximum)
                    if spec["adapter"] != "eubucco" or not restricted_eubucco(f["properties"])]
    result = []
    projection = Transformer.from_crs(crs, 4326, always_xy=True)
    for f in local_features(path):
        if spec["adapter"] == "eubucco" and restricted_eubucco(f.get("properties", {})):
            continue
        g = shape(f["geometry"])
        if crs != 4326:
            g = transform(projection.transform, g)
        if not g.intersects(box(*bounds)):
            continue
        f = {**f, "geometry": mapping(g)}
        result.append(normalize(f, spec))
        if len(result) > maximum:
            raise ValueError("Local vector exceeds row budget")
    return result


def read_citygml(path, spec, bounds):
    """Read building-owned LoD0 footprints, falling back to projected LoD1.

    CRS axis order comes from the GML CRS. Parent footprints never absorb a
    BuildingPart's attributes. External xlinks/DTDs/entities are not fetched.
    """
    stack, default_crs = [], None
    for event, element in ET.iterparse(path, events=("start", "end"), forbid_dtd=True):
        name = element.tag.split("}")[-1]
        if event == "start":
            stack.append(element)
            if element.get("srsName") and default_crs is None:
                default_crs = element.get("srsName")
            continue
        if name in ("Building", "BuildingPart"):
            fid = next((v for k, v in element.attrib.items() if k.endswith("}id")), None)
            p = {"type": "building_part" if name == "BuildingPart" else "building"}
            if name == "BuildingPart":
                parent = next((e for e in reversed(stack[:-1]) if e.tag.endswith("}Building")), None)
                p["building_id"] = next((v for k, v in parent.attrib.items() if k.endswith("}id")), None) if parent is not None else None
            for child in element:
                key = child.tag.split("}")[-1]
                if key in ("measuredHeight", "storeysAboveGround"):
                    p[key] = child.text
                    if key == "measuredHeight" and child.get("uom", "m") not in ("m", "#m"):
                        raise ValueError("Unsupported PLATEAU height unit")
            geometry_nodes = []
            for lod in ("lod0FootPrint", "lod0RoofEdge", "lod1Solid"):
                geometry_nodes = [e for e in element if e.tag.split("}")[-1] == lod]
                if geometry_nodes:
                    break
            polygons = []
            for node in geometry_nodes:
                for polygon in node.iter():
                    if polygon.tag.split("}")[-1] != "Polygon":
                        continue
                    rings = []
                    for boundary in polygon:
                        if boundary.tag.split("}")[-1] not in ("exterior", "interior"):
                            continue
                        pos = next((e for e in boundary.iter() if e.tag.endswith("}posList")), None)
                        if pos is None or not pos.text:
                            continue
                        srs = pos.get("srsName") or polygon.get("srsName") or node.get("srsName") or default_crs
                        if not srs:
                            raise ValueError("CityGML has no CRS")
                        epsg = re.search(r"(\d+)$", srs)
                        if not epsg:
                            raise ValueError("Unsupported CityGML CRS")
                        crs = CRS.from_epsg(int(epsg[1]))
                        projection = Transformer.from_crs(crs, 4326, always_xy=True)
                        dim = int(pos.get("srsDimension", "3"))
                        numbers = [float(v) for v in pos.text.split()]
                        if dim not in (2, 3) or len(numbers) % dim:
                            raise ValueError("Invalid CityGML coordinate dimension")
                        north_first = crs.axis_info[0].direction == "north"
                        coords = [(numbers[i+1], numbers[i]) if north_first else (numbers[i], numbers[i+1]) for i in range(0, len(numbers), dim)]
                        rings.append([projection.transform(x, y)[:2] for x, y in coords])
                    if rings and len(rings[0]) >= 4:
                        g = Polygon(rings[0], rings[1:])
                        if g.area > 1e-14 and g.is_valid:
                            polygons.append(g)
            if polygons and fid:
                g = unary_union(polygons)
                if g.intersects(box(*bounds)):
                    yield normalize(dict(id=fid, geometry=mapping(g), properties=p), spec)
            element.clear()
            if len(stack) > 1:
                stack[-2].remove(element)
        stack.pop()


def plateau(spec, bounds, downloads, maximum):
    endpoint = "https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:" + ",".join(map(str, bounds))
    catalog = downloads.json(endpoint)
    cities = catalog.get("cities")
    if not isinstance(cities, list):
        raise ValueError("PLATEAU catalog schema changed")
    records, seen = [], set()
    for city in cities:
        for item in city.get("files", {}).get("bldg", []):
            if item["url"] in seen:
                continue
            seen.add(item["url"])
            print(f"Reading PLATEAU {city['cityCode']} / {item['code']}", flush=True)
            path = downloads.get(item["url"])
            pinned = {**spec, "release": str(city.get("year"))}
            records.extend(read_citygml(path, pinned, bounds))
            if len(records) > maximum:
                raise ValueError("PLATEAU row budget exceeded")
    return records


def eubucco(spec, bounds, downloads, maximum):
    root = "https://s3.eubucco.com/eubucco/v0.2/"
    boundary = downloads.get(root + "additional/NUTS-regions-2016.parquet", 64 * 1024**2)
    records = []
    listing = downloads.get("https://s3.eubucco.com/eubucco?list-type=2&prefix=v0.2/buildings/parquet/&delimiter=/", 2 * 1024**2)
    index = ET.parse(listing)
    if index.findtext("{*}IsTruncated") != "false":
        raise ValueError("EUBUCCO partition listing is incomplete")
    available = {e.text.split("nuts_id=")[-1].strip("/") for e in index.findall("{*}CommonPrefixes/{*}Prefix")}
    with connection() as con:
        regions = list(parquet_features(con, str(boundary), bounds, 3035, 10000))
        for region in regions:
            code = region["properties"]["region_id"]
            if code not in available or not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{1,3}", code):
                continue
            print(f"Reading EUBUCCO v0.2 / {code}", flush=True)
            location = root + f"buildings/parquet/nuts_id={code}/{code}.parquet"
            for f in parquet_features(con, location, bounds, 3035, maximum):
                if restricted_eubucco(f["properties"]):
                    continue
                records.append(normalize(f, spec))
                if len(records) > maximum:
                    raise ValueError("EUBUCCO row budget exceeded")
            downloads.receipts.append(dict(url=location, release="v0.2", query_bounds=bounds))
    return records


def restricted_eubucco(properties):
    # The v0.2 license documents these geometry exceptions. Also exclude their
    # donated attributes conservatively when provenance names either source.
    restricted = ("gov-czechia-prague", "gov-italy-abruzzo")
    return any(any(s in str(value) for s in restricted)
               for key, value in properties.items() if "source" in key)


def raster_candidates(records, spec):
    """Area sampling in source CRS, with explicit NoData and pixel support.

    Coarse cells are regional context even when the TIFF was upsampled. A
    missing pixel is never zero height; low support cannot donate a height.
    """
    resolution = float(spec["effective_resolution_m"])
    if not 0 < resolution <= 10000:
        raise ValueError("Invalid effective raster resolution")
    with rasterio.open(spec["path"]) as raster:
        projection = Transformer.from_crs(4326, raster.crs, always_xy=True)
        for r in records:
            g = transform(projection.transform, shape(r["geometry"]))
            if not g.intersects(box(*raster.bounds)):
                continue
            try:
                data, affine = mask(raster, [mapping(g)], crop=True, all_touched=True,
                               filled=False, indexes=int(spec.get("band", 1)))
            except ValueError:
                continue
            values = data.compressed()
            valid = values[np.isfinite(values) & (values > 0) & (values <= 1200)]
            covered = geometry_mask([mapping(g)], data.shape, affine, all_touched=True, invert=True)
            support = len(valid) / max(1, np.count_nonzero(covered))
            if not len(valid) or support < .5:
                continue
            r["candidates"].append(candidate(float(np.median(valid)), spec["id"],
                spec.get("release", "raster"), "regional" if resolution >= 30 else "raster",
                "cell_mean" if resolution >= 30 else spec.get("definition", "roof_mean"),
                spec.get("observed_year"), pixel_count=len(valid), effective_resolution_m=resolution,
                support=support))


PROVIDERS = {"overture": overture, "plateau": plateau, "eubucco": eubucco}


def load(spec, bounds, downloads, maximum):
    if "path" in spec:
        if spec["adapter"] == "plateau" and Path(spec["path"]).suffix in (".gml", ".xml"):
            records = []
            for record in read_citygml(spec["path"], spec, bounds):
                records.append(record)
                if len(records) > maximum:
                    raise ValueError("Local CityGML exceeds row budget")
            return records
        return local_vector(spec, bounds, maximum)
    return PROVIDERS[spec["adapter"]](spec, bounds, downloads, maximum)
