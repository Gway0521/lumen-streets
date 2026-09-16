"""Versioned building-height normalization and conservative footprint conflation.

All input values survive in the audit record. No rendering default is evidence.
This module has no network access and does not depend on showcase cities.
"""
import math
import re
from decimal import Decimal
from collections import defaultdict
from statistics import median

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from shapely.strtree import STRtree

VERSION = 1
METHODS = {"survey": 0, "mapped": 0, "levels": 1, "model": 2,
           "raster": 2, "regional": 3, "fallback": 4}
DEFINITIONS = {"ground_to_top": 1, "ground_to_roof": .9,
               "roof_mean": .7, "roof_unspecified": .5, "cell_mean": .3}


def number(value, maximum=1200, zero=False):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, str):
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?\s*", value, re.I)
        if not m:
            return None
        value = float(m[1]) * (.3048 if (m[2] or "").lower() in ("ft", "feet", "'") else 1)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value) if (0 <= value if zero else 0 < value) and value <= maximum else None


def year(value):
    # Release year and construction year must never become a measurement year.
    m = re.match(r"^(\d{4})(?:-|$)", str(value or ""))
    return int(m[1]) if m and 1900 <= int(m[1]) <= 2100 else None


def floors(value):
    return number(value, 250) if not isinstance(value, str) or re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", value) else None


def candidate(value, source, source_id, method, definition, observed=None, **extra):
    return dict(value=number(value), source=source, source_id=str(source_id), method=method,
                definition=definition, observed_year=year(observed), match=1.0, **extra)


def normalize(feature, spec):
    p = feature.get("properties") or {}
    adapter = spec["adapter"]
    fid = str(feature.get("id") or p.get("id") or p.get("identificatie") or "")
    if not fid:
        raise ValueError("Every building needs a stable source ID")
    source = spec["id"]
    observed = p.get("observed_year", spec.get("observed_year"))
    method = spec.get("method", "mapped")
    definition = spec.get("definition", "ground_to_top")
    h, levels = p.get("height"), p.get("floors")
    bottom = p.get("min_height")
    roof = p.get("roof_height")
    part = p.get("type") == "building_part" or bool(p.get("building:part"))
    parent = p.get("building_id")
    upstream = p.get("sources", [])
    if adapter == "osm":
        levels, roof = p.get("building:levels"), p.get("roof:height")
        observed = p.get("survey:date", p.get("check_date:height", observed))
    elif adapter == "overture":
        levels = p.get("num_floors")
        # sources.property scopes height provenance; a footprint source is not a
        # height measurement. Unknown origins remain explicitly uncertain.
        height_sources = [s for s in upstream if s.get("property") in ("", "/height", "height", "properties/height")]
        names = " ".join(str(s.get("dataset", "")).lower() for s in height_sources)
        if any(n in names for n in ("microsoft", "ml", "google")):
            method, definition = "model", "roof_mean"
        elif "openstreetmap" in names or "osm" in names:
            method = "mapped"
        elif h is not None:
            method = "model"  # unknown acquisition is not promoted to measured
            definition = "roof_unspecified"
    elif adapter == "eubucco":
        hs = str(p.get("height_source") or "unknown")
        method = "model" if any(s in hs.lower() for s in ("estimated", "unknown", "msft", "microsoft")) else "mapped"
        definition = spec.get("definitions", {}).get(hs, "roof_unspecified")
        observed = spec.get("observation_years", {}).get(hs, observed)
    elif adapter == "plateau":
        h, levels = p.get("measuredHeight"), p.get("storeysAboveGround")
        method, definition = "survey", "ground_to_top"
    elif adapter == "3dbag":
        top = p.get("b3_h_dak_70p")
        valid_top = isinstance(top, (int, float)) and not isinstance(top, bool) and math.isfinite(top)
        ground = p.get("b3_h_maaiveld")
        # Ground elevation may be negative in the Netherlands.
        valid_ground = isinstance(ground, (int, float)) and not isinstance(ground, bool) and math.isfinite(ground)
        h = top - ground if valid_top and valid_ground else None
        method, definition = "survey", "ground_to_roof"
        levels = None  # b3_bouwlagen is itself an estimate, not surveyed floors
    elif adapter != "generic":
        raise ValueError(f"Unknown adapter: {adapter}")
    minimum = number(bottom, zero=True) or 0
    if number(bottom, zero=True) is None:
        minimum = (floors(p.get("min_floor", p.get("building:min_level"))) or 0) * 3.2
    candidates = [candidate(h, source, fid, method, definition, observed,
                            upstream=upstream, release=spec.get("release"),
                            upstream_height_source=p.get("height_source"),
                            uncertainty=[p.get("height_confidence_lower"), p.get("height_confidence_upper")])]
    n = floors(levels)
    if n is not None:
        candidates.append(candidate(n * 3.2 + (number(roof) or 0), source, fid,
                                    "model" if p.get("floors_source") == "estimated" else "levels",
                                    "ground_to_roof", observed, floors=n, floor_height=3.2))
    return dict(id=f"{source}/{fid}", source_id=fid, geometry=feature["geometry"],
                raw=p, source=source, raw_height=h, raw_floors=levels,
                minimum=minimum, part=part, parent=parent, candidates=candidates,
                building=p.get("building") or p.get("class") or p.get("subtype") or "yes")


def eligible(c, bottom=0):
    return (number(c.get("value")) is not None and c["value"] > bottom
            and c.get("method") in METHODS and c.get("definition") in DEFINITIONS
            and c.get("match", 0) >= .65 and not c.get("rejected"))


def choose(candidates, bottom=0, reference_year=2026):
    accepted = [c for c in candidates if eligible(c, bottom)]
    def order(c):
        age = min(30, max(0, reference_year - c["observed_year"])) if c.get("observed_year") else 15
        quality = .5 * c["match"] + .3 * DEFINITIONS[c["definition"]] - .01 * age
        if c["method"] == "survey":
            quality += .1
        return (METHODS[c["method"]], -quality, c["source"], c["source_id"], c["value"])
    return min(accepted, key=order) if accepted else None


def metric_geometries(records, bounds):
    # Fixed equal-area coordinates keep matching and statistics independent of
    # the build partition origin. Dateline-crossing requests are split upstream.
    projection = Transformer.from_crs(4326, 6933, always_xy=True)
    result = []
    for r in records:
        g = shape(r["geometry"])
        if g.geom_type not in ("Polygon", "MultiPolygon") or not g.is_valid or g.is_empty:
            raise ValueError(f"Invalid footprint: {r['id']}")
        result.append(transform(projection.transform, g))
    return result


def conflate(base, supplements, bounds):
    """Accept mutually unique matches; preserve rejected evidence for audit.

    A large national outline must not donate a tower's height to several small
    neighbours, building parts, or buildings surrounding a courtyard.
    """
    a = metric_geometries(base, bounds)
    b = metric_geometries(supplements, bounds)
    tree = STRtree(b)
    proposals, reverse = {}, defaultdict(list)
    for i, g in enumerate(a):
        ranked = []
        for j in tree.query(g):
            j = int(j)
            if base[i]["part"] != supplements[j]["part"]:
                continue
            common = g.intersection(b[j]).area
            if common <= 0:
                continue
            score = common / (g.area + b[j].area - common)
            if score >= .65 and common / min(g.area, b[j].area) >= .8:
                ranked.append((score, j))
        ranked.sort(key=lambda v: (-v[0], supplements[v[1]]["id"]))
        if ranked:
            proposals[i] = ranked
            reverse[ranked[0][1]].append((ranked[0][0], i))
    matched = 0
    for i, ranked in proposals.items():
        score, j = ranked[0]
        ambiguous = len(ranked) > 1 and score - ranked[1][0] < .1
        rivals = sorted(reverse[j], reverse=True)
        ambiguous |= len(rivals) > 1  # no many-to-one height propagation
        for c in supplements[j]["candidates"]:
            base[i]["candidates"].append({**c, "match": round(score, 6),
                "rejected": "ambiguous-footprint" if ambiguous else None})
        if not ambiguous:
            matched += 1
    return matched


def resolve(records, bounds, reference_year=2026, use_statistics=True):
    geometries = metric_geometries(records, bounds)
    chosen = [choose(r["candidates"], r["minimum"], reference_year) for r in records]
    # Parts of one tower are correlated observations, not independent nearby
    # buildings. Exclude parts and their hidden parent outlines from samples.
    groups = defaultdict(list)
    def group(r, g):
        c = g.centroid
        return (int(c.x // 2000), int(c.y // 2000), r["building"], int(math.log2(max(16, g.area)) // 2))
    for r, g, c in zip(records, geometries, chosen):
        if c and c["method"] in ("mapped", "survey") and not r["part"] and not r.get("hide_3d"):
            groups[group(r, g)].append(c["value"])
    for r, g, c in zip(records, geometries, chosen):
        if c is None:
            samples = groups[group(r, g)]
            if use_statistics and len(samples) >= 5:
                c = candidate(median(samples), "regional-statistics", str(group(r, g)),
                              "regional", "roof_unspecified", sample_count=len(samples))
            else:
                kind = r["building"]
                value = 4 if kind in ("shed", "garage", "garages", "roof") else (
                    9 if kind in ("industrial", "warehouse") else max(4, min(24, math.sqrt(g.area) * .8)))
                c = candidate(value, "lumen-fallback", "type-area-v1", "fallback", "roof_unspecified")
            r["candidates"].append(c)
        # Unusable minimums cannot inflate an otherwise missing building.
        r["resolved"] = {**c, "bottom": r["minimum"] if c["value"] > r["minimum"] and c["method"] not in ("regional", "fallback") else 0}
        other = [x for x in r["candidates"] if eligible(x, r["minimum"]) and x["method"] in ("survey", "mapped")]
        r["conflict"] = bool(other and max(x["value"] for x in other) - min(x["value"] for x in other) > max(5, c["value"] * .25))
    return records


def tile_feature(record):
    c = record["resolved"]
    return dict(type="Feature", id=record["id"], geometry=record["geometry"], properties={
        "lumen_height_version": VERSION, "source_id": record["id"],
        "building": record["building"], "height_raw": record["raw_height"],
        "floors_raw": record["raw_floors"], "height_missing": number(record["raw_height"]) is None,
        "height_m": c["value"], "min_height_m": c["bottom"],
        "height_source": c["source"], "height_source_id": c["source_id"],
        "height_method": c["method"], "height_definition": c["definition"],
        "height_year": c.get("observed_year"), "height_match": c["match"],
        "height_estimated": c["method"] not in ("survey", "mapped"),
        "height_conflict": record["conflict"], "building:part": "yes" if record["part"] else None,
        "height_resolution_m": c.get("effective_resolution_m"),
        "height_support": c.get("support"),
        "parent_id": record["parent"],
    })
