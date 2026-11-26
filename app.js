import * as db from './db.js';
import { parseCSV } from './csv.js';
import { hitter, pitcher } from './projections.js';
import { DEFAULTS, processScore } from './grading.js';
import { forecast } from './forecast.js';
import { TIERS, AAV, active, payroll } from './payroll.js';

const SNAP = '2026-11-25', API = 'https://statsapi.mlb.com/api/v1', $ = id => document.getElementById(id);
const BASE = { id: 'main', ...DEFAULTS, photos: true, mode: 'realistic', custom: 180, realisticBudget: 170, otherTaxCosts: 18, decline28to30: .25, declineFrom31: .5 };
let all = [], roster = [], agents = [], contracts = {}, proj = {}, log = [], snapId = SNAP, settings = BASE, picked = null;
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const money = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(1) + 'M';
const say = t => $('msg').textContent = t;
const plain = s => s.normalize('NFD').replace(/[̀-ͯ.]/g, '').toLowerCase();
const war = p => proj[p.id]?.war ?? null;
const sorter = key => (a, b) => key === 'name' ? a.name.localeCompare(b.name) : key === 'age' ? (a.age ?? 99) - (b.age ?? 99)
  : key === 'salary' ? (contracts[b.id]?.salary ?? -1) - (contracts[a.id]?.salary ?? -1) : (war(b) ?? -99) - (war(a) ?? -99);

async function refresh() {
  settings = { ...BASE, ...(await db.all('settings'))[0] };
  all = await db.all('players'); roster = all.filter(p => !p.fa); agents = all.filter(p => p.fa);
  const snaps = (await db.all('snapshots')).map(s => s.id).sort(); snapId = snaps.at(-1) || SNAP;
  contracts = Object.fromEntries((await db.all('contracts')).filter(c => c.snapshotId === snapId).map(c => [c.playerId, c]));
  proj = Object.fromEntries((await db.all('projections')).map(p => [p.playerId, p]));
  log = (await db.all('decisions')).sort((a, b) => a.at.localeCompare(b.at));
  render();
}
function face(p) {
  const box = el('div', { className: 'face' }, p.name.split(' ').map(w => w[0]).slice(0, 2).join(''));
  if (settings.photos && p.mlbId) {
    const img = el('img', { alt: '', loading: 'lazy', referrerPolicy: 'no-referrer',
      src: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${p.mlbId}/headshot/67/current` });
    img.onerror = () => img.remove(); box.append(img);
  }
  return box;
}
function fit(p) {
  if (war(p) === null) return 'No projection';
  const pitch = p.group === 'P';
  const peers = roster.filter(r => pitch ? r.group === 'P' : r.pos === p.pos).map(war).filter(v => v !== null).sort((a, b) => b - a);
  if (!pitch && !roster.some(r => r.pos)) return 'Fit unknown';
  const bar = peers[pitch ? 4 : 0] ?? 0;
  return war(p) > bar + .5 ? 'Upgrade' : war(p) > bar - .5 ? 'Similar' : 'Depth';
}
function card(p) {
  const c = contracts[p.id], w = war(p), gone = active(log).some(d => d.playerId === p.id && ['release', 'nontender'].includes(d.type));
  const signed = active(log).find(d => d.playerId === p.id && ['sign', 'minor'].includes(d.type));
  const box = el('article', { className: 'card' }, face(p), el('strong', {}, p.name),
    el('small', {}, `${p.pos || (p.group === 'P' ? 'Pitcher' : 'Position')}, age ${p.age ?? '?'}`),
    el('div', { className: 'war' }, w === null ? 'No proj.' : `${w.toFixed(1)} WAR`));
  if (p.fa) box.append(el('small', {}, w === null ? 'No model value' : `Model value ${money(Math.max(.8, w * settings.dollarsPerWar))}`),
    el('div', {}, el('span', { className: 'tag' }, signed ? 'In your plan' : fit(p))));
  else box.append(el('small', { title: c?.note || '' }, gone ? 'Removed in your plan' : c?.salary != null ? `${money(c.salary)} (${c.type})` : 'Salary missing'));
  box.append(el('button', { onclick: () => openMove(p) }, 'Make move'));
  return box;
}
function meter(label, value, limit, marks = []) {
  const max = Math.max(value, limit, ...marks, 1) * 1.05, over = value > limit;
  const bar = el('div', { className: over ? 'bar over' : 'bar' }, el('i', { style: `width:${value / max * 100}%` }),
    ...marks.map(m => el('u', { style: `left:${m / max * 100}%`, title: money(m) })));
  return el('div', {}, el('div', {}, `${label}: ${money(value)}. ${over ? 'Over by ' + money(value - limit) : 'Room ' + money(limit - value)}`), bar);
}
function render() {
  const p = payroll(roster.concat(agents.filter(a => log.some(d => d.playerId === a.id))).filter(x => !x.fa), contracts, log, settings.otherTaxCosts);
  const stat = (l, v) => el('div', {}, l, el('b', {}, v));
  $('stats').replaceChildren(stat('40-man', `${p.spots}/40`), stat('Est. tax bill', money(p.bill)), stat('Salaries missing', String(p.missing)), stat('Moves', String(active(log).length)));
  const budget = settings.mode === 'unleashed' ? TIERS[0].at : settings.mode === 'custom' ? settings.custom : settings.realisticBudget;
  const onTax = settings.mode === 'unleashed';
  $('meters').replaceChildren(
    meter(onTax ? 'Cash payroll (known)' : 'Cash payroll (known) vs budget', p.cash, onTax ? TIERS[0].at : budget),
    meter(onTax ? 'Tax payroll vs budget' : 'Tax payroll vs first threshold', p.tax, onTax ? budget : TIERS[0].at, TIERS.map(t => t.at)),
    el('small', {}, `Gold marks: ${TIERS.map(t => '$' + t.at + 'M').join(', ')} (2026 rules; 2027 depends on the new labor deal). Estimates include ${money(settings.otherTaxCosts)} of other tax costs.${p.spots > 40 ? ' Your 40-man is over the limit.' : ''}`));
  $('mode').value = settings.mode; $('custom').value = settings.custom; $('customwrap').hidden = settings.mode !== 'custom';
  $('photos').checked = settings.photos; $('snap').textContent = roster.length ? `Orioles, snapshot ${snapId.replace('T', ' ')}` : 'No snapshot loaded';
  const f = $('filter').value;
  $('roster').replaceChildren(...roster.filter(x => f === 'all' || x.group === f).sort(sorter($('sort').value)).map(card));
  const spots = [...new Set(roster.map(x => x.pos).filter(Boolean))].sort();
  $('depth').replaceChildren(...(spots.length ? spots.map(s => el('div', {}, el('h2', {}, s), ...roster.filter(x => x.pos === s).sort(sorter('war')).map(x => el('div', {}, `${x.name} ${war(x)?.toFixed(1) ?? '-'}`)))) : [el('p', {}, 'Load free agents to fill in positions.')]));
  const fp = $('fapos').value;
  $('fapos').replaceChildren(el('option', { value: 'all' }, 'All'), ...[...new Set(agents.map(a => a.pos))].sort().map(s => el('option', { value: s }, s))); $('fapos').value = fp;
  $('market').replaceChildren(...agents.filter(x => fp === 'all' || x.pos === fp).sort(sorter($('fasort').value)).map(card));
  const voided = new Set(log.map(d => d.voids));
  $('timeline').replaceChildren(...(log.length ? [...log].reverse().map(d => {
    const item = el('article', { className: 'panel' }, el('strong', { className: voided.has(d.id) ? 'voided' : '' }, `${d.label}: ${d.name}`),
      el('div', {}, new Date(d.at).toLocaleString()));
    if (d.type !== 'void') item.append(el('div', {}, `${d.years} yr at ${money(d.aav)}. Expected ${d.expectedWar} WAR, ${d.confidence.toLowerCase()} confidence. Process surplus ${d.process ? money(d.process.surplus) : 'not scored'}.${d.process?.vsBest != null ? ` Versus best alternative ${money(d.process.vsBest)}.` : ''}`));
    if (d.forecast?.length > 1) item.append(el('div', {}, `Forecast surplus over ${d.forecast.length} years: ${money(d.forecast.reduce((a, r) => a + r.surplus, 0))}.`));
    item.append(el('p', {}, d.why));
    if (d.alternatives?.length || d.other) item.append(el('small', {}, `Alternatives: ${[...(d.alternatives || []).map(a => a.name), d.other].filter(Boolean).join(', ')}`));
    if (d.type !== 'void' && !voided.has(d.id)) item.append(el('div', {}, el('button', { className: 'quiet', onclick: () => voidMove(d) }, 'Void')));
    return item;
  }) : [el('p', {}, 'Make your first move from the roster or free agent board.')]));
  const who = $('fixwho').value;
  $('fixwho').replaceChildren(...[...roster].sort(sorter('name')).map(x => el('option', { value: x.id }, x.name))); if (who) $('fixwho').value = who;
}
const TYPES = { fa: { sign: 'Sign', minor: 'Minor league deal' }, own: { tender: 'Tender', nontender: 'Non-tender', extend: 'Extend', release: 'Release' } };
const modelValue = p => Math.max(.8, war(p) * settings.dollarsPerWar);
let typedCost = false;
// Fill the yearly cost unless you've typed your own.
function fillCost() {
  if (typedCost) return;
  const type = $('mtype').value, model = war(picked) === null ? '' : modelValue(picked).toFixed(1);
  $('maav').value = type === 'sign' || type === 'extend' ? model : type === 'minor' ? '0.8' : contracts[picked.id]?.salary ?? '';
}
function openMove(p) {
  picked = p; $('moveform').reset();
  $('movename').textContent = p.name; $('movewar').textContent = war(p) === null ? 'No projection saved, so there is no projected value.' : `Projected ${war(p).toFixed(1)} WAR. Model value ${money(modelValue(p))} per year.`;
  $('mtype').replaceChildren(...Object.entries(TYPES[p.fa ? 'fa' : 'own']).map(([v, t]) => el('option', { value: v }, t)));
  typedCost = false; $('mwar').value = war(p)?.toFixed(1) ?? '';
  $('malts').replaceChildren(...agents.filter(a => a.id !== p.id).sort(sorter('war')).map(a => el('option', { value: a.id }, `${a.name} (${a.pos}, ${war(a)?.toFixed(1) ?? '-'} WAR)`)));
  fillCost(); scoreMove(); $('move').showModal();
}
const altList = () => [...$('malts').selectedOptions].map(o => agents.find(a => a.id === o.value))
  .map(a => ({ id: a.id, name: a.name, age: a.age, war: war(a), cost: war(a) === null ? null : Math.max(.8, war(a) * settings.dollarsPerWar) }));
function scoreNow() {
  if (war(picked) === null || $('maav').value === '' || !['sign', 'minor', 'extend', 'tender'].includes($('mtype').value)) return null;
  return processScore({ war: war(picked), cost: +$('maav').value, age: picked.age }, altList().filter(a => a.war !== null), settings);
}
function forecastNow() {
  const years = Math.floor(+$('myears').value);
  if (war(picked) === null || picked.age == null || $('maav').value === '' || !(years >= 1 && years <= 15) || !['sign', 'minor', 'extend', 'tender'].includes($('mtype').value)) return null;
  return forecast({ war: war(picked), age: picked.age, cost: +$('maav').value, years }, settings);
}
function showForecast() {
  const rows = forecastNow(); $('mforecast').hidden = !rows; if (!rows) return;
  const line = (cells, tag = 'td') => el('tr', {}, ...cells.map(c => el(tag, {}, String(c))));
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  $('mrows').replaceChildren(line(['Year', 'Age', 'WAR', 'Value', 'Surplus'], 'th'),
    ...rows.map(r => line([r.season, r.age, r.war.toFixed(1), money(r.value), money(r.surplus)])),
    line(['Total', '', sum('war').toFixed(1), money(sum('value')), money(sum('surplus'))], 'th'));
}
function scoreMove() {
  showForecast();
  const s = scoreNow();
  if (!s) { $('mscore').textContent = war(picked) === null ? '' : 'Enter a cost to see the surplus. Cuts are not scored.'; return; }
  const gap = modelValue(picked) - $('maav').value, years = +$('myears').value || 1;
  $('mscore').textContent = `Your cost is ${money(Math.abs(gap))} ${gap >= 0 ? 'below' : 'above'} model value. Year-one surplus: ${money(s.surplus)} (includes any injury discount). Total commitment: ${money($('maav').value * years)}.`;
}
async function voidMove(d) {
  const why = prompt('Why are you voiding this move?'); if (!why?.trim()) return;
  await db.add('decisions', { id: crypto.randomUUID(), type: 'void', label: 'Voided', voids: d.id, playerId: d.playerId, name: d.name, why: why.trim(), at: new Date().toISOString() });
  await refresh();
}
$('moveform').onsubmit = async e => {
  e.preventDefault(); const type = $('mtype').value, p = picked;
  if (!$('mwhy').value.trim()) return say('Add your reasoning.');
  if (active(log).some(d => d.playerId === p.id && d.type === type)) { $('mscore').textContent = 'You already have this move. Void it first.'; return; }
  await db.add('decisions', { id: crypto.randomUUID(), type, label: $('mtype').selectedOptions[0].text, playerId: p.id, name: p.name,
    years: +$('myears').value, aav: +$('maav').value, expectedWar: +$('mwar').value, confidence: $('mconf').value, why: $('mwhy').value.trim(),
    alternatives: altList(), other: $('mother').value.trim(), at: new Date().toISOString(), snapshotId: snapId,
    projection: proj[p.id] || null, assumptions: { ...settings }, process: scoreNow(), forecast: forecastNow() });
  $('move').close(); await refresh(); say(`Move locked: ${p.name}.`);
};
$('maav').addEventListener('input', () => typedCost = true);
$('mtype').addEventListener('input', () => { fillCost(); scoreMove(); });
$('cancel').onclick = () => $('move').close();
for (const id of ['mtype', 'maav', 'malts', 'myears']) $(id).oninput = scoreMove;

async function getStats(ids) {
  const res = await fetch(`${API}/people?personIds=${ids}&hydrate=stats(group=[hitting,pitching],type=[yearByYear])`);
  if (!res.ok) throw new Error(`MLB returned ${res.status}`);
  return (await res.json()).people;
}
function project(p, m) {
  const group = p.group === 'P' ? 'pitching' : 'hitting';
  const splits = m?.stats?.find(s => s.group.displayName === group)?.splits || [];
  const out = p.age == null ? null : (p.group === 'P' ? pitcher : hitter)(splits, p.age + 1);
  return { id: `${SNAP}:${p.id}`, playerId: p.id, snapshotId: SNAP, source: 'homegrown-v1', ...(out || { war: null }) };
}
const spot = m => { const a = m?.primaryPosition?.abbreviation; return ['LF', 'CF', 'RF'].includes(a) ? 'OF' : a; };
$('load').onclick = async () => {
  try {
    if (roster.length) return say('Snapshot already loaded. It stays locked.');
    const res = await fetch(`orioles_roster_${SNAP}.csv`); if (!res.ok) throw new Error('Roster CSV not found');
    await db.put('teams', { id: 'BAL', name: 'Baltimore Orioles', mlbId: 110 });
    await db.put('seasons', { id: '2027', status: 'open' }); await db.put('snapshots', { id: SNAP, seasonId: '2027', teamId: 'BAL' });
    for (const r of parseCSV(await res.text())) {
      const id = r.mlb_id || r.name;
      await db.put('players', { id, mlbId: r.mlb_id, name: r.name, group: r.group, age: +r.age });
      await db.put('contracts', { id: `${SNAP}:${id}`, playerId: id, snapshotId: SNAP, salary: r.salary_2027_millions === '' ? null : +r.salary_2027_millions, type: r.salary_type, note: r.contract_note });
    }
    await refresh(); say('Snapshot loaded.');
  } catch (e) { say(`Couldn't load the snapshot. ${e.message}.`); }
};
$('proj').onclick = async () => {
  if (!roster.length) return say('Load the snapshot first.');
  if (roster.some(p => proj[p.id])) return say('Projections are already saved.');
  say('Getting stats from MLB…');
  try { const people = await getStats(roster.filter(p => p.mlbId).map(p => p.mlbId));
    for (const p of roster) await db.put('projections', project(p, people.find(x => String(x.id) === p.mlbId)));
    await refresh(); say('Projections saved.');
  } catch (e) { say(`Couldn't get projections. ${e.message}. Try again.`); }
};
$('fa').onclick = async () => {
  if (!roster.length) return say('Load the snapshot first.');
  if (agents.length) return say('Free agents are already loaded.');
  $('fa').disabled = true; say('Matching players with MLB records…');
  try {
    const res = await fetch(`free_agents_${SNAP}.csv`); if (!res.ok) throw new Error('Free agent CSV not found');
    const rows = parseCSV(await res.text());
    // Only accept a single exact name match among active players.
    const found = await Promise.all(rows.map(async r => {
      const q = await fetch(`${API}/people/search?names=${encodeURIComponent(r.name)}`); if (!q.ok) throw new Error(`MLB returned ${q.status}`);
      const hits = ((await q.json()).people || []).filter(m => plain(m.fullName) === plain(r.name) && m.active);
      return hits.length === 1 ? hits[0] : null;
    }));
    const own = roster.filter(p => p.mlbId).map(p => p.mlbId);
    const people = await getStats(found.filter(Boolean).map(m => m.id).concat(own));
    for (const p of roster) { const m = people.find(x => String(x.id) === p.mlbId); if (spot(m)) await db.put('players', { ...p, pos: spot(m) }); }
    for (const [i, r] of rows.entries()) {
      const m = people.find(x => x.id === found[i]?.id);
      const p = { id: `fa:${r.name}`, fa: true, mlbId: m ? String(m.id) : '', name: r.name, pos: r.position, group: /P$/.test(r.position) ? 'P' : 'Position', age: m?.currentAge ?? null, listedBy: r.listed_by };
      await db.put('players', p); await db.put('projections', project(p, m));
    }
    await refresh(); say(`Loaded ${rows.length} free agents. ${found.filter(m => !m).length} had no MLB match.`);
  } catch (e) { say(`Couldn't load free agents. ${e.message}. Try again.`); }
  $('fa').disabled = false;
};
$('fix').onsubmit = async e => {
  e.preventDefault(); const target = $('fixwho').value, id = new Date().toISOString().slice(0, 23);
  const old = Object.values(contracts);
  const next = { ...(contracts[target] || { playerId: target }), salary: +$('fixcash').value, aav: +$('fixaav').value, type: 'my fix' };
  await db.add('snapshots', { id, seasonId: '2027', teamId: 'BAL' });
  for (const c of old.filter(c => c.playerId !== target).concat(next)) await db.add('contracts', { ...c, id: `${id}:${c.playerId}`, snapshotId: id });
  await refresh(); say('Salary fix saved.');
};
const show = tab => { document.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== tab);
  $('tabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false')); say(''); };
$('tabs').onclick = e => e.target.dataset.tab && show(e.target.dataset.tab);
for (const id of ['filter', 'sort', 'fapos', 'fasort']) $(id).onchange = render;
const save = async () => { await db.put('settings', settings); render(); };
$('photos').onchange = e => { settings.photos = e.target.checked; save(); };
$('mode').onchange = e => { settings.mode = e.target.value; save(); };
$('custom').onchange = e => { settings.custom = +e.target.value; save(); };
$('export').onclick = async () => {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(await db.backup())], { type: 'application/json' })), download: `front-office-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$('restore').onchange = async e => { try { await db.restore(JSON.parse(await e.target.files[0].text())); await refresh(); say('Backup restored.'); } catch (err) { say(`Couldn't restore. ${err.message}.`); } };
const LABELS = { realisticBudget: 'Realistic budget ($M cash)', otherTaxCosts: 'Other tax payroll costs ($M)', dollarsPerWar: 'Market $M per WAR', injuryBase: 'Base injury discount (0-1)', injuryPerYearOver30: 'Added per year over 30', rosterSpotCost: '40-man spot cost ($M)', decline28to30: 'WAR lost per year, ages 28-30', declineFrom31: 'WAR lost per year, 31 and up' };
show('dash'); await refresh();
// One-time correction: Peralta's reported terms were blank in the first snapshot.
const fp = roster.find(p => p.name === 'Freddy Peralta');
if (fp && contracts[fp.id]?.salary === null && snapId === SNAP) {
  const id = '2026-11-25T23:59';
  await db.put('snapshots', { id, seasonId: '2027', teamId: 'BAL' });
  for (const c of Object.values(contracts)) await db.put('contracts', { ...c, ...(c.playerId === fp.id ? { salary: 23, aav: 25, type: 'reported', note: '5 yr $125M; $23M salary, $10M bonus timing not applied' } : {}), id: `${id}:${c.playerId}`, snapshotId: id });
  await refresh();
}
$('settings').replaceChildren(...Object.entries(LABELS).map(([k, label]) => {
  const i = el('input', { type: 'number', step: 'any', min: 0, value: settings[k] });
  i.onchange = () => { settings[k] = Number(i.value); save(); };
  return el('label', {}, label, i);
}));
const today = new Date().toLocaleDateString('en-CA');
$('lock').textContent = today >= '2026-12-02' ? 'A lockout was expected from Dec. 2. Check its status before treating a new move as realistic.' : 'Labor deal expires Dec. 1. A lockout is expected to freeze moves after that.';
