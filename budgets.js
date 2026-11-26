// 2026 payrolls entering opening week, $M: MLB Labor Relations figures reported by USA TODAY Sports.
// https://sports.yahoo.com/articles/2026-mlb-payrolls-highest-lowest-100221699.html
// Keyed by MLB team id. Update once a year.
export const PAYROLL = {
  121: 357.6, 119: 322.4, 147: 301.1, 143: 283.7, 141: 279.0, 144: 252.1, 117: 246.5, 135: 224.8, 112: 220.7, 116: 209.4,
  137: 200.8, 111: 198.9, 140: 183.5, 109: 183.5, 108: 179.0, 110: 170.4, 136: 160.7, 118: 141.2, 158: 125.5, 113: 124.3,
  115: 118.3, 134: 102.1, 138: 98.1, 142: 96.7, 133: 91.8, 139: 89.6, 120: 88.0, 145: 83.9, 146: 79.4, 114: 70.0,
};
// Rules of thumb for a trade partner: net salary added, and the biggest single salary taken on.
const ADD = .05, ONE = .18, STRETCH_ADD = 2, STRETCH_ONE = 1.5;
export const tier = p => p >= 220 ? 'big spender' : p >= 150 ? 'upper middle' : p >= 100 ? 'middle' : 'tight budget';
export const room = (teamId, used = 0, table = PAYROLL) => table[teamId] ? Math.max(0, table[teamId] * ADD - used) : null;
// incoming and outgoing are first-year salaries from the other team's side.
export function theyAfford(teamId, incoming, outgoing, used = 0, table = PAYROLL) {
  const payroll = table[teamId], sum = l => l.reduce((a, v) => a + v, 0), net = sum(incoming) - sum(outgoing);
  if (!payroll) return { level: 'ok', net };
  const added = used + net, biggest = Math.max(0, ...incoming), limit = payroll * ADD;
  const level = net <= 0 || (added <= limit && biggest <= payroll * ONE) ? 'ok'
    : added <= limit * STRETCH_ADD && biggest <= payroll * ONE * STRETCH_ONE ? 'stretch' : 'no';
  return { level, net, limit: Math.max(0, limit - used) };
}
// delta is the salary you add; left is your unspent budget. Up to $10M over counts as a stretch.
export function youAfford(delta, left) {
  const over = delta - left;
  return { level: delta <= 0 || over <= 0 ? 'ok' : over <= 10 ? 'stretch' : 'no', over: Math.max(0, over) };
}
// Your own payroll file: columns team (name or MLB id) and payroll_millions.
export function importPayrolls(rows, teams) {
  const table = {}, key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let skipped = 0;
  for (const r of rows) {
    const raw = String(r.team || '').trim(), value = Number(String(r.payroll_millions ?? '').replace(/[$,]/g, ''));
    const id = PAYROLL[raw] !== undefined ? raw : teams.find(t => key(t.name) === key(raw))?.id;
    if (id && value > 0 && value < 1000) table[id] = value; else skipped++;
  }
  return { table, skipped };
}
