export type Zone = {
  id: string; name: string; region: string; lat: number; lng: number;
  prospectivity: number; oreGrade?: number; reserves?: number; concentration?: number; area: number;
  geology?: number; mineral?: number; historical?: number; terrain?: number; structure?: number; proximity?: number;
  status: string; risk?: number; confidence: number;
};

export type Risk = {
  id: string; name: string; severity: 'Low' | 'Medium' | 'High';
  probability: number; impact: number; zone: string; detected: string; mitigation: string;
};

export type Action = {
  id: string; title: string; priority: 'LOW' | 'MEDIUM' | 'HIGH'; impact: number; confidence: number;
  zone: string; status: 'Pending' | 'Approved' | 'Rejected' | 'Scheduled' | 'Completed' | 'Cancelled';
};

export type Sim = { equipmentDowntime: number; rainfall: 'Low' | 'Medium' | 'High'; blastingDelay: number; workingHours: number };
export type ScenarioResult = { production: number; shortfall: number; recovery: number; risk: number };

export const seedZones: Zone[] = [
  { id: 'A', name: 'Keonjhar North', region: 'Odisha, India', lat: 21.4532, lng: 85.7214, prospectivity: 92, oreGrade: 43, reserves: 148000, concentration: 5.8, area: 12.4, geology: 94, mineral: 88, historical: 86, terrain: 78, structure: 84, proximity: 91, status: 'Available', risk: 28, confidence: 91 },
  { id: 'B', name: 'Keonjhar East', region: 'Odisha, India', lat: 21.4984, lng: 85.7932, prospectivity: 89, oreGrade: 41, reserves: 119000, concentration: 5.5, area: 9.8, geology: 79, mineral: 73, historical: 69, terrain: 72, structure: 76, proximity: 71, status: 'Active extraction', risk: 48, confidence: 84 },
  { id: 'C', name: 'Sundargarh Belt', region: 'Odisha, India', lat: 22.1123, lng: 84.9934, prospectivity: 84, oreGrade: 36, reserves: 68000, concentration: 4.9, area: 8.6, geology: 51, mineral: 46, historical: 42, terrain: 48, structure: 55, proximity: 38, status: 'Monitoring', risk: 55, confidence: 73 },
  { id: 'D', name: 'West Singhbhum Edge', region: 'Jharkhand, India', lat: 22.0031, lng: 85.4521, prospectivity: 81, oreGrade: 34, reserves: 41000, concentration: 4.5, area: 7.1, geology: 31, mineral: 28, historical: 25, terrain: 39, structure: 33, proximity: 27, status: 'Restricted', risk: 72, confidence: 66 },
];

export const risks: Risk[] = [
  { id: 'r1', name: 'Equipment Downtime', severity: 'High', probability: 84, impact: 91, zone: 'Zone B', detected: '4 min ago', mitigation: 'Redeploy Excavator E-04 and open a maintenance window.' },
  { id: 'r2', name: 'Heavy Rainfall', severity: 'High', probability: 71, impact: 77, zone: 'Zone B', detected: '12 min ago', mitigation: 'Adjust blasting and haulage schedule.' },
  { id: 'r3', name: 'Blasting Delay', severity: 'Medium', probability: 62, impact: 58, zone: 'Zone C', detected: '28 min ago', mitigation: 'Move crew to the next approved blast block.' },
  { id: 'r4', name: 'Low Ore Grade', severity: 'Medium', probability: 49, impact: 55, zone: 'Zone C', detected: '41 min ago', mitigation: 'Blend with higher-grade stockpile.' },
  { id: 'r5', name: 'Transport Delay', severity: 'Medium', probability: 44, impact: 63, zone: 'Zone A', detected: '53 min ago', mitigation: 'Prioritize the available haul route.' },
  { id: 'r6', name: 'Slope Instability', severity: 'High', probability: 38, impact: 94, zone: 'Zone D', detected: '1 hr ago', mitigation: 'Inspect slope and restrict heavy movement.' },
];

export const seedActions: Action[] = [
  { id: 'a1', title: 'Redeploy Excavator E-04', priority: 'HIGH', impact: 420, confidence: 84, zone: 'Zone B', status: 'Pending' },
  { id: 'a2', title: 'Shift equipment toward Zone B', priority: 'HIGH', impact: 310, confidence: 81, zone: 'Zone B', status: 'Pending' },
  { id: 'a3', title: 'Adjust blasting schedule', priority: 'MEDIUM', impact: 190, confidence: 78, zone: 'Zone C', status: 'Pending' },
  { id: 'a4', title: 'Inspect Zone A geological indicators', priority: 'MEDIUM', impact: 120, confidence: 88, zone: 'Zone A', status: 'Pending' },
];

const defaultWeights = { geology: 0.30, mineral: 0.25, historical: 0.20, terrain: 0.10, structure: 0.10, proximity: 0.05 };

export function prospectivity(z: Zone, w: typeof defaultWeights = defaultWeights): number {
  const s = z.geology * w.geology + z.mineral * w.mineral + z.historical * w.historical
    + z.terrain * w.terrain + z.structure * w.structure + z.proximity * w.proximity;
  return Math.round(Math.max(0, Math.min(100, s)));
}

export function recommendations(zones: Zone[] = seedZones, shortfall = 1580, risk = 84, rain: Sim['rainfall'] = 'Medium') {
  const r: { title: string; reason: string; action: string; confidence: number; impact: number; priority: 'LOW' | 'MEDIUM' | 'HIGH' }[] = [];
  if (shortfall > 800 && risk > 60) {
    r.push({ title: 'Resolve equipment constraint', reason: 'Production shortfall and operational risk are elevated.', action: 'Redeploy available equipment and open a low-load maintenance window.', confidence: 84, impact: 420, priority: 'HIGH' });
  }
  const top = zones.length ? [...zones].sort((a, b) => b.prospectivity - a.prospectivity)[0] : undefined;
  if (top && top.prospectivity > 75 && (top.risk ?? 0) < 40) {
    r.push({ title: `Prioritize ${top.name} exploration`, reason: `Prospectivity ${top.prospectivity}% with risk ${top.risk ?? 0}%.`, action: 'Prioritize exploration drilling and sampling.', confidence: top.confidence, impact: 120, priority: 'MEDIUM' });
  }
  if (rain === 'High') {
    r.push({ title: 'Adjust weather-sensitive operations', reason: 'High rainfall increases transport and blasting disruption risk.', action: 'Reschedule blasting and protect critical haulage windows.', confidence: 79, impact: 260, priority: 'HIGH' });
  }
  if (r.length === 0) {
    r.push({ title: 'Maintain current operating plan', reason: 'Current simulated indicators remain within configured thresholds.', action: 'Continue monitoring and reassess at the next simulation tick.', confidence: 72, impact: 80, priority: 'LOW' });
  }
  return r;
}
