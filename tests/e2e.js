// 브라우저 전체 흐름 확인 — 먼저 저장소 폴더에서 `python3 -m http.server 8765` 실행 후 `node tests/e2e.js`
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  pg.on('dialog', d => d.accept());
  const SHOTS = require('path').resolve(__dirname, 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });
  const shot = async (n) => { await pg.waitForTimeout(250); await pg.screenshot({ path: `${SHOTS}/${n}.png` }); };
  const U = 'http://127.0.0.1:8765/';
  await pg.goto(U + 'index_pro.html#admin');
  await pg.click('.persona-card >> nth=2');   // 오영자 (수급·등급 외)
  await pg.click('.tab-btn:has-text("맞춤 서비스")');
  await shot('01_services_tab');
  const goBtns = await pg.locator('.svc-go').count();
  console.log('svc-go buttons:', goBtns);
  await pg.click('.pf-entry .btn-primary');
  await shot('02_S02_region');
  await pg.selectOption('#pf-sido', '41');
  await pg.selectOption('#pf-sgg', '41281');
  await pg.waitForFunction(() => document.querySelector('#pf-dong') && !document.querySelector('#pf-dong').disabled);
  await pg.selectOption('#pf-dong', { label: '화정1동' });
  await pg.click('[data-act="saveRegion"]');
  await shot('03_S03_public');
  await pg.click('[data-act="tab"][data-tab="private"]');
  await shot('04_S03_private');
  await pg.click('[data-act="tab"][data-tab="public"]');
  // 공공 카드 → S10
  await pg.click('.pf-card [data-act="open"][data-svc="life_companion"]');
  await shot('05_S10_detail');
  await pg.click('.pf-sticky [data-act="go"][data-s="S12c"]');
  await pg.waitForTimeout(400);
  await shot('06_S12c_form');
  // 업로드
  const fs = require('fs');
  await pg.setInputFiles('input[data-chg="upload"]', { name: '신분증_사본.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await pg.waitForTimeout(600);
  await pg.click('input[data-chg="chk"] >> nth=0');
  await pg.click('input[data-chg="proxy"]');
  await pg.waitForTimeout(300);
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('[data-act="bundle"]')]);
  await dl.saveAs(require('path').resolve(__dirname, 'shots', 'bundle.pdf'));
  console.log('bundle saved', dl.suggestedFilename());
  await shot('07_S12c_after');
  // LINK 경로 (장기요양 인정신청)
  await pg.click('#pf-back'); await pg.click('#pf-back');
  if (await pg.locator('[data-act="more"]').count()) await pg.click('[data-act="more"]');
  await pg.click('.pf-card [data-act="open"][data-svc="ltc_apply"]');
  await shot('08_S10_ltc');
  await pg.click('[data-act="prep"]');
  await shot('09_S11_prepare');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), pg.click('.pf-sticky .btn-primary')]);
  await popup.close().catch(()=>{});
  await pg.bringToFront();
  await pg.evaluate(() => { const p = JSON.parse(localStorage.getItem('person_funnel_pending')); p.at -= 5000; localStorage.setItem('person_funnel_pending', JSON.stringify(p)); window.dispatchEvent(new Event('focus')); });
  await pg.waitForTimeout(600);
  await shot('10_S13_sheet');
  await pg.click('[data-act="pendYes"]');
  // 민간 → 기관 목록
  await pg.click('#pf-tab-rec');
  await pg.click('[data-act="tab"][data-tab="private"]');
  await shot('11_S03_private_after_ltc');
  await pg.click('.pf-card [data-act="open"][data-svc="day_care"]');
  await shot('12_S20_list');
  await pg.click('[data-act="sort"][data-k="grade"]');
  await shot('13_S20_grade');
  await pg.click('.pf-card .pf-card-title.sm >> nth=0');
  await shot('14_S21_detail');
  await pg.click('.pf-sticky [data-act="cart"]');
  await pg.click('#pf-back'); await pg.click('#pf-back');
  await pg.click('.pf-card [data-act="open"][data-svc="fraud_prevent"]');
  await shot('15_S25_life');
  await pg.click('.pf-card .pf-card-title.sm >> nth=0');
  await shot('16_S26_course');
  await pg.click('.pf-sticky [data-act="cart"]');
  await pg.click('#pf-tab-plan');
  await shot('17_S30_plan');
  await pg.locator('#pf-body').evaluate(e => e.scrollTop = 9999);
  await shot('18_S30_plan_bottom');
  // 인쇄 미리보기 (print 미디어)
  await pg.evaluate(() => { window.print = () => {}; });
  await pg.click('[data-act="print"]');
  await pg.emulateMedia({ media: 'print' });
  await shot('19_print');
  await pg.emulateMedia({ media: 'screen' });
  await pg.evaluate(() => document.body.classList.remove('pf-printing'));
  // 새 소식 미리보기
  await pg.click('#pf-tab-rec');
  await pg.click('[data-act="devNews"]');
  await shot('20_news');
  // 시작 페이지 계획 카드
  await pg.goto(U + 'index.html');
  await shot('21_index');
  await pg.click('#planCard');
  await pg.waitForTimeout(800);
  await shot('22_hash_plan');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
