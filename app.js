import * as db from './db.js?v=7';
import { parseCSV } from './csv.js';
import { hitter, pitcher } from './projections.js';
import { DEFAULTS, processScore } from './grading.js';
import { forecast } from './forecast.js';
import { TIERS, active, payroll } from './payroll.js?v=7';
import { projectStats, COLUMNS } from './stats.js?v=7';
import { drawTrade, setupTrade, clearReceived, search } from './tradeui.js?v=7';
import { terms, importRows, plain } from './contracts.js?v=7';
import { SPOTS, leagueNeeds } from './needs.js?v=7';

const SNAP = '2026-11-25', API = 'https://statsapi.mlb.com/api/v1', $ = id => document.getElementById(id);
const BASE = { id: 'main', ...DEFAULTS, photos: true, mode: 'realistic', custom: 180, realisticBudget: 170, otherTaxCosts: 18, decline28to30: .25, declineFrom31: .5, statYears: 3 };
let history = {}, edits = {}, fixes = {}, imports = {}, teams = [], needs = null, effective = new Map(), statCache = new Map();
const MINE = '110';
const ORDER = ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'DH', 'TWP'];
let all = [], roster = [], agents = [], contracts = {}, proj = {}, log = [], snapId = SNAP, settings = BASE, picked = null;
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const money = v => (v <= -.05 ? '-$' : '$') + Math.abs(v).toFixed(1) + 'M';
const say = t => $('msg').textContent = t;
const war = p => proj[p.id]?.war ?? null;
const byWar = (a, b) => (war(b) ?? -99) - (war(a) ?? -99) || a.name.localeCompare(b.name);
const statsFor = p => {
  if (!history[p.id]) return null;
  if (!statCache.has(p.id)) statCache.set(p.id, projectStats(history[p.id], p.group === 'P', settings.statYears));
  return statCache.get(p.id);
};
function termsFor(p) {
  if (!effective.has(p.id)) {
    const t = terms(p, { war: war(p), splits: history[p.id], edit: edits[p.id], fix: fixes[p.id], imported: imports[p.mlbId] || imports[plain(p.name)], settings });
    const ext = !edits[p.id] && active(log).findLast(d => d.type === 'extend' && d.playerId === p.id);
    effective.set(p.id, ext ? { pay: Array(Math.max(1, Math.floor(ext.years))).fill(ext.aav), aav: ext.aav, source: 'your extension', owed: true } : t);
  }
  return effective.get(p.id);
}
// A team's players after your trades: players you got leave, players you gave arrive.
function rosterOf(id) {
  const trades = active(log).filter(d => d.type === 'trade');
  const gone = traded('get'), arrived = new Set(trades.filter(d => d.teamId === id).flatMap(d => d.give.map(p => p.id)));
  return all.filter(p => (p.team === id && !gone.has(p.id)) || arrived.has(p.id));
}
function myRoster() {
  const off = new Set([...traded('give'), ...active(log).filter(d => ['release', 'nontender'].includes(d.type)).map(d => d.playerId)]);
  const signed = new Set(active(log).filter(d => d.type === 'sign').map(d => d.playerId));
  return all.filter(p => (!p.team && !p.fa && !off.has(p.id)) || traded('get').has(p.id) || signed.has(p.id));
}
// League ranks need all 29 other rosters saved.
function computeNeeds() {
  if (!roster.length || teams.length < 29 || !teams.every(t => all.some(p => p.team === t.id))) return null;
  const spots = list => list.map(p => ({ spot: section(p), war: war(p) }));
  return leagueNeeds(new Map([[MINE, spots(myRoster())], ...teams.map(t => [t.id, spots(rosterOf(t.id))])]));
}
const teamName = id => teams.find(t => t.id === id)?.name || id;
const topNeeds = id => needs.get(id).slice(0, 3);
// Pitchers split into starters and relievers from games started.
function section(p) {
  if (p.group !== 'P') return p.pos && p.pos !== 'P' ? p.pos : 'Other';
  if (p.pos === 'SP' || p.pos === 'RP') return p.pos;
  const s = statsFor(p); return s ? (s.starter ? 'SP' : 'RP') : 'Pitchers, no MLB stats';
}
const traded = side => new Set(active(log).filter(d => d.type === 'trade').flatMap(d => d[side].map(p => p.id)));

async function refresh() {
  settings = { ...BASE, ...(await db.all('settings'))[0] };
  all = await db.all('players'); roster = all.filter(p => !p.fa && !p.team); agents = all.filter(p => p.fa);
  const snaps = (await db.all('snapshots')).map(s => s.id).sort(); snapId = snaps.at(-1) || SNAP;
  proj = Object.fromEntries((await db.all('projections')).map(p => [p.playerId, p]));
  history = Object.fromEntries((await db.all('results')).filter(r => r.id.startsWith('stats:')).map(r => [r.playerId, r.splits]));
  const rows = await db.all('contracts'), by = kind => Object.fromEntries(rows.filter(c => c.snapshotId === kind).map(c => [c.playerId, c]));
  edits = by('trade'); fixes = by('fix'); imports = by('import');
  statCache = new Map();
  teams = (await db.all('teams')).filter(t => t.id !== 'BAL' && t.id !== MINE).sort((a, b) => a.name.localeCompare(b.name));
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
  const out = traded('give').has(p.id), acquired = !!p.team;
  const box = el('article', { className: 'card' }, face(p), el('strong', {}, p.name),
    el('small', {}, `${section(p).startsWith('Pitchers') ? 'P' : section(p)}, age ${p.age ?? '?'}`),
    el('div', { className: 'war' }, w === null ? 'No proj.' : `${w.toFixed(1)} WAR`));
  const s = statsFor(p), cols = COLUMNS[p.group === 'P' ? 'pit' : 'hit'];
  if (s) box.append(el('div', { className: 'line' }, ...cols.slice(0, 4).map(([label, key, fmt]) => el('span', {}, `${label} ${fmt(s[key])}`))),
    el('small', {}, `${s.seasons} of ${settings.statYears} seasons${s.small ? ', small sample' : ''}`));
  else box.append(el('small', {}, history[p.id] ? 'No MLB stats in range' : 'Stats not loaded'));
  if (p.fa) box.append(el('small', {}, w === null ? 'No model value' : `Model value ${money(modelValue(p))}`),
    el('div', {}, el('span', { className: 'tag' }, signed ? 'In your plan' : fit(p))));
  else if (acquired) box.append(el('div', {}, el('span', { className: 'tag' }, 'Acquired by trade')));
  else box.append(el('small', {}, out ? 'Traded in your plan' : gone ? 'Removed in your plan' : `${money(c.salary)} (${c.type})`));
  const buttons = el('div', {}, el('button', { className: 'quiet', onclick: () => openDetail(p) }, 'Stats'));
  if (!out && !acquired) buttons.append(' ', el('button', { onclick: () => openMove(p) }, 'Make move'));
  box.append(buttons); return box;
}
function openDetail(p) {
  const s = statsFor(p), cols = COLUMNS[p.group === 'P' ? 'pit' : 'hit'];
  $('dname').textContent = p.name;
  const row = (cells, tag = 'td') => el('tr', {}, ...cells.map(c => el(tag, {}, c)));
  const t = p.fa ? null : termsFor(p), w = war(p);
  $('dbody').replaceChildren(el('p', {}, `${section(p)}, age ${p.age ?? '?'}, ${w === null ? 'no WAR projection' : `projected ${w.toFixed(1)} WAR`}.`),
    ...(t ? [el('p', {}, `Contract (${t.source}): ${t.pay.length} yr: ${t.pay.map(money).join(', ')}.`)] : []), ...(s ? [el('p', {}, `Projected from ${s.seasons} of the last ${settings.statYears} seasons, recent ones weighted more.${s.small ? ' Small sample.' : ''}`),
    el('div', { className: 'scroll' }, el('table', {}, row(['Season', ...cols.map(c => c[0])], 'th'), row(['Proj. 2027', ...cols.map(([, k, f]) => f(s[k]))], 'th'),
      ...s.history.map(h => row([String(h.season), ...cols.map(([, k, f]) => f(h[k]))]))))] : [el('p', {}, history[p.id] ? 'No MLB stats in these seasons.' : 'Press Refresh stats on the dashboard.')]));
  $('detail').showModal();
}
// Position headings, each ordered by projected WAR.
function sections(id, list) {
  const names = [...new Set(list.map(section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const blocks = names.map(n => el('section', {}, el('h2', {}, n), el('div', { className: 'grid' }, ...list.filter(p => section(p) === n).sort(byWar).map(card))));
  $(id).replaceChildren(...blocks);
  $(`${id}jump`).replaceChildren(...names.map((n, i) => el('button', { type: 'button', onclick: () => blocks[i].scrollIntoView({ behavior: 'smooth' }) }, n)));
}
function meter(label, value, limit, marks = []) {
  const max = Math.max(value, limit, ...marks, 1) * 1.05, over = value > limit;
  const bar = el('div', { className: over ? 'bar over' : 'bar' }, el('i', { style: `width:${value / max * 100}%` }),
    ...marks.map(m => el('u', { style: `left:${m / max * 100}%`, title: money(m) })));
  return el('div', {}, el('div', {}, `${label}: ${money(value)}. ${over ? 'Over by ' + money(value - limit) : 'Room ' + money(limit - value)}`), bar);
}
function renderNeeds(chosen) {
  const loaded = teams.filter(t => all.some(p => p.team === t.id)).length;
  const chips = (title, id, mine) => el('div', { className: 'needrow' }, el('strong', {}, title), ...topNeeds(id).map(n =>
    el('button', { type: 'button', className: 'need', disabled: !mine, title: mine ? 'Find a match' : '', onclick: () => search(n.spot) }, `${n.spot}: ${n.rank} of ${n.of}`)));
  $('scan').hidden = !!needs;
  $('needs').replaceChildren(...(needs ? [chips('Your needs', MINE, true), ...(chosen ? [chips(`${teamName(chosen)} needs`, chosen, false)] : []),
    el('small', {}, 'League rank by projected WAR (30 is weakest). OF counts three players, SP and RP five. Tap one of yours to find a match.')]
    : [el('p', {}, `Scan the league once to see who is weak where. ${loaded ? `${loaded} of 29 rosters saved.` : 'It can take a minute or two.'}`)]));
}
function renderTrade() {
  needs = computeNeeds();
  const chosen = $('team').value, want = $('needfilter').value;
  const shown = teams.filter(t => !needs || !want || t.id === chosen || topNeeds(t.id).some(n => n.spot === want));
  $('team').replaceChildren(el('option', { value: '' }, 'Choose a team'), ...shown.map(t => el('option', { value: t.id }, needs ? `${t.name}: needs ${topNeeds(t.id).map(n => n.spot).join(', ')}` : t.name)));
  $('team').value = chosen;
  $('needwrap').hidden = $('matchbox').hidden = !needs;
  const spot = $('matchspot').value;
  if (needs) { const order = needs.get(MINE);
    $('matchspot').replaceChildren(...order.map(n => el('option', { value: n.spot }, `${n.spot} (rank ${n.rank} of ${n.of})`))); $('matchspot').value = spot || order[0].spot; }
  renderNeeds(chosen);
  const unavailable = new Set([...traded('give'), ...traded('get'), ...active(log).filter(d => ['sign', 'release', 'nontender'].includes(d.type)).map(d => d.playerId)]);
  drawTrade({ el, face, war, section, byWar, settings, terms: termsFor, openDetail, needs, myId: MINE, teamIds: teams.map(t => t.id), teamName,
    unavailable, own: myRoster(), theirs: rosterOf, chooseTeam: id => { $('needfilter').value = ''; renderTrade(); $('team').value = id; renderTrade(); $('matches').replaceChildren(); },
    saveEdit: async (playerId, e) => { await db.put('contracts', { id: `trade:${playerId}`, playerId, snapshotId: 'trade', ...e }); await refresh(); } });
}
function render() {
  effective = new Map();
  contracts = Object.fromEntries(all.filter(x => !x.fa).map(x => { const t = termsFor(x); return [x.id, { salary: t.pay[0], aav: t.aav, type: t.source, owed: t.owed }]; }));
  const p = payroll(roster.concat(agents.filter(a => log.some(d => d.playerId === a.id))).filter(x => !x.fa), contracts, log, settings.otherTaxCosts);
  const stat = (l, v) => el('div', {}, l, el('b', {}, v));
  $('stats').replaceChildren(stat('40-man', `${p.spots}/40`), stat('Est. tax bill', money(p.bill)), stat('Estimated salaries', String(roster.filter(x => contracts[x.id].type === 'estimate').length)), stat('Moves', String(active(log).length)));
  const budget = settings.mode === 'unleashed' ? TIERS[0].at : settings.mode === 'custom' ? settings.custom : settings.realisticBudget;
  const onTax = settings.mode === 'unleashed';
  $('meters').replaceChildren(
    meter(onTax ? 'Cash payroll (known)' : 'Cash payroll (known) vs budget', p.cash, onTax ? TIERS[0].at : budget),
    meter(onTax ? 'Tax payroll vs budget' : 'Tax payroll vs first threshold', p.tax, onTax ? budget : TIERS[0].at, TIERS.map(t => t.at)),
    el('small', {}, `Gold marks: ${TIERS.map(t => '$' + t.at + 'M').join(', ')} (2026 rules; 2027 depends on the new labor deal). Estimates include ${money(settings.otherTaxCosts)} of other tax costs.${p.spots > 40 ? ' Your 40-man is over the limit.' : ''}`));
  $('mode').value = settings.mode; $('custom').value = settings.custom; $('customwrap').hidden = settings.mode !== 'custom';
  $('photos').checked = settings.photos; $('snap').textContent = roster.length ? `Orioles 40-man${settings.rosterDate ? `, loaded ${settings.rosterDate}` : ''}` : 'No roster loaded';
  $('imported').textContent = Object.keys(imports).length ? `${Object.keys(imports).length} contracts imported.` : 'No file imported. All contracts are estimates unless you change them.';
  const acquired = all.filter(p => traded('get').has(p.id));
  sections('roster', roster.concat(acquired));
  sections('market', agents);
  document.querySelectorAll('.window').forEach(w => w.value = settings.statYears);
  renderTrade();
  const voided = new Set(log.map(d => d.voids));
  $('timeline').replaceChildren(...(log.length ? [...log].reverse().map(d => {
    const item = el('article', { className: 'panel' }, el('strong', { className: voided.has(d.id) ? 'voided' : '' }, `${d.label}: ${d.name}`),
      el('div', {}, new Date(d.at).toLocaleString()));
    if (d.type === 'trade') {
      const names = list => list.map(p => `${p.name} (${p.surplus === null ? 'not valued' : money(p.surplus)}; ${p.source})`).join(', ');
      item.append(el('div', {}, `Gave: ${names(d.give)}`), el('div', {}, `Got: ${names(d.get)}`),
        el('div', {}, `Net projected surplus ${money(d.process.surplus)}${d.process.unvalued ? ' (incomplete)' : ''}. ${d.confidence} confidence.`));
    } else if (d.type !== 'void') item.append(el('div', {}, `${d.years} yr at ${money(d.aav)}. Expected ${d.expectedWar} WAR, ${d.confidence.toLowerCase()} confidence. Process surplus ${d.process ? money(d.process.surplus) : 'not scored'}.${d.process?.vsBest != null ? ` Versus best alternative ${money(d.process.vsBest)}.` : ''}`));
    if (d.forecast?.length > 1) item.append(el('div', {}, `Forecast surplus over ${d.forecast.length} years: ${money(d.forecast.reduce((a, r) => a + r.surplus, 0))}.`));
    item.append(el('p', {}, d.why));
    if (d.alternatives?.length || d.other) item.append(el('small', {}, `Alternatives: ${[...(d.alternatives || []).map(a => a.name), d.other].filter(Boolean).join(', ')}`));
    if (d.type !== 'void' && !voided.has(d.id)) item.append(el('div', {}, el('button', { className: 'quiet', onclick: () => voidMove(d) }, 'Void')));
    return item;
  }) : [el('p', {}, 'Make your first move from the roster or free agent board.')]));
  const who = $('fixwho').value;
  $('fixwho').replaceChildren(...[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(x => el('option', { value: x.id }, x.name))); if (who) $('fixwho').value = who;
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
  $('malts').replaceChildren(...agents.filter(a => a.id !== p.id).sort(byWar).map(a => el('option', { value: a.id }, `${a.name} (${a.pos}, ${war(a)?.toFixed(1) ?? '-'} WAR)`)));
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
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const res = await fetch(`${API}/people?personIds=${ids.slice(i, i + 40)}&hydrate=stats(group=[hitting,pitching],type=[yearByYear])`);
    if (!res.ok) throw new Error(`MLB returned ${res.status}`);
    out.push(...(await res.json()).people);
  }
  return out;
}
function project(p, m) {
  const group = p.group === 'P' ? 'pitching' : 'hitting';
  const splits = m?.stats?.find(s => s.group.displayName === group)?.splits || [];
  const out = p.age == null ? null : (p.group === 'P' ? pitcher : hitter)(splits, p.age + 1);
  return { id: `${SNAP}:${p.id}`, playerId: p.id, snapshotId: SNAP, source: 'homegrown-v1', ...(out || { war: null }) };
}
const spot = m => { const a = m?.primaryPosition?.abbreviation; return ['LF', 'CF', 'RF'].includes(a) ? 'OF' : a; };
// Orioles 40-man straight from MLB. Existing projections are never overwritten.
async function loadOwnRoster() {
  const res = await fetch(`${API}/teams/${MINE}/roster?rosterType=40Man`); if (!res.ok) throw new Error(`MLB returned ${res.status}`);
  const list = (await res.json()).roster || []; if (!list.length) throw new Error('No players returned');
  const people = await getStats(list.map(r => r.person.id)), before = (await db.all('players')).filter(p => !p.fa && !p.team);
  const players = people.map(m => ({ ...before.find(p => p.id === String(m.id)), id: String(m.id), mlbId: String(m.id), name: m.fullName,
    age: before.find(p => p.id === String(m.id))?.age ?? m.currentAge ?? null, pos: spot(m), group: m.primaryPosition?.abbreviation === 'P' ? 'P' : 'Position' }));
  await db.put('teams', { id: 'BAL', name: 'Baltimore Orioles', mlbId: 110 });
  await db.put('seasons', { id: '2027', status: 'open' }); await db.put('snapshots', { id: SNAP, seasonId: '2027', teamId: 'BAL' });
  await saveStats(players, people);
  const have = new Set((await db.all('projections')).map(p => p.playerId));
  for (const p of players) if (!have.has(p.id)) await db.put('projections', project(p, people.find(x => String(x.id) === p.mlbId)));
  // Drop saved players who aren't on MLB's list, unless one of your moves refers to them.
  const used = new Set(log.flatMap(d => [d.playerId, ...(d.give || []).map(p => p.id)]));
  for (const p of before) if (!players.some(x => x.id === p.id) && !used.has(p.id)) await db.remove('players', p.id);
  settings.rosterSource = 'mlb'; settings.rosterDate = new Date().toLocaleDateString('en-CA'); await db.put('settings', settings);
}
$('load').onclick = async () => {
  if (roster.length && settings.rosterSource === 'mlb') return say('Roster already loaded. It stays locked.');
  $('load').disabled = true; say('Loading the Orioles from MLB…');
  try { await loadOwnRoster(); await refresh(); say('Roster loaded.'); }
  catch (e) { say(`Couldn't load the roster. ${e.message}. Try again.`); }
  $('load').disabled = false;
};
$('fa').onclick = async () => {
  if (!roster.length) return say('Load the roster first.');
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
  e.preventDefault(); const target = $('fixwho').value;
  await db.put('contracts', { id: `fix:${target}`, playerId: target, snapshotId: 'fix', salary: +$('fixcash').value, aav: +$('fixaav').value, at: new Date().toISOString() });
  // A newer fix replaces any trade-screen entry for this player.
  await db.remove('contracts', `trade:${target}`);
  await refresh(); say('Salary fix saved.');
};
$('importfile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const { good, skipped } = importRows(parseCSV(await file.text()));
    if (!good.length) throw new Error('No usable rows. Use the template columns');
    for (const r of good) await db.put('contracts', { id: `import:${r.key}`, playerId: r.key, snapshotId: 'import', salary: r.salary, years: r.years, aav: r.aav });
    await refresh(); say(`Imported ${good.length} contracts.${skipped ? ` Skipped ${skipped} incomplete rows.` : ''}`);
  } catch (err) { say(`Couldn't import. ${err.message}.`); }
  e.target.value = '';
};
$('template').onclick = () => download('contracts-template.csv', 'name,mlb_id,salary_millions,years,aav_millions\nExample Player,,12.5,3,12.5\n', 'text/csv');
$('unimport').onclick = async () => { for (const c of await db.all('contracts')) if (c.snapshotId === 'import') await db.remove('contracts', c.id); await refresh(); say('Imported contracts removed.'); };
const show = tab => { document.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== tab);
  $('tabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false')); say(''); };
$('tabs').onclick = e => { const t = e.target.dataset.tab; if (!t) return; show(t); if (t === 'trade') loadTeams(); };
document.querySelectorAll('.window').forEach(w => w.onchange = () => { settings.statYears = +w.value; save(); });
$('dclose').onclick = () => $('detail').close();
setupTrade(async t => {
  const names = list => list.map(p => p.name).join(', '), key = crypto.randomUUID(), teamId = $('team').value;
  await db.add('decisions', { id: key, type: 'trade', label: 'Trade', playerId: `trade:${key}`, name: `${names(t.give)} for ${names(t.get)}`, ...t,
    teamId, at: new Date().toISOString(), snapshotId: snapId, assumptions: { ...settings },
    projections: [...t.give, ...t.get].map(p => proj[p.id] || null) });
  $('donebody').replaceChildren(el('p', {}, `With ${teamName(teamId)}.`), el('p', {}, `You gave: ${names(t.give)}`), el('p', {}, `You got: ${names(t.get)}`),
    el('p', {}, `Net projected surplus ${money(t.process.surplus)}${t.process.unvalued ? ' (incomplete)' : ''}.`));
  $('matches').replaceChildren(); await refresh(); say('Trade saved.'); $('done').showModal();
});
$('doneclose').onclick = () => $('done').close();
$('doneview').onclick = () => { $('done').close(); show('log'); scrollTo({ top: 0 }); };
// Save each player's season history; saved WAR projections are never overwritten.
async function saveStats(players, people) {
  for (const p of players) { const m = people.find(x => String(x.id) === p.mlbId); if (!m) continue;
    const group = p.group === 'P' ? 'pitching' : 'hitting';
    await db.put('results', { id: `stats:${p.id}`, playerId: p.id, splits: m.stats?.find(s => s.group.displayName === group)?.splits || [] });
    const next = { ...p, pos: p.fa ? p.pos : spot(m) || p.pos, debut: m.mlbDebutDate ? +m.mlbDebutDate.slice(0, 4) : null };
    await db.put('players', next); }
}
$('stats5').onclick = async () => {
  const list = all.filter(p => p.mlbId); if (!list.length) return say('Load the roster first.');
  say('Getting season stats from MLB…');
  try { await saveStats(list, await getStats(list.map(p => p.mlbId))); await refresh(); say('Stats saved.'); }
  catch (e) { say(`Couldn't get stats. ${e.message}. Try again.`); }
};
async function loadTeamRoster(id) {
  const res = await fetch(`${API}/teams/${id}/roster?rosterType=40Man`); if (!res.ok) throw new Error(`MLB returned ${res.status}`);
  const list = (await res.json()).roster || []; if (!list.length) throw new Error('No players returned');
  const people = await getStats(list.map(r => r.person.id));
  const players = people.map(m => ({ id: `t:${id}:${m.id}`, team: id, mlbId: String(m.id), name: m.fullName, age: m.currentAge ?? null,
    pos: spot(m), group: m.primaryPosition?.abbreviation === 'P' ? 'P' : 'Position' }));
  // Projections first: players are saved last so a half-loaded team is retried.
  for (const p of players) await db.put('projections', project(p, people.find(x => String(x.id) === p.mlbId)));
  await saveStats(players, people);
  return players.length;
}
$('team').onchange = async () => {
  const id = $('team').value; clearReceived(); $('matches').replaceChildren();
  if (!id || all.some(p => p.team === id)) return renderTrade();
  say('Loading their 40-man roster…');
  try { const n = await loadTeamRoster(id); await refresh(); say(`Loaded ${n} players.`); }
  catch (e) { say(`Couldn't load that roster. ${e.message}. Choose another team, then try again.`); renderTrade(); }
};
$('needfilter').onchange = () => renderTrade();
$('scan').onclick = async () => {
  if (!roster.length) return say('Load the roster on the dashboard first.');
  $('scan').disabled = true;
  try {
    await loadTeams();
    if (!teams.length) throw new Error('No team list');
    const mine = roster.filter(p => p.mlbId && !history[p.id]);
    if (mine.length) await saveStats(mine, await getStats(mine.map(p => p.mlbId)));
    const left = teams.filter(t => !all.some(p => p.team === t.id));
    for (const [i, t] of left.entries()) { say(`Scanning ${t.name} (${i + 1} of ${left.length})…`); await loadTeamRoster(t.id); }
    await refresh(); say(needs ? 'League scanned.' : 'Scan finished, but some rosters are missing. Try again.');
  } catch (e) { await refresh(); say(`Scan stopped. ${e.message}. Press Scan league to continue.`); }
  $('scan').disabled = false;
};
async function loadTeams() {
  if (teams.length >= 29) return;
  try { const res = await fetch(`${API}/teams?sportId=1`); if (!res.ok) throw new Error(`MLB returned ${res.status}`);
    for (const t of (await res.json()).teams) if (t.id !== 110) await db.put('teams', { id: String(t.id), name: t.name, mlbId: t.id });
    await refresh();
  } catch (e) { say(`Couldn't load the team list. ${e.message}. Open Trade again to retry.`); }
}
const save = async () => { await db.put('settings', settings); statCache = new Map(); render(); };
$('photos').onchange = e => { settings.photos = e.target.checked; save(); };
$('mode').onchange = e => { settings.mode = e.target.value; save(); };
$('custom').onchange = e => { settings.custom = +e.target.value; save(); };
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}
$('export').onclick = async () => download(`front-office-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await db.backup()), 'application/json');
// Remove salary rows saved by earlier versions, keeping only what you typed.
async function cleanOldContracts() {
  const rows = await db.all('contracts');
  for (const c of rows.filter(c => c.type === 'my fix' && c.snapshotId !== 'fix').sort((a, b) => a.snapshotId.localeCompare(b.snapshotId)))
    await db.put('contracts', { id: `fix:${c.playerId}`, playerId: c.playerId, snapshotId: 'fix', salary: c.salary, aav: c.aav });
  for (const c of rows) if (!['trade', 'fix', 'import'].includes(c.snapshotId)) await db.remove('contracts', c.id);
}
async function upgrade() {
  await cleanOldContracts(); await refresh();
  if (!roster.length || settings.rosterSource === 'mlb') return;
  say('Updating your roster from MLB…');
  try { await loadOwnRoster(); await refresh(); say('Roster updated. Contracts are now estimates.'); }
  catch (e) { say(`Couldn't update the roster. ${e.message}. Press Load roster to retry.`); }
}
$('restore').onchange = async e => { try { await db.restore(JSON.parse(await e.target.files[0].text())); await upgrade(); say('Backup restored.'); } catch (err) { say(`Couldn't restore. ${err.message}.`); } };
const LABELS = { realisticBudget: 'Realistic budget ($M cash)', otherTaxCosts: 'Other tax payroll costs ($M)', dollarsPerWar: 'Market $M per WAR', injuryBase: 'Base injury discount (0-1)', injuryPerYearOver30: 'Added per year over 30', rosterSpotCost: '40-man spot cost ($M)', decline28to30: 'WAR lost per year, ages 28-30', declineFrom31: 'WAR lost per year, 31 and up' };
show('dash'); await refresh();
$('settings').replaceChildren(...Object.entries(LABELS).map(([k, label]) => {
  const i = el('input', { type: 'number', step: 'any', min: 0, value: settings[k] });
  i.onchange = () => { settings[k] = Number(i.value); save(); };
  return el('label', {}, label, i);
}));
const today = new Date().toLocaleDateString('en-CA');
$('lock').textContent = today >= '2026-12-02' ? 'A lockout was expected from Dec. 2. Check its status before treating a new move as realistic.' : 'Labor deal expires Dec. 1. A lockout is expected to freeze moves after that.';
await upgrade();
