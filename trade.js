import { forecast } from './forecast.js';
// Orioles 2027-onward terms from Baseball-Reference, Nov. 2026. years = seasons left; pay = known salaries.
export const ORIOLES = {
  'Pete Alonso': { pay: [33.5,33.5,33.5,33.5] }, 'Kyle Bradish': { pay: [10,13,17,22,28] }, 'Shane Baz': { pay: [7.8,10.8,21.8,25.8] },
  'Samuel Basallo': { pay: [1.62,1.62,4.62,7.62,11.62,15.62,15.62] }, "Tyler O'Neill": { pay: [16.5] }, 'Yennier Cano': { pay: [2.75,4.75] },
  'Freddy Peralta': { pay: [23,23,23,23,23] }, 'Ryan Helsley': { pay: [14] }, 'Félix Bautista': { pay: [2.35] },
  'Gunnar Henderson': { years: 2, service: 4 }, 'Jordan Westburg': { years: 3, service: 3 }, 'Colton Cowser': { years: 3, service: 3 },
  'Rico Garcia': { years: 4, service: 2 }, 'Christian Encarnacion-Strand': { years: 4, service: 2 }, 'Jackson Holliday': { years: 4, service: 2 },
  'Blaze Alexander': { years: 4, service: 2 }, 'Carlos Narváez': { years: 4, service: 2 }, 'Coby Mayo': { years: 5, service: 1 },
  'Cade Povich': { years: 5, service: 1 }, 'Grant Wolfram': { years: 5, service: 1 }, 'Brandon Young': { years: 5, service: 1 },
  'Jeremiah Jackson': { years: 5, service: 1 }, 'Dylan Beavers': { years: 5, service: 1 }, 'Josh Walker': { years: 5, service: 1 }, 'Yaramil Hiraldo': { years: 5, service: 1 },
};
const ARB = { 3: 2.5, 4: 3.8, 5: 5.5 };
// Estimated pay by service time; each arbitration year is at least 40% above the last.
export function estimatePay(service, years, current) {
  const pay = [];
  for (let i = 0; i < years; i++) { const level = service + i, base = level < 3 ? .8 : ARB[Math.min(level, 5)];
    pay.push(i === 0 ? current ?? base : level < 3 ? base : Math.max(base, pay[i - 1] * (level > 3 ? 1.4 : 1))); }
  return pay.map(v => Math.round(v * 100) / 100);
}
// Best available terms: your edit, then known Orioles terms, then an estimate from MLB debut year.
export function terms(player, contract, edit) {
  if (edit) return { pay: Array(edit.years).fill(edit.salary), source: 'your entry' };
  const known = !player.team && ORIOLES[player.name];
  if (known?.pay) return { pay: known.pay, source: 'contract' };
  const service = known?.service ?? (player.debut ? Math.max(0, 2026 - player.debut) : 0);
  if (!known && service >= 6) return { pay: null, source: 'needs entry' };
  const years = known?.years ?? Math.max(1, 6 - service);
  return { pay: estimatePay(service, years, contract?.salary ?? undefined), source: 'estimate' };
}
export function tradeValue(player, war, pay, settings) {
  if (war == null || !pay?.length || player.age == null) return null;
  const rows = forecast({ war, age: player.age, cost: 0, years: pay.length }, settings);
  return rows.reduce((a, r, i) => a + r.value - pay[i], 0);
}
export function balance(give, get) {
  const sum = list => list.reduce((a, p) => a + (p.surplus ?? 0), 0);
  const out = sum(give), back = sum(get), net = back - out, even = Math.max(5, .15 * Math.max(Math.abs(out), Math.abs(back)));
  return { out, back, net, unknown: [...give, ...get].filter(p => p.surplus === null).length,
    verdict: Math.abs(net) <= even ? 'Roughly even.' : net > 0 ? 'Favors you. The other team may say no.' : 'Favors them.' };
}
