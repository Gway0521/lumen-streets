"""Bounded background tile job. All discovery is geographic, not city-specific."""
import argparse
import gzip
import json
from pathlib import Path
from shapely.geometry import box, shape
from model import normalize, candidate, conflate, resolve, tile_feature
from providers import Downloads, load
import ghsl


def run(input_path, output_path, cache, stage):
    payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
    registry = json.loads((Path(__file__).resolve().parents[2]/"data/building-sources.json").read_text())
    bounds = payload["bounds"]
    extents = [shape(f["geometry"]).bounds for f in payload["features"]]
    if extents:
        bounds = [min([bounds[0], *[b[0] for b in extents]])-.0001, min([bounds[1], *[b[1] for b in extents]])-.0001,
                  max([bounds[2], *[b[2] for b in extents]])+.0001, max([bounds[3], *[b[3] for b in extents]])+.0001]
    records = [normalize({**f, "id": f["properties"]["id"]}, registry["base"]) for f in payload["features"]]
    downloads = Downloads(cache, budget=512*1024**2, allowed_hosts={
        "jeodpp.jrc.ec.europa.eu", "s3.eubucco.com", "api.plateauview.mlit.go.jp",
        "assets.cms.plateau.reearth.io"})
    states, credits = {}, []
    if stage == "context":
        try:
            count = ghsl.enrich(records, bounds, downloads)
            states["ghs-built-h"] = "complete" if count else "no-data"
            if count:
                credits.append(ghsl.CREDIT)
        except Exception as e:
            states["ghs-built-h"] = "failed"
            print(f"GHS unavailable: {type(e).__name__}: {e}", flush=True)
    else:
        previous = payload.get("context", {})
        states.update(previous.get("states", {}))
        credits.extend(previous.get("credits", []))
        for r in records:
            c = previous.get("overrides", {}).get(r["id"])
            if c and c["height_method"] not in ("fallback", "mapped", "levels", "model"):
                r["candidates"].append(candidate(c["height_m"], c["height_source"], c["height_source_id"],
                    c["height_method"], c["height_definition"], c["height_year"],
                    effective_resolution_m=c.get("height_resolution_m"), support=c.get("height_support")))
        for spec in registry["supplements"]:
            if not spec.get("enabled") or not box(*bounds).intersects(box(*spec["bounds"])):
                continue
            try:
                supplements = load(spec, bounds, downloads, 100000)
                matches = conflate(records, supplements, bounds)
                states[spec["id"]] = "complete" if matches else "no-match"
                if matches:
                    credits.append(spec["attribution"])
            except Exception as e:
                states[spec["id"]] = "failed"
                print(f"{spec['id']} unavailable: {type(e).__name__}: {e}", flush=True)
    # A tile contains only part of a statistical neighbourhood. Do not let a
    # camera/partition boundary determine a regional median in this service.
    resolve(records, bounds, use_statistics=False)
    overrides = {r["id"]: tile_feature(r)["properties"] for r in records
                 if r["resolved"]["method"] != "fallback"}
    used = {r["resolved"]["source"] for r in records}
    credits = ([ghsl.CREDIT] if "ghs-built-h" in used else []) + [
        spec["attribution"] for spec in registry["supplements"] if spec["id"] in used]
    # Keep source attributes, candidate matches/rejections and download receipts
    # beside the cached result; none of this audit data is sent to the browser.
    audit = dict(records=records, receipts=downloads.receipts)
    with gzip.open(str(output_path)+".audit.gz", "wt", encoding="utf-8") as stream:
        json.dump(audit, stream, separators=(",", ":"), default=str)
    value = dict(overrides=overrides, credits=credits, states=states)
    partial = Path(str(output_path)+".tmp")
    partial.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    partial.replace(output_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--stage", choices=["context", "national"], required=True)
    a = parser.parse_args()
    run(a.input, a.output, a.cache, a.stage)
