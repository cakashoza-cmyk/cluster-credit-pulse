// Free-tier LLM clients. Keys are read ONLY from environment variables.
//   OPENROUTER_API_KEY  -> OpenRouter (models tried in order from OPENROUTER_MODELS)
//   GEMINI_API_KEY      -> Google Gemini API free tier (models from GEMINI_MODELS)
// If neither is set, mode = 'none' and the pipeline uses the heuristic fallback.

const OR_MODELS = (process.env.OPENROUTER_MODELS ||
  'moonshotai/kimi-k2.6:free,moonshotai/kimi-k2:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free')
  .split(',').map((s) => s.trim()).filter(Boolean);
const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DELAY_MS = Number(process.env.LLM_DELAY_MS || 4000); // free tiers: ~15-20 req/min max

export function llmMode() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'none';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dead = new Set(); // models that failed hard this run
const overload = {}; // consecutive 5xx/timeouts per model
export const usage = {}; // successful calls per model
export const rateLimits = { count: 0, daily: [] };

function extractJson(text) {
  if (!text) throw new Error('empty response');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON object in response');
  const body = raw.slice(start, end + 1);
  try { return JSON.parse(body); } catch (e) {
    // lenient repair for common model slips: single quotes, unquoted keys, trailing commas
    const fixed = body.replace(/'([^'\\]*)'/g, '"$1"').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch { throw e; }
  }
}

async function callOpenRouter(model, system, user) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/cluster-credit-pulse',
      'X-Title': 'Cluster Credit Pulse',
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) { const full = JSON.stringify(body.error || body); const e = new Error(`OpenRouter ${model}: ${res.status} ${full.slice(0, 200)}`); e.status = res.status || body.error?.code; e.full = full; throw e; }
  return body.choices?.[0]?.message?.content;
}

async function callGemini(model, system, user) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING || 'low' } } : {}) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const full = JSON.stringify(body.error || body); const e = new Error(`Gemini ${model}: ${res.status} ${full.slice(0, 200)}`); e.status = res.status; e.full = full; throw e; }
  return body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
}

/** Returns { json, model } or throws. Tries OpenRouter models, then Gemini models. */
export async function completeJson(system, user, { providers = ['openrouter', 'gemini'] } = {}) {
  const plan = [];
  if (process.env.OPENROUTER_API_KEY && providers.includes('openrouter')) for (const m of OR_MODELS) plan.push(['openrouter', m]);
  if (process.env.GEMINI_API_KEY && providers.includes('gemini')) for (const m of GEMINI_MODELS) plan.push(['gemini', m]);
  let lastErr = new Error('no LLM key configured');
  for (const [provider, model] of plan) {
    const key = `${provider}:${model}`;
    if (dead.has(key)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sleep(DELAY_MS);
        const text = provider === 'openrouter' ? await callOpenRouter(model, system, user) : await callGemini(model, system, user);
        const json = extractJson(text);
        overload[key] = 0; usage[key] = (usage[key] || 0) + 1;
        return { json, model: key };
      } catch (e) {
        lastErr = e;
        if (e.status === 429) {
          rateLimits.count++;
          const txt = e.full || e.message;
          const delay = Number((txt.match(/retryDelay\W+(\d+)s/) || [])[1] || 0);
          if (/per ?day|PerDay|daily|free-models-per-day/i.test(txt) || delay > 120) { dead.add(key); rateLimits.daily.push(key); console.log(`[llm] ${key} daily quota exhausted`); break; }
          console.log(`[llm] ${key} 429 (per-minute), backing off`);
          await sleep(Math.max(delay * 1000, 20000 * (attempt + 1))); continue;
        }
        if (e.status && e.status >= 400 && e.status < 500) { dead.add(key); break; } // model unavailable / bad id
        if (e instanceof SyntaxError || /JSON/.test(e.message)) continue; // retry malformed output
        // 5xx (e.g. 503 "high demand"): one quick retry, then fall through to next model; disable after 4 strikes
        overload[key] = (overload[key] || 0) + 1;
        if (overload[key] >= 4) { dead.add(key); console.log(`[llm] ${key} overloaded repeatedly, skipping for this run`); break; }
        if (attempt >= 1) break;
        await sleep(3000);
      }
    }
  }
  throw lastErr;
}
