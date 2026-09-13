"""Supplement the fixed art-study snapshots with multipolygon geometry."""
import json
import argparse
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from fetch_maps import ROOT, REGIONS

def supplement(name, bbox):
    target = ROOT / 'public' / 'data' / f'{name}.json'
    data = json.loads(target.read_text(encoding='utf-8'))
    if data['pocketPlaces'].get('relationsRetrievedAt'):
        print(name, 'relations already present', flush=True)
        return
    bounds = ','.join(map(str,bbox))
    query = f'[out:json][timeout:80];(relation["building"]({bounds});relation["natural"="water"]({bounds});relation["leisure"="park"]({bounds}););out body geom;'
    extra = None
    for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            request = urllib.request.Request(endpoint,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'LumenStreets-snapshot-maintenance/0.1 (bounded offline art study)'})
            with urllib.request.urlopen(request, timeout=100) as response:
                extra = json.load(response)
            if 'remark' in extra:
                raise RuntimeError(extra['remark'])
            break
        except Exception as error:
            extra = None
            print(name, endpoint, str(error)[:150], flush=True)
    if extra is None:
        raise RuntimeError('No complete relation snapshot: ' + name)
    if 'remark' in extra:
        raise RuntimeError(extra['remark'])
    keys = {(e['type'],e['id']) for e in data['elements']}
    data['elements'].extend(e for e in extra['elements'] if (e['type'],e['id']) not in keys)
    data['pocketPlaces']['relationsRetrievedAt'] = datetime.now(timezone.utc).isoformat()
    data['pocketPlaces']['relationsSource'] = endpoint
    target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(name, len(extra['elements']), 'relations added', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('regions', nargs='*')
    args = parser.parse_args()
    failed = []
    for name in args.regions or REGIONS:
        if name not in REGIONS:
            parser.error('Unknown region: ' + name)
        try:
            supplement(name, REGIONS[name])
        except Exception as error:
            print(name, str(error), flush=True)
            failed.append(name)
        time.sleep(5)
    if failed:
        raise SystemExit('Missing relations: ' + ', '.join(failed))
