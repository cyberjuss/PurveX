"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

export interface PostureGaugeProps {
  /** 0-100 posture score. */
  score: number;
  /** Fill color for the arc — pass a tone-appropriate CSS color. */
  color: string;
  /** Track (background arc) color. */
  trackColor?: string;
  height?: number;
}

/**
 * Radial arc rendering a 0-100 posture score. Mirrors the "ring + centered
 * number" composition used elsewhere in the app (e.g. dashboard's MITRE
 * coverage ring), but as a genuine recharts data mark instead of hand-drawn
 * SVG, matching the convention set by `test-trend-chart.tsx`.
 *
 * Renders only the arc — callers overlay the centered score text themselves
 * via a `relative` wrapper, since RadialBarChart has no built-in slot for
 * arbitrary centered content.
 */
export default function PostureGauge({
  score,
  color,
  trackColor = "var(--surface-subtle)",
  height = 220,
}: PostureGaugeProps) {
  const clamped = Math.min(100, Math.max(0, score));
  const data = [{ name: "score", value: clamped, fill: color }];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadialBarChart
        data={data}
        innerRadius="72%"
        outerRadius="100%"
        barSize={14}
        startAngle={90}
        endAngle={-270}
      >
        <PolarAngleAxis
          type="number"
          domain={[0, 100]}
          angleAxisId={0}
          tick={false}
        />
        <RadialBar
          background={{ fill: trackColor }}
          dataKey="value"
          cornerRadius={999}
        />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}
