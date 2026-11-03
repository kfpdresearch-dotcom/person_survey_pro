// 시나리오: 페르소나 3종 + (독거·수급·등급 없음 / 부부·일반·3등급 / 데이터 없는 군 단위)
const fs = require('fs'), vm = require('vm');
const { run } = require('./regress.js');
const W = require('path').resolve(__dirname, '..') + '/';
const ctx = run(fs.readFileSync(W + 'index_pro.html', 'utf8'), true);
const api = ctx.__API, C = ctx.PERSON_CORE;
const map = JSON.parse(fs.readFileSync(W + 'data/map.json'));
const bundle = {}; ['facilities','places','courses','offices','welfare'].forEach(k => bundle[k] = JSON.parse(fs.readFileSync(`${W}data/${k}/41281.json`)));
const region = { sido:'41', sigungu:'41281', sggName:'고양시 덕양구', dong:'4128153000', dongName:'화정1동', lat:37.634, lng:126.832 };
const today = '2026-11-03';
function scenario(name, answers, reg, bnd) {
  api.STATE.answers = answers;
  const d = api.calcDomainScores(), s = api.extractSignals(), r = api.recommendServices(s, d);
  const p = C.buildProfile(answers, d, s, reg, { year: 2026 });
  const items = C.buildItems(r, api.SERVICES, p);
  const sp = C.splitByTrack(items);
  const ctxF = t => ({ track: t, map, bundle: bnd, ltcTypesAll: ['방문요양','주야간보호','방문간호'] });
  const pub = C.rankWithinTrack(sp.public, p, ctxF('public'));
  const pri = C.rankWithinTrack(sp.private, p, ctxF('private'));
  console.log(`\n■ ${name}  (나이 ${p.age.v}, 가구 ${p.household.v}, 수급 ${p.income.v}, 등급 ${p.ltcGrade.v})`);
  console.log('  공공:', pub.map(x => `${x.pinned?'📌':''}${x.svc.id}[${x.elig.level}/${x.score}]`).join('  '));
  pub.filter(x => x.elig.level !== 'likely').forEach(x => console.log(`     - ${x.svc.id}: ${x.elig.reason}`));
  console.log('  민간:', pri.map(x => `${x.pinned?'📌':''}${x.svc.id}(${x.svc.sub||'-'})[${x.score}]`).join('  '));
  const g = C.autoGuide(p, pri, { track:'private', map, bundle: bnd, origin: reg && reg.lat ? reg : null, ltcTypesAll:['방문요양','주야간보호'], today });
  g.forEach(x => console.log(`     미리보기 ${x.item.svc.id}: ${x.kind} → ${x.preview.map(v => v.name).join(' / ') || '(없음)'}`));
  const gp = C.autoGuide(p, pub, { track:'public', map, bundle: bnd, origin: null, today, env:{} });
  gp.forEach(x => console.log(`     신청처 ${x.item.svc.id}: ${x.channel} → ${x.preview[0].name || x.preview[0].type}`));
  const cart = pub.filter(x => x.elig.level !== 'none').slice(0, 2).map(x => ({ key:'program:'+x.svc.id, kind:'program', svcId:x.svc.id, name: map.services[x.svc.id] ? map.services[x.svc.id].program : x.svc.title, status:'saved', level:x.elig.level }));
  const f = C.listFacilities(bnd.facilities, ['주야간보호'], 'distance', reg);
  if (f.length) cart.push({ key:'facility:'+f[0].id, kind:'facility', svcId:'day_care', refId:f[0].id, name:f[0].name, status:'saved' });
  const scores = {}; pub.concat(pri).forEach(x => scores[x.svc.id] = x.score);
  const plan = C.buildCarePlan(cart, { map, offices: bnd.offices, region: reg, scores, env:{} });
  console.log('  돌봄계획: 제도', plan.programs.map(x => x.name).join(' → '), '| 연락', plan.contacts.map(x=>x.name).join(','), '\n  이번 주 할 일:', plan.weekTask && plan.weekTask.text);
  return { p, pub, pri };
}
const P = api.PERSONAS;
scenario('사례1 최성길(74 부부)', api.buildPersonaAnswers(P.p1), region, bundle);
scenario('사례2 한금자(79 독거)', api.buildPersonaAnswers(P.p2), region, bundle);
scenario('사례3 오영자(81 수급)', api.buildPersonaAnswers(P.p3), region, bundle);
const mk = (over) => api.buildPersonaAnswers({ lv: { 'A. 기본정보':1,'B. 신체 건강':2,'C. 일상 기능':2,'D. 인지 건강':1,'E. 정서 상태':1,'F. 사회 관계':2,'G. 경제 재무':2,'H. 주거 환경':2,'I. 여가·의미':2,'J. 안전·권리':0,'K. 맞춤 서비스':0 }, ans: over });
scenario('독거·수급·등급 없음', mk({ 2:'1944', 6:'독거 (혼자 생활)', 9:'기초생활수급', 10:'신청한 적 없음', 30:'일부 도움이 필요해요', 29:'두 번 이상 있어요', 23:'불규칙하거나 자주 거름', 48:'자주 그래요', 57:'주간보호센터를 이용하고 싶어요' }), region, bundle);
scenario('부부·일반·등급 있음', mk({ 2:'1949', 6:'부부 가구', 9:'해당 없음', 10:'등급 있음 (1~5등급·인지지원)', 30:'일부 도움이 필요해요', 31:'3가지 이상 도움이 필요함' }), region, bundle);
scenario('데이터 없는 군 단위(경북 군위군)', mk({ 2:'1950', 6:'독거 (혼자 생활)', 9:'잘 모르겠음', 10:'잘 모르겠음' }), { sido:'27', sigungu:'27720', sggName:'군위군' }, {});
// 새 소식
const ls0 = C.makeLastSeen(bundle, map, '2026-10-20');
ls0.fullFacilities = ['S41281002'];
const news = C.whatsNew(bundle, map, ls0, { svcIds:['energy_support','hobby_program','day_care'], programCats:['정보화','문화예술','생활취미','운동'], ltcTypes:['주야간보호'] }, today);
console.log('\n■ 새 소식(10/20 기준 → 11/03):'); news.forEach(n => console.log('  ', n.kind, n.text));
