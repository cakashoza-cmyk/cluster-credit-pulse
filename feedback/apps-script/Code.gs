/**
 * Cluster Credit Pulse — Field Pulse backend on Google Apps Script + Google Sheet (free).
 * OPTIONAL alternative to the default ntfy.sh relay. See README "Field Pulse → Switch to Google Sheet".
 *
 * Script properties (Project Settings → Script properties):
 *   EXPORT_TOKEN  long random string; the GitHub Action sends it to read raw rows (repo secret FEEDBACK_EXPORT_TOKEN)
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the /exec URL
 * into config/feedback.json { "adapter": "apps_script", "apps_script": { "url": "<exec url>" } }.
 */
const SHEET = 'responses';
const ROLES = ['banker', 'operator', 'supplier', 'buyer', 'logistics', 'labour', 'consultant', 'other'];
const MAX_PER_DEVICE_PER_HOUR = 30;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('Cluster Credit Pulse — Field Pulse');
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(['id', 'received_at', 'card', 'cluster', 'role', 'did', 'test', 'answers_json', 'text', 'dt_ms', 'payload_json']); sh.setFrozenRows(1); }
  return sh;
}
const json_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const raw = (e.postData && e.postData.contents) || '';
    if (raw.length > 4000) return json_({ ok: false, error: 'too large' });
    const p = JSON.parse(raw);
    // validation
    if (p.v !== 1 || !/^[0-9a-f]{12}$/.test(p.card) || ROLES.indexOf(p.role) < 0 || !p.did || typeof p.answers !== 'object') return json_({ ok: false, error: 'invalid' });
    const answers = {};
    Object.keys(p.answers).slice(0, 6).forEach((k) => { if (/^[a-z]+\.q\d$/.test(k)) answers[k] = String(p.answers[k]).slice(0, 60); });
    if (!Object.keys(answers).length) return json_({ ok: false, error: 'no answers' });
    // rate limit per device id
    const cache = CacheService.getScriptCache();
    const did = String(p.did).slice(0, 40);
    const n = Number(cache.get('rl:' + did) || 0);
    if (n >= MAX_PER_DEVICE_PER_HOUR) return json_({ ok: false, error: 'rate limited' });
    cache.put('rl:' + did, String(n + 1), 3600);
    const text = String(p.text || '').slice(0, 280).replace(/https?:\/\/\S+/g, '[link]').replace(/\S+@\S+\.\S+/g, '[email]').replace(/(\+?\d[\d\s-]{5,}\d)/g, '[number]');
    const clean = { v: 1, card: p.card, cluster: String(p.cluster || '').slice(0, 30), role: p.role, answers, text, did, pv: String(p.pv || ''), ts: Number(p.ts) || Date.now(), dt: Number(p.dt) || 0, lang: p.lang === 'gu' ? 'gu' : 'en', test: !!p.test };
    const id = Utilities.getUuid();
    sheet_().appendRow([id, new Date(), clean.card, clean.cluster, clean.role, did, clean.test, JSON.stringify(answers), text, clean.dt, JSON.stringify(clean)]);
    return json_({ ok: true, id });
  } catch (err) {
    return json_({ ok: false, error: String(err).slice(0, 200) });
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'aggregates';
  const rows = sheet_().getDataRange().getValues().slice(1);
  if (action === 'export') {
    if (e.parameter.token !== PropertiesService.getScriptProperties().getProperty('EXPORT_TOKEN')) return json_({ ok: false, error: 'forbidden' });
    return json_({ ok: true, rows: rows.map((r) => ({ id: r[0], time: Math.floor(new Date(r[1]).getTime() / 1000), payload: r[10] })) });
  }
  // public aggregates: counts per card and role only (no free text, no device ids), test rows excluded
  const cards = {};
  rows.forEach((r) => { if (r[6] === true) return; const c = (cards[r[2]] = cards[r[2]] || { n: 0, by_role: {} }); c.n++; c.by_role[r[4]] = (c.by_role[r[4]] || 0) + 1; });
  return json_({ ok: true, generated_at: new Date().toISOString(), cards });
}
