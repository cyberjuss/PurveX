"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export type DetectionStatusDatum = {
  name: string;
  value: number;
  color: string;
};

type PieLabelProps = {
  name?: string;
  percent?: number;
};

interface DetectionStatusPieProps {
  data: DetectionStatusDatum[];
  height?: number;
  outerRadius?: number;
}

export default function DetectionStatusPie({
  data,
  height = 300,
  outerRadius = 100,
}: DetectionStatusPieProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={(props: PieLabelProps) => {
            const { name, percent } = props;
            if (!name || percent === undefined) return "";
            return `${name}: ${(percent * 100).toFixed(0)}%`;
          }}
          outerRadius={outerRadius}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            borderRadius: "8px",
            color: "#e2e8f0",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
