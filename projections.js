// Simple "Marcel-style" projections. Bat or arm only: no defense or baserunning.
const W = { 2026: 5, 2025: 4, 2024: 3 }, LG_WOBA = .315, LG_FIP = 4.15;
const n = v => Number(v) || 0;
export const innings = v => { const [a, b] = String(v ?? 0).split('.'); return n(a) + n(b) / 3; };
// One row per season: use the combined line for traded players, else add team lines.
export function seasonRows(splits, year) {
  const rows = splits.filter(s => Number(s.season) === year);
  const total = rows.find(s => !s.team);
  return total ? [total.stat] : rows.map(s => s.stat);
}
const ageFactor = age => age < 29 ? (29 - age) * .006 : (29 - age) * .003;
export function hitter(splits, age) {
  let num = 0, den = 0; const pa = {};
  for (const y in W) for (const s of seasonRows(splits, +y)) {
    const bb = n(s.baseOnBalls) - n(s.intentionalWalks), h1 = n(s.hits) - n(s.doubles) - n(s.triples) - n(s.homeRuns);
    num += W[y] * (.69 * bb + .72 * n(s.hitByPitch) + .89 * h1 + 1.27 * n(s.doubles) + 1.62 * n(s.triples) + 2.1 * n(s.homeRuns));
    den += W[y] * (n(s.atBats) + bb + n(s.sacFlies) + n(s.hitByPitch));
    pa[y] = (pa[y] || 0) + n(s.plateAppearances);
  }
  if (!den) return null;
  const woba = (num + 1200 * LG_WOBA) / (den + 1200) * (1 + ageFactor(age));
  const time = Math.min(680, .5 * (pa[2026] || 0) + .1 * (pa[2025] || 0) + 200);
  const war = ((woba - LG_WOBA) / 1.2 * time + 20 * time / 600) / 10;
  return { type: 'bat', war, time, rate: war / time };
}
export function pitcher(splits, age) {
  let num = 0, ip = 0, g = 0, gs = 0; const by = {};
  for (const y in W) for (const s of seasonRows(splits, +y)) {
    const i = innings(s.inningsPitched);
    num += W[y] * (13 * n(s.homeRuns) + 3 * (n(s.baseOnBalls) + n(s.hitByPitch ?? s.hitBatsmen)) - 2 * n(s.strikeOuts));
    ip += W[y] * i; by[y] = (by[y] || 0) + i; g += n(s.gamesPlayed); gs += n(s.gamesStarted);
  }
  if (!ip) return null;
  const core = (num + 400 * (LG_FIP - 3.15)) / (ip + 400);
  const fip = (core + 3.15) * (1 - ageFactor(age));
  const starter = gs / g > .5;
  const time = .5 * (by[2026] || 0) + .1 * (by[2025] || 0) + (starter ? 60 : 25);
  const war = ((starter ? 5.2 : 4.4) - fip) * time / 90;
  return { type: 'arm', war, time, rate: war / time };
}
