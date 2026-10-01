"use client";

import { useMemo, useState } from "react";
import type { Pipeline, PipelineNode } from "@/domain";

interface Placed extends PipelineNode {
  x: number;
  y: number;
  height: number;
}

interface Ribbon {
  key: string;
  source: string;
  target: string;
  value: number;
  path: string;
  thickness: number;
  colour: string;
}

/** Pixel coordinate space, so label text keeps its real size against the layout. */
const WIDTH = 1000;
const HEIGHT = 420;
const NODE_WIDTH = 11;
const GAP = 16;
/** Room on the right for the last column's labels. */
const LABEL_SPACE = 190;
const FONT = 12;

/** A node's colour says what kind of state it is, not which series it belongs to. */
function nodeColour(kind: PipelineNode["kind"]): string {
  if (kind === "offer") return "var(--good)";
  if (kind === "rejected") return "var(--critical)";
  if (kind === "waiting") return "var(--axis)";
  return "var(--series-1)";
}

/** The ribbon takes its colour from where it ends up, which is the thing worth reading. */
function ribbonColour(kind: PipelineNode["kind"]): string {
  if (kind === "offer") return "var(--good)";
  if (kind === "rejected") return "var(--critical)";
  if (kind === "waiting") return "var(--ink-muted)";
  return "var(--series-1)";
}

export function PipelineSankey({ pipeline }: { pipeline: Pipeline }) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const { nodes, links } = pipeline;
    if (!nodes.length || !links.length) return null;

    const columns = new Map<number, PipelineNode[]>();
    for (const node of nodes) {
      const list = columns.get(node.depth) ?? [];
      list.push(node);
      columns.set(node.depth, list);
    }

    const depths = [...columns.keys()].sort((a, b) => a - b);
    const plotWidth = WIDTH - LABEL_SPACE;
    const columnGap = depths.length > 1 ? plotWidth / (depths.length - 1) : 0;

    // Scale: the tallest column decides how many units fit in the available height.
    const tallest = Math.max(
      ...depths.map((depth) => {
        const list = columns.get(depth) ?? [];
        const total = list.reduce((sum, node) => sum + node.value, 0);
        return total + (list.length - 1) * (GAP / 2);
      }),
    );
    const unit = (HEIGHT - GAP * 2) / Math.max(tallest, 1);

    const placed = new Map<string, Placed>();
    depths.forEach((depth, columnIndex) => {
      const list = (columns.get(depth) ?? []).slice().sort((a, b) => b.value - a.value);
      const totalHeight = list.reduce((sum, node) => sum + node.value * unit, 0) + (list.length - 1) * GAP;
      let y = (HEIGHT - totalHeight) / 2;

      for (const node of list) {
        const height = Math.max(node.value * unit, 3);
        placed.set(node.name, { ...node, x: columnIndex * columnGap, y, height });
        y += height + GAP;
      }
    });

    // Ribbons leave a node stacked in order of size, and arrive the same way.
    const outCursor = new Map<string, number>();
    const inCursor = new Map<string, number>();
    const ribbons: Ribbon[] = [];

    for (const link of [...links].sort((a, b) => b.value - a.value)) {
      const from = placed.get(link.source);
      const to = placed.get(link.target);
      if (!from || !to) continue;

      const thickness = Math.max(link.value * unit, 1.5);
      const y0 = from.y + (outCursor.get(link.source) ?? 0) + thickness / 2;
      const y1 = to.y + (inCursor.get(link.target) ?? 0) + thickness / 2;
      outCursor.set(link.source, (outCursor.get(link.source) ?? 0) + thickness);
      inCursor.set(link.target, (inCursor.get(link.target) ?? 0) + thickness);

      const x0 = from.x + NODE_WIDTH / 2;
      const x1 = to.x - NODE_WIDTH / 2;
      const midpoint = (x0 + x1) / 2;

      ribbons.push({
        key: link.source + "->" + link.target,
        source: link.source,
        target: link.target,
        value: link.value,
        thickness,
        colour: ribbonColour(to.kind),
        path: "M" + x0 + "," + y0 + " C" + midpoint + "," + y0 + " " + midpoint + "," + y1 + " " + x1 + "," + y1,
      });
    }

    return { placed: [...placed.values()], ribbons, columns: depths.length };
  }, [pipeline]);

  if (!layout) {
    return <p className="empty">Nothing has been applied for yet, so there is no pipeline to draw.</p>;
  }

  return (
    <div className="sankey">
      <svg
        viewBox={"-6 -10 " + (WIDTH + 12) + " " + (HEIGHT + 20)}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        role="img"
        aria-label="Job pipeline flow"
      >
        {layout.ribbons.map((ribbon) => {
          const active = hover === ribbon.key || hover === ribbon.source || hover === ribbon.target;
          return (
            <path
              key={ribbon.key}
              d={ribbon.path}
              fill="none"
              stroke={ribbon.colour}
              strokeWidth={ribbon.thickness}
              strokeOpacity={hover ? (active ? 0.62 : 0.12) : 0.34}
              onMouseEnter={() => setHover(ribbon.key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {ribbon.source} → {ribbon.target}: {ribbon.value}
              </title>
            </path>
          );
        })}

        {layout.placed.map((node) => {
          const dim = hover != null && hover !== node.name && !hover.includes(node.name);
          return (
            <g
              key={node.name}
              onMouseEnter={() => setHover(node.name)}
              onMouseLeave={() => setHover(null)}
              opacity={dim ? 0.45 : 1}
            >
              <rect
                x={node.x - NODE_WIDTH / 2}
                y={node.y}
                width={NODE_WIDTH}
                height={node.height}
                rx={2}
                fill={nodeColour(node.kind)}
              />
              <text
                x={node.x + NODE_WIDTH}
                y={node.y + node.height / 2}
                dominantBaseline="middle"
                fontSize={FONT}
                fill="var(--ink-secondary)"
                style={{ fontWeight: 500 }}
              >
                {node.name} {node.value}
              </text>
              <title>
                {node.name}: {node.value}
              </title>
            </g>
          );
        })}
      </svg>

      <div className="legend" style={{ marginTop: 10 }}>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--series-1)" }} />
          Moved forward
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--critical)" }} />
          Rejected
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--axis)" }} />
          No reply yet
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--good)" }} />
          Offer
        </span>
      </div>
    </div>
  );
}
