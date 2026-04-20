"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TestTrendDatum = {
  date: string;
  Pass: number;
  Fail: number;
  Inconclusive: number;
};

interface TestTrendChartProps {
  data: TestTrendDatum[];
  height?: number;
}

export default function TestTrendChart({ data, height = 300 }: TestTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorPass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorFail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorInconclusive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          style={{ fontSize: "11px" }}
          tick={{ fill: "#94a3b8" }}
        />
        <YAxis
          stroke="#94a3b8"
          style={{ fontSize: "11px" }}
          tick={{ fill: "#94a3b8" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            borderRadius: "8px",
            color: "#e2e8f0",
          }}
          labelStyle={{ color: "#cbd5e1" }}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }}
          iconType="circle"
        />
        <Area
          type="monotone"
          dataKey="Pass"
          stackId="1"
          stroke="#10b981"
          fill="url(#colorPass)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Fail"
          stackId="1"
          stroke="#ef4444"
          fill="url(#colorFail)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Inconclusive"
          stackId="1"
          stroke="#f59e0b"
          fill="url(#colorInconclusive)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
