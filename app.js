import * as db from './db.js';
import { parseCSV } from './csv.js';
import { hitter, pitcher } from './projections.js';
import { DEFAULTS, processScore } from './grading.js';

const SNAP = '2026-11-25', $ = id => document.getElementById(id);
let players = [], contracts = {}, proj = {}, settings = { id: 'main', ...DEFAULTS, photos: true };
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const money = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(1) + 'M';
const say = t => $('msg').textContent = t;

async function refresh() {
  settings = { ...settings, ...(await db.all('settings'))[0] };
  players = (await db.all('players')).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  contracts = Object.fromEntries((await db.all('contracts')).map(c => [c.playerId, c]));
  proj = Object.fromEntries((await db.all('projections')).map(p => [p.playerId, p]));
  render();
}
function face(p) {
  const box = el('div', { className: 'face' }, p.name.split(' ').map(w => w[0]).slice(0, 2).join(''));
  if (settings.photos && p.mlbId) {
    const img = el('img', { alt: '', loading: 'lazy', referrerPolicy: 'no-referrer',
      src: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${p.mlbId}/headshot/67/current` });
    img.onerror = () => img.remove();
    box.append(img);
  }
  return box;
}
function render() {
  const paid = Object.values(contracts).filter(c => c.salary !== null);
  const total = paid.reduce((a, c) => a + c.salary, 0);
  const stat = (label, v) => el('div', {}, label, el('b', {}, v));
  $('stats').replaceChildren(stat('Roster', `${players.length}/40`), stat('Known salaries', money(total)),
    stat('Salaries missing', String(players.length - paid.length)));
  $('snap').textContent = players.length ? `Orioles, snapshot ${SNAP}` : 'No snapshot loaded';
  $('photos').checked = settings.photos;
  $('roster').replaceChildren(...players.map(p => { const c = contracts[p.id], j = proj[p.id];
    return el('article', { className: 'card' }, face(p), el('strong', {}, p.name),
      el('small', {}, `${p.group === 'P' ? 'Pitcher' : 'Position'}, age ${p.age}`),
      el('div', { className: 'war' }, j?.war != null ? `${j.war.toFixed(1)} WAR` : 'No proj.'),
      el('small', { title: c?.note || '' }, c?.salary != null ? `${money(c.salary)} (${c.type})` : 'Salary missing'));
  }));
  const chosen = $('who').value;
  $('who').replaceChildren(...players.filter(p => proj[p.id]?.war != null).map(p => el('option', { value: p.id }, p.name)));
  if (chosen && proj[chosen]) $('who').value = chosen;
  score();
}
function score() {
  const p = players.find(x => x.id === $('who').value), cost = Number($('cost').value);
  if (!p) return $('score').textContent = 'Get projections to score a move.';
  const r = processScore({ war: proj[p.id].war, cost, age: p.age }, [], settings);
  $('score').textContent = `Projected surplus: ${money(r.surplus)} in year one.`;
}
$('load').onclick = async () => {
  try {
    if (players.length) return say('Snapshot already loaded. It stays locked.');
    const res = await fetch(`orioles_roster_${SNAP}.csv`);
    if (!res.ok) throw new Error('Roster CSV not found next to index.html');
    const rows = parseCSV(await res.text());
    await db.put('teams', { id: 'BAL', name: 'Baltimore Orioles', mlbId: 110 });
    await db.put('seasons', { id: '2027', status: 'open' });
    await db.put('snapshots', { id: SNAP, seasonId: '2027', teamId: 'BAL' });
    for (const r of rows) {
      const id = r.mlb_id || r.name;
      await db.put('players', { id, mlbId: r.mlb_id, name: r.name, group: r.group, age: +r.age });
      await db.put('contracts', { id: `${SNAP}:${id}`, playerId: id, snapshotId: SNAP,
        salary: r.salary_2027_millions === '' ? null : +r.salary_2027_millions, type: r.salary_type, note: r.contract_note });
    }
    say(`Loaded ${rows.length} players.`); await refresh();
  } catch (e) { say(`Couldn't load the snapshot. ${e.message}.`); }
};
$('proj').onclick = async () => {
  const ids = players.filter(p => p.mlbId).map(p => p.mlbId);
  if (!ids.length) return say('Load the snapshot first.');
  if (Object.keys(proj).length) return say('Projections are already saved for this snapshot.');
  say('Getting stats from MLB…');
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people?personIds=${ids}&hydrate=stats(group=[hitting,pitching],type=[yearByYear])`);
    if (!res.ok) throw new Error(`MLB returned ${res.status}`);
    const { people } = await res.json();
    for (const p of players) {
      const m = people.find(x => String(x.id) === p.mlbId); const group = p.group === 'P' ? 'pitching' : 'hitting';
      const splits = m?.stats?.find(s => s.group.displayName === group)?.splits || [];
      const out = (p.group === 'P' ? pitcher : hitter)(splits, p.age + 1);
      await db.put('projections', { id: `${SNAP}:${p.id}`, playerId: p.id, snapshotId: SNAP, source: 'homegrown-v1', ...(out || { war: null }) });
    }
    await refresh(); say('Projections saved. They cover batting or pitching only.');
  } catch (e) { say(`Couldn't get projections. ${e.message}. Try again.`); }
};
$('photos').onchange = async e => { settings.photos = e.target.checked; await db.put('settings', settings); render(); };
$('who').onchange = $('cost').oninput = score;
$('export').onclick = async () => {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(await db.backup())], { type: 'application/json' })), download: 'front-office-backup.json' });
  a.click(); URL.revokeObjectURL(a.href);
};
$('restore').onchange = async e => {
  try { await db.restore(JSON.parse(await e.target.files[0].text())); await refresh(); say('Backup restored.'); }
  catch (err) { say(`Couldn't restore. ${err.message}.`); }
};
const LABELS = { dollarsPerWar: 'Market $M per WAR', injuryBase: 'Base injury discount (0-1)', injuryPerYearOver30: 'Added per year over 30', rosterSpotCost: '40-man spot cost ($M)' };
await refresh();
$('settings').replaceChildren(...Object.entries(LABELS).map(([k, label]) => {
  const i = el('input', { type: 'number', step: 'any', min: 0, value: settings[k] });
  i.onchange = async () => { settings[k] = Number(i.value); await db.put('settings', settings); score(); };
  return el('label', {}, label, i);
}));
