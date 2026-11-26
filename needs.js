import { balance } from './trade.js?v=8';
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
// Players projected at STAR wins or more are never suggested.
export const STAR = 4;
const TIERS = [{ name: 'fit', gap: 1, slack: 1, upgrade: .5, wants: 3 }, { name: 'long', gap: 2, slack: 2, upgrade: .1, wants: 5 }];
const open = p => !p.locked && !p.untouchable && p.surplus !== null && p.war < STAR;
// One-for-one offers: they send an upgrade at your spot, you send help at one of their needs.
// Good fits come first; looser "long shots" fill any remaining places.
export function findMatches({ spot, mine, others, needs, myId, limit = 5 }) {
  const myNeeds = needs.get(myId).slice(0, 3).map(n => n.spot), myBar = strength(mine, spot).bar, out = [], targets = new Set(), used = {};
  for (const tier of TIERS) {
    const found = [];
    for (const [teamId, theirs] of others) {
      const wants = needs.get(teamId).slice(0, tier.wants).map(n => n.spot).filter(s => s !== spot && !myNeeds.includes(s));
      const offers = mine.filter(p => open(p) && wants.includes(p.spot) && p.war >= strength(theirs, p.spot).bar + tier.upgrade);
      if (!offers.length) continue;
      for (const get of theirs.filter(p => open(p) && p.spot === spot && p.war >= myBar + tier.upgrade))
        for (const give of offers) {
          const { net } = balance([give], [get]), even = Math.max(5, .15 * Math.max(Math.abs(give.surplus), Math.abs(get.surplus)));
          const gap = get.war - give.war;
          if (Math.abs(net) <= even * tier.slack && Math.abs(gap) <= tier.gap)
            found.push({ teamId, give, get, net, gap, even, tier: tier.name, score: get.war - myBar - Math.abs(net) / 10 - Math.abs(gap) });
        }
    }
    for (const m of found.sort((a, b) => b.score - a.score)) {
      if (out.length === limit) break;
      if (targets.has(m.get.id) || (used[m.give.id] || 0) >= 2) continue;
      out.push(m); targets.add(m.get.id); used[m.give.id] = (used[m.give.id] || 0) + 1;
    }
    if (out.length === limit) break;
  }
  return out;
}
// Plain-language reasons an offer might not happen.
export function caveats(m) {
  const list = [];
  if (m.net > m.even) list.push('They may say no: you gain more value.');
  if (m.net < -m.even) list.push('You give up more value.');
  if (m.gap > 1) list.push('They may say no: you get more talent.');
  if (m.gap < -1) list.push('You give up more talent.');
  if (m.tier === 'long' && !list.length) list.push('Small upgrade or a weaker need for them.');
  const unsure = [m.give, m.get].filter(p => p.source === 'estimate' && p.owed).map(p => p.name);
  if (unsure.length) list.push(`Contract unknown (estimated veteran deal): ${unsure.join(', ')}.`);
  return list;
}
