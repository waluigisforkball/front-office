import { PAYROLL } from './budgets.js?v=12';
import { byPlayer, kindOf } from './news.js?v=12';
// Free agency opened to all teams Nov. 2 at 5 p.m. ET, so that day's signings count as "not yet".
export const OPENING = '2026-11-02';
const club = t => !!t && PAYROLL[t.id] !== undefined;
const happened = (t, date) => t.date < date || (t.date === date && !(date === OPENING && kindOf(t) === 'sign'));
// rosters: Map of MLB team id to player ids as MLB lists them for the date.
// Transactions correct that list, so the board is right even if MLB's list reflects later moves.
export function boardState(rosters, transactions, date) {
  const place = new Map();
  for (const [team, ids] of rosters) for (const id of ids) place.set(String(id), team);
  const free = new Set(), taken = new Set();
  for (const [id, list] of byPlayer(transactions)) {
    const events = list.filter(kindOf), before = events.filter(t => happened(t, date)), after = events.filter(t => !happened(t, date));
    const set = where => { free.delete(id); if (where === 'free') { place.delete(id); free.add(id); } else if (where) place.set(id, where); else place.delete(id); };
    if (before.length) {
      const t = before.at(-1), kind = kindOf(t);
      if (kind !== 'leave') taken.add(id);
      if (kind === 'leave') set('free');
      else if (place.has(id)) set(t.toTeam.id);
    } else if (after.length) {
      const t = after[0], kind = kindOf(t);
      if (kind === 'sign') set('free');
      else if (kind === 'move') set(club(t.fromTeam) ? t.fromTeam.id : null);
      else set(club(t.fromTeam) ? t.fromTeam.id : t.toTeam.id);
    }
  }
  const teams = new Map([...rosters.keys()].map(team => [team, []]));
  for (const [id, team] of place) teams.get(team)?.push(id);
  // taken: signed or moved by this date, so never a free agent on it.
  return { teams, free: [...free], taken: [...taken] };
}
