// Fetch + parse RSS (Google News search RSS and publisher RSS). No article bodies are fetched.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const UA = 'Mozilla/5.0 (compatible; ClusterCreditPulse/0.1; +https://github.com/)';

const HL = { en: ['en-IN', 'IN:en'], gu: ['gu-IN', 'IN:gu'], hi: ['hi-IN', 'IN:hi'] };

export function googleNewsUrl(q, lang = 'en', window = 'when:30d') {
  const [hl, ceid] = HL[lang] || HL.en;
  const query = window ? `${q} ${window}` : q;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=IN&ceid=${ceid}`;
}

const txt = (v) => (v == null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v));

export function stripHtml(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ').trim();
}

export async function fetchFeed(url, { retries = 2, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const doc = parser.parse(xml);
      let items = doc?.rss?.channel?.item ?? [];
      if (!Array.isArray(items)) items = [items];
      return items.map((it) => {
        const src = it.source;
        let title = stripHtml(txt(it.title));
        const sourceName = stripHtml(txt(src)) || '';
        // Google News appends " - Publisher" to titles
        if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();
        return {
          title,
          link: txt(it.link).trim(),
          pubDate: txt(it.pubDate),
          snippet: stripHtml(txt(it.description)).slice(0, 400),
          sourceName,
          sourceUrl: src && typeof src === 'object' ? src['@_url'] || '' : '',
        };
      }).filter((x) => x.title && x.link);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}
