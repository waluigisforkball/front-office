import { tradeValue, balance } from './trade.js?v=8';
import { SPOTS, STAR, findMatches, caveats } from './needs.js?v=8';
const $ = id => document.getElementById(id);
const PAGE = 6;
const basket = { give: [], get: [] }, view = { give: { spot: '', page: 0 }, get: { spot: '', page: 0 } };
let ctx, pending = Promise.resolve();
const opened = new Set();
const money = v => (v <= -.05 ? '-$' : '$') + Math.abs(v).toFixed(1) + 'M';
function describe(p) {
  const t = ctx.terms(p), war = ctx.war(p);
  return { id: p.id, name: p.name, pos: ctx.section(p), age: p.age, war, pay: t.pay, source: t.source, owed: t.owed, surplus: tradeValue(p, war, t.pay, ctx.settings) };
}
const pool = side => (side === 'give' ? ctx.own : ctx.theirs($('team').value)).filter(p => !ctx.unavailable.has(p.id));
const spotOf = p => SPOTS.includes(ctx.section(p)) ? ctx.section(p) : 'Other';
function add(side, id) { if (pool(side).some(p => p.id === id) && !basket[side].includes(id)) basket[side].push(id); drawTrade(); }
function chip(p, side, inBasket) {
  const { el } = ctx, d = describe(p);
  const open = el('button', { type: 'button', className: 'who', title: 'See stats', onclick: () => ctx.openDetail(p) }, ctx.face(p),
    el('span', {}, el('strong', {}, p.name), el('small', {}, `${d.pos}, age ${d.age ?? '?'}, ${d.war === null ? 'no proj.' : d.war.toFixed(1) + ' WAR'}`),
      el('small', {}, d.surplus === null ? 'Not valued (no MLB projection)' : `Surplus ${money(d.surplus)} over ${d.pay.length} yr`),
      el('small', {}, `${money(d.pay[0])} a year, ${d.source}`)));
  const act = el('button', { type: 'button', className: inBasket ? 'quiet' : '', onclick: () => { if (inBasket) { basket[side] = basket[side].filter(x => x !== p.id); drawTrade(); } else add(side, p.id); } }, inBasket ? 'Remove' : 'Add');
  const buttons = el('div', { className: 'acts' }, act, ...(side === 'give' ? [ctx.keepButton(p)] : []));
  const box = el('div', { className: 'chip', draggable: !inBasket }, el('div', { className: 'chiphead' }, open, buttons));
  box.ondragstart = e => e.dataTransfer.setData('text/plain', JSON.stringify({ side, id: p.id }));
  if (inBasket) {
    const salary = el('input', { type: 'number', min: 0, step: 'any', value: d.pay[0] });
    const years = el('input', { type: 'number', min: 1, max: 15, step: 1, value: d.pay.length });
    const row = el('div', { className: 'row' }, el('label', {}, 'Salary per year ($M)', salary), el('label', {}, 'Years left', years));
    // Typed terms save as soon as you leave these two boxes.
    let changed = false; row.oninput = () => changed = true;
    row.addEventListener('focusout', e => {
      const y = Math.floor(+years.value);
      if (!changed || row.contains(e.relatedTarget) || salary.value === '' || !(+salary.value >= 0) || !(y >= 1 && y <= 15)) return;
      changed = false; pending = ctx.saveEdit(p.id, { salary: +salary.value, years: y });
    });
    const more = el('details', { open: opened.has(p.id), ontoggle: e => e.target.open ? opened.add(p.id) : opened.delete(p.id) }, el('summary', {}, 'Change contract'), el('small', {}, d.pay.map(money).join(', ')), row);
    box.append(more);
  }
  return box;
}
function column(side) {
  const { el } = ctx, v = view[side], list = pool(side), find = $(`${side}find`).value.toLowerCase();
  basket[side] = basket[side].filter(id => list.some(p => p.id === id));
  $(`${side}basket`).replaceChildren(...(basket[side].length ? basket[side].map(id => chip(list.find(p => p.id === id), side, true)) : [el('p', {}, 'Drag players here or press Add.')]));
  const spots = [...SPOTS, 'Other'].filter(s => list.some(p => spotOf(p) === s));
  if (v.spot && !spots.includes(v.spot)) v.spot = '';
  $(`${side}spots`).replaceChildren(...(list.length ? ['', ...spots].map(s => {
    const b = el('button', { type: 'button', onclick: () => { v.spot = s; v.page = 0; drawTrade(); } }, s || 'All');
    b.setAttribute('aria-pressed', String(v.spot === s)); return b; }) : []));
  const shown = list.filter(p => !basket[side].includes(p.id) && (!v.spot || spotOf(p) === v.spot) && `${p.name} ${ctx.section(p)}`.toLowerCase().includes(find)).sort(ctx.byWar);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)); v.page = Math.min(v.page, pages - 1);
  const empty = side === 'get' && !$('team').value ? 'Choose a trade partner above.' : 'No players match.';
  $(`${side}pool`).replaceChildren(...(shown.length ? shown.slice(v.page * PAGE, (v.page + 1) * PAGE).map(p => chip(p, side, false)) : [el('p', {}, empty)]));
  const step = (label, to, off) => el('button', { type: 'button', className: 'quiet', disabled: off, onclick: () => { v.page = to; drawTrade(); } }, label);
  $(`${side}pages`).replaceChildren(step('Previous', v.page - 1, v.page === 0), el('span', {}, `Page ${v.page + 1} of ${pages}`), step('Next', v.page + 1, v.page >= pages - 1));
}
const selected = side => basket[side].map(id => describe(pool(side).find(p => p.id === id)));
function fail(text, ...marks) {
  $('terror').textContent = text; marks.forEach(m => m.classList.add('bad'));
  marks[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const clearError = () => { $('terror').textContent = ''; document.querySelectorAll('[data-view=trade] .bad').forEach(m => m.classList.remove('bad')); };
export function drawTrade(next) {
  if (next) ctx = next; if (!ctx) return;
  column('give'); column('get'); clearError();
  const give = selected('give'), get = selected('get'), b = balance(give, get), ready = give.length && get.length;
  const share = Math.max(0, Math.min(100, 50 + b.net / Math.max(20, Math.abs(b.out), Math.abs(b.back)) * 50));
  $('needle').style.left = `${ready ? share : 50}%`;
  $('verdict').textContent = !ready ? 'Add at least one player to each side.' : b.unknown ? `${b.unknown} player(s) not valued, so this balance is incomplete.`
    : `${b.verdict} You give ${money(b.out)} of surplus and get ${money(b.back)}. Net ${money(b.net)}. Talent ${b.talent >= 0 ? '+' : ''}${b.talent.toFixed(1)} WAR.`;
}
// Put a suggested one-for-one offer into the trade slots.
function load(m) { ctx.chooseTeam(m.teamId); basket.give = [m.give.id]; basket.get = [m.get.id]; drawTrade(); $('balancebox').scrollIntoView({ behavior: 'smooth' }); }
export function search(spot) {
  const { el } = ctx, box = $('matches'); $('matchspot').value = spot;
  if (!ctx.needs) return box.replaceChildren(el('p', {}, 'Scan the league first.'));
  const usable = list => list.map(p => ({ ...describe(p), spot: spotOf(p), locked: ctx.unavailable.has(p.id), untouchable: ctx.settings.untouchable.includes(p.id) }));
  const found = findMatches({ spot, mine: usable(ctx.own), others: new Map(ctx.teamIds.map(id => [id, usable(ctx.theirs(id))])), needs: ctx.needs, myId: ctx.myId });
  const offer = m => el('div', { className: 'offer' },
    el('div', {}, el('strong', {}, `${ctx.teamName(m.teamId)}`),
      el('small', {}, `You get ${m.get.name} (${m.get.pos}, ${m.get.war.toFixed(1)} WAR)`),
      el('small', {}, `You give ${m.give.name} (${m.give.pos}, ${m.give.war.toFixed(1)} WAR). Net ${money(m.net)}.`),
      ...caveats(m).map(text => el('small', { className: 'caveat' }, text))),
    el('button', { type: 'button', onclick: () => load(m) }, 'Review offer'));
  const group = (title, tier) => { const list = found.filter(m => m.tier === tier); return list.length ? [el('h3', {}, title), ...list.map(offer)] : []; };
  const rules = el('p', {}, el('small', {}, `Players projected at ${STAR} WAR or more, and your untouchables, are left out.`));
  box.replaceChildren(rules, ...(found.length ? [...group('Good fits', 'fit'), ...group('Long shots', 'long')]
    : [el('p', {}, `No one-for-one offer found at ${spot}. Try another position or build one below.`)]));
}
export function setupTrade(lock) {
  for (const side of ['give', 'get']) {
    $(`${side}find`).oninput = () => { view[side].page = 0; drawTrade(); };
    const zone = $(`${side}zone`);
    zone.ondragover = e => e.preventDefault();
    zone.ondrop = e => { e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.side === side) add(side, d.id); } catch { /* not a player */ } };
  }
  $('findmatch').onclick = () => search($('matchspot').value);
  $('twhy').oninput = clearError;
  $('tradeform').onsubmit = async e => {
    e.preventDefault(); await pending; clearError();
    const give = selected('give'), get = selected('get'), why = $('twhy').value.trim();
    const marks = [!give.length && $('givebasket'), !get.length && $('getbasket'), !why && $('twhy')].filter(Boolean);
    if (marks.length) return fail(`Not saved yet. ${[!give.length && 'Add a player you give.', !get.length && 'Add a player you get.', !why && 'Write why you are making this trade.'].filter(Boolean).join(' ')}`, ...marks);
    const b = balance(give, get);
    try { await lock({ give, get, why, confidence: $('tconf').value, other: $('tother').value.trim(), process: { surplus: b.net, unvalued: b.unknown } }); }
    catch (err) { return fail(`Couldn't save the trade. ${err.message}`); }
    basket.give = []; basket.get = []; $('tradeform').reset(); drawTrade();
  };
}
export const clearReceived = () => { basket.get = []; view.get = { spot: '', page: 0 }; $('getfind').value = ''; };
