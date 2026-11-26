import { forecast } from './forecast.js';
// Wins above 2 and above 4 are worth extra: one star beats several average players.
export const starWins = w => w + .35 * Math.max(0, w - 2) + .35 * Math.max(0, w - 4);
// Each season: what the production is worth minus the salary, counting later years a little less.
// If the salary isn't guaranteed the club can walk away, so a bad year counts as zero.
export function valueRows(player, war, terms, settings) {
  const { pay, owed } = terms || {};
  if (war == null || !pay?.length || player.age == null) return null;
  return forecast({ war, age: player.age, cost: 0, years: pay.length }, settings).map((r, i) => {
    const healthy = r.war ? r.value / (r.war * settings.dollarsPerWar) : 0;
    const worth = starWins(r.war) * healthy * settings.dollarsPerWar, gap = worth - pay[i];
    return { season: r.season, war: r.war, worth, pay: pay[i], counts: (owed ? gap : Math.max(0, gap)) * (1 - settings.futureDiscount) ** i };
  });
}
export function tradeValue(player, war, terms, settings) {
  const rows = valueRows(player, war, terms, settings);
  return rows ? rows.reduce((a, r) => a + r.counts, 0) : null;
}
// Fair means similar surplus value and similar talent.
export function balance(give, get) {
  const sum = (list, k) => list.reduce((a, p) => a + (p[k] ?? 0), 0);
  const out = sum(give, 'surplus'), back = sum(get, 'surplus'), net = back - out, even = Math.max(5, .15 * Math.max(Math.abs(out), Math.abs(back)));
  const talent = sum(get, 'war') - sum(give, 'war');
  let verdict = Math.abs(net) <= even ? 'Roughly even.' : net > 0 ? 'Favors you. The other team may say no.' : 'Favors them.';
  if (Math.abs(net) <= even && talent > 2) verdict = 'Even on dollars, but you get much more talent. The other team may say no.';
  if (Math.abs(net) <= even && talent < -2) verdict = 'Even on dollars, but you give up much more talent.';
  const best = list => Math.max(0, ...list.map(p => p.war ?? 0)), theirs = best(get), mine = best(give);
  if (theirs >= 4 && theirs - mine > 1.5 && net > -even && !(Math.abs(net) <= even && talent > 2)) verdict = 'They are unlikely to trade a player this good without one close to him in return.';
  return { out, back, net, talent, unknown: [...give, ...get].filter(p => p.surplus === null).length, verdict };
}
