'use client';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
  BarChart, Bar, CartesianGrid, Cell, PieChart, Pie,
} from 'recharts';

const tooltipStyle = { background: '#16181a', border: '1px solid #26292c', borderRadius: 10, fontSize: 12, color: '#ece7de' };

export function ProductionChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid stroke="#1c1e20" strokeDasharray="3 3" />
        <XAxis dataKey="day" stroke="#7d7c78" tick={{ fontSize: 10 }} />
        <YAxis stroke="#7d7c78" tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="actual" stroke="#b6875a" dot={false} strokeWidth={2} name="Actual" />
        <Line type="monotone" dataKey="target" stroke="#5a5e63" dot={false} strokeDasharray="5 5" name="Target" />
        <Line type="monotone" dataKey="forecast" stroke="#5fa38d" dot={false} strokeWidth={2} name="Forecast" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Spark({ data }: { data: number[] }) {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data.map((v, i) => ({ i, v }))}>
        <Area dataKey="v" type="monotone" stroke="#b6875a" fill="#b6875a" fillOpacity={0.09} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PotentialDonut({ zones }: { zones: any[] }) {
  const hi = 42, med = 36, low = 22;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={[{ n: 'High', v: hi }, { n: 'Medium', v: med }, { n: 'Low', v: low }]} dataKey="v" nameKey="n" innerRadius={65} outerRadius={90} paddingAngle={3}>
          {[hi, med, low].map((_, i) => (
            <Cell key={i} fill={i === 0 ? '#5fa38d' : i === 1 ? '#c1893f' : '#a54b45'} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function FeatureBars({ factors }: { factors?: { name: string; value: number }[] } = {}) {
  const d = (factors ?? [
    { name: 'Geological indicators', value: 31 }, { name: 'Historical grade', value: 24 }, { name: 'Mineral index', value: 19 },
    { name: 'Terrain', value: 11 }, { name: 'Structural indicators', value: 9 }, { name: 'Other', value: 6 },
  ]).map(({ name, value }) => ({ name, v: value }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={d} layout="vertical" margin={{ left: 20, right: 10 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={130} stroke="#7d7c78" tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="v" fill="#b6875a" radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
