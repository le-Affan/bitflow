// The only module that knows the graph library (Cytoscape.js). Swap the library by rewriting this file.
import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";

import type { Graph } from "../api/types";
import { shorten } from "../lib/shorten";

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
  onRendered?: (counts: RenderedCounts) => void;
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

// Build-time constant: Vite replaces it, so production bundles drop the inspector code.
const E2E_INSPECTOR = import.meta.env.VITE_E2E_INSPECTOR === "true";

export function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

const COLORS = {
  node: "#5b6b7f",
  edge: "#b3bcc7",
  hover: "#1f2933",
  selected: "#c2410c",
};

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      width: 9,
      height: 9,
      "background-color": COLORS.node,
      "border-width": 0,
      label: "",
      "overlay-opacity": 0,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1,
      "line-color": COLORS.edge,
      "target-arrow-color": COLORS.edge,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.7,
      // Bezier separates parallel edges, so A->B and B->A are drawn as two distinct curves.
      "curve-style": "bezier",
      "control-point-step-size": 14,
      "overlay-opacity": 0,
    },
  },
  { selector: "node.hovered", style: { "background-color": COLORS.hover } },
  { selector: "edge.hovered", style: { "line-color": COLORS.hover, "target-arrow-color": COLORS.hover, "z-index": 10 } },
  {
    selector: "node.selected",
    style: { "background-color": COLORS.selected, "border-width": 2, "border-color": "#fff7ed", "z-index": 20 },
  },
  {
    selector: "edge.selected",
    style: { "line-color": COLORS.selected, "target-arrow-color": COLORS.selected, "z-index": 20 },
  },
];

function layoutOptions(): cytoscape.LayoutOptions {
  return {
    name: "cose",
    animate: false,
    randomize: true,
    fit: true,
    padding: 24,
    // Strong repulsion and long ideal edges keep the hub's star readable; gravity pulls the many
    // small disconnected components in around the main one instead of scattering them.
    nodeRepulsion: () => 9000,
    idealEdgeLength: () => 40,
    edgeElasticity: () => 80,
    gravity: 0.6,
    numIter: 1500,
    componentSpacing: 30,
    nodeOverlap: 8,
  } as cytoscape.LayoutOptions;
}

const MIN_NODE_DISTANCE = 30; // model units; nodes are 9 wide

/**
 * Pushes apart nodes that ended up closer than `minDistance`. Force layouts put structurally
 * equivalent nodes (e.g. two hubs that share most of their neighbours) on the same spot.
 */
function separateOverlaps(cy: cytoscape.Core, minDistance: number, passes = 30): void {
  const nodes = cy.nodes().toArray();
  const pos = nodes.map((n) => ({ ...n.position() }));
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
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
    if (!moved) break;
  }
  cy.batch(() => nodes.forEach((n, k) => n.position(pos[k])));
}

export function GraphView({ graph, selection, onNodeClick, onEdgeClick, onRendered }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const handlers = useRef({ onNodeClick, onEdgeClick, onRendered });
  handlers.current = { onNodeClick, onEdgeClick, onRendered };

  // (Re)build the graph whenever the data changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const started = performance.now();
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((n) => ({ group: "nodes" as const, data: { id: n.address } })),
        ...graph.edges.map((e) => ({
          group: "edges" as const,
          data: { id: edgeId(e.source, e.target), source: e.source, target: e.target, txCount: e.tx_count },
        })),
      ],
      style: STYLE,
      layout: { name: "preset" },
      minZoom: 0.05,
      maxZoom: 8,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autoungrabify: true,
      selectionType: "single",
    });
    cy.layout(layoutOptions()).run();
    separateOverlaps(cy, MIN_NODE_DISTANCE);
    cy.fit(undefined, 24);
    cyRef.current = cy;
    const layoutMs = Math.round(performance.now() - started);

    cy.on("mouseover", "node", (evt) => {
      const n = evt.target as cytoscape.NodeSingular;
      n.addClass("hovered");
      const p = n.renderedPosition();
      setTooltip({ x: p.x, y: p.y, text: shorten(n.id()) });
    });
    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target as cytoscape.EdgeSingular;
      e.addClass("hovered");
      const p = e.renderedMidpoint();
      const n = e.data("txCount") as number;
      setTooltip({
        x: p.x,
        y: p.y,
        text: `${shorten(e.data("source"))} → ${shorten(e.data("target"))} · ${n} transaction${n === 1 ? "" : "s"}`,
      });
    });
    cy.on("mouseout", "node, edge", (evt) => {
      evt.target.removeClass("hovered");
      setTooltip(null);
    });
    cy.on("viewport", () => setTooltip(null));
    cy.on("tap", "node", (evt) => handlers.current.onNodeClick(evt.target.id()));
    cy.on("tap", "edge", (evt) => handlers.current.onEdgeClick(evt.target.data("source"), evt.target.data("target")));

    // Cytoscape only tracks window resizes; the side panel changes the container size too.
    const resizeObserver = new ResizeObserver(() => cy.resize());
    resizeObserver.observe(containerRef.current);

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

    return () => {
      resizeObserver.disconnect();
      setTooltip(null);
      cyRef.current = null;
      if (E2E_INSPECTOR) delete window.__bitflowGraph;
      cy.destroy();
    };
  }, [graph]);

  // Reflect the current selection.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements(".selected").removeClass("selected");
    if (selection?.kind === "node") cy.getElementById(selection.address).addClass("selected");
    if (selection?.kind === "edge") cy.getElementById(edgeId(selection.source, selection.target)).addClass("selected");
  }, [selection, graph]);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-canvas" data-testid="graph-canvas" aria-label="Transaction graph" role="img" />
      {tooltip && (
        <div className="graph-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      )}
      <div className="graph-controls">
        <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => cyRef.current?.fit(undefined, 24)}>Reset view</button>
      </div>
    </div>
  );
}
