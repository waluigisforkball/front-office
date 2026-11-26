// All money in $ millions. "time" is plate appearances or innings.
export const DEFAULTS = { dollarsPerWar: 9, injuryBase: 0, injuryPerYearOver30: 0.02, rosterSpotCost: 0.25, futureDiscount: 0.08 };
export const surplus = (war, cost, s) => war * s.dollarsPerWar - cost;
export const injuryDiscount = (age, s) => Math.min(.5, s.injuryBase + Math.max(0, age - 30) * s.injuryPerYearOver30);
// Process: only what was knowable. move = {war, cost, age}
export function processScore(move, alternatives, s) {
  const value = m => surplus(m.war * (1 - injuryDiscount(m.age, s)), m.cost, s);
  const mine = value(move);
  const best = alternatives.length ? Math.max(...alternatives.map(value)) : null;
  return { surplus: mine, vsBest: best === null ? null : mine - best };
}
export const outcomeScore = (actualWar, cost, s) => surplus(actualWar, cost, s);
// Splits the miss into availability (playing time) and performance (rate). The two always add up.
export function luckSplit(projected, actual, s) {
  const projRate = projected.time ? projected.war / projected.time : 0;
  const availability = (actual.time - projected.time) * projRate * s.dollarsPerWar;
  const performance = (actual.war - actual.time * projRate) * s.dollarsPerWar;
  return { availability, performance, injuryFlag: actual.time < .6 * projected.time };
}
// Positive regret = a same-price-or-cheaper alternative did better.
export function regret(pick, alternatives, s) {
  const options = alternatives.filter(a => a.cost <= pick.cost).map(a => surplus(a.actualWar, a.cost, s));
  return options.length ? Math.max(0, Math.max(...options) - surplus(pick.actualWar, pick.cost, s)) : 0;
}
// AAA rule: only MLB production counts. Never called up = cost plus roster spot.
export const aaaScore = ({ games, war, cost, used40Man }, s) =>
  games > 0 ? surplus(war, cost, s) : -(cost + (used40Man ? s.rosterSpotCost : 0));
// Multi-year deals: one graded row per season at the average annual value.
export const spread = (total, years, firstSeason) =>
  Array.from({ length: years }, (_, i) => ({ season: firstSeason + i, cost: total / years }));
