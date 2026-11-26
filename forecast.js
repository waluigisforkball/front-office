import { surplus, injuryDiscount } from './grading.js';
// Year 1 is the saved projection. Each later year changes by an age-based step.
export function forecast({ war, age, cost, years, firstSeason = 2027 }, s) {
  let w = war;
  return Array.from({ length: years }, (_, i) => {
    const a = age + i;
    if (i) w = Math.max(0, w - (a >= 31 ? s.declineFrom31 : a >= 28 ? s.decline28to30 : 0));
    const value = w * (1 - injuryDiscount(a, s)) * s.dollarsPerWar;
    return { season: firstSeason + i, age: a, war: w, value, surplus: surplus(w * (1 - injuryDiscount(a, s)), cost, s) };
  });
}
