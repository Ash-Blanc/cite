# MoLE Citation Graph — Design

## Vibe
Dark, terminal-meets-research-lab aesthetic. Dense data visualization with clean information hierarchy. Think: academic paper + hacker console.

## Colors
- Background: `#0a0a0f` (near-black with blue tint)
- Surface: `#111118`
- Border: `#1e1e2e`
- Accent: `#6366f1` (indigo)
- Accent alt: `#a78bfa` (violet)
- Text primary: `#e2e8f0`
- Text secondary: `#94a3b8`
- Text muted: `#475569`
- Cited-by color: `#34d399` (emerald — papers that cite MoLE)
- Cites color: `#fb923c` (orange — papers MoLE cites)
- Center node: `#6366f1` (indigo — the MoLE paper itself)

## Typography
- Font: `IBM Plex Mono` for headings/labels (monospace, research feel)
- Body: `Inter`
- Sizes: tight hierarchy, 11px labels, 13px body, 16px headings

## Layout
- Full-screen canvas graph takes up ~80% of viewport
- Top bar: paper title + metadata
- Left sidebar: stats + filter controls
- Node popover: paper details on click

## Graph Colors (passed to MemoryGraph)
- docFill: `#111118`
- docStroke: `#6366f1`
- accent: `#6366f1`
- bg: `#0a0a0f`
- textPrimary: `#e2e8f0`
- textSecondary: `#94a3b8`
