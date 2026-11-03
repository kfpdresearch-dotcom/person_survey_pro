/* ============================================================
 * 퍼슨 돌봄 퍼널 — 서식 프리필 · 묶음 PDF (브라우저 안에서만, 서버 전송 0건)
 *  · prefillPdf(form, values) : PDF 서식(AcroForm)이면 아는 칸만 채움. HWP·서식 없음이면 null
 *  · bundlePdf(opts)          : 신청 준비 안내 + 작성 도우미 + (위임장 안내) + 올린 서류 → 한 파일
 *  라이브러리(pdf-lib, fontkit)와 한글 글꼴은 funnel/vendor 에 같이 배포하고 필요할 때만 불러온다.
 * ============================================================ */
(function (root) {
  'use strict';
  const VENDOR = 'funnel/vendor/';
  let libP = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('불러오기 실패: ' + src));
      document.head.appendChild(s);
    });
  }
  function loadLib() {
    if (libP) return libP;
    libP = (root.PDFLib ? Promise.resolve() : loadScript(VENDOR + 'pdf-lib.min.js'))
      .then(() => (root.fontkit ? null : loadScript(VENDOR + 'fontkit.umd.min.js')))
      .then(() => Promise.all([
        fetch(VENDOR + 'Pretendard-Regular-subset.ttf').then((r) => r.arrayBuffer()),
        fetch(VENDOR + 'Pretendard-Bold-subset.ttf').then((r) => r.arrayBuffer())
      ]))
      .then(([reg, bold]) => ({ PDFLib: root.PDFLib, fontkit: root.fontkit, reg, bold }));
    libP.catch(() => { libP = null; });
    return libP;
  }

  // ── 서식 프리필 ───────────────────────────────────────────
  //  form.file 이 PDF 이고 form.fields = { 'PDF필드명': 'profile키' } 가 있으면 그 칸만 채운다.
  async function prefillPdf(form, values) {
    if (!form || !form.file || form.fmt !== 'pdf') return null;
    const lib = await loadLib();
    const bytes = await fetch(form.file).then((r) => r.arrayBuffer());
    const doc = await lib.PDFLib.PDFDocument.load(bytes);
    doc.registerFontkit(lib.fontkit);
    const font = await doc.embedFont(lib.reg, { subset: false });
    const f = doc.getForm();
    Object.entries(form.fields || {}).forEach(([name, key]) => {
      const v = values[key];
      if (v == null || v === '') return;
      try { const tf = f.getTextField(name); tf.setText(String(v)); tf.updateAppearances(font); } catch (e) { /* 칸 이름이 다르면 건너뜀 */ }
    });
    return doc.save();
  }

  // ── 묶음 PDF ──────────────────────────────────────────────
  //  opts = { title, svcName, eligText, office:{name,addr,tel,hours,type}, steps:[..], docs:[{name,where,checked}],
  //           fields:[{label,value,how}], proxy:{on, docs:[..], form}, files:[{name,type,blob}], forms:[bytes|null], notice }
  async function bundlePdf(opts) {
    const lib = await loadLib();
    const { PDFDocument, rgb } = lib.PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(lib.fontkit);
    const R = await doc.embedFont(lib.reg, { subset: false });
    const B = await doc.embedFont(lib.bold, { subset: false });
    const W = 595, H = 842, M = 46;
    const green = rgb(0.29, 0.39, 0.31), sub = rgb(0.45, 0.43, 0.41), ink = rgb(0.2, 0.2, 0.2), line = rgb(0.86, 0.84, 0.8);
    let page, y;
    const footer = () => {
      const t = '퍼슨 생활 점검 · 신청 준비 묶음 — 신청을 돕는 안내 자료이며 자격 판정이 아닙니다. 최종 판단은 담당 기관이 합니다.';
      page.drawText(t, { x: M, y: 26, size: 7.5, font: R, color: sub });
    };
    const newPage = () => { page = doc.addPage([W, H]); y = H - M; footer(); };
    const wrap = (text, font, size, maxW) => {
      const out = [];
      String(text || '').split('\n').forEach((para) => {
        let cur = '';
        for (const ch of para) {
          const t = cur + ch;
          if (font.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = ch; } else cur = t;
        }
        out.push(cur);
      });
      return out;
    };
    const ensure = (h) => { if (y - h < 48) newPage(); };
    const text = (t, o) => {
      o = o || {};
      const size = o.size || 11, font = o.bold ? B : R, x = o.x || M, maxW = o.maxW || (W - M - x);
      const lines = wrap(t, font, size, maxW);
      lines.forEach((ln) => { ensure(size + 6); page.drawText(ln, { x, y: y - size, size, font, color: o.color || ink }); y -= size + (o.gap || 5); });
    };
    const rule = () => { ensure(12); page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.8, color: line }); y -= 14; };
    const h2 = (t) => { y -= 6; text(t, { size: 14, bold: true, color: green }); rule(); };
    const box = (label, value, how) => {
      ensure(how ? 86 : 66);
      const top = y;
      text(label, { size: 10, bold: true, color: sub, gap: 3 });
      text(value || '(직접 쓰기)', { size: 12, bold: !!value, color: value ? ink : rgb(0.65, 0.55, 0.45), x: M + 8 });
      if (how) text('→ ' + how, { size: 9.5, color: sub, x: M + 8 });
      y -= 4;
      page.drawRectangle({ x: M - 6, y: y, width: W - 2 * M + 12, height: top - y + 2, borderColor: line, borderWidth: 0.7 });
      y -= 8;
    };

    // 1쪽 — 신청 준비 안내
    newPage();
    text(opts.title || '신청 준비 묶음', { size: 20, bold: true, color: green, gap: 8 });
    text(opts.svcName || '', { size: 13, bold: true });
    if (opts.notice) text(opts.notice, { size: 9.5, color: rgb(0.66, 0.36, 0.36) });
    text(`만든 날: ${new Date().toLocaleDateString('ko-KR')}`, { size: 9.5, color: sub });
    if (opts.eligText) { h2('신청 가능성'); text(opts.eligText, { size: 11 }); text('※ 최종 판단은 담당 기관이 합니다.', { size: 9.5, color: sub }); }
    if (opts.office) {
      h2('제출처');
      const o = opts.office;
      text(o.name || o.type, { size: 12, bold: true });
      if (o.addr) text('주소  ' + o.addr, { size: 10.5 });
      if (o.tel) text('전화  ' + o.tel, { size: 10.5 });
      if (o.hours) text('운영  ' + o.hours, { size: 10.5 });
    }
    if (opts.steps && opts.steps.length) { h2('신청 순서'); opts.steps.forEach((s, i) => text(`${i + 1}. ${s}`, { size: 11 })); }
    if (opts.docs && opts.docs.length) {
      h2('구비서류 체크리스트');
      opts.docs.forEach((d) => text(`${d.checked ? '■' : '□'}  ${d.name}${d.where ? '  —  ' + d.where : ''}`, { size: 11 }));
    }
    // 2쪽 — 신청서 작성 도우미
    if (opts.fields && opts.fields.length) {
      newPage();
      text('신청서 작성 도우미', { size: 18, bold: true, color: green, gap: 8 });
      text('점검에서 알게 된 칸은 미리 적어 두었어요. 빈칸은 오른쪽 안내대로 직접 적어 주세요. 이름·주민등록번호·계좌번호는 퍼슨이 받지 않아요.', { size: 10, color: sub });
      y -= 6;
      opts.fields.forEach((f) => box(f.label, f.value, f.how));
    }
    // 3쪽 — 대리 신청
    if (opts.proxy && opts.proxy.on) {
      newPage();
      text('보호자가 대신 신청할 때', { size: 18, bold: true, color: green, gap: 8 });
      if (opts.proxy.note) text(opts.proxy.note, { size: 11 });
      if (opts.proxy.form) text(`필요 서식: ${opts.proxy.form.name}${opts.proxy.form.source ? ' (' + opts.proxy.form.source + ' 에서 내려받기)' : ''}`, { size: 11 });
      h2('보호자 준비물');
      (opts.proxy.docs || []).forEach((d) => text(`□  ${d.name}${d.where ? '  —  ' + d.where : ''}`, { size: 11 }));
    }
    // 프리필된 서식(PDF)
    for (const fb of (opts.forms || [])) {
      if (!fb) continue;
      try { const src = await PDFDocument.load(fb); const pages = await doc.copyPages(src, src.getPageIndices()); pages.forEach((p) => doc.addPage(p)); } catch (e) { /* skip */ }
    }
    // 올린 서류
    for (const f of (opts.files || [])) {
      const buf = await f.blob.arrayBuffer();
      try {
        if (f.type === 'application/pdf') {
          const src = await PDFDocument.load(buf, { ignoreEncryption: true });
          const pages = await doc.copyPages(src, src.getPageIndices());
          pages.forEach((p) => doc.addPage(p));
          continue;
        }
        let img;
        if (f.type === 'image/png') img = await doc.embedPng(buf);
        else if (f.type === 'image/jpeg' || f.type === 'image/jpg') img = await doc.embedJpg(buf);
        else img = await doc.embedJpg(await toJpeg(f.blob));
        newPage();
        text(`첨부 서류 — ${f.name}`, { size: 12, bold: true, color: green });
        const maxW = W - 2 * M, maxH = y - 50;
        const sc = Math.min(maxW / img.width, maxH / img.height, 1);
        page.drawImage(img, { x: M, y: y - img.height * sc, width: img.width * sc, height: img.height * sc });
      } catch (e) {
        newPage(); text(`첨부 서류 — ${f.name}`, { size: 12, bold: true }); text('이 파일 형식은 묶음에 넣지 못했어요. 따로 출력해 주세요.', { size: 10.5, color: sub });
      }
    }
    return doc.save();
  }
  // HEIC 등 기타 이미지 → 캔버스로 JPEG 변환 (브라우저가 읽을 수 있을 때만)
  function toJpeg(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        c.toBlob((b) => { URL.revokeObjectURL(url); b ? b.arrayBuffer().then(res) : rej(new Error('변환 실패')); }, 'image/jpeg', 0.88);
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했어요')); };
      im.src = url;
    });
  }

  root.PERSON_PDF = { loadLib, prefillPdf, bundlePdf };
})(typeof window !== 'undefined' ? window : globalThis);
