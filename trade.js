import { forecast } from './forecast.js';
export function tradeValue(player, war, pay, settings) {
  if (war == null || !pay?.length || player.age == null) return null;
  const rows = forecast({ war, age: player.age, cost: 0, years: pay.length }, settings);
  return rows.reduce((a, r, i) => a + r.value - pay[i], 0);
}
// Fair means similar surplus value and similar talent.
export function balance(give, get) {
  const sum = (list, k) => list.reduce((a, p) => a + (p[k] ?? 0), 0);
  const out = sum(give, 'surplus'), back = sum(get, 'surplus'), net = back - out, even = Math.max(5, .15 * Math.max(Math.abs(out), Math.abs(back)));
  const talent = sum(get, 'war') - sum(give, 'war');
  let verdict = Math.abs(net) <= even ? 'Roughly even.' : net > 0 ? 'Favors you. The other team may say no.' : 'Favors them.';
  if (Math.abs(net) <= even && talent > 2) verdict = 'Even on dollars, but you get much more talent. The other team may say no.';
  if (Math.abs(net) <= even && talent < -2) verdict = 'Even on dollars, but you give up much more talent.';
  return { out, back, net, talent, unknown: [...give, ...get].filter(p => p.surplus === null).length, verdict };
}
