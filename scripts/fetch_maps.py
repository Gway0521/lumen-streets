"""Fetch fixed OSM art-study snapshots sequentially. Not a public download service."""
import argparse
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
REGIONS = {key: value['bbox'] for key, value in json.loads((ROOT / 'src' / 'regions.json').read_text(encoding='utf-8')).items()}

def fetch(name, bbox):
    target = ROOT / 'public' / 'data' / f'{name}.json'
    if target.exists():
        print(name, 'snapshot already exists', flush=True)
        return
    bounds = ','.join(map(str, bbox))
    query = f'''[out:json][timeout:90];(
      way["building"]({bounds});
      way["highway"]({bounds});
      way["leisure"~"park|garden|pitch|playground|sports_centre"]({bounds});
      way["landuse"~"grass|forest|recreation_ground"]({bounds});
      way["natural"~"water|wood"]({bounds});
      way["waterway"="riverbank"]({bounds});
    );out body geom;'''
    for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            request = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data':query}).encode(), headers={'User-Agent':'LumenStreets-snapshot-maintenance/0.1 (bounded offline map research)'})
            with urllib.request.urlopen(request, timeout=110) as response:
                result = json.load(response)
            if 'remark' in result:
                raise RuntimeError(result['remark'])
            result['pocketPlaces'] = {'region':name,'bbox':bbox,'retrievedAt':datetime.now(timezone.utc).isoformat(),'source':endpoint,'attribution':'Map data © OpenStreetMap contributors · ODbL 1.0'}
            target.write_text(json.dumps(result, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
            print(name, len(result.get('elements',[])), 'ways;', target.stat().st_size, 'bytes', flush=True)
            return
        except Exception as error:
            print(name, endpoint, type(error).__name__, str(error)[:150], flush=True)
    raise RuntimeError(f'No complete snapshot obtained for {name}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('regions', nargs='*', help='Region IDs from src/regions.json; defaults to all')
    args = parser.parse_args()
    failed = []
    for region in args.regions or REGIONS:
        if region not in REGIONS:
            parser.error(f'Unknown region: {region}')
        try:
            fetch(region, REGIONS[region])
        except Exception as error:
            print(region, str(error), flush=True)
            failed.append(region)
    if failed:
        raise SystemExit('Missing snapshots: ' + ', '.join(failed))
