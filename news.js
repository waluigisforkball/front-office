import { PAYROLL } from './budgets.js?v=10';
// Reads MLB transaction records and works out which of your moves real life has overtaken.
export const ORIOLES = 110;
const isClub = t => !!t && PAYROLL[t.id] !== undefined;
const CHANGES = /trade|claim|signed|selected|purchase/i, SIGNED = /signed/i, LEFT = /releas|free agency/i;
export function byPlayer(transactions) {
  const map = new Map();
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const id = String(t.person?.id ?? ''); if (!id) continue;
    if (!map.has(id)) map.set(id, []); map.get(id).push(t);
  }
  return map;
}
const event = (t, kind) => ({ kind, team: t.toTeam?.id, teamName: t.toTeam?.name, date: t.date, text: t.description || `${t.person.fullName}: ${t.typeDesc}` });
// A free agent who has signed with a major league club.
export function signing(list = []) {
  const t = list.findLast(t => (t.typeCode === 'SFA' || SIGNED.test(t.typeDesc)) && isClub(t.toTeam));
  return t ? event(t, 'signed') : null;
}
// A player who has left the club you expect him to be on.
export function departure(list = [], teamId) {
  let out = null;
  for (const t of list) {
    const change = t.typeCode === 'TR' || t.typeCode === 'SFA' || t.typeCode === 'CLW' || CHANGES.test(t.typeDesc);
    if (change && isClub(t.toTeam)) out = t.toTeam.id === teamId ? null : event(t, 'moved');
    else if (LEFT.test(t.typeDesc) && [t.fromTeam?.id, t.toTeam?.id].includes(teamId)) out = event(t, 'released');
  }
  return out;
}
// state: ok, matched (it happened as you planned) or broken (it can no longer happen).
export function moveStatus(d, news, mlbId) {
  const of = id => news.get(String(mlbId(id))), broken = e => ({ state: 'broken', reason: `${e.date}: ${e.text}` });
  if (d.type === 'trade') {
    for (const p of d.give) { const e = departure(of(p.id), ORIOLES); if (e) return broken(e); }
    for (const p of d.get) { const e = departure(of(p.id), Number(d.teamId)); if (e) return broken(e); }
  } else if (d.type === 'sign' || d.type === 'minor') {
    const e = signing(of(d.playerId));
    if (e) return e.team === ORIOLES ? { state: 'matched', reason: `${e.date}: ${e.text}` } : broken(e);
  } else {
    const e = departure(of(d.playerId), ORIOLES);
    if (e) return e.kind === 'released' && ['release', 'nontender'].includes(d.type) ? { state: 'matched', reason: `${e.date}: ${e.text}` } : broken(e);
  }
  return { state: 'ok' };
}
