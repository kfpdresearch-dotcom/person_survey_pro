import json, sys, os
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
sidos = {}
dongs = {}
def centroid(geom):
    polys = geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
    best = max(polys, key=lambda p: len(p[0]))
    ring = best[0]
    # polygon centroid (shoelace)
    a=cx=cy=0.0
    for i in range(len(ring)-1):
        x0,y0=ring[i]; x1,y1=ring[i+1]
        c=x0*y1-x1*y0; a+=c; cx+=(x0+x1)*c; cy+=(y0+y1)*c
    if abs(a)<1e-12:
        xs=[p[0] for p in ring]; ys=[p[1] for p in ring]; return sum(ys)/len(ys), sum(xs)/len(xs)
    a*=0.5; return cy/(6*a), cx/(6*a)
for f in d['features']:
    p=f['properties']
    s=sidos.setdefault(p['sido'],{'code':p['sido'],'name':p['sidonm'],'sgg':{}})
    import re
    nm=re.sub(r'^(.+?시)(.+[구])$', r'\1 \2', p['sggnm'])
    s['sgg'].setdefault(p['sgg'],nm)
    lat,lng=centroid(f['geometry'])
    dongs.setdefault(p['sgg'],[]).append({'code':p['adm_cd2'],'name':p['adm_nm'].split(' ')[-1],'lat':round(lat,5),'lng':round(lng,5)})
res={'version':'2025-01-01','source':'행정동 경계(vuski/admdongkor ver20250101) 기반 자동 생성','sido':[]}
for k in sorted(sidos):
    s=sidos[k]
    res['sido'].append({'code':k,'name':s['name'],'sgg':[{'code':c,'name':n} for c,n in sorted(s['sgg'].items())]})
json.dump(res,open(os.path.join(out,'regions.json'),'w'),ensure_ascii=False,separators=(',',':'))
for sgg,lst in dongs.items():
    lst.sort(key=lambda x:x['name'])
    json.dump({'version':'2025-01-01','sgg':sgg,'dong':lst},open(os.path.join(out,'dong',sgg+'.json'),'w'),ensure_ascii=False,separators=(',',':'))
print(len(res['sido']), sum(len(s['sgg']) for s in res['sido']), len(dongs))
