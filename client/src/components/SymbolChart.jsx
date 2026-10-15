import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactInr, formatInt } from '../utils/format.js';

export default function SymbolChart({ data, loading }) {
  return (
    <section aria-label="Traded value by symbol" className="rounded-xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,27,58,0.04)]">
      <h2 className="text-base font-semibold">Traded value by symbol</h2>
      <p className="text-sm text-ink-soft">Top 10 symbols by notional value (price × quantity)</p>
      <div className="mt-4 h-64">
        {loading ? <div className="skeleton h-full w-full" /> : !data?.length ? (
          <div className="grid h-full place-items-center text-sm text-ink-faint">No trades to chart yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e7ef" />
              <XAxis dataKey="symbol" tick={{ fontSize: 11, fill: '#44546f' }} tickLine={false} axisLine={{ stroke: '#e2e7ef' }} interval={0} angle={-25} textAnchor="end" height={54} />
              <YAxis tickFormatter={formatCompactInr} tick={{ fontSize: 11, fill: '#44546f' }} tickLine={false} axisLine={false} width={64} />
              <Tooltip cursor={{ fill: '#eaf0ff' }} formatter={(v, _n, p) => [`${formatCompactInr(v)} · ${formatInt(p.payload.trades)} trades`, 'Value']} />
              <Bar dataKey="value" fill="#1f4fd8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
