'use client';
import { Target } from 'lucide-react';
import { Spark } from '../Charts';

export function Kpi({
  title, value, sub, trend, color, onClick, spark,
}: {
  title: string; value: string; sub: string; trend: string;
  color?: 'green' | 'risk'; onClick?: () => void; spark?: number[];
}) {
  return (
    <div className={`card kpi`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}>
      <div className="kpi-head"><span>{title}</span><Target size={14} /></div>
      <div className={`metric ${color || ''}`}>{value}</div>
      <div className="sub" style={{ fontSize: 12 }}>{sub} · <span className={color === 'risk' ? 'risk' : 'trend'}>{trend}</span></div>
      {spark && spark.length > 0 && <Spark data={spark} />}
    </div>
  );
}
