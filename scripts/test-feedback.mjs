// Offline self-test of Field Pulse decrypt/validate/aggregate with synthetic encrypted responses (no network).
// Usage: node --env-file=.env scripts/test-feedback.mjs
import fs from 'node:fs';
import { webcrypto as c } from 'node:crypto';
import { aggregate } from '../pipeline/lib/feedback.mjs';
const cfg = JSON.parse(fs.readFileSync('config/feedback.json'));
const polls = JSON.parse(fs.readFileSync('public/data/polls.json'));
const feed = JSON.parse(fs.readFileSync('public/data/feed.json'));
const b64 = (b) => Buffer.from(b).toString('base64');
async function enc(o) {
  const pub = await c.subtle.importKey('jwk', cfg.public_key_jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await c.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const key = await c.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(o)));
  return JSON.stringify({ enc: 'ecdh-p256-aesgcm', k: b64(await c.subtle.exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) });
}
const [id, poll] = Object.entries(polls.polls).find(([, p]) => !p.no_poll && p.roles.length >= 3);
const inbox = []; let i = 0;
const mk = async (role, pick, extra = {}) => { const R = poll.roles.find((r) => r.role === role); const answers = Object.fromEntries(R.questions.map((q) => [q.id, pick(q)])); inbox.push({ id: 'm' + i, time: 1791526498 + i, message: await enc({ v: 1, card: id, role, answers, text: 'seeing it, call 9876543210', did: 'd' + i++, ts: Date.now(), dt: 9000, ...extra }) }); };
const [r1, r2] = poll.roles;
for (let k = 0; k < 4; k++) await mk(r1.role, (q) => q.supports[0] || q.options[0]);
for (let k = 0; k < 3; k++) await mk(r2.role, (q) => q.contradicts[0] || q.options[1]);
await mk(r1.role, (q) => q.supports[0], { test: true });
await mk(r1.role, (q) => q.supports[0], { dt: 300 });
inbox.push({ id: 'junk', time: 1, message: 'hello' });
const { pulse, stats } = await aggregate({ inbox, polls, feedItems: feed.items, minN: 5 });
console.log('card', id, feed.items.find((x) => x.id === id)?.headline);
console.log(JSON.stringify(stats)); console.log(JSON.stringify(pulse[id], null, 1));
