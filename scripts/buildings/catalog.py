"""Combine disjoint prepared partitions into one small runtime manifest."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from build import encode


def combine(paths, output):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError("Catalog output already exists; choose a new version")
    regions, revisions = [], []
    for path in paths:
        path = Path(path).resolve()
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("version") != 1 or manifest.get("zoom") != 14:
            raise ValueError("Incompatible building manifest")
        for region in manifest["regions"]:
            a = region["tile_bounds"]
            for old in regions:
                b = old["tile_bounds"]
                if a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]:
                    raise ValueError("Partition coverage overlaps; choose one revision per tile")
            template = os.path.relpath(path.parent / region["tiles"], output.parent).replace("\\", "/")
            regions.append({"tile_bounds":a, "tiles":template,
                            "attribution":region.get("attribution", manifest["attribution"]),
                            "manifest":os.path.relpath(path, output.parent).replace("\\", "/")})
        revisions.append(manifest["revision"])
    if len(regions) > 4096:
        raise ValueError("Catalog exceeds 4096 regions; merge adjacent build partitions")
    # Credits are scoped to the loaded region, not every country in the catalog.
    data = dict(version=1, zoom=14, regions=regions, attribution=[],
                revision=hashlib.sha256(encode(revisions)).hexdigest())
    if len(encode(data)) > 2 * 1024**2:
        raise ValueError("Catalog exceeds runtime metadata budget")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encode(data))
    return data


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifests", nargs="+")
    p.add_argument("--output", required=True)
    args = p.parse_args()
    combine(args.manifests, args.output)
