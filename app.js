import * as db from './db.js?v=11';
import { parseCSV } from './csv.js';
import { hitter, pitcher } from './projections.js';
import { DEFAULTS, processScore } from './grading.js';
import { forecast } from './forecast.js';
import { TIERS, active, payroll, taxBill } from './payroll.js?v=11';
import { projectStats, COLUMNS } from './stats.js?v=11';
import { drawTrade, setupTrade, clearReceived, clearAll, search } from './tradeui.js?v=11';
import { terms, importRows, plain } from './contracts.js?v=11';
import { SPOTS, leagueNeeds } from './needs.js?v=11';
import { PAYROLL, tier, room, theyAfford, youAfford, importPayrolls } from './budgets.js?v=11';
import { byPlayer, signing, departure, moveStatus } from './news.js?v=11';
import { OPENING, boardState } from './timemachine.js?v=11';

const SNAP = '2026-11-25', API = 'https://statsapi.mlb.com/api/v1', $ = id => document.getElementById(id);
const BASE = { id: 'main', ...DEFAULTS, photos: true, mode: 'realistic', custom: 180, decline28to30: .25, declineFrom31: .5, statYears: 3, untouchable: [], budget2027: 185, baselineCash: 170, baselineTax: 186 };
let books = { cash: 0, tax: 0 }, submissions = [], news = new Map(), checked = null;
let history = {}, edits = {}, fixes = {}, imports = {}, teams = [], needs = null, effective = new Map(), statCache = new Map();
const MINE = '110';
// view is the Time Machine date; null means today. liveBefore is today's estimated roster cost.
let view = null, builtAt = null, liveBefore = null;
const dateText = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const addDecision = move => db.add('decisions', view ? { ...move, scenario: view } : move);
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
const payrolls = () => ({ ...PAYROLL, ...settings.payrolls });
const mlbId = id => all.find(p => p.id === id)?.mlbId;
const statusOf = d => moveStatus(d, news, mlbId);
const submittedIn = d => submissions.find(s => s.moves.some(m => m.id === d.id));
// What real transactions say has happened to a player since the roster snapshot.
function realNews(p) {
  if (p.fa) return signing(news.get(p.mlbId));
  return departure(news.get(p.mlbId), p.team ? Number(p.team) : Number(MINE));
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
  const results = await db.all('results'), tx = results.find(r => r.id === 'tx');
  submissions = results.filter(r => r.kind === 'submission').sort((a, b) => a.number - b.number);
  news = byPlayer(tx?.transactions || []); checked = tx?.at || null;
  submissions = submissions.filter(s => (s.scenario || null) === view);
  teams = (await db.all('teams')).filter(t => t.id !== 'BAL' && t.id !== MINE).sort((a, b) => a.name.localeCompare(b.name));
  log = (await db.all('decisions')).filter(d => (d.scenario || null) === view).sort((a, b) => a.at.localeCompare(b.at));
  if (view) { // A past board replaces today's players, and later real moves stay hidden.
    const board = results.find(r => r.id === `board:${view}`);
    all = board.players; roster = all.filter(p => !p.fa && !p.team); agents = all.filter(p => p.fa);
    proj = board.proj; history = board.history; builtAt = board.builtAt; snapId = view; news = new Map(); checked = null;
  }
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
// Untouchable players are never suggested by Find match.
function keepButton(p) {
  const on = settings.untouchable.includes(p.id);
  const b = el('button', { type: 'button', className: on ? 'keep on' : 'keep', title: 'Find match will never offer an untouchable player',
    onclick: () => { settings.untouchable = on ? settings.untouchable.filter(id => id !== p.id) : [...settings.untouchable, p.id]; $('matches').replaceChildren(); save(); } },
    on ? 'Untouchable ✓' : 'Untouchable');
  b.setAttribute('aria-pressed', String(on)); return b;
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
  const real = realNews(p);
  if (real) box.append(el('small', { className: 'caveat', title: real.text }, `Real news ${real.date}: ${real.kind === 'released' ? 'let go' : `to ${real.teamName}`}`));
  if (!out && !acquired && !real) buttons.append(' ', el('button', { onclick: () => openMove(p) }, 'Make move'));
  if (!p.fa && !out && !gone) buttons.append(el('div', {}, keepButton(p)));
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
// Salary already added to a team by your earlier trades with it.
const usedBy = id => active(log).filter(d => d.type === 'trade' && d.teamId === id)
  .reduce((a, d) => a + d.give.reduce((x, p) => x + p.pay[0], 0) - d.get.reduce((x, p) => x + p.pay[0], 0), 0);
const signed = v => (v >= .05 ? '+' : '') + money(v);
function checkMoney(teamId, give, get) {
  const out = give.map(p => p.pay[0]), back = get.map(p => p.pay[0]), sum = l => l.reduce((a, v) => a + v, 0), delta = sum(back) - sum(out);
  const left = settings.mode === 'unleashed' ? TIERS[0].at - books.tax : (settings.mode === 'custom' ? settings.custom : settings.budget2027) - books.cash;
  const me = youAfford(delta, left), them = theyAfford(teamId, out, back, usedBy(teamId), payrolls());
  const mine = me.level === 'ok' ? '' : `Puts you ${money(me.over)} over budget.`;
  const theirs = them.level === 'ok' ? '' : them.level === 'stretch' ? 'A stretch for their payroll.' : 'They likely can\'t afford this.';
  const rank = ['ok', 'stretch', 'no'], level = rank[Math.max(rank.indexOf(me.level), rank.indexOf(them.level))];
  const summary = `Salary: you ${signed(delta)}, them ${signed(-delta)}.`;
  return { level, summary, notes: [mine, theirs].filter(Boolean),
    lines: [[`You: ${signed(delta)} salary, ${money(left - delta)} budget left. ${mine}`, !!mine],
      [`${teamName(teamId)}: ${signed(-delta)} salary${them.limit == null ? '' : `, room to add about ${money(them.limit)}`}. ${theirs}`, !!theirs]] };
}
function renderNeeds(chosen) {
  const loaded = teams.filter(t => all.some(p => p.team === t.id)).length;
  const chips = (title, id, mine) => el('div', { className: 'needrow' }, el('strong', {}, title), ...topNeeds(id).map(n =>
    el('button', { type: 'button', className: 'need', disabled: !mine, title: mine ? 'Find a match' : '', onclick: () => search(n.spot) }, `${n.spot}: ${n.rank} of ${n.of}`)));
  $('scan').hidden = !!needs || !!view;
  $('needs').replaceChildren(...(needs ? [chips('Your needs', MINE, true), ...(chosen ? [chips(`${teamName(chosen)} needs`, chosen, false)] : []),
    ...(chosen && payrolls()[chosen] ? [el('p', {}, `${teamName(chosen)}: ${money(payrolls()[chosen])} payroll (${tier(payrolls()[chosen])}). Room to add about ${money(room(chosen, usedBy(chosen), payrolls()))} in trades.`)] : []),
    el('small', {}, 'League rank by projected WAR (30 is weakest). OF counts three players, SP and RP five. Tap one of yours to find a match.')]
    : [el('p', {}, `Scan the league once to see who is weak where. ${loaded ? `${loaded} of 29 rosters saved.` : 'It can take a minute or two.'}`)]));
}
function renderTrade() {
  needs = computeNeeds();
  const chosen = $('team').value, want = $('needfilter').value;
  const shown = teams.filter(t => !needs || !want || t.id === chosen || topNeeds(t.id).some(n => n.spot === want));
  $('team').replaceChildren(el('option', { value: '' }, 'Choose a team'), ...shown.map(t => el('option', { value: t.id }, `${t.name}${payrolls()[t.id] ? ` ($${Math.round(payrolls()[t.id])}M)` : ''}${needs ? `: needs ${topNeeds(t.id).map(n => n.spot).join(', ')}` : ''}`)));
  $('team').value = chosen;
  $('needwrap').hidden = $('matchbox').hidden = !needs;
  const spot = $('matchspot').value;
  if (needs) { const order = needs.get(MINE);
    $('matchspot').replaceChildren(...order.map(n => el('option', { value: n.spot }, `${n.spot} (rank ${n.rank} of ${n.of})`))); $('matchspot').value = spot || order[0].spot; }
  renderNeeds(chosen);
  const unavailable = new Set([...traded('give'), ...traded('get'), ...active(log).filter(d => ['sign', 'release', 'nontender'].includes(d.type)).map(d => d.playerId),
    ...all.filter(p => !p.fa && realNews(p)).map(p => p.id)]);
  drawTrade({ el, face, war, section, byWar, settings, terms: termsFor, openDetail, keepButton, check: checkMoney, needs, myId: MINE, teamIds: teams.map(t => t.id), teamName,
    unavailable, own: myRoster(), theirs: rosterOf, chooseTeam: id => { $('needfilter').value = ''; renderTrade(); $('team').value = id; renderTrade(); $('matches').replaceChildren(); },
    saveEdit: async (playerId, e) => { await db.put('contracts', { id: `trade:${playerId}`, playerId, snapshotId: 'trade', ...e }); await refresh(); } });
}
function render() {
  effective = new Map();
  contracts = Object.fromEntries(all.filter(x => !x.fa).map(x => { const t = termsFor(x); return [x.id, { salary: t.pay[0], aav: t.aav, type: t.source, owed: t.owed }]; }));
  // Team totals start from a known payroll; your moves add to it or subtract from it.
  const own = roster, before = payroll(own, contracts, [], 0), p = payroll(own, contracts, log, 0);
  if (!view) liveBefore = before;
  const anchor = liveBefore || before;
  const start = { cash: settings.baselineCash + before.cash - anchor.cash, tax: settings.baselineTax + before.tax - anchor.tax };
  if (own.length) { p.cash = start.cash + p.cash - before.cash; p.tax = start.tax + p.tax - before.tax; p.bill = taxBill(p.tax); }
  books = p;
  const stat = (l, v) => el('div', {}, l, el('b', {}, v));
  $('stats').replaceChildren(stat('40-man', `${p.spots}/40`), stat('Est. tax bill', money(p.bill)), stat('Estimated salaries', String(roster.filter(x => contracts[x.id].type === 'estimate').length)), stat('Moves', String(active(log).length)));
  const budget = settings.mode === 'unleashed' ? TIERS[0].at : settings.mode === 'custom' ? settings.custom : settings.budget2027;
  const onTax = settings.mode === 'unleashed';
  $('meters').replaceChildren(
    meter(onTax ? 'Cash payroll' : 'Cash payroll vs budget', p.cash, onTax ? TIERS[0].at : budget),
    meter(onTax ? 'Tax payroll vs budget' : 'Tax payroll vs first threshold', p.tax, onTax ? budget : TIERS[0].at, TIERS.map(t => t.at)),
    el('small', {}, `Before moves${view ? ' on this date' : ''}: ${money(start.cash)} cash, ${money(start.tax)} tax (change in Settings). ${own.length ? `Player estimates cover ${money(before.cash)} of the cash figure; ${money(start.cash - before.cash)} is unassigned. ` : ''}Gold marks: ${TIERS.map(t => '$' + t.at + 'M').join(', ')} (2026 rules).${p.spots > 40 ? ' Your 40-man is over the limit.' : ''}`));
  $('mode').value = settings.mode; $('custom').value = settings.custom; $('customwrap').hidden = settings.mode !== 'custom';
  $('photos').checked = settings.photos; $('snap').textContent = view ? `Orioles as of ${dateText(view)}` : roster.length ? `Orioles 40-man${settings.rosterDate ? `, loaded ${settings.rosterDate}` : ''}` : 'No roster loaded';
  $('tnow').textContent = view ? `Practice board: ${dateText(view)}${view === OPENING ? ', before any signings' : ''}. Moves here don't count. Built ${new Date(builtAt).toLocaleString()}.` : 'Today. Moves here are live.';
  $('timebar').classList.toggle('practice', !!view); $('tback').hidden = !view;
  if (view) $('tdate').value = view;
  for (const id of ['load', 'stats5', 'fa', 'check']) $(id).hidden = !!view;
  $('imported').textContent = Object.keys(imports).length ? `${Object.keys(imports).length} contracts imported.` : 'No file imported. All contracts are estimates unless you change them.';
  const acquired = all.filter(p => traded('get').has(p.id));
  sections('roster', roster.concat(acquired));
  sections('market', agents.filter(p => !signing(news.get(p.mlbId)) || active(log).some(d => d.playerId === p.id)));
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
    if (d.type !== 'void' && !voided.has(d.id)) {
      const sent = submittedIn(d), status = statusOf(d);
      item.append(el('div', {}, el('span', { className: 'tag' }, sent ? `Submitted in ${view ? 'practice ' : ''}plan ${sent.number}` : 'Not submitted'),
        ...(status.state === 'ok' ? [] : [' ', el('span', { className: `tag ${status.state}` }, status.state === 'broken' ? 'Broken by real news' : 'Happened in real life')])));
      if (status.reason) item.append(el('p', { className: 'caveat' }, status.reason));
      if (!sent || view) item.append(el('div', {}, el('button', { className: 'quiet', onclick: () => voidMove(d) }, 'Void')));
      else if (status.state === 'broken') item.append(el('div', {}, el('button', { onclick: () => replaceMove(d, status) }, 'Replace this move')));
    }
    return item;
  }) : [el('p', {}, 'Make your first move from the roster or free agent board.')]));
  renderPlans();
  $('payimported').textContent = Object.keys(settings.payrolls || {}).length ? `${Object.keys(settings.payrolls).length} team payrolls imported.` : 'Using the built-in 2026 figures.';
  const who = $('fixwho').value;
  $('fixwho').replaceChildren(...[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(x => el('option', { value: x.id }, x.name))); if (who) $('fixwho').value = who;
}
function renderPlans() {
  const current = active(log), fresh = current.filter(d => !submittedIn(d)), broken = current.filter(d => statusOf(d).state === 'broken');
  // Submit is always available: standing pat is a decision too.
  $('submit').disabled = false;
  $('submit').textContent = view ? `Save practice plan ${submissions.length + 1}` : submissions.length ? `Submit plan ${submissions.length + 1}` : 'Submit plan';
  $('plansum').textContent = view ? `${fresh.length} not saved in a plan. Later real moves are hidden. Practice moves can be voided anytime.` : `${fresh.length} not submitted. ${broken.length} broken. ${checked ? `Last checked ${new Date(checked).toLocaleString()}.` : 'Not checked for real news yet.'}`;
  $('plans').replaceChildren(...[...submissions].reverse().map(s => el('div', { className: 'offer' },
    el('div', {}, el('strong', {}, `${view ? 'Practice plan' : 'Plan'} ${s.number}`), el('small', {}, `${new Date(s.at).toLocaleString()}, ${s.moves.length} move(s)`)),
    el('button', { type: 'button', onclick: () => openReport(s) }, 'View report'))));
}
// A picture of the market at the moment you submit.
function fieldNow() {
  const line = p => ({ name: p.name, mlbId: p.mlbId, pos: section(p), age: p.age, war: war(p) });
  const mine = myRoster().map(p => ({ ...line(p), salary: p.fa ? null : termsFor(p).pay[0] }));
  const partners = [...new Set(active(log).filter(d => d.type === 'trade').map(d => d.teamId))].map(id => ({ id, name: teamName(id),
    payroll: payrolls()[id] ?? null, needs: needs ? topNeeds(id) : null, players: rosterOf(id).filter(p => !realNews(p)).sort(byWar).map(line) }));
  const budget = settings.mode === 'unleashed' ? TIERS[0].at : settings.mode === 'custom' ? settings.custom : settings.budget2027;
  return { cash: books.cash, tax: books.tax, spots: books.spots, budget, mode: settings.mode, needs: needs ? topNeeds(MINE) : null, roster: mine, partners,
    agents: agents.filter(p => !signing(news.get(p.mlbId))).sort(byWar).map(line) };
}
async function submitPlan() {
  $('submit').disabled = true;
  const got = view ? false : await checkNews();
  const broken = active(log).filter(d => statusOf(d).state === 'broken' && !submittedIn(d));
  if (broken.length) { render(); return say(`Not submitted. ${broken.length} new move(s) are broken by real news. Void them first.`); }
  if (!view && !got && !confirm("Couldn't check for real news. Submit anyway?")) return render();
  const at = new Date().toISOString(), number = submissions.length + 1;
  await db.add('results', { id: `sub:${at}`, kind: 'submission', number, at, snapshotId: SNAP, newsChecked: got,
    moves: active(log).map(d => ({ ...d, statusThen: statusOf(d) })), field: fieldNow(), ...(view ? { scenario: view } : {}) });
  await refresh(); say(view ? `Practice plan ${number} saved.` : `Plan ${number} submitted.`);
}
async function checkNews() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const res = await fetch(`${API}/transactions?sportId=1&startDate=${SNAP}&endDate=${today}`); if (!res.ok) throw new Error(`MLB returned ${res.status}`);
    const list = (await res.json()).transactions; if (!Array.isArray(list)) throw new Error('Unexpected reply');
    await db.put('results', { id: 'tx', transactions: list.filter(t => t.person), at: new Date().toISOString() });
    await refresh(); return true;
  } catch (e) { say(`Couldn't check for real news. ${e.message}.`); return false; }
}
async function replaceMove(d, status) {
  if (!confirm(`Remove "${d.label}: ${d.name}" so you can make a new move? The original stays in plan history.`)) return;
  await addDecision({ id: crypto.randomUUID(), type: 'void', label: 'Replaced', voids: d.id, playerId: d.playerId, name: d.name, why: `Broken by real news. ${status.reason}`, at: new Date().toISOString() });
  await refresh(); say('Removed. Make your new move, then resubmit.');
}
function openReport(s) {
  const f = s.field, h = t => el('h3', {}, t), list = items => el('ul', {}, ...items.map(t => el('li', {}, t)));
  const who = p => `${p.name}, ${p.pos}, ${p.war == null ? 'no proj.' : `${p.war.toFixed(1)} WAR`}${p.salary == null ? '' : `, ${money(p.salary)}`}`;
  const needText = n => n ? n.map(x => `${x.spot} (${x.rank} of ${x.of})`).join(', ') : 'League not scanned';
  const fold = (title, players) => el('details', {}, el('summary', {}, `${title} (${players.length})`), list(players.map(who)));
  // Transactions after this plan that involve anyone who was on the field.
  const ids = new Set([...f.roster, ...f.agents, ...f.partners.flatMap(t => t.players)].map(p => p.mlbId).filter(Boolean));
  const day = new Date(s.at).toLocaleDateString('en-CA');
  const since = [...ids].flatMap(id => news.get(id) || []).filter(t => t.date >= day).sort((a, b) => b.date.localeCompare(a.date));
  $('rname').textContent = `${s.scenario ? 'Practice plan' : 'Plan'} ${s.number}`;
  $('rbody').replaceChildren(el('p', {}, s.scenario ? `Saved ${new Date(s.at).toLocaleString()} on the ${dateText(s.scenario)} board.` : `Submitted ${new Date(s.at).toLocaleString()}.${s.newsChecked ? '' : ' Real news could not be checked at the time.'}`),
    h('Your moves'), list(s.moves.length ? s.moves.map(m => { const now = statusOf(m);
      return `${m.label}: ${m.name} (made ${new Date(m.at).toLocaleDateString()})\nYour reason: ${m.why}${now.state === 'ok' ? '' : `\n${now.state === 'broken' ? 'Now broken' : 'Happened in real life'}: ${now.reason}`}`; }) : ['No moves: you stood pat.']),
    h('The field then'), el('p', {}, `Cash ${money(f.cash)}, tax ${money(f.tax)}, budget ${money(f.budget)} (${f.mode}). 40-man ${f.spots}/40.`),
    el('p', {}, `Your needs: ${needText(f.needs)}`), fold('Your roster', f.roster), fold('Free agent board', f.agents),
    ...f.partners.flatMap(t => [el('p', {}, `${t.name}: ${t.payroll ? `${money(t.payroll)} payroll. ` : ''}Needs: ${needText(t.needs)}`), fold(`${t.name} roster`, t.players)]),
    ...(s.scenario ? [] : [h('Changed since'), since.length ? list(since.slice(0, 60).map(t => `${t.date}: ${t.description || `${t.person.fullName}, ${t.typeDesc}`}`))
      : el('p', {}, checked ? 'No transactions found involving these players.' : 'Press Check for updates to look.')]));
  $('report').showModal();
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
  $('malts').replaceChildren(...agents.filter(a => a.id !== p.id && !signing(news.get(a.mlbId))).sort(byWar).map(a => el('option', { value: a.id }, `${a.name} (${a.pos}, ${war(a)?.toFixed(1) ?? '-'} WAR)`)));
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
  await addDecision({ id: crypto.randomUUID(), type: 'void', label: 'Voided', voids: d.id, playerId: d.playerId, name: d.name, why: why.trim(), at: new Date().toISOString() });
  await refresh();
}
$('moveform').onsubmit = async e => {
  e.preventDefault(); const type = $('mtype').value, p = picked;
  if (!$('mwhy').value.trim()) return say('Add your reasoning.');
  if (realNews(p)) { $('mscore').textContent = 'Real news has moved this player. Pick someone else.'; return; }
  if (active(log).some(d => d.playerId === p.id && d.type === type)) { $('mscore').textContent = 'You already have this move. Void it first.'; return; }
  await addDecision({ id: crypto.randomUUID(), type, label: $('mtype').selectedOptions[0].text, playerId: p.id, name: p.name,
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
$('submit').onclick = submitPlan;
$('check').onclick = async () => { $('check').disabled = true; say('Checking MLB transactions…');
  if (await checkNews()) { const n = active(log).filter(d => statusOf(d).state === 'broken').length; say(n ? `${n} move(s) broken by real news. See below.` : 'Checked. None of your moves are broken.'); }
  $('check').disabled = false; };
$('rclose').onclick = () => $('report').close();
$('payfile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    await loadTeams();
    const { table, skipped } = importPayrolls(parseCSV(await file.text()), [...teams, { id: MINE, name: 'Baltimore Orioles' }]);
    if (!Object.keys(table).length) throw new Error('No usable rows. Use the template columns');
    settings.payrolls = { ...settings.payrolls, ...table }; await save(); say(`Imported ${Object.keys(table).length} payrolls.${skipped ? ` Skipped ${skipped} rows.` : ''}`);
  } catch (err) { say(`Couldn't import. ${err.message}.`); }
  e.target.value = '';
};
$('paytemplate').onclick = async () => { await loadTeams(); const names = Object.fromEntries([...teams, { id: MINE, name: 'Baltimore Orioles' }].map(t => [t.id, t.name]));
  download('team-payrolls.csv', 'team,payroll_millions\n' + Object.entries(payrolls()).map(([id, v]) => `${names[id] || id},${v}`).join('\n') + '\n', 'text/csv'); };
$('payreset').onclick = async () => { settings.payrolls = {}; await save(); say('Back to the built-in payrolls.'); };
setupTrade(async t => {
  const names = list => list.map(p => p.name).join(', '), key = crypto.randomUUID(), teamId = $('team').value;
  await addDecision({ id: key, type: 'trade', label: 'Trade', playerId: `trade:${key}`, name: `${names(t.give)} for ${names(t.get)}`, ...t,
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
  if (!id || view || all.some(p => p.team === id)) return renderTrade();
  say('Loading their 40-man roster…');
  try { const n = await loadTeamRoster(id); await refresh(); say(`Loaded ${n} players.`); }
  catch (e) { say(`Couldn't load that roster. ${e.message}. Choose another team, then try again.`); renderTrade(); }
};
$('needfilter').onchange = () => renderTrade();
$('scan').onclick = async () => {
  if (view) return;
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
// Rebuild the whole league as it stood on a date, from MLB rosters and transactions.
async function buildBoard(date) {
  await loadTeams(); if (teams.length < 29) throw new Error('No team list');
  const today = new Date().toLocaleDateString('en-CA');
  const res = await fetch(`${API}/transactions?sportId=1&startDate=2026-10-01&endDate=${today}`); if (!res.ok) throw new Error(`MLB returned ${res.status}`);
  const transactions = (await res.json()).transactions?.filter(t => t.person); if (!transactions) throw new Error('Unexpected reply');
  const [y, m, d] = date.split('-'), rosters = new Map(), clubs = Object.keys(PAYROLL).map(Number);
  for (const [i, id] of clubs.entries()) {
    say(`Building ${dateText(date)}: roster ${i + 1} of ${clubs.length}…`);
    const r = await fetch(`${API}/teams/${id}/roster?rosterType=40Man&season=${y}&date=${m}/${d}/${y}`); if (!r.ok) throw new Error(`MLB returned ${r.status}`);
    const list = (await r.json()).roster || []; if (!list.length) throw new Error('MLB sent an empty roster');
    rosters.set(id, list.map(x => x.person.id));
  }
  const state = boardState(rosters, transactions, date);
  // Today's saved free agent list helps cover players with no transaction on record.
  const placed = new Set([...state.teams.values()].flat());
  const saved = await db.all('players'), taken = new Set(state.taken);
  const free = new Set([...state.free, ...saved.filter(p => p.fa && p.mlbId && !placed.has(p.mlbId) && !taken.has(p.mlbId)).map(p => p.mlbId)]);
  // Players you already have keep the same projection on every board.
  const stored = new Map((await db.all('projections')).map(x => [x.playerId, x]));
  const frozen = new Map(saved.filter(p => stored.get(p.id)?.war != null).map(p => [p.mlbId, stored.get(p.id)]));
  say(`Building ${dateText(date)}: player stats…`);
  const people = new Map((await getStats([...placed, ...free])).map(x => [String(x.id), x]));
  const board = { id: `board:${date}`, kind: 'board', date, builtAt: new Date().toISOString(), players: [], proj: {}, history: {} }, names = new Set();
  const add = (mlb, extra) => {
    const x = people.get(mlb); if (!x) return;
    const group = x.primaryPosition?.abbreviation === 'P' ? 'P' : 'Position';
    const p = { id: extra.id || `fa:${names.has(x.fullName) ? `${x.fullName} ${mlb}` : x.fullName}`, mlbId: mlb, name: x.fullName, age: x.currentAge ?? null, pos: spot(x), group,
      debut: x.mlbDebutDate ? +x.mlbDebutDate.slice(0, 4) : null, ...extra };
    const splits = x.stats?.find(s => s.group.displayName === (group === 'P' ? 'pitching' : 'hitting'))?.splits || [];
    const out = frozen.has(mlb) ? { ...frozen.get(mlb), id: `${SNAP}:${p.id}`, playerId: p.id } : project(p, x);
    if (p.fa) { if (out.war == null) return; names.add(x.fullName); if (group === 'P') p.pos = projectStats(splits, true, 3)?.starter ? 'SP' : 'RP'; }
    board.players.push(p); board.proj[p.id] = out; board.history[p.id] = splits;
  };
  for (const [team, ids] of state.teams) for (const mlb of ids) add(mlb, String(team) === MINE ? { id: mlb } : { id: `t:${team}:${mlb}`, team: String(team) });
  for (const mlb of free) add(mlb, { fa: true });
  // Only the latest board is kept, to save space. Your practice moves and plans stay.
  for (const r of await db.all('results')) if (r.kind === 'board') await db.remove('results', r.id);
  await db.put('results', board);
}
async function travel(date) {
  const today = new Date().toLocaleDateString('en-CA');
  if (!date || date < OPENING || date > today) return say(`Pick a date from ${dateText(OPENING)} to today.`);
  if (!view && !roster.length) return say('Load the roster on the dashboard first.');
  const buttons = ['tgo', 'topen', 'tback'].map($); buttons.forEach(b => b.disabled = true);
  let note = '';
  try { await buildBoard(date); }
  catch (e) {
    if ((await db.all('results')).some(r => r.id === `board:${date}`)) note = ` Couldn't rebuild (${e.message}), so this is the saved copy.`;
    else { say(`Couldn't build that board. ${e.message}. You're still on ${view ? dateText(view) : 'today'}.`); buttons.forEach(b => b.disabled = false); return; }
  }
  view = date; resetTrade(); await refresh(); say(`Showing ${dateText(date)}.${note}`); buttons.forEach(b => b.disabled = false);
}
function resetTrade() { clearAll(); $('team').value = ''; $('needfilter').value = ''; $('matches').replaceChildren(); $('matchspot').replaceChildren(); }
$('tdate').min = OPENING; $('tdate').max = $('tdate').value = new Date().toLocaleDateString('en-CA');
$('tgo').onclick = () => travel($('tdate').value);
$('topen').onclick = () => travel(OPENING);
$('tback').onclick = async () => { view = null; resetTrade(); $('tdate').value = $('tdate').max; await refresh(); say('Back to today.'); };
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
$('restore').onchange = async e => { try { await db.restore(JSON.parse(await e.target.files[0].text())); view = null; await upgrade(); say('Backup restored.'); } catch (err) { say(`Couldn't restore. ${err.message}.`); } };
const LABELS = { budget2027: 'Realistic budget ($M cash)', baselineCash: 'Cash payroll before moves ($M)', baselineTax: 'Tax payroll before moves ($M)', dollarsPerWar: 'Market $M per WAR', injuryBase: 'Base injury discount (0-1)', injuryPerYearOver30: 'Added per year over 30', rosterSpotCost: '40-man spot cost ($M)', decline28to30: 'WAR lost per year, ages 28-30', declineFrom31: 'WAR lost per year, 31 and up' };
show('dash'); await refresh();
$('settings').replaceChildren(...Object.entries(LABELS).map(([k, label]) => {
  const i = el('input', { type: 'number', step: 'any', min: 0, value: settings[k] });
  i.onchange = () => { settings[k] = Number(i.value); save(); };
  return el('label', {}, label, i);
}));
const today = new Date().toLocaleDateString('en-CA');
$('lock').textContent = today >= '2026-12-02' ? 'A lockout was expected from Dec. 2. Check its status before treating a new move as realistic.' : 'Labor deal expires Dec. 1. A lockout is expected to freeze moves after that.';
await upgrade();
// Look for real news on opening, once you have a plan to protect.
if (active(log).length) await checkNews();
