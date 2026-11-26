import { seasonRows, innings } from './projections.js';
// Weighted average over only the seasons a player appeared in; recent seasons count more.
const LAST = 2026;
const HIT = ['plateAppearances','atBats','hits','doubles','triples','homeRuns','rbi','runs','stolenBases','strikeOuts','baseOnBalls','hitByPitch','sacFlies','totalBases'];
const PIT = ['inningsPitched','gamesPlayed','gamesStarted','earnedRuns','hits','baseOnBalls','strikeOuts','homeRuns','wins','losses','saves'];
export function seasonTotals(splits, year, pitching) {
  const rows = seasonRows(splits, year); if (!rows.length) return null;
  const out = {};
  for (const k of pitching ? PIT : HIT) out[k] = rows.reduce((a, r) => a + (k === 'inningsPitched' ? innings(r[k]) : Number(r[k]) || 0), 0);
  if (!pitching && !out.totalBases) out.totalBases = out.hits + out.doubles + 2 * out.triples + 3 * out.homeRuns;
  return (pitching ? out.inningsPitched : out.plateAppearances) ? out : null;
}
// Rate stats from totals. k adds league-average playing time so tiny samples don't run wild.
export function rates(t, pitching, k = 0) {
  if (pitching) { const ip = t.inningsPitched + k / 4;
    return { era: 9 * (t.earnedRuns + 4.15 / 9 * k / 4) / ip, whip: (t.hits + t.baseOnBalls + 1.3 * k / 4) / ip }; }
  const ab = t.atBats + k, on = t.atBats + t.baseOnBalls + t.hitByPitch + t.sacFlies + k;
  const avg = (t.hits + .245 * k) / ab, obp = (t.hits + t.baseOnBalls + t.hitByPitch + .315 * k) / on, slg = (t.totalBases + .4 * k) / ab;
  return { avg, obp, slg, ops: obp + slg };
}
export function projectStats(splits, pitching, years = 3) {
  const used = [];
  for (let i = 0; i < years; i++) { const t = seasonTotals(splits, LAST - i, pitching); if (t) used.push({ season: LAST - i, weight: 5 - i, t }); }
  if (!used.length) return null;
  const weight = used.reduce((a, s) => a + s.weight, 0), avg = {};
  for (const k of pitching ? PIT : HIT) avg[k] = used.reduce((a, s) => a + s.weight * s.t[k], 0) / weight;
  return { ...avg, ...rates(avg, pitching, 100), seasons: used.length,
    small: pitching ? avg.inningsPitched < 40 : avg.plateAppearances < 200,
    starter: pitching && avg.gamesStarted / avg.gamesPlayed > .5, history: used.map(s => ({ season: s.season, ...s.t, ...rates(s.t, pitching) })) };
}
const r3 = v => v.toFixed(3).replace(/^0/, ''), r0 = v => String(Math.round(v)), r2 = v => v.toFixed(2);
export const COLUMNS = {
  hit: [['AVG','avg',r3],['HR','homeRuns',r0],['RBI','rbi',r0],['OPS','ops',r3],['OBP','obp',r3],['SLG','slg',r3],['R','runs',r0],['SB','stolenBases',r0],['K','strikeOuts',r0],['PA','plateAppearances',r0]],
  pit: [['ERA','era',r2],['WHIP','whip',r2],['K','strikeOuts',r0],['IP','inningsPitched',r0],['BB','baseOnBalls',r0],['W','wins',r0],['L','losses',r0],['SV','saves',r0],['HR','homeRuns',r0],['G','gamesPlayed',r0],['GS','gamesStarted',r0]],
};
