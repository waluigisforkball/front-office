// Orioles salaries from public reporting, checked Nov. 26, 2026. Dollars in millions, 2027 first.
// since: the Time Machine ignores a deal on dates before it was known.
// guaranteed: owed even if released. control: arbitration years left, when only 2027 has a figure.
export const KNOWN = {
  'pete alonso': { pay: [31, 31, 31, 31], aav: 31, guaranteed: true, since: '2025-12-01' },
  'freddy peralta': { pay: [23, 23, 23, 23, 23], aav: 25, guaranteed: true, since: '2026-11-24' }, // plus a $10M signing bonus
  'kyle bradish': { pay: [10, 13, 17, 22, 28], aav: 18, guaranteed: true, since: '2026-07-31' },
  'shane baz': { pay: [7, 10, 21, 25], aav: 13.6, guaranteed: true, since: '2026-03-31' },
  'samuel basallo': { pay: [1, 1, 4, 7, 11, 15, 22], aav: 8.375, guaranteed: true, since: '2025-09-01' }, // 2033 includes the $7M option buyout
  "tyler o'neill": { pay: [16.5], aav: 16.5, guaranteed: true, since: '2024-12-01' },
  'ryan helsley': { pay: [14], aav: 14, guaranteed: true, since: '2026-10-29' },
  'yennier cano': { pay: [2.75, 4.75], aav: 3.75, guaranteed: true, since: '2026-07-31' },
  'felix bautista': { pay: [2.35], aav: 2.35, guaranteed: false, since: '2026-11-20' },
  // Projected arbitration salaries (MLB Trade Rumors), not yet agreed.
  'gunnar henderson': { first: 14.1, control: 2, since: '2026-10-01' },
  'colton cowser': { first: 2.2, control: 3, since: '2026-10-01' },
  'jordan westburg': { first: 1.5, control: 3, since: '2026-10-01' },
};
// Agreements reported in the news that MLB may not list yet. Checked Nov. 26, 2026.
export const REPORTED = [
  { name: 'Kevin Gausman', team: 116, teamName: 'Detroit Tigers', date: '2026-11-25', terms: '1 year, $25M' },
  { name: 'David Peterson', team: 115, teamName: 'Colorado Rockies', date: '2026-11-25', terms: '2 years, $32M' },
];
