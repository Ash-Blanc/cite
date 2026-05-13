import { Hono } from 'hono';
import { cors } from "hono/cors"

// ─── types ────────────────────────────────────────────────────────────────────

interface PaperNode {
  paperId: string;
  arxivId?: string;
  title: string;
  year: number;
  authors: string[];
  venue: string;
  abstract?: string;
  /** Sentences from the paper that cite this node (references only) */
  contexts?: string[];
  /** Citation intent labels e.g. "background", "methodology", "result" */
  intents?: string[];
}

interface GraphResponse {
  paper: PaperNode & { abstract: string };
  references: PaperNode[];
  citations: PaperNode[];
  error?: string;
}

// ─── in-memory cache (survives hot-reload in dev but resets on restart) ───────

const cache = new Map<string, { data: GraphResponse; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// ─── arXiv XML parser ─────────────────────────────────────────────────────────

function extractText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

async function fetchArxivMeta(arxivId: string): Promise<{
  title: string;
  abstract: string;
  authors: string[];
  year: number;
  venue: string;
} | null> {
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`,
      { headers: { 'User-Agent': 'citation-graph/1.0' } }
    );
    if (!res.ok) return null;
    const xml = await res.text();

    // check if any entry returned
    if (!xml.includes('<entry>')) return null;

    // parse entry block
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
    if (!entryMatch) return null;
    const entry = entryMatch[1];

    const title = extractText(entry, 'title')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const abstract = extractText(entry, 'summary')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const publishedStr = extractText(entry, 'published');
    const year = publishedStr ? parseInt(publishedStr.slice(0, 4), 10) : new Date().getFullYear();

    // extract author names from <author><name>...</name></author>
    const authorBlocks = extractAll(entry, 'author');
    const authors = authorBlocks.map(block => extractText(block, 'name')).filter(Boolean);

    // primary category as venue hint
    const catMatch = entry.match(/arxiv:primary_category[^>]+term="([^"]+)"/i);
    const venue = `arXiv${catMatch ? ` (${catMatch[1]})` : ''}`;

    return { title, abstract, authors, year, venue };
  } catch {
    return null;
  }
}

// ─── Semantic Scholar helpers ─────────────────────────────────────────────────

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const S2_HEADERS = {
  'User-Agent': 'citation-graph/1.0',
  'Accept': 'application/json',
};

function parseS2Authors(authors: Array<{ name: string }>): string[] {
  if (!authors || authors.length === 0) return [];
  if (authors.length <= 3) return authors.map(a => a.name);
  return [...authors.slice(0, 3).map(a => a.name), 'et al.'];
}

function getArxivIdFromS2(paper: { externalIds?: Record<string, string> }): string | undefined {
  return paper.externalIds?.ArXiv;
}

async function fetchS2References(arxivId: string): Promise<PaperNode[]> {
  try {
    const url = `${S2_BASE}/paper/arXiv:${arxivId}/references?fields=title,year,authors,venue,externalIds,intents,contexts&limit=50`;
    const res = await fetch(url, { headers: S2_HEADERS });
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: Array<{
        intents?: string[];
        contexts?: string[];
        citedPaper: Record<string, unknown>;
      }>;
    };
    if (!data.data) return [];

    return data.data
      .filter((item) => item.citedPaper?.title)
      .map((item, i) => {
        const p = item.citedPaper as {
          paperId?: string;
          title: string;
          year?: number;
          authors?: Array<{ name: string }>;
          venue?: string;
          externalIds?: Record<string, string>;
        };
        // Dedupe & trim contexts, limit to 3 most useful ones
        const rawContexts = (item.contexts ?? [])
          .map((s) => s.trim())
          .filter((s) => s.length > 20);
        const seen = new Set<string>();
        const contexts: string[] = [];
        for (const ctx of rawContexts) {
          // Use first 80 chars as dedup key to catch near-dupes
          const key = ctx.slice(0, 80);
          if (!seen.has(key)) { seen.add(key); contexts.push(ctx); }
          if (contexts.length >= 3) break;
        }
        return {
          paperId: p.paperId ?? `ref-${i}`,
          arxivId: getArxivIdFromS2(p),
          title: p.title,
          year: p.year ?? 0,
          authors: parseS2Authors(p.authors ?? []),
          venue: p.venue ?? 'Unknown',
          intents: item.intents ?? [],
          contexts,
        };
      });
  } catch {
    return [];
  }
}

async function fetchS2Citations(arxivId: string): Promise<PaperNode[]> {
  try {
    const url = `${S2_BASE}/paper/arXiv:${arxivId}/citations?fields=title,year,authors,venue,externalIds,intents,contexts&limit=30`;
    const res = await fetch(url, { headers: S2_HEADERS });
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: Array<{
        intents?: string[];
        contexts?: string[];
        citingPaper: Record<string, unknown>;
      }>;
    };
    if (!data.data) return [];

    return data.data
      .filter((item) => item.citingPaper?.title)
      .map((item, i) => {
        const p = item.citingPaper as {
          paperId?: string;
          title: string;
          year?: number;
          authors?: Array<{ name: string }>;
          venue?: string;
          externalIds?: Record<string, string>;
        };
        const rawContexts = (item.contexts ?? [])
          .map((s) => s.trim())
          .filter((s) => s.length > 20);
        const seen = new Set<string>();
        const contexts: string[] = [];
        for (const ctx of rawContexts) {
          const key = ctx.slice(0, 80);
          if (!seen.has(key)) { seen.add(key); contexts.push(ctx); }
          if (contexts.length >= 3) break;
        }
        return {
          paperId: p.paperId ?? `cite-${i}`,
          arxivId: getArxivIdFromS2(p),
          title: p.title,
          year: p.year ?? 0,
          authors: parseS2Authors(p.authors ?? []),
          venue: p.venue ?? 'Unknown',
          intents: item.intents ?? [],
          contexts,
        };
      });
  } catch {
    return [];
  }
}

// ─── graph data builder ───────────────────────────────────────────────────────

async function buildGraphForPaper(arxivId: string): Promise<GraphResponse> {
  // fetch all in parallel
  const [arxivMeta, references, citations] = await Promise.all([
    fetchArxivMeta(arxivId),
    fetchS2References(arxivId),
    fetchS2Citations(arxivId),
  ]);

  if (!arxivMeta) {
    return {
      paper: {
        paperId: `arxiv-${arxivId}`,
        arxivId,
        title: `arXiv:${arxivId}`,
        abstract: 'Could not fetch paper metadata. Verify the arXiv ID.',
        authors: [],
        year: new Date().getFullYear(),
        venue: 'arXiv',
      },
      references,
      citations,
      error: 'Could not fetch paper metadata from arXiv. The ID may be incorrect.',
    };
  }

  return {
    paper: {
      paperId: `arxiv-${arxivId}`,
      arxivId,
      ...arxivMeta,
    },
    references,
    citations,
  };
}

// ─── app ─────────────────────────────────────────────────────────────────────

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }))
  .get('/health', (c) => c.json({ status: 'ok' }))

  // dynamic graph endpoint — /api/graph/:arxivId
  .get('/graph/:arxivId', async (c) => {
    const arxivId = c.req.param('arxivId').trim();

    // validate arXiv ID format: YYMM.NNNNN or old-style like cs/0604NNNN
    if (!arxivId || !/^[\w./-]+$/.test(arxivId)) {
      return c.json({ error: 'Invalid arXiv ID' }, 400);
    }

    // check cache
    const cached = cache.get(arxivId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return c.json(cached.data);
    }

    const data = await buildGraphForPaper(arxivId);

    // cache it
    cache.set(arxivId, { data, fetchedAt: Date.now() });

    return c.json(data);
  });

export type AppType = typeof app;
export default app;
