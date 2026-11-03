// 회귀 확인: 기존 진단·채점·추천 결과가 퍼널 추가 전후로 같은지 (샘플 응답 10세트)
const fs = require('fs'), vm = require('vm');
const path = require('path');
const W = path.resolve(__dirname, '..') + '/';
function scriptsOf(html) { return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]); }
function makeCtx() {
  const el = () => ({ appendChild(){}, innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){}}, addEventListener(){}, setAttribute(){}, querySelector(){return null}, querySelectorAll(){return []} });
  const store = {};
  const ctx = { console, Date, Math, JSON, parseInt, isNaN, setTimeout, clearTimeout,
    document: { getElementById: () => el(), createElement: () => el(), body: el(), head: el(), querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, readyState:'complete' },
    location: { hash:'', pathname:'/', search:'' }, history: { replaceState(){} },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k,v) => store[k] = String(v), removeItem: k => delete store[k] },
    alert(){}, confirm(){ return true; }, navigator: { userAgent:'node' }, addEventListener(){} };
  ctx.window = ctx; ctx.globalThis = ctx;
  return vm.createContext(ctx);
}
function run(html, withFunnel) {
  const ctx = makeCtx();
  vm.runInContext(scriptsOf(html)[0] + '\n;globalThis.__API={STATE,SERVICES,PERSONAS,QUESTIONS,buildPersonaAnswers,calcDomainScores,extractSignals,recommendServices,calculateLifeScore};', ctx);
  if (withFunnel) ['meta','core'].forEach(f => vm.runInContext(fs.readFileSync(W+'funnel/'+f+'.js','utf8'), ctx));
  if (withFunnel) ctx.PERSON_CORE.attachMeta(ctx.__API.SERVICES);
  return ctx;
}
function answerSets(api) {
  const sets = Object.keys(api.PERSONAS).map(k => api.buildPersonaAnswers(api.PERSONAS[k]));
  let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let n = 0; n < 7; n++) {
    const lv = {}; ['A. 기본정보','B. 신체 건강','C. 일상 기능','D. 인지 건강','E. 정서 상태','F. 사회 관계','G. 경제 재무','H. 주거 환경','I. 여가·의미','J. 안전·권리','K. 맞춤 서비스'].forEach(d => lv[d] = Math.floor(rnd()*4));
    const ans = { 2: String(1940 + Math.floor(rnd()*25)) };
    api.QUESTIONS.filter(q => typeof q.id === 'number' && q.options).forEach(q => { if (rnd() < 0.5) ans[q.id] = q.options[Math.floor(rnd()*q.options.length)]; });
    sets.push(api.buildPersonaAnswers({ lv, ans }));
  }
  return sets;
}
function summarize(ctx, answers) {
  const api = ctx.__API;
  api.STATE.answers = JSON.parse(JSON.stringify(answers));
  const d = api.calcDomainScores(), s = api.extractSignals(), r = api.recommendServices(s, d);
  const f = arr => arr.map(x => x.svc.id + ':' + x.score.toFixed(3));
  return JSON.stringify({ life: api.calculateLifeScore(), d: d.map(x => x.code + x.score + x.status), s: s.map(x => x.id + x.sev), t1: f(r.tier1), t2: f(r.tier2), c: f(r.checkNeeded) });
}
const orig = fs.readFileSync(W + 'tests/baseline/index_pro.before-funnel.html', 'utf8');
const neu = fs.readFileSync(W + 'index_pro.html', 'utf8');
const A = run(orig, false), B = run(neu, true);
const sets = answerSets(A.__API);
let same = 0;
sets.forEach((ans, i) => { const a = summarize(A, ans), b = summarize(B, ans); if (a === b) same++; else console.log('DIFF', i, a, b); });
console.log(`회귀 비교: ${same}/${sets.length} 세트 동일`);
module.exports = { run, summarize, answerSets };
