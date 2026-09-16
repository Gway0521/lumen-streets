import gzip
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box, mapping

from build import build, partition, tile_bounds
from catalog import combine
from model import candidate, choose, conflate, floors, normalize, number, resolve, tile_feature
from providers import read_citygml, raster_candidates, restricted_eubucco

BOUNDS = [0, 0, .01, .01]
SPEC = {"id": "osm", "adapter": "osm", "license": "ODbL-1.0", "attribution": "OpenStreetMap contributors"}


def record(i, props=None, geometry=None, spec=SPEC):
    return normalize(dict(id=str(i), properties=props or {}, geometry=mapping(geometry or box(.001, .001, .0012, .0012))), spec)


class Heights(unittest.TestCase):
    def test_missing_is_not_five_metres(self):
        records = [record(1), record(2, {"height": "5"}), record(3, {"height": "-1"})]
        resolve(records, BOUNDS)
        p = [tile_feature(r)["properties"] for r in records]
        self.assertIsNone(p[0]["height_raw"])
        self.assertTrue(p[0]["height_missing"])
        self.assertEqual(p[1]["height_m"], 5)
        self.assertFalse(p[1]["height_estimated"])
        self.assertEqual(p[2]["height_raw"], "-1")
        self.assertTrue(p[2]["height_missing"])

    def test_units_and_invalid_minimum(self):
        self.assertEqual(number(Decimal("34.9")), 34.9)
        self.assertEqual(floors(Decimal("3.5")), 3.5)
        self.assertAlmostEqual(number("100 ft"), 30.48)
        for n in (True, -1, "5;10", "12x", float("nan"), 1201):
            self.assertIsNone(number(n))
        self.assertIsNone(floors("3m"))
        r = record(1, {"height": "10", "min_height": "30", "building:levels": "20"})
        resolve([r], BOUNDS)
        self.assertEqual(r["resolved"]["method"], "levels")
        self.assertEqual(r["resolved"]["bottom"], 30)

    def test_recency_definition_and_method(self):
        old = candidate(20, "survey", "1", "survey", "ground_to_top", 2000)
        recent = candidate(30, "osm", "1", "mapped", "ground_to_top", 2025)
        model = candidate(100, "model", "1", "model", "roof_mean", 2026)
        absolute = candidate(150, "elevation", "1", "survey", "sea_level", 2026)
        self.assertEqual(choose([old, recent, model, absolute]), recent)
        recent["match"] = .4
        self.assertEqual(choose([old, recent, model, absolute]), old)
        self.assertIsNone(choose([absolute]))

    def test_eubucco_and_overture_estimates_remain_estimates(self):
        r = record(1, {"height": 40, "height_source": "estimated", "construction_year": 2024}, spec={**SPEC,"adapter":"eubucco"})
        self.assertEqual(r["candidates"][0]["method"], "model")
        self.assertIsNone(r["candidates"][0]["observed_year"])
        r = record(2, {"height": 30, "sources": [{"property":"/height", "dataset":"Microsoft", "update_time":"2026-01-01"}]}, spec={**SPEC,"adapter":"overture"})
        self.assertEqual(r["candidates"][0]["method"], "model")
        self.assertIsNone(r["candidates"][0]["observed_year"])
        self.assertTrue(restricted_eubucco({"geometry_source":"gov-italy-abruzzo"}))
        self.assertTrue(restricted_eubucco({"height_source":"gov-czechia-prague"}))

    def test_nap_heights_use_ground_even_below_sea_level(self):
        r = record(1, {"b3_h_dak_70p": -1, "b3_h_maaiveld": -5}, spec={**SPEC,"adapter":"3dbag"})
        resolve([r], BOUNDS)
        self.assertEqual(r["resolved"]["value"], 4)
        self.assertEqual(r["raw"]["b3_h_maaiveld"], -5)

    def test_conflation_rejects_ambiguous_neighbours_holes_and_parts(self):
        base = [record(1)]
        supplement = [record(2, {"height": 40}), record(3, {"height": 80})]
        self.assertEqual(conflate(base, supplement, BOUNDS), 0)
        resolve(base, BOUNDS)
        self.assertEqual(base[0]["resolved"]["method"], "fallback")
        self.assertEqual(base[0]["candidates"][-2]["rejected"], "ambiguous-footprint")
        self.assertEqual(conflate([record(1, {"building:part":"yes"})], [record(2, {"height": 50})], BOUNDS), 0)
        courtyard = box(.001, .001, .002, .002).difference(box(.0011, .0011, .0019, .0019))
        self.assertEqual(conflate([record(1, geometry=courtyard)], [record(2, {"height": 50}, box(.0012,.0012,.0018,.0018))], BOUNDS), 0)

    def test_unique_match_and_order_independence(self):
        for sources in ([record(2, {"height":40})],):
            base = [record(1)]
            self.assertEqual(conflate(base, sources, BOUNDS), 1)
            resolve(base, BOUNDS)
            self.assertEqual(base[0]["resolved"]["value"], 40)
            self.assertIsNone(base[0]["raw_height"])
        c = [candidate(20,"b","1","mapped","ground_to_top",2020), candidate(30,"a","1","mapped","ground_to_top",2020)]
        self.assertEqual(choose(c), choose(c[::-1]))

    def test_raster_nodata_support_and_priority(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "height.tif"
            spec = {**SPEC, "path":str(path), "effective_resolution_m":90, "observed_year":2020}
            with rasterio.open(path, "w", driver="GTiff", height=4, width=4, count=1,
                               dtype="float32", crs="EPSG:4326", transform=from_origin(0,.004,.001,.001), nodata=-9999) as out:
                data = np.full((4,4), -9999, dtype="float32")
                data[0,0] = 70
                out.write(data, 1)
            r = record(1, geometry=box(0,0,.004,.004))
            raster_candidates([r], spec)
            self.assertEqual(len(r["candidates"]), 1)
            with rasterio.open(path, "r+") as out:
                out.write(np.full((4,4), 70, dtype="float32"), 1)
            r = record(2, {"height": 12}, box(0,0,.004,.004))
            raster_candidates([r], spec)
            self.assertEqual(r["candidates"][-1]["method"], "regional")
            resolve([r], BOUNDS)
            self.assertEqual(r["resolved"]["value"], 12)

    def test_citygml_axes_holes_and_raw_height(self):
        xml = '''<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
        <gml:boundedBy><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697"/></gml:boundedBy>
        <core:cityObjectMember><bldg:Building gml:id="test"><bldg:measuredHeight uom="m">45.2</bldg:measuredHeight><bldg:storeysAboveGround>12</bldg:storeysAboveGround><bldg:lod0FootPrint><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35 139 0 35 139.001 0 35.001 139.001 0 35.001 139 0 35 139 0</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint></bldg:Building></core:cityObjectMember></core:CityModel>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"source.gml"
            path.write_text(xml)
            result = list(read_citygml(path, {**SPEC,"adapter":"plateau"}, [138,34,140,36]))
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["raw_height"], "45.2")
            self.assertAlmostEqual(result[0]["geometry"]["coordinates"][0][0][0], 139, places=4)

    def test_build_audit_reproducibility_and_tile_border(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root/"source.geojson"
            # Cross the x=8192 boundary; same complete footprint in both tiles.
            f = dict(type="Feature", id="one", properties={"height":None,"building:levels":"3"}, geometry=mapping(box(-.0001,.001,.0001,.002)))
            source.write_text(json.dumps(dict(type="FeatureCollection",features=[f])))
            config = {"version":1,"base":{**SPEC,"path":str(source)},"supplements":[]}
            first = build(config, [-.0002,.001,.0002,.002], root/"a", root/"cache")
            second = build(config, [-.0002,.001,.0002,.002], root/"b", root/"cache")
            self.assertEqual(first["content_sha256"], second["content_sha256"])
            audit = json.loads(gzip.decompress((root/"a/audit.jsonl.gz").read_bytes()).splitlines()[0])
            self.assertIsNone(audit["raw"]["height"])
            self.assertEqual(audit["raw"]["building:levels"], "3")
            tiles = list((root/"a/tiles").rglob("*.json"))
            self.assertEqual(len(tiles), 2)
            self.assertEqual(json.loads(tiles[0].read_text())["features"][0]["geometry"],json.loads(tiles[1].read_text())["features"][0]["geometry"])
            with self.assertRaises(ValueError):
                build(config, BOUNDS, root/"a", root/"cache")
        with self.assertRaises(ValueError):
            partition([-180,-80,180,80])

    def test_catalog_scopes_credits_and_rejects_overlapping_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, bounds in (("one",[1,1,1,1]),("two",[2,1,2,1])):
                folder=root/name
                folder.mkdir()
                (folder/"manifest.json").write_text(json.dumps(dict(version=1,zoom=14,revision=name,
                    regions=[dict(tile_bounds=bounds,tiles="tiles/{z}/{x}/{y}.json")],attribution=[name])))
            catalog=combine([root/"one/manifest.json",root/"two/manifest.json"],root/"catalog.json")
            self.assertEqual(catalog["attribution"],[])
            self.assertEqual(catalog["regions"][1]["attribution"],["two"])
            self.assertEqual(catalog["regions"][0]["tiles"],"one/tiles/{z}/{x}/{y}.json")
            with self.assertRaises(ValueError):
                combine([root/"one/manifest.json",root/"one/manifest.json"],root/"invalid.json")


if __name__ == "__main__":
    unittest.main()
