// The only module that knows the graph library (Cytoscape.js). Swap the library by rewriting this file.
import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";

import type { Graph } from "../api/types";
import { shorten } from "../lib/shorten";
import type { Theme } from "../lib/theme";

export type GraphSelection = { kind: "node"; address: string } | { kind: "edge"; source: string; target: string } | null;

export interface RenderedCounts {
  nodes: number;
  edges: number;
  layoutMs: number;
}

interface Props {
  graph: Graph;
  selection: GraphSelection;
  onNodeClick: (address: string) => void;
  onEdgeClick: (source: string, target: string) => void;
  /** Click on empty canvas. */
  onBackgroundClick?: () => void;
  onRendered?: (counts: RenderedCounts) => void;
  theme?: Theme;
}

interface Tooltip {
  x: number;
  y: number;
  text: string;
}

/**
 * Read-only inspector used by the end-to-end tests to find elements on the canvas. Only attached when the
 * build sets VITE_E2E_INSPECTOR=true (the e2e image); production builds leave it out entirely.
 */
export interface GraphInspector {
  nodeCount: () => number;
  edgeCount: () => number;
  nodeIds: () => string[];
  edgeIds: () => string[];
  degree: (id: string) => number;
  renderedNodePosition: (id: string) => { x: number; y: number } | null;
  renderedEdgeMidpoint: (id: string) => { x: number; y: number } | null;
  /** Point at parameter t (0 = source end, 1 = target end) along the drawn edge. */
  renderedEdgePoint: (id: string, t: number) => { x: number; y: number } | null;
  zoom: () => number;
  pan: () => { x: number; y: number };
  /** False while a zoom/pan animation (buttons, reset) runs or a wheel zoom step is still pending. */
  viewportIdle: () => boolean;
  /** Fires the same tap event a click would, for elements buried under others. */
  tap: (id: string) => boolean;
  renderedAt: number;
  layoutMs: number;
}

declare global {
  interface Window {
    __bitflowGraph?: GraphInspector;
  }
}

/** Zoom change per mouse-wheel notch (deltaY = 100 px): 0.2 = 20 %. Adjust here. */
export const WHEEL_ZOOM_STEP = 0.2;
const WHEEL_NOTCH_PX = 100;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/** Wheel delta in "notches", normalised across pixel, line and page delta modes. */
function wheelNotches(e: WheelEvent): number {
  const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
  return Math.max(-5, Math.min(5, px / WHEEL_NOTCH_PX)); // cap one event to 5 notches
}

// Build-time constant: Vite replaces it, so production bundles drop the inspector code.
const E2E_INSPECTOR = import.meta.env.VITE_E2E_INSPECTOR === "true";

export function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

type GraphElement = cytoscape.NodeSingular | cytoscape.EdgeSingular;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Uniform styling: every node the same size, every edge the same width. Colour changes only show interaction
// (hover / selection), never value or significance.
const PALETTES = {
  light: {
    node: "#64748b", ring: "#ffffff", edge: "#94a3b8",
    accent: "#4f46e5", accentSoft: "#818cf8", accentStrong: "#4338ca",
    nodeDim: 0.16, edgeBase: 0.55, edgeDim: 0.06,
  },
  dark: {
    node: "#94a3b8", ring: "#0f172a", edge: "#64748b",
    accent: "#818cf8", accentSoft: "#a5b4fc", accentStrong: "#c7d2fe",
    nodeDim: 0.2, edgeBase: 0.6, edgeDim: 0.08,
  },
} as const;

const TRANSITION_MS = 180;

function graphStyle(theme: Theme, animate: boolean): cytoscape.StylesheetJson {
  const c = PALETTES[theme];
  // Transitions live on the base selectors so state changes ease both in and out.
  const nodeTransition = animate
    ? { "transition-property": "opacity, background-color, border-color, underlay-color, underlay-opacity, underlay-padding",
        "transition-duration": TRANSITION_MS, "transition-timing-function": "ease-in-out" as const }
    : {};
  const edgeTransition = animate
    ? { "transition-property": "opacity, line-color, target-arrow-color",
        "transition-duration": TRANSITION_MS, "transition-timing-function": "ease-in-out" as const }
    : {};
  return [
    // While panning/zooming a large graph, areas outside the cached bitmap stay transparent (CSS background shows).
    { selector: "core", style: { "outside-texture-bg-opacity": 0 } } as unknown as cytoscape.StylesheetJsonBlock,
    {
      selector: "node",
      style: {
        width: 10,
        height: 10,
        "background-color": c.node,
        "border-width": 1.5,
        "border-color": c.ring,
        // Soft halo so nodes read as raised discs.
        "underlay-color": c.node,
        "underlay-opacity": 0.14,
        "underlay-padding": 3,
        "underlay-shape": "ellipse",
        label: "",
        "overlay-opacity": 0,
        ...nodeTransition,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        opacity: c.edgeBase,
        "line-color": c.edge,
        "target-arrow-color": c.edge,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.6,
        // Straight is the cheapest edge with an arrowhead; edges with an opposite partner use bezier (below).
        "curve-style": "straight",
        "overlay-opacity": 0,
        ...edgeTransition,
      },
    },
    // A->B and B->A both exist: bezier draws them as two distinct curves.
    { selector: "edge.bidir", style: { "curve-style": "bezier", "control-point-step-size": 14 } },
    { selector: "node.dimmed", style: { opacity: c.nodeDim } },
    { selector: "edge.dimmed", style: { opacity: c.edgeDim } },
    { selector: "node.hl", style: { opacity: 1, "background-color": c.accentSoft, "underlay-color": c.accent, "underlay-opacity": 0.2 } },
    {
      selector: "edge.hl",
      style: {
        opacity: 0.95, "line-color": c.accent, "target-arrow-color": c.accent, "z-index": 10,
        "line-style": "dashed", "line-dash-pattern": [7, 3],
      },
    },
    { selector: "node.focus", style: { "background-color": c.accent, "underlay-opacity": 0.32, "underlay-padding": 5, "z-index": 20 } },
    { selector: "edge.focus", style: { width: 1.5, "z-index": 20 } },
    {
      selector: "node.selected",
      style: {
        "background-color": c.accentStrong, "border-width": 2, "underlay-color": c.accent,
        "underlay-opacity": 0.38, "underlay-padding": 6, "z-index": 30,
      },
    },
    {
      selector: "edge.selected",
      style: { width: 1.5, opacity: 1, "line-color": c.accentStrong, "target-arrow-color": c.accentStrong, "z-index": 30 },
    },
  ];
}

const SETTLE_MS = 700; // load animation: nodes ease into the final layout
const HOVER_GRACE_MS = 120; // keep a hover highlight briefly so gaps between elements don't flash the whole graph
const DASH_MAX_EDGES = 240; // moving dash only when few enough edges are highlighted
const GRID_PX = 24;

// Graphs above this many nodes get the fast layout path and cheaper rendering; smaller graphs keep the
// original full-quality layout.
const LARGE_GRAPH_NODES = 600;
const SMALL_MIN_DISTANCE = 30; // model units; nodes are 10 wide (13 with their ring)
const LARGE_MIN_DISTANCE = 14;
const LEAF_RING0 = 28; // first ring radius around a parent
const LEAF_GAP = 16; // spacing between leaves on a ring and between rings

/** Finished layouts per day, in memory, so returning to a day already viewed is instant. */
const layoutCache = new Map<string, Map<string, cytoscape.Position>>();
const layoutKey = (g: Graph) => `${g.day}|${g.nodes.length}|${g.edges.length}`;

function coseOptions(large: boolean, forcedNodes: number): cytoscape.LayoutOptions {
  // cose stops when its temperature cools down; a lower cooling factor means fewer iterations. Small graphs keep
  // the default cooling (0.99) and today's quality; the core of a large graph cools faster, more so when bigger.
  const coolingFactor = !large ? 0.99 : forcedNodes <= 1500 ? 0.95 : 0.9;
  return {
    name: "cose",
    animate: false,
    randomize: true,
    fit: false,
    // Strong repulsion and long ideal edges keep stars readable; gravity pulls the many small disconnected
    // components in around the main one instead of scattering them; cose packs components apart.
    nodeRepulsion: () => 9000,
    idealEdgeLength: () => 40,
    edgeElasticity: () => 80,
    gravity: 0.6,
    numIter: 1500,
    coolingFactor,
    componentSpacing: 30,
    nodeOverlap: 8,
  } as cytoscape.LayoutOptions;
}

/** Ring radii and how many leaves fit on each, for `count` leaves around one parent. */
function leafRings(count: number): [radius: number, capacity: number][] {
  const rings: [number, number][] = [];
  let radius = LEAF_RING0;
  for (let left = count; left > 0; radius += LEAF_GAP) {
    const capacity = Math.max(6, Math.floor((2 * Math.PI * radius) / LEAF_GAP));
    rings.push([radius, Math.min(capacity, left)]);
    left -= capacity;
  }
  return rings;
}

/**
 * Lays out the graph. Large graphs: only the "core" (nodes with more than one neighbour) is force-laid out;
 * leaves (nodes whose single neighbour has other neighbours) are placed on rings around their parent. Each
 * parent reserves room for its rings during the core layout, so clusters don't pile on top of each other.
 */
function runLayout(cy: cytoscape.Core, large: boolean): void {
  if (!large) {
    cy.layout(coseOptions(false, cy.nodes().length)).run();
    separateOverlaps(cy, SMALL_MIN_DISTANCE);
    return;
  }
  const leaves = cy.nodes().filter((n) => {
    const nb = n.neighborhood().nodes();
    return nb.length === 1 && nb[0].neighborhood().nodes().length > 1;
  });
  const children = new Map<string, cytoscape.NodeSingular[]>();
  leaves.forEach((leaf) => {
    const parent = leaf.neighborhood().nodes()[0].id();
    (children.get(parent) ?? children.set(parent, []).get(parent)!).push(leaf);
  });
  // Temporary layout-only size for parents (removed before anything is drawn; rendering stays uniform).
  cy.batch(() => children.forEach((kids, parentId) => {
    const rings = leafRings(kids.length);
    const size = 2 * rings[rings.length - 1][0] + 10;
    cy.getElementById(parentId).style({ width: size, height: size });
  }));
  const core = cy.elements().difference(leaves).difference(leaves.connectedEdges());
  const t0 = performance.now();
  core.layout(coseOptions(true, core.nodes().length)).run();
  performance.measure("bitflow:layout:cose", { start: t0, end: performance.now() });
  cy.batch(() => children.forEach((kids, parentId) => {
    const parent = cy.getElementById(parentId);
    parent.removeStyle("width height");
    const c = parent.position();
    let i = 0;
    for (const [radius, count] of leafRings(kids.length)) {
      for (let a = 0; a < count; a++, i++) {
        const angle = (2 * Math.PI * a) / count + radius; // offset per ring so rings don't line up
        kids[i].position({ x: c.x + radius * Math.cos(angle), y: c.y + radius * Math.sin(angle) });
      }
    }
  }));
  const t1 = performance.now();
  separateOverlaps(cy, LARGE_MIN_DISTANCE);
  performance.measure("bitflow:layout:separate", { start: t1, end: performance.now() });
}

/**
 * Pushes apart nodes closer than `minDistance` (a uniform-grid neighbour search, about linear in node count).
 * Force layouts put structurally equivalent nodes (e.g. two hubs sharing most neighbours) on the same spot.
 */
function separateOverlaps(cy: cytoscape.Core, minDistance: number, passes = 30): void {
  const nodes = cy.nodes().toArray();
  const pos = nodes.map((n) => ({ ...n.position() }));
  const cell = (v: number) => Math.floor(v / minDistance);
  for (let pass = 0; pass < passes; pass++) {
    const grid = new Map<string, number[]>();
    pos.forEach((p, i) => {
      const k = `${cell(p.x)},${cell(p.y)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      const gx = cell(pos[i].x);
      const gy = cell(pos[i].y);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (const j of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
            if (j <= i) continue;
            let dx = pos[j].x - pos[i].x;
            let dy = pos[j].y - pos[i].y;
            let d = Math.hypot(dx, dy);
            if (d >= minDistance) continue;
            if (d === 0) {
              // Deterministic direction for exactly coincident nodes.
              dx = Math.cos(i + j);
              dy = Math.sin(i + j);
              d = 1;
            }
            const push = (minDistance - d) / 2;
            pos[i].x -= (dx / d) * push;
            pos[i].y -= (dy / d) * push;
            pos[j].x += (dx / d) * push;
            pos[j].y += (dy / d) * push;
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  cy.batch(() => nodes.forEach((n, k) => n.position(pos[k])));
}

export function GraphView({ graph, selection, onNodeClick, onEdgeClick, onBackgroundClick, onRendered, theme = "light" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const handlers = useRef({ onNodeClick, onEdgeClick, onBackgroundClick, onRendered });
  handlers.current = { onNodeClick, onEdgeClick, onBackgroundClick, onRendered };
  const selectedRef = useRef<GraphElement | null>(null);
  const applyRef = useRef<() => void>(() => {});
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;
  const largeRef = useRef(false);
  const viewportAnimRef = useRef(0); // id of the running viewport animation, 0 when none
  const [layingOut, setLayingOut] = useState(() => !layoutCache.has(layoutKey(graph)));

  // (Re)build the graph whenever the data changes. A layout that isn't cached runs after the browser has painted
  // the "Laying out graph…" indicator (initial state), so the indicator is visible during the computation.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const cached = layoutCache.get(layoutKey(graph));
    const run = () => {
      if (cancelled) return;
      dispose = build(cached);
      setLayingOut(false);
    };
    let raf = 0;
    let timer = 0;
    if (cached) run();
    else raf = requestAnimationFrame(() => { timer = window.setTimeout(run, 0); }); // after the next paint
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      dispose?.();
    };
  }, [graph]);

  function build(cached: Map<string, cytoscape.Position> | undefined): () => void {
    const started = performance.now();
    const reduced = prefersReducedMotion();
    const large = graph.nodes.length > LARGE_GRAPH_NODES;
    largeRef.current = large;
    const pairs = new Set(graph.edges.map((e) => edgeId(e.source, e.target)));
    const tCreate = performance.now();
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((n) => ({ group: "nodes" as const, data: { id: n.address } })),
        ...graph.edges.map((e) => ({
          group: "edges" as const,
          data: { id: edgeId(e.source, e.target), source: e.source, target: e.target, txCount: e.tx_count },
          classes: pairs.has(edgeId(e.target, e.source)) ? "bidir" : "",
        })),
      ],
      // Element transitions are skipped on large graphs: easing thousands of elements per hover lags.
      style: graphStyle(themeRef.current, !reduced && !large),
      layout: { name: "preset" },
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      boxSelectionEnabled: false,
      autoungrabify: true,
      selectionType: "single",
      // Large graphs: while panning/zooming, Cytoscape moves a cached bitmap of the current frame (arrowheads
      // and curves included) instead of redrawing every edge.
      textureOnViewport: large,
    });
    performance.measure("bitflow:create", { start: tCreate, end: performance.now() });
    if (cached) {
      cy.batch(() => cy.nodes().forEach((n) => { n.position(cached.get(n.id()) ?? { x: 0, y: 0 }); }));
    } else {
      runLayout(cy, large);
      layoutCache.set(layoutKey(graph), new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }] as const)));
    }
    cy.fit(undefined, 24);
    cyRef.current = cy;
    const layoutMs = Math.round(performance.now() - started);
    performance.measure(cached ? "bitflow:layout-cached" : "bitflow:layout", { start: started, end: performance.now() });

    // Highlight: the hovered element (or else the selected one), its direct neighbourhood lit, the rest dimmed.
    let hovered: GraphElement | null = null;
    let dashEdges: cytoscape.EdgeCollection = cy.collection();
    let dashFrame = 0;
    let dashOffset = 0;
    const stopDash = () => {
      cancelAnimationFrame(dashFrame);
      dashFrame = 0;
      if (dashEdges.nonempty()) dashEdges.removeStyle("line-dash-offset");
    };
    const dashTick = () => {
      dashOffset -= 0.5; // negative offset moves the dashes from source to target
      dashEdges.style("line-dash-offset", dashOffset);
      dashFrame = requestAnimationFrame(dashTick);
    };
    // Only elements whose state changes are touched (diffs between the previous and the new sets), in one
    // batched update. Small graphs: hover and selection both light the neighbourhood and dim the rest. Large
    // graphs: hover only lights the neighbourhood; dimming follows the click selection, so a hover never restyles
    // thousands of elements.
    const neighbourhood = (el: GraphElement): cytoscape.Collection => el.isNode()
      ? (el as cytoscape.NodeSingular).closedNeighborhood()
      : (el as cytoscape.EdgeSingular).union((el as cytoscape.EdgeSingular).connectedNodes());
    let selectedPrev: GraphElement | null = null;
    let dimFocusPrev: GraphElement | null = null;
    let keepPrev: cytoscape.Collection = cy.collection(); // elements not dimmed
    let hlFocusPrev: GraphElement | null = null;
    let litPrev: cytoscape.Collection = cy.collection();
    const applyHighlight = () => {
      const selectedNow = selectedRef.current?.inside() ? selectedRef.current : null;
      const focus = hovered ?? selectedNow;
      const dimFocus = large ? selectedNow : focus;
      if (selectedNow === selectedPrev && dimFocus === dimFocusPrev && focus === hlFocusPrev) return;
      cy.batch(() => {
        if (selectedNow !== selectedPrev) {
          selectedPrev?.removeClass("selected");
          selectedNow?.addClass("selected");
          selectedPrev = selectedNow;
        }
        if (dimFocus !== dimFocusPrev) {
          if (!dimFocus) {
            cy.elements(".dimmed").removeClass("dimmed");
            keepPrev = cy.collection();
          } else {
            const keep = neighbourhood(dimFocus);
            if (!dimFocusPrev) cy.elements().difference(keep).addClass("dimmed");
            else {
              keepPrev.difference(keep).addClass("dimmed");
              keep.removeClass("dimmed");
            }
            keepPrev = keep;
          }
          dimFocusPrev = dimFocus;
        }
        if (focus !== hlFocusPrev) {
          stopDash();
          const lit = focus ? neighbourhood(focus) : cy.collection();
          hlFocusPrev?.removeClass("focus");
          litPrev.difference(lit).removeClass("hl");
          lit.addClass("hl");
          focus?.addClass("focus");
          hlFocusPrev = focus;
          litPrev = lit;
          dashEdges = lit.edges();
          if (!reduced && !large && dashEdges.nonempty() && dashEdges.length <= DASH_MAX_EDGES) {
            dashFrame = requestAnimationFrame(dashTick);
          }
        }
      });
    };
    applyRef.current = applyHighlight;

    const container = containerRef.current!;
    // Cursor and classes go on the wrapper, not on Cytoscape's container: Cytoscape watches its container's
    // attributes and runs a full resize/redraw on every change.
    const wrapEl = wrapRef.current!;
    let leaveTimer = 0;
    const enter = (el: GraphElement) => {
      window.clearTimeout(leaveTimer);
      hovered = el;
      applyHighlight();
      wrapEl.style.cursor = "pointer";
    };
    cy.on("mouseover", "node", (evt) => {
      const n = evt.target as cytoscape.NodeSingular;
      enter(n);
      const p = n.renderedPosition();
      setTooltip({ x: p.x, y: p.y, text: shorten(n.id()) });
    });
    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target as cytoscape.EdgeSingular;
      enter(e);
      const p = e.renderedMidpoint();
      const n = e.data("txCount") as number;
      setTooltip({
        x: p.x,
        y: p.y,
        text: `${shorten(e.data("source"))} → ${shorten(e.data("target"))} · ${n} transaction${n === 1 ? "" : "s"}`,
      });
    });
    cy.on("mouseout", "node, edge", () => {
      wrapEl.style.cursor = "";
      window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => {
        hovered = null;
        applyHighlight();
        setTooltip(null);
      }, HOVER_GRACE_MS);
    });
    // Dotted background texture follows pan and zoom so panning feels anchored (one element, cheap).
    const syncGrid = () => {
      let size = GRID_PX * cy.zoom();
      while (size < GRID_PX / 2) size *= 2;
      while (size >= GRID_PX * 2) size /= 2;
      const pan = cy.pan();
      wrapEl.style.setProperty("--grid-size", `${size}px`);
      wrapEl.style.setProperty("--grid-x", `${pan.x % size}px`);
      wrapEl.style.setProperty("--grid-y", `${pan.y % size}px`);
    };
    cy.on("viewport", () => {
      setTooltip(null);
      syncGrid();
    });
    cy.on("tap", "node", (evt) => handlers.current.onNodeClick(evt.target.id()));
    cy.on("tap", "edge", (evt) => handlers.current.onEdgeClick(evt.target.data("source"), evt.target.data("target")));
    cy.on("tap", (evt) => {
      if (evt.target === cy) handlers.current.onBackgroundClick?.();
    });

    // Panels opening, closing or collapsing resize the canvas. Keep every node where it is on screen (no zoom or
    // pan jump): only compensate for the canvas's own left edge moving. Then redraw synchronously, because
    // resizing a canvas clears it and Cytoscape would otherwise paint one blank frame before its next redraw.
    let box = container.getBoundingClientRect();
    // cy.renderer() exists at runtime but is not in Cytoscape's type definitions.
    const renderNow = () =>
      (cy as unknown as { renderer?: () => { render?: () => void } }).renderer?.()?.render?.();
    const resizeObserver = new ResizeObserver(() => {
      const next = container.getBoundingClientRect();
      if (next.width === box.width && next.height === box.height && next.left === box.left) return;
      const dx = box.left - next.left;
      box = next;
      cy.resize();
      if (dx) cy.panBy({ x: dx, y: 0 });
      renderNow();
    });
    resizeObserver.observe(container);

    // Wheel zoom: a fixed step per notch, centred on the mouse. Captured on the wrapper before Cytoscape's
    // own (much slower) wheel handler, which is stopped; pinch zoom on touch screens stays Cytoscape's.
    const wrap = wrapRef.current!;
    // Wheel events are coalesced into one zoom per frame (a fast wheel or trackpad can fire many per frame).
    let wheelNotchesPending = 0;
    let wheelAt = { x: 0, y: 0 };
    let wheelFrame = 0;
    let wheelIdle = 0;
    type RendererInternals = { data?: { wheelZooming?: boolean }; redrawHint?: (k: string, v: boolean) => void; redraw?: () => void };
    const renderer = (cy as unknown as { renderer?: () => RendererInternals }).renderer?.();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current!.getBoundingClientRect();
      wheelNotchesPending += wheelNotches(e);
      wheelAt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const notches = Math.max(-5, Math.min(5, wheelNotchesPending));
        wheelNotchesPending = 0;
        if (large && renderer?.data) {
          // Large graphs: zoom the cached bitmap while the wheel moves, redraw once it stops (as Cytoscape does
          // for its own wheel handling). Renderer internals are not in Cytoscape's typed API, hence the guards.
          renderer.data.wheelZooming = true;
          window.clearTimeout(wheelIdle);
          wheelIdle = window.setTimeout(() => {
            if (renderer.data) renderer.data.wheelZooming = false;
            renderer.redrawHint?.("eles", true);
            renderer.redraw?.();
          }, 150);
        }
        const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cy.zoom() * (1 + WHEEL_ZOOM_STEP) ** -notches));
        cy.zoom({ level, renderedPosition: wheelAt });
      });
    };
    wrap.addEventListener("wheel", onWheel, { capture: true, passive: false });

    syncGrid();

    // Load animation: nodes ease from a contracted start into the (unchanged) final layout and the canvas fades
    // in. The viewport was already fitted to the final positions, so the end state is identical to no animation.
    // The test inspector and onRendered are only published once the layout has settled.
    let settled = false;
    let settleLayout: cytoscape.Layouts | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      publish();
    };
    const animateSettle = !reduced && !cached && !large;
    if (!reduced && !cached && large) wrapEl.classList.add("graph-entering"); // large graphs: fade in only
    if (animateSettle) {
      const finalPos = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }] as const));
      const ext = cy.nodes().boundingBox();
      const cx = (ext.x1 + ext.x2) / 2;
      const cyy = (ext.y1 + ext.y2) / 2;
      cy.batch(() => cy.nodes().forEach((n) => {
        const p = finalPos.get(n.id())!;
        n.position({ x: cx + (p.x - cx) * 0.55, y: cyy + (p.y - cyy) * 0.55 });
      }));
      wrapEl.classList.add("graph-entering");
      settleLayout = cy.layout({
        name: "preset",
        positions: (n: cytoscape.NodeSingular) => finalPos.get(n.id())!,
        fit: false,
        animate: true,
        animationDuration: SETTLE_MS,
        animationEasing: "ease-out-cubic",
      } as cytoscape.LayoutOptions);
      settleLayout.one("layoutstop", finish);
      settleLayout.run();
    }

    function publish() {
    const renderedAt = performance.now();
    if (E2E_INSPECTOR) window.__bitflowGraph = {
      nodeCount: () => cy.nodes().length,
      edgeCount: () => cy.edges().length,
      nodeIds: () => cy.nodes().map((n) => n.id()),
      edgeIds: () => cy.edges().map((e) => e.id()),
      degree: (id) => cy.getElementById(id).degree(false),
      renderedNodePosition: (id) => {
        const n = cy.getElementById(id);
        return n.nonempty() ? n.renderedPosition() : null;
      },
      renderedEdgeMidpoint: (id) => {
        const e = cy.getElementById(id) as cytoscape.EdgeSingular;
        return e.nonempty() ? e.renderedMidpoint() : null;
      },
      renderedEdgePoint: (id, t) => {
        const e = cy.getElementById(id) as cytoscape.EdgeSingular;
        if (e.empty()) return null;
        const s0 = e.renderedSourceEndpoint();
        const s1 = e.renderedTargetEndpoint();
        let cps: { x: number; y: number }[] = [];
        try {
          cps = e.renderedControlPoints() ?? []; // throws for straight edges without control points
        } catch {
          cps = [];
        }
        if (cps.length !== 1) return { x: s0.x + (s1.x - s0.x) * t, y: s0.y + (s1.y - s0.y) * t };
        const c = cps[0]; // quadratic bezier: one control point
        const u = 1 - t;
        return { x: u * u * s0.x + 2 * u * t * c.x + t * t * s1.x, y: u * u * s0.y + 2 * u * t * c.y + t * t * s1.y };
      },
      zoom: () => cy.zoom(),
      pan: () => cy.pan(),
      viewportIdle: () => viewportAnimRef.current === 0 && wheelFrame === 0,
      tap: (id) => {
        const el = cy.getElementById(id);
        if (el.empty()) return false;
        el.emit("tap");
        return true;
      },
      renderedAt,
      layoutMs,
    };
    handlers.current.onRendered?.({ nodes: cy.nodes().length, edges: cy.edges().length, layoutMs });
    }
    if (!animateSettle) finish();

    return () => {
      window.clearTimeout(leaveTimer);
      wrapEl.classList.remove("graph-entering");
      wrapEl.style.cursor = "";
      settled = true;
      settleLayout?.stop();
      stopDash();
      applyRef.current = () => {};
      wrap.removeEventListener("wheel", onWheel, { capture: true });
      cancelAnimationFrame(wheelFrame);
      window.clearTimeout(wheelIdle);
      resizeObserver.disconnect();
      setTooltip(null);
      cyRef.current = null;
      if (E2E_INSPECTOR) delete window.__bitflowGraph;
      cy.destroy();
    };
  }

  // Theme switch: restyle existing elements in place (no rebuild, no layout, no viewport change). Applied without
  // transitions so ~1,200 elements don't animate; transitions are restored on the next frame.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const cy = cyRef.current;
    if (!cy) return;
    cy.style().fromJson(graphStyle(theme, false)).update();
    if (prefersReducedMotion()) return;
    if (largeRef.current) return; // large graphs run without element transitions
    const raf = requestAnimationFrame(() => cy.style().fromJson(graphStyle(theme, true)).update());
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  // Reflect the current selection (stronger highlight, unrelated items dimmed while its panel is open).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const id = selection?.kind === "node" ? selection.address
      : selection?.kind === "edge" ? edgeId(selection.source, selection.target) : null;
    const el = id ? cy.getElementById(id) : null;
    selectedRef.current = el && el.nonempty() ? (el as GraphElement) : null;
    applyRef.current();
  }, [selection, graph]);

  // + / - / Reset view animate the viewport (instant with reduced motion).
  const animateViewport = (target: cytoscape.AnimationOptions) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop(true);
    if (prefersReducedMotion()) {
      viewportAnimRef.current = 0;
      if (target.fit) cy.fit(undefined, 24);
      else cy.viewport({ zoom: target.zoom as number, pan: target.pan as cytoscape.Position });
      return;
    }
    const id = viewportAnimRef.current + 1; // a newer animation replaces (stops) the previous one
    viewportAnimRef.current = id;
    cy.animate({
      ...target, duration: 260, easing: "ease-in-out-cubic",
      complete: () => { if (viewportAnimRef.current === id) viewportAnimRef.current = 0; },
    });
  };
  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cy.zoom() * factor));
    const c = { x: cy.width() / 2, y: cy.height() / 2 };
    const pan = cy.pan();
    const k = level / cy.zoom();
    animateViewport({ zoom: level, pan: { x: c.x - (c.x - pan.x) * k, y: c.y - (c.y - pan.y) * k } });
  };
  const resetView = () => animateViewport({ fit: { eles: cyRef.current?.elements() ?? undefined, padding: 24 } } as cytoscape.AnimationOptions);

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <div ref={containerRef} className="graph-canvas" data-testid="graph-canvas" aria-label="Transaction graph" role="img" />
      {layingOut && (
        <div className="graph-overlay" role="status" data-testid="graph-laying-out">
          <span className="spinner" aria-hidden="true" />
          Laying out graph…
        </div>
      )}
      {tooltip && (
        <div className="graph-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      )}
      <div className="graph-controls">
        <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" onClick={resetView}>Reset view</button>
      </div>
    </div>
  );
}
