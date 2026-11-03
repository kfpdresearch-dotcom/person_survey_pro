/* ============================================================
 * 퍼슨 돌봄 퍼널 — 브라우저 저장소
 *  · localStorage : 지역 · 프로파일 · 돌봄 계획 바구니 · 마지막 확인(lastSeen)
 *  · IndexedDB    : 사용자가 올린 서류 파일 (서버 전송 없음, 30일 자동 삭제)
 * ============================================================ */
(function (root) {
  'use strict';
  const KEYS = {
    region: 'person_funnel_region',
    profile: 'person_funnel_profile',
    cart: 'person_funnel_cart',
    last: 'person_funnel_lastseen',
    pending: 'person_funnel_pending',
    prefill: 'person_funnel_prefill_ok'
  };
  const ls = {
    get(k, def) {
      try { const v = root.localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* noop */ } }
  };

  // ── IndexedDB (서류 파일) ─────────────────────────────────
  const DB_NAME = 'person_funnel', STORE = 'files', KEEP_DAYS = 30;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('이 브라우저는 파일 보관을 지원하지 않아요')); return; }
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const st = d.createObjectStore(STORE, { keyPath: 'id' });
          st.createIndex('svcId', 'svcId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const files = {
    add(svcId, file) {
      const rec = { id: 'f' + Date.now() + Math.random().toString(36).slice(2, 7), svcId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() };
      return tx('readwrite', (st) => reqP(st.put(rec))).then(() => rec);
    },
    list(svcId) {
      return tx('readonly', (st) => reqP(svcId ? st.index('svcId').getAll(svcId) : st.getAll()))
        .then((arr) => (arr || []).sort((a, b) => a.createdAt - b.createdAt));
    },
    remove(id) { return tx('readwrite', (st) => reqP(st.delete(id))); },
    clear() { return tx('readwrite', (st) => reqP(st.clear())); },
    purgeOld() {
      const limit = Date.now() - KEEP_DAYS * 86400000;
      return files.list().then((all) => Promise.all(all.filter((f) => f.createdAt < limit).map((f) => files.remove(f.id))).then((r) => r.length));
    },
    KEEP_DAYS
  };

  root.PERSON_STORE = { KEYS, ls, files };
})(typeof window !== 'undefined' ? window : globalThis);
