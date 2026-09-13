"""Bounded rail/station OSM snapshots for the eight bundled art scenes."""
import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from fetch_maps import ROOT, REGIONS

def fetch_rail(name):
    target = ROOT / 'public' / 'data' / f'{name}-rail.json'
    if target.exists():
        print(name, 'rail snapshot exists', flush=True)
        return
    bbox = REGIONS[name]
    bounds = ','.join(map(str, bbox))
    query = f'''[out:json][timeout:60];(
      way["railway"~"^(rail|subway|light_rail|tram)$"]({bounds});
      node["railway"~"^(station|halt|stop)$"]({bounds});
    );out body geom;'''
    for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            req = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': 'PocketPlaces-art-study/0.3 (bounded offline snapshots)'})
            with urllib.request.urlopen(req, timeout=80) as response:
                data = json.load(response)
            if 'remark' in data:
                raise RuntimeError(data['remark'])
            data['pocketPlaces'] = {'region': name, 'bbox': bbox, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'source': endpoint, 'attribution': 'Map data © OpenStreetMap contributors · ODbL 1.0'}
            target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            print(name, len(data['elements']), 'rail/station features', flush=True)
            return
        except Exception as error:
            print(name, endpoint, str(error)[:150], flush=True)
    raise RuntimeError('Rail snapshot unavailable: ' + name)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('regions', nargs='*')
    args = parser.parse_args()
    failed = []
    for name in args.regions or REGIONS:
        if name not in REGIONS:
            parser.error('Unknown region: ' + name)
        try:
            fetch_rail(name)
        except Exception as error:
            print(error, flush=True)
            failed.append(name)
        time.sleep(8)
    if failed:
        raise SystemExit('Missing rail snapshots: ' + ', '.join(failed))
