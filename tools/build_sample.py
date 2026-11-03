import json, random
random.seed(7)
SGG='41281'; import os; W=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
dong=json.load(open(f'{W}/regions/dong/{SGG}.json'))['dong']
byname={d['name']:d for d in dong}
NOTICE='예시 데이터입니다. 실제 기관·강좌가 아니며, 화면 확인용으로 만든 가상의 정보예요. 실제 서비스에서는 공공데이터 스냅샷(T03)으로 교체됩니다.'
TEL='000-0000-0000'
def jit(d,s=0.004): return round(d['lat']+random.uniform(-s,s),5), round(d['lng']+random.uniform(-s,s),5)
def base(kind,ver,src): return {'version':ver,'sample':True,'notice':NOTICE,'sgg':SGG,'sggName':'경기도 고양시 덕양구','kind':kind,'source':src}
AREAS=['기관운영','환경 및 안전','수급자 권리보장','급여제공과정','급여제공결과']
def ev(g):
    lo={'A':90,'B':80,'C':70,'D':60,'E':45}[g]
    tot=round(random.uniform(lo,lo+8),1)
    return {'grade':g,'score':tot,'year':2025,'areas':{a:round(min(100,random.uniform(tot-8,tot+6)),1) for a in AREAS}}
F=[]
spec=[('햇살','주야간보호','A','화정1동',30,24),('푸른숲','주야간보호','B','행신2동',25,25),('느티나무','주야간보호','C','성사1동',40,31),
      ('온기','방문요양','A','화정2동',None,58),('다정','방문요양','B','능곡동',None,33),('한마음','방문요양','D','고양동',None,21),
      ('맑은물','방문목욕','B','행신1동',None,12),('새봄','방문간호','A','삼송1동',None,17),('든든','방문간호','C','관산동',None,9),
      ('늘봄','방문요양','B','원신동',None,40)]
for i,(nm,t,g,dn,cap,cur) in enumerate(spec):
    d=byname.get(dn) or dong[i]; lat,lng=jit(d)
    types=[t] + (['방문목욕'] if t=='방문요양' and i%2==0 else [])
    F.append({'id':f'S{SGG}{i+1:03d}','name':f'[예시] {nm} {t}센터','types':types,'addr':f'경기도 고양시 덕양구 {d["name"]} (예시 주소)','dong':d['code'],
              'tel':TEL,'lat':lat,'lng':lng,'eval':ev(g),'capacity':cap,'current':cur,
              'staff':{'요양보호사':random.randint(4,30),'사회복지사':random.randint(1,3),'간호(조무)사':random.randint(0,2)},
              'nonCovered':(['식재료비(1일)'] if t=='주야간보호' else []),'openedAt':f'20{random.randint(10,22)}-0{random.randint(1,9)}-01'})
fac=base('facilities','2026-11-01',['장기요양기관 검색(15059029)','장기요양기관 평가 결과(15104801)','시설별 상세조회(15058856)'])
fac['items']=F; json.dump(fac,open(f'{W}/facilities/{SGG}.json','w'),ensure_ascii=False,indent=1)

P=[]
pspec=[('노인복지관','덕양','화정1동',60),('노인복지관','행신','행신1동',60),('경로당','화정','화정2동',65),('경로당','성사','성사2동',65),
       ('경로당','능곡','능곡동',65),('경로당','삼송','삼송2동',65),('경로당','관산','관산동',65),('평생학습관','덕양','행신3동',0)]
for i,(t,nm,dn,ma) in enumerate(pspec):
    d=byname.get(dn) or dong[i]; lat,lng=jit(d)
    P.append({'id':f'P{SGG}{i+1:03d}','type':t,'name':f'[예시] {nm} {t}','addr':f'경기도 고양시 덕양구 {d["name"]} (예시 주소)','dong':d['code'],'tel':TEL,'lat':lat,'lng':lng,'minAge':ma,
              'hours':'평일 09:00~18:00' if t!='경로당' else '매일 10:00~17:00'})
pl=base('places','2026-11-01',['노인복지 이용시설 현황(15098828)','노인복지시설(15056929)']); pl['items']=P
json.dump(pl,open(f'{W}/places/{SGG}.json','w'),ensure_ascii=False,indent=1)

C=[]
cspec=[ # name, cat, target, place idx, days, time, start,end, regStart, regEnd, fee
 ('어르신 스마트폰 첫걸음(영상통화·사진)','정보화','노인',7,'화,목','10:00~11:30','2026-11-17','2026-12-18','2026-11-01','2026-11-14',0),
 ('키오스크·모바일 뱅킹 따라하기','정보화','성인',7,'수','14:00~16:00','2026-11-11','2026-12-23','2026-10-20','2026-11-05',0),
 ('의자 근력·균형 체조','운동','노인',0,'월,수,금','09:30~10:20','2026-11-02','2027-01-29','2026-10-26','2026-11-06',0),
 ('바른걸음 걷기 교실','운동','노인',1,'화','10:00~11:00','2026-11-24','2027-02-23','2026-11-16','2026-11-21',10000),
 ('수채화로 그리는 우리 동네','문화예술','성인',7,'목','13:00~15:00','2026-11-05','2026-12-24','2026-10-12','2026-10-30',30000),
 ('원예치료 — 작은 화분 가꾸기','생활취미','노인',0,'금','14:00~15:30','2026-11-13','2026-12-18','2026-11-02','2026-11-12',5000),
 ('기억력 쑥쑥 두뇌 놀이','두뇌','노인',1,'월','10:00~11:00','2026-11-09','2026-12-28','2026-11-02','2026-11-06',0),
 ('내 인생 이야기 — 자서전 쓰기','자서전','성인',7,'수','10:00~12:00','2026-12-02','2027-01-27','2026-11-20','2026-11-28',0),
 ('보이스피싱 예방 생활금융 교육','금융','전체',1,'목','14:00~15:00','2026-11-19','2026-11-19','2026-11-03','2026-11-17',0),
 ('어르신 합창 동아리','동아리','노인',0,'화','15:00~16:30','2026-11-03','2027-03-30','2026-10-20','2026-11-30',0),
 ('재능나눔 봉사단 모집(동화 읽어주기)','자원봉사','성인',0,'수','10:00~12:00','2026-11-18','2027-02-24','2026-11-04','2026-11-15',0),
 ('어린이 코딩 교실','정보화','아동',7,'토','10:00~12:00','2026-11-07','2026-12-19','2026-10-20','2026-11-04',0),
 ('가을 공예 특강(종료)','공예','노인',0,'금','14:00~16:00','2026-09-04','2026-10-23','2026-08-20','2026-08-31',0),
]
for i,(nm,cat,tg,pi,days,tm,s,e,rs,re_,fee) in enumerate(cspec):
    p=P[pi]
    C.append({'id':f'C{SGG}{i+1:03d}','name':'[예시] '+nm,'cat':cat,'content':f'{nm} — 예시 강좌 소개 문구','target':tg,'days':days,'time':tm,
              'startDate':s,'endDate':e,'regStart':rs,'regEnd':re_,'fee':fee,'placeId':p['id'],'place':p['name'],'addr':p['addr'],'lat':p['lat'],'lng':p['lng'],
              'org':p['name'],'tel':TEL,'regMethod':'방문·전화' if i%2 else '방문·온라인','url':None,'capacity':random.choice([12,15,20,25])})
co=base('courses','2026-11-02',['전국평생학습강좌표준데이터']); co['items']=C; co['refresh']='weekly'
json.dump(co,open(f'{W}/courses/{SGG}.json','w'),ensure_ascii=False,indent=1)

O=[{'dong':d['code'],'name':f'[예시] {d["name"]} 행정복지센터','addr':f'경기도 고양시 덕양구 {d["name"]} (예시 주소)','tel':TEL,'hours':'평일 09:00~18:00','lat':d['lat'],'lng':d['lng']} for d in dong]
of=base('offices','2026-11-01',['전국 행정복지센터 주소·전화(확보 경로 확인 필요)']); of['items']=O
of['health']={'name':'[예시] 덕양구보건소','addr':'경기도 고양시 덕양구 (예시 주소)','tel':TEL,'hours':'평일 09:00~18:00'}
of['dementia']={'name':'[예시] 덕양구 치매안심센터','addr':'경기도 고양시 덕양구 (예시 주소)','tel':TEL,'hours':'평일 09:00~18:00'}
of['nhis']={'name':'[예시] 국민건강보험공단 고양지사','addr':'경기도 고양시 (예시 주소)','tel':TEL,'hours':'평일 09:00~18:00'}
json.dump(of,open(f'{W}/offices/{SGG}.json','w'),ensure_ascii=False,indent=1)

L={'version':'2026-11-01','sample':True,'notice':NOTICE,'sgg':SGG,'kind':'local-welfare','source':['지자체복지서비스(15108347)'],
   'items':[{'id':'L41281001','name':'[예시] 덕양구 어르신 병원동행 지원','svc':['hospital_companion'],'target':'혼자 병원 가기 어려운 65세 이상','content':'월 2회 이내 병원 동행(예시)','method':'행정복지센터 신청','period':{'always':True}},
            {'id':'L41281002','name':'[예시] 덕양구 저소득 어르신 밑반찬 배달','svc':['meal_delivery'],'target':'65세 이상 기초·차상위 독거 어르신','content':'주 1회 밑반찬 배달(예시)','method':'행정복지센터 신청','period':{'always':False,'start':'2026-11-10','end':'2026-12-10'}},
            {'id':'L41281003','name':'[예시] 겨울철 난방용품 지원','svc':['energy_support'],'target':'저소득 어르신 가구','content':'전기요·내복 지원(예시)','method':'행정복지센터 신청','period':{'always':False,'start':'2026-11-01','end':'2026-11-30'}}]}
json.dump(L,open(f'{W}/welfare/{SGG}.json','w'),ensure_ascii=False,indent=1)
idx={'version':'2026-11-03','note':'데이터가 있는 시·군·구 목록. 수집 배치(tools/collect)가 갱신합니다.','sgg':{SGG:{'facilities':'2026-11-01','places':'2026-11-01','courses':'2026-11-02','offices':'2026-11-01','welfare':'2026-11-01','sample':True}}}
json.dump(idx,open(f'{W}/index.json','w'),ensure_ascii=False,indent=1)
print(len(F),len(P),len(C),len(O))
