// Dollars in millions. Thresholds and first-time-payor rates are the 2026 rules.
export const TIERS = [{ at: 244, rate: .20 }, { at: 264, rate: .32 }, { at: 284, rate: .625 }, { at: 304, rate: .80 }];
export const taxBill = payroll => TIERS.reduce((sum, t, i) =>
  sum + Math.max(0, Math.min(payroll, TIERS[i + 1]?.at ?? Infinity) - t.at) * t.rate, 0);
// Annual averages for multi-year deals; other players count at salary.
export const AAV = { 'Pete Alonso': 31, 'Kyle Bradish': 18, 'Shane Baz': 13.6, 'Samuel Basallo': 8.375,
  "Tyler O'Neill": 16.5, 'Yennier Cano': 3.75, 'Freddy Peralta': 25, 'Ryan Helsley': 14, 'Félix Bautista': 2.35 };
// Moves apply in order. A "void" entry cancels an earlier one without erasing it.
export const active = log => { const voided = new Set(log.filter(d => d.type === 'void').map(d => d.voids));
  return log.filter(d => d.type !== 'void' && !voided.has(d.id)); };
export function payroll(players, contracts, log, other) {
  const lines = new Map();
  for (const p of players) { const c = contracts[p.id]; const cash = c?.salary ?? null;
    lines.set(p.id, { cash, tax: c?.aav ?? AAV[p.name] ?? cash, spot: true, owed: AAV[p.name] !== undefined }); }
  for (const d of active(log)) {
    if (d.type === 'trade') {
      for (const p of d.give) lines.set(p.id, { cash: 0, tax: 0, spot: false });
      for (const p of d.get) lines.set(p.id, { cash: p.pay[0], tax: p.pay[0], spot: true, owed: true });
      continue;
    }
    const line = lines.get(d.playerId);
    if (d.type === 'sign') lines.set(d.playerId, { cash: d.aav, tax: d.aav, spot: true, owed: true });
    if (d.type === 'minor') lines.set(d.playerId, { cash: d.aav, tax: d.aav, spot: false });
    if (d.type === 'extend' && line) Object.assign(line, { cash: d.aav, tax: d.aav, owed: true });
    if ((d.type === 'release' || d.type === 'nontender') && line) {
      line.spot = false; if (!line.owed) Object.assign(line, { cash: 0, tax: 0 }); }
  }
  const v = [...lines.values()];
  const cash = v.reduce((a, l) => a + (l.cash || 0), 0), tax = v.reduce((a, l) => a + (l.tax || 0), 0) + other;
  return { cash, tax, bill: taxBill(tax), spots: v.filter(l => l.spot).length, missing: v.filter(l => l.cash === null).length };
}
