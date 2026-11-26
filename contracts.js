import { forecast } from './forecast.js';
// Estimated contracts from MLB season history and our own WAR projections. No outside salary data.
const MIN = .8, ARB_SHARE = { 3: .25, 4: .4, 5: .55 };
export const plain = s => s.normalize('NFD').replace(/[̀-ͯ.]/g, '').toLowerCase().trim();
const round = v => Math.round(v * 100) / 100;
// Rough service time: full credit for a regular season in the majors, part credit otherwise.
export function service(splits = [], debut) {
  if (!debut) return 0;
  let total = 0;
  for (let y = debut; y <= 2026; y++) {
    const rows = splits.filter(s => Number(s.season) === y);
    const most = k => Math.max(0, ...rows.map(s => Number(s.stat?.[k]) || 0));
    const pitched = rows.some(s => s.stat?.inningsPitched !== undefined);
    const share = pitched ? Math.max(most('gamesStarted') / 26, most('gamesPlayed') / 50) : most('gamesPlayed') / 130;
    if (!splits.length) total += 1;
    else if (y === debut) total += Math.min(1, share);
    else total += share >= .35 ? 1 : .5;
  }
  return total;
}
export function estimate(player, war, years0, settings) {
  const level = Math.floor(years0), veteran = level >= 6;
  if (war == null || player.age == null) return { pay: [MIN], owed: false };
  const values = n => forecast({ war, age: player.age, cost: 0, years: n }, settings).map(r => r.value);
  if (veteran) { // Assume a market-rate deal: shorter for older and weaker players.
    const a = player.age, n = war < 1 ? 1 : a <= 28 ? 4 : a <= 31 ? 3 : a <= 33 ? 2 : 1;
    const avg = Math.max(MIN, values(n).reduce((x, y) => x + y, 0) / n);
    return { pay: Array(n).fill(round(avg)), owed: true };
  }
  const n = 6 - level, v = values(n), pay = [];
  for (let i = 0; i < n; i++) { const s = level + i;
    pay.push(round(s < 3 ? MIN : Math.max(MIN, v[i] * ARB_SHARE[Math.min(s, 5)], i && s > 3 ? pay[i - 1] * 1.1 : 0))); }
  return { pay, owed: false };
}
// Order of trust: your trade entry, then your imported file (or estimate), with a salary fix on top.
export function terms(player, { war, splits, edit, fix, imported, settings }) {
  if (edit) return { pay: Array(edit.years).fill(edit.salary), aav: edit.salary, source: 'your entry', owed: edit.years > 1 };
  const yrs = service(splits, player.debut);
  const out = imported ? { pay: Array(imported.years).fill(imported.salary), aav: imported.aav ?? imported.salary, source: 'imported', owed: imported.years > 1 || yrs >= 6 }
    : { ...estimate(player, war, yrs, settings), source: 'estimate' };
  if (fix) return { ...out, pay: [fix.salary, ...out.pay.slice(1)], aav: fix.aav, source: 'my fix' };
  return { ...out, aav: out.aav ?? out.pay[0] };
}
export function importRows(rows) {
  const good = [], num = v => v === undefined || String(v).trim() === '' ? NaN : Number(String(v).replace(/[$,]/g, ''));
  for (const r of rows) {
    const key = String(r.mlb_id || '').trim() || plain(r.name || ''), salary = num(r.salary_millions), years = num(r.years), aav = num(r.aav_millions);
    if (key && salary >= 0 && salary < 100 && Number.isInteger(years) && years >= 1 && years <= 15)
      good.push({ key, salary, years, aav: aav >= 0 && aav < 100 ? aav : null });
  }
  return { good, skipped: rows.length - good.length };
}
