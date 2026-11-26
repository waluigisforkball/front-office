import { balance } from './trade.js?v=7';
export const SPOTS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'];
const DEPTH = { OF: 3, SP: 5, RP: 5 };
// total = projected WAR of the starters at a spot; bar = the weakest of those starters.
export function strength(players, spot) {
  const n = DEPTH[spot] || 1, w = players.filter(p => p.spot === spot && p.war != null).map(p => p.war).sort((a, b) => b - a).slice(0, n);
  return { total: w.reduce((a, b) => a + b, 0), bar: w[n - 1] ?? 0 };
}
// teams: Map of team id to players. Returns each team's spots, worst league rank first.
export function leagueNeeds(teams) {
  const totals = new Map([...teams].map(([id, list]) => [id, Object.fromEntries(SPOTS.map(s => [s, strength(list, s).total]))]));
  const avg = Object.fromEntries(SPOTS.map(s => [s, [...totals.values()].reduce((a, t) => a + t[s], 0) / totals.size]));
  return new Map([...totals].map(([id, t]) => [id, SPOTS.map(spot => ({ spot, of: totals.size, total: t[spot],
    rank: 1 + [...totals.values()].filter(o => o[spot] > t[spot]).length }))
    .sort((a, b) => b.rank - a.rank || (a.total - avg[a.spot]) - (b.total - avg[b.spot]))]));
}
// One-for-one offers: they send an upgrade at your spot, you send help at one of their top three needs.
export function findMatches({ spot, mine, others, needs, myId, limit = 5 }) {
  const myNeeds = needs.get(myId).slice(0, 3).map(n => n.spot), myBar = strength(mine, spot).bar, found = [];
  for (const [teamId, theirs] of others) {
    const wants = needs.get(teamId).slice(0, 3).map(n => n.spot).filter(s => s !== spot && !myNeeds.includes(s));
    const offers = mine.filter(p => !p.locked && wants.includes(p.spot) && p.surplus !== null && p.war >= strength(theirs, p.spot).bar + .5);
    if (!offers.length) continue;
    for (const get of theirs.filter(p => !p.locked && p.spot === spot && p.surplus !== null && p.war >= myBar + .5))
      for (const give of offers) {
        const b = balance([give], [get]);
        if (b.verdict === 'Roughly even.') found.push({ teamId, give, get, net: b.net, score: get.war - myBar - Math.abs(b.net) / 10 - Math.abs(get.war - give.war) / 4 });
      }
  }
  const out = [], targets = new Set(), used = {};
  for (const m of found.sort((a, b) => b.score - a.score)) {
    if (targets.has(m.get.id) || (used[m.give.id] || 0) >= 2) continue;
    out.push(m); targets.add(m.get.id); used[m.give.id] = (used[m.give.id] || 0) + 1;
    if (out.length === limit) break;
  }
  return out;
}
