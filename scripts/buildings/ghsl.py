"""Geographic discovery of official GHS-BUILT-H ANBH 100 m tiles (2018).

These are regional averages, never individual surveyed building heights.
"""
import hashlib
import math
import re
import shutil
import zipfile
from pathlib import Path
from pyproj import Transformer
from providers import raster_candidates

PRODUCT = "GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100"
ROOT = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/" + PRODUCT + "/V1-0/tiles/"
CREDIT = "European Commission JRC, GHS-BUILT-H R2023A; Pesaresi & Politis (2023), Pesaresi et al. (2024); CC BY 4.0; sampled regional estimates"


def tile_names(bounds):
    # The published Mollweide grid starts at -18,041,000 / 9,000,000 m.
    p = Transformer.from_crs(4326, "ESRI:54009", always_xy=True)
    w, s, e, n = p.transform_bounds(*bounds, densify_pts=21)
    names = []
    for row in range(math.floor((9000000-n)/1000000)+1, math.floor((9000000-s)/1000000)+2):
        for col in range(math.floor((w+18041000)/1000000)+1, math.floor((e+18041000)/1000000)+2):
            names.append(f"{PRODUCT}_V1_0_R{row}_C{col}.zip")
    if len(names) > 4:
        raise ValueError("GHS partition budget exceeded")
    return names


def enrich(records, bounds, downloads):
    listing = downloads.get(ROOT, 2*1024**2).read_text(encoding="utf-8")
    available = set(re.findall(r'GHS_BUILT_H_ANBH_[A-Za-z0-9_]+\.zip', listing))
    if not available:
        raise ValueError("GHS tile catalog changed")
    for name in tile_names(bounds):
        if name not in available:
            continue  # official catalog has no land observations in this cell
        archive = downloads.get(ROOT + name, 64*1024**2)
        target = downloads.cache / (hashlib.sha256(name.encode()).hexdigest()+".tif")
        if not target.exists():
            with zipfile.ZipFile(archive) as z:
                files = [i for i in z.infolist() if i.filename == name[:-4]+".tif"]
                if len(files) != 1 or files[0].file_size > 512*1024**2:
                    raise ValueError("Unexpected GHS archive")
                if downloads.disk_used + downloads.used + files[0].file_size > 2*1024**3:
                    raise ValueError("Extracted raster cache budget exceeded")
                partial = target.with_suffix(".part")
                # Stream one explicitly named TIFF; never extract archive paths.
                with z.open(files[0]) as source, partial.open("wb") as out:
                    shutil.copyfileobj(source, out, 1024**2)
                partial.replace(target)
                downloads.disk_used += files[0].file_size
        target.touch()
        raster_candidates(records, dict(id="ghs-built-h", path=str(target), release="R2023A",
            effective_resolution_m=100, observed_year="2018", definition="cell_mean"))
    return sum(any(c["source"] == "ghs-built-h" for c in r["candidates"]) for r in records)
