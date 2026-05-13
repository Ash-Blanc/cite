import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  FormEvent,
} from "react";
import {
  GraphCanvas,
  ForceSimulation,
  ViewportState,
} from "@supermemory/memory-graph";
import type { GraphNode, GraphEdge, GraphThemeColors } from "@supermemory/memory-graph";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";

// ─── types ────────────────────────────────────────────────────────────────────

interface PaperNode {
  paperId: string;
  arxivId?: string;
  title: string;
  year: number;
  authors: string[];
  venue: string;
  abstract?: string;
  contexts?: string[];
  intents?: string[];
}

interface GraphResponse {
  paper: PaperNode & { abstract: string };
  references: PaperNode[];
  citations: PaperNode[];
  error?: string;
}

interface PaperMeta {
  paperId: string;
  arxivId?: string;
  title: string;
  year: number;
  authors: string[];
  venue: string;
  note: string;
  relation: "center" | "reference" | "citing";
  contexts?: string[];
  intents?: string[];
}

// ─── theme ────────────────────────────────────────────────────────────────────

const COLORS: GraphThemeColors = {
  bg: "#0a0a0f",
  docFill: "#111118",
  docStroke: "#6366f1",
  docInnerFill: "#1a1a2e",
  memFill: "#1e1e2e",
  memFillHover: "#2d2d4e",
  memStrokeDefault: "#4c4c6e",
  accent: "#6366f1",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#475569",
  edgeDerives: "#fb923c",
  edgeUpdates: "#6366f1",
  edgeExtends: "#34d399",
  memBorderForgotten: "#ef4444",
  memBorderExpiring: "#f59e0b",
  memBorderRecent: "#34d399",
  glowColor: "#6366f1",
  iconColor: "#6366f1",
  popoverBg: "#111118",
  popoverBorder: "#1e1e2e",
  popoverTextPrimary: "#e2e8f0",
  popoverTextSecondary: "#94a3b8",
  popoverTextMuted: "#475569",
  controlBg: "#111118",
  controlBorder: "#1e1e2e",
};

// ─── build nodes + edges ──────────────────────────────────────────────────────

function buildGraph(
  centerId: string,
  papers: PaperMeta[],
  filter: "all" | "references" | "citing"
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const cx = 0;
  const cy = 0;
  const refRadius = 520;
  const citeRadius = 300;

  const visible = papers.filter((p) => {
    if (filter === "all") return true;
    if (filter === "references") return p.relation === "center" || p.relation === "reference";
    if (filter === "citing") return p.relation === "center" || p.relation === "citing";
    return true;
  });

  const refs = visible.filter((p) => p.relation === "reference");
  const cites = visible.filter((p) => p.relation === "citing");

  const nodes: GraphNode[] = visible.map((p) => {
    let x = cx;
    let y = cy;

    if (p.relation === "reference") {
      const idx = refs.indexOf(p);
      const angle = (2 * Math.PI * idx) / refs.length - Math.PI / 2;
      x = cx + refRadius * Math.cos(angle) + (Math.random() - 0.5) * 60;
      y = cy + refRadius * Math.sin(angle) + (Math.random() - 0.5) * 60;
    } else if (p.relation === "citing") {
      const idx = cites.indexOf(p);
      const angle = (2 * Math.PI * idx) / cites.length - Math.PI / 2;
      x = cx + citeRadius * Math.cos(angle) + (Math.random() - 0.5) * 40;
      y = cy + citeRadius * Math.sin(angle) + (Math.random() - 0.5) * 40;
    }

    const borderColor =
      p.relation === "center" ? "#6366f1" :
      p.relation === "reference" ? "#fb923c" :
      "#34d399";

    const size =
      p.relation === "center" ? 72 :
      p.relation === "citing" ? 52 :
      46;

    return {
      id: p.paperId,
      type: "document" as const,
      x,
      y,
      size,
      borderColor,
      isHovered: false,
      isDragging: false,
      vx: 0,
      vy: 0,
      fx: p.relation === "center" ? cx : null,
      fy: p.relation === "center" ? cy : null,
      data: {
        id: p.paperId,
        title: p.title,
        summary: p.note,
        type: p.relation === "center" ? "paper" : p.relation,
        createdAt: `${p.year}-01-01T00:00:00Z`,
        updatedAt: new Date().toISOString(),
        memories: [],
      },
    };
  });

  const edges: GraphEdge[] = [];

  if (filter !== "citing") {
    refs.forEach((ref) => {
      edges.push({
        id: `edge-${ref.paperId}-to-center`,
        source: ref.paperId,
        target: centerId,
        edgeType: "derives",
        visualProps: { opacity: 0.75, thickness: 1.5 },
      });
    });
  }

  if (filter !== "references") {
    cites.forEach((cite) => {
      edges.push({
        id: `edge-center-to-${cite.paperId}`,
        source: centerId,
        target: cite.paperId,
        edgeType: "extends",
        visualProps: { opacity: 0.75, thickness: 1.5 },
      });
    });
  }

  return { nodes, edges };
}

// ─── root component ───────────────────────────────────────────────────────────

export default function Index() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const arxivId = params.get("id")?.trim() ?? "";

  if (!arxivId) return <LandingPage />;
  return <GraphView arxivId={arxivId} />;
}

// ─── landing page ─────────────────────────────────────────────────────────────

const EXAMPLES = [
  { id: "1706.03762", label: "Attention Is All You Need" },
  { id: "1810.04805", label: "BERT" },
  { id: "2005.14165", label: "GPT-3" },
  { id: "2503.15798", label: "MoLE (MoE with Lookup Tables)" },
  { id: "2302.13971", label: "LLaMA" },
];

function LandingPage() {
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!id) { setError("Enter an arXiv ID"); return; }
    // strip full URL prefix if pasted
    const cleaned = id
      .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "")
      .replace(/v\d+$/, "")
      .replace(/\.pdf$/, "")
      .trim();
    if (!cleaned) { setError("Invalid arXiv ID"); return; }
    setError("");
    navigate(`/?id=${encodeURIComponent(cleaned)}`);
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#0a0a0f",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* header */}
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "11px",
            color: "#6366f1",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}
        >
          Citation Graph Explorer
        </div>
        <div
          style={{
            fontSize: "36px",
            fontWeight: 700,
            color: "#e2e8f0",
            lineHeight: 1.2,
            marginBottom: "12px",
          }}
        >
          Explore any arXiv paper
        </div>
        <div
          style={{
            fontSize: "15px",
            color: "#64748b",
            maxWidth: "480px",
          }}
        >
          Enter an arXiv ID to visualize its citation network — what it cites
          and what cites it.
        </div>
      </div>

      {/* input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "8px",
          width: "100%",
          maxWidth: "480px",
          padding: "0 16px",
          boxSizing: "border-box",
        }}
      >
        <input
          autoFocus
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(""); }}
          placeholder="e.g. 1706.03762 or arxiv.org/abs/1706.03762"
          style={{
            flex: 1,
            background: "#111118",
            border: `1px solid ${error ? "#ef4444" : "#1e1e2e"}`,
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "16px",
            color: "#e2e8f0",
            fontFamily: "'IBM Plex Mono', monospace",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            background: "#6366f1",
            border: "none",
            borderRadius: "8px",
            padding: "12px 20px",
            fontSize: "14px",
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Explore →
        </button>
      </form>

      {error && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "#ef4444",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {error}
        </div>
      )}

      {/* examples */}
      <div
        style={{
          marginTop: "32px",
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          justifyContent: "center",
          maxWidth: "560px",
          padding: "0 16px",
        }}
      >
        <div
          style={{
            width: "100%",
            textAlign: "center",
            fontSize: "11px",
            color: "#475569",
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: "4px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Try an example
        </div>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            onClick={() => navigate(`/?id=${ex.id}`)}
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "11px",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "'IBM Plex Mono', monospace",
              transition: "border-color 0.15s",
              touchAction: "manipulation",
            }}
            onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.borderColor = "#6366f1")}
            onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.borderColor = "#1e1e2e")}
          >
            {ex.id} · {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── graph view ───────────────────────────────────────────────────────────────

function GraphView({ arxivId }: { arxivId: string }) {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "references" | "citing">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dims, setDims] = useState({
    w: window.innerWidth,
    h: window.innerHeight - 88,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<ViewportState | null>(null);
  const simRef = useRef<ForceSimulation | null>(null);

  // fetch graph data
  const { data, isLoading, isError, error, refetch } = useQuery<GraphResponse>({
    queryKey: ["graph", arxivId],
    queryFn: async () => {
      const res = await fetch(`/api/graph/${encodeURIComponent(arxivId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // build flat PaperMeta list from API response
  const papers = useMemo<PaperMeta[]>(() => {
    if (!data) return [];
    const centerId = data.paper.paperId;
    const result: PaperMeta[] = [
      {
        paperId: centerId,
        arxivId: data.paper.arxivId,
        title: data.paper.title,
        year: data.paper.year,
        authors: data.paper.authors,
        venue: data.paper.venue,
        note: data.paper.abstract,
        relation: "center",
      },
      ...data.references.map((r) => ({
        paperId: r.paperId,
        arxivId: r.arxivId,
        title: r.title,
        year: r.year,
        authors: r.authors,
        venue: r.venue,
        note: `${r.venue} (${r.year || "?"})`,
        relation: "reference" as const,
        contexts: r.contexts,
        intents: r.intents,
      })),
      ...data.citations.map((c) => ({
        paperId: c.paperId,
        arxivId: c.arxivId,
        title: c.title,
        year: c.year,
        authors: c.authors,
        venue: c.venue,
        note: `${c.venue} (${c.year || "?"})`,
        relation: "citing" as const,
        contexts: c.contexts,
        intents: c.intents,
      })),
    ];
    return result;
  }, [data]);

  const paperMap = useMemo(
    () => new Map(papers.map((p) => [p.paperId, p])),
    [papers]
  );

  const centerId = data?.paper.paperId ?? "";

  const { nodes: baseNodes, edges } = useMemo(
    () => (centerId ? buildGraph(centerId, papers, filter) : { nodes: [], edges: [] }),
    [centerId, papers, filter]
  );

  const nodes = useMemo(
    () => baseNodes.map((n) => ({ ...n, isHovered: n.id === hoveredId })),
    [baseNodes, hoveredId]
  );

  // init/restart simulation when graph changes
  useEffect(() => {
    if (!nodes.length) return;
    if (!simRef.current) simRef.current = new ForceSimulation();
    simRef.current.init(nodes, edges);

    const t = setTimeout(() => {
      if (viewportRef.current) {
        viewportRef.current.fitToNodes(nodes, dims.w, dims.h);
        setTimeout(() => {
          if (viewportRef.current) {
            viewportRef.current.zoomTo(
              viewportRef.current.zoom * 0.82,
              dims.w / 2,
              dims.h / 2
            );
          }
        }, 200);
      }
    }, 1600);

    return () => clearTimeout(t);
  }, [filter, centerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // window resize
  useEffect(() => {
    const onResize = () =>
      setDims({ w: window.innerWidth, h: window.innerHeight - 88 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleNodeClick = useCallback((id: string | null) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // ── touch tap detection (node select on tablet/phone) ─────────────────────
  // The library handles pan+pinch-zoom natively. We add tap-to-select on top.
  const touchStartRef = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { touchStartRef.current = null; return; }
      const t = e.touches[0]!;
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      if (Math.hypot(dx, dy) > 8) touchStartRef.current.moved = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;
      const elapsed = Date.now() - start.time;
      if (!start.moved && elapsed < 350) {
        // it's a tap — hit test nodes
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = canvas.getBoundingClientRect();
        const sx = start.x - rect.left;
        const sy = start.y - rect.top;
        const { x: wx, y: wy } = viewport.screenToWorld(sx, sy);

        // find the node closest to tap within its hit radius
        let hitId: string | null = null;
        let best = Infinity;
        for (const node of nodes) {
          const dist = Math.hypot(node.x - wx, node.y - wy);
          const radius = (node.size ?? 40) * 1.1; // generous tap area
          if (dist < radius && dist < best) {
            best = dist;
            hitId = node.id;
          }
        }
        handleNodeClick(hitId);
      }
      touchStartRef.current = null;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [nodes, handleNodeClick]); // re-bind when nodes change

  const selectedPaper = selectedId ? paperMap.get(selectedId) ?? null : null;

  // ── loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <FullscreenMessage>
        <LoadingSpinner />
        <div
          style={{
            marginTop: "16px",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "13px",
            color: "#64748b",
          }}
        >
          Fetching citation data for arXiv:{arxivId}…
        </div>
      </FullscreenMessage>
    );
  }

  // ── error state ────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <FullscreenMessage>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "13px",
            color: "#ef4444",
            marginBottom: "12px",
          }}
        >
          {(error as Error)?.message ?? "Failed to load paper data"}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => refetch()}
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              borderRadius: "6px",
              padding: "8px 16px",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            Retry
          </button>
          <button
            onClick={() => navigate("/")}
            style={{
              background: "#6366f1",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ← Back
          </button>
        </div>
      </FullscreenMessage>
    );
  }

  const refCount = data.references.length;
  const citeCount = data.citations.length;
  const totalCount = 1 + refCount + citeCount;

  // short title for header
  const shortTitle =
    data.paper.title.length > 52
      ? data.paper.title.slice(0, 52) + "…"
      : data.paper.title;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#0a0a0f",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ── top bar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          flexShrink: 0,
          background: "#0d0d15",
          minHeight: "56px",
          boxSizing: "border-box",
        }}
      >
        {/* back + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => navigate("/")}
            title="Search another paper"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              borderRadius: "6px",
              padding: "4px 10px",
              cursor: "pointer",
              color: "#94a3b8",
              fontSize: "13px",
              fontFamily: "'IBM Plex Mono', monospace",
              flexShrink: 0,
              minWidth: "44px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "manipulation",
            }}
          >
            ←
          </button>
          <div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "10px",
                color: "#6366f1",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              Citation Graph · arXiv:{arxivId}
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "13px",
                fontWeight: 600,
                color: "#e2e8f0",
              }}
            >
              {shortTitle}
            </div>
          </div>
          {window.innerWidth >= 520 && (
            <div
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
                borderRadius: "6px",
                padding: "3px 10px",
                fontSize: "11px",
                color: "#94a3b8",
                fontFamily: "'IBM Plex Mono', monospace",
                flexShrink: 0,
              }}
            >
              {data.paper.venue} · {data.paper.year}
              {data.paper.authors.length > 0
                ? ` · ${data.paper.authors[0]}${data.paper.authors.length > 1 ? " et al." : ""}`
                : ""}
            </div>
          )}
        </div>

        {/* filter pills */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <FilterPill
            value={refCount}
            label="cites →"
            color="#fb923c"
            active={filter === "references"}
            onClick={() => setFilter(filter === "references" ? "all" : "references")}
          />
          <FilterPill
            value={citeCount}
            label="← cited by"
            color="#34d399"
            active={filter === "citing"}
            onClick={() => setFilter(filter === "citing" ? "all" : "citing")}
          />
          <FilterPill
            value={totalCount}
            label="all"
            color="#6366f1"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
        </div>
      </div>

      {/* ── legend ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "6px 20px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          gap: "20px",
          alignItems: "center",
          flexShrink: 0,
          background: "#0d0d15",
          height: "32px",
          boxSizing: "border-box",
        }}
      >
        <LegendItem color="#6366f1" label="This paper" />
        <LegendArrow color="#fb923c" label="cites (reference → paper)" />
        <LegendArrow color="#34d399" label="cited by (paper → citing)" />
        {data.error && (
          <div
            style={{
              fontSize: "10px",
              color: "#f59e0b",
              fontFamily: "'IBM Plex Mono', monospace",
              background: "#f59e0b14",
              border: "1px solid #f59e0b40",
              borderRadius: "4px",
              padding: "2px 8px",
            }}
          >
            ⚠ {data.error}
          </div>
        )}
        <div
          style={{
            marginLeft: "auto",
            fontSize: "10px",
            color: "#475569",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          Tap/click node · Drag · Pinch to zoom
        </div>
      </div>

      {/* ── graph + side panel ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        {/* touch-action: none prevents browser pan/scroll interference on canvas */}
        <div style={{ flex: 1, position: "relative", touchAction: "none" }}>
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            width={selectedId ? dims.w - 360 : dims.w}
            height={dims.h}
            colors={COLORS}
            highlightDocumentIds={[centerId]}
            selectedNodeId={selectedId}
            onNodeHover={setHoveredId}
            onNodeClick={handleNodeClick}
            onNodeDragStart={() => {}}
            onNodeDragEnd={() => {}}
            canvasRef={canvasRef}
            simulation={simRef.current ?? undefined}
            viewportRef={viewportRef}
            variant="console"
          />
        </div>

        {selectedPaper && (
          <SidePanel
            paper={selectedPaper}
            centerId={centerId}
            centerTitle={data.paper.title}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── side panel ───────────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  background: "#6366f1",
  methodology: "#fb923c",
  result: "#34d399",
  extends: "#34d399",
  uses: "#60a5fa",
};

function IntentBadge({ intent }: { intent: string }) {
  const color = INTENT_COLORS[intent.toLowerCase()] ?? "#64748b";
  return (
    <span
      style={{
        display: "inline-block",
        background: `${color}20`,
        border: `1px solid ${color}60`,
        borderRadius: "3px",
        padding: "1px 6px",
        fontSize: "9px",
        color,
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        marginRight: "4px",
      }}
    >
      {intent}
    </span>
  );
}

function SidePanel({
  paper,
  centerId,
  centerTitle,
  onClose,
}: {
  paper: PaperMeta;
  centerId: string;
  centerTitle: string;
  onClose: () => void;
}) {
  const isSmall = window.innerWidth < 600;

  const borderColor =
    paper.relation === "center" ? "#6366f1" :
    paper.relation === "reference" ? "#fb923c" :
    "#34d399";

  const relationLabel =
    paper.relation === "center" ? "This paper" :
    paper.relation === "reference" ? "Cited by this paper →" :
    "← Cites this paper";

  const shortCenter = centerTitle.length > 24 ? centerTitle.slice(0, 24) + "…" : centerTitle;
  const shortTitle = paper.title.length > 24 ? paper.title.slice(0, 24) + "…" : paper.title;

  // On small screens: bottom sheet overlay instead of right-side panel
  const panelStyle: React.CSSProperties = isSmall
    ? {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "60vh",
        background: "#0d0d15",
        borderTop: "1px solid #1e1e2e",
        borderRadius: "16px 16px 0 0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Inter', sans-serif",
        zIndex: 100,
        boxShadow: "0 -4px 40px rgba(0,0,0,0.6)",
      }
    : {
        width: "360px",
        flexShrink: 0,
        background: "#0d0d15",
        borderLeft: "1px solid #1e1e2e",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Inter', sans-serif",
      };

  return (
    <div style={panelStyle}>
      {/* panel header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "inline-block",
              background: `${borderColor}18`,
              border: `1px solid ${borderColor}60`,
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "10px",
              color: borderColor,
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}
          >
            {relationLabel}
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#e2e8f0",
              lineHeight: 1.4,
            }}
          >
            {paper.title}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            padding: "2px",
            flexShrink: 0,
            minWidth: "44px",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "manipulation",
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <MetaRow label="Year" value={paper.year ? String(paper.year) : "—"} />
        <MetaRow label="Venue" value={paper.venue || "—"} />
        <MetaRow label="Authors" value={paper.authors.join(", ") || "—"} />

        {/* abstract / note for center paper */}
        {paper.relation === "center" && paper.note && (
          <>
            <div style={{ height: "1px", background: "#1e1e2e", margin: "16px 0" }} />
            <div
              style={{
                fontSize: "11px",
                color: "#94a3b8",
                fontFamily: "'IBM Plex Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "8px",
              }}
            >
              Abstract
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#cbd5e1",
                lineHeight: 1.6,
                padding: "10px 12px",
                background: "#111118",
                border: "1px solid #1e1e2e",
                borderRadius: "6px",
                maxHeight: "200px",
                overflowY: "auto",
              }}
            >
              {paper.note}
            </div>
          </>
        )}

        {/* citation context */}
        {paper.relation !== "center" && (
          <>
            <div style={{ height: "1px", background: "#1e1e2e", margin: "16px 0" }} />
            {/* direction flow */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                background: "#111118",
                border: "1px solid #1e1e2e",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "'IBM Plex Mono', monospace",
                flexWrap: "wrap",
                marginBottom: "12px",
              }}
            >
              {paper.relation === "reference" ? (
                <>
                  <span style={{ color: "#6366f1" }}>{shortCenter}</span>
                  <span style={{ color: "#fb923c", fontSize: "14px" }}>→</span>
                  <span style={{ color: "#fb923c" }}>cites</span>
                  <span style={{ color: "#fb923c", fontSize: "14px" }}>→</span>
                  <span style={{ color: "#fb923c" }}>{shortTitle}</span>
                </>
              ) : (
                <>
                  <span style={{ color: "#34d399" }}>{shortTitle}</span>
                  <span style={{ color: "#34d399", fontSize: "14px" }}>→</span>
                  <span style={{ color: "#34d399" }}>cites</span>
                  <span style={{ color: "#34d399", fontSize: "14px" }}>→</span>
                  <span style={{ color: "#6366f1" }}>{shortCenter}</span>
                </>
              )}
            </div>

            {/* intents */}
            {paper.intents && paper.intents.length > 0 && (
              <div style={{ marginBottom: "10px" }}>
                <span style={{ fontSize: "10px", color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginRight: "6px" }}>
                  cited as:
                </span>
                {paper.intents.map((intent) => (
                  <IntentBadge key={intent} intent={intent} />
                ))}
              </div>
            )}

            {/* citation context snippets */}
            {paper.contexts && paper.contexts.length > 0 ? (
              <>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#94a3b8",
                    fontFamily: "'IBM Plex Mono', monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: "8px",
                  }}
                >
                  {paper.relation === "reference"
                    ? "How this paper is cited"
                    : "How it cites the paper"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {paper.contexts.map((ctx, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "10px 12px",
                        background: "#111118",
                        border: `1px solid ${paper.relation === "reference" ? "#fb923c30" : "#34d39930"}`,
                        borderLeft: `3px solid ${paper.relation === "reference" ? "#fb923c" : "#34d399"}`,
                        borderRadius: "0 6px 6px 0",
                        fontSize: "11px",
                        color: "#cbd5e1",
                        lineHeight: 1.6,
                        fontStyle: "italic",
                      }}
                    >
                      "…{ctx.length > 240 ? ctx.slice(0, 240) + "…" : ctx}…"
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: "11px",
                  color: "#475569",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontStyle: "italic",
                  padding: "8px 0",
                }}
              >
                No citation context available for this paper.
              </div>
            )}
          </>
        )}

        {/* arXiv link */}
        {paper.arxivId && (
          <>
            <div style={{ height: "1px", background: "#1e1e2e", margin: "16px 0" }} />
            <a
              href={`https://arxiv.org/abs/${paper.arxivId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px",
                background: "#6366f118",
                border: "1px solid #6366f140",
                borderRadius: "6px",
                color: "#818cf8",
                fontSize: "12px",
                fontFamily: "'IBM Plex Mono', monospace",
                textDecoration: "none",
              }}
            >
              arXiv:{paper.arxivId} ↗
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function FullscreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#0a0a0f",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        gap: "0",
      }}
    >
      {children}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div
      style={{
        width: "32px",
        height: "32px",
        border: "2px solid #1e1e2e",
        borderTop: "2px solid #6366f1",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "6px",
        fontSize: "12px",
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          color: "#475569",
          fontFamily: "'IBM Plex Mono', monospace",
          minWidth: "56px",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ color: "#94a3b8" }}>{value}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div
        style={{
          width: "10px",
          height: "10px",
          background: `${color}30`,
          border: `1.5px solid ${color}`,
          borderRadius: "2px",
        }}
      />
      <span
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function LegendArrow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <svg width="24" height="10" viewBox="0 0 24 10">
        <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth="1.5" />
        <polygon points="18,2 24,5 18,8" fill={color} />
      </svg>
      <span
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function FilterPill({
  value,
  label,
  color,
  active,
  onClick,
}: {
  value: number;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}18` : "#111118",
        border: `1px solid ${active ? color : "#1e1e2e"}`,
        borderRadius: "6px",
        padding: "4px 12px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        transition: "all 0.15s",
        minHeight: "44px",
        touchAction: "manipulation",
      }}
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "14px",
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </span>
    </button>
  );
}
