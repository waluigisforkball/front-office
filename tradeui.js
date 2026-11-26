import { terms, tradeValue, balance } from './trade.js?v=6';
const $ = id => document.getElementById(id);
const basket = { give: [], get: [] };
let ctx;
const money = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(1) + 'M';
function describe(p) {
  const t = terms(p, ctx.contracts[p.id], ctx.edits[p.id]), war = ctx.war(p);
  return { id: p.id, name: p.name, pos: ctx.section(p), age: p.age, war, pay: t.pay, source: t.source, surplus: tradeValue(p, war, t.pay, ctx.settings) };
}
const pool = side => (side === 'give' ? ctx.own : ctx.theirs($('team').value)).filter(p => !ctx.unavailable.has(p.id));
function add(side, id) { if (pool(side).some(p => p.id === id) && !basket[side].includes(id)) basket[side].push(id); drawTrade(); }
function chip(p, side, inBasket) {
  const { el } = ctx, d = describe(p);
  const head = el('div', { className: 'chiphead' }, ctx.face(p), el('div', {}, el('strong', {}, p.name),
    el('small', {}, `${d.pos}, ${d.war === null ? 'no proj.' : d.war.toFixed(1) + ' WAR'}`),
    el('small', {}, d.surplus === null ? `Not valued (${d.pay ? 'no projection' : 'enter contract'})` : `${money(d.surplus)} over ${d.pay.length} yr`)),
    el('button', { type: 'button', className: 'quiet', onclick: () => { if (inBasket) { basket[side] = basket[side].filter(x => x !== p.id); drawTrade(); } else add(side, p.id); } }, inBasket ? 'Remove' : 'Add'));
  const box = el('div', { className: 'chip', draggable: !inBasket }, head);
  box.ondragstart = e => e.dataTransfer.setData('text/plain', JSON.stringify({ side, id: p.id }));
  if (inBasket) {
    const salary = el('input', { type: 'number', min: 0, step: 'any', value: d.pay?.[0] ?? '' });
    const years = el('input', { type: 'number', min: 1, max: 12, step: 1, value: d.pay?.length ?? 1 });
    const save = () => { const y = Math.floor(+years.value); if (salary.value !== '' && +salary.value >= 0 && y >= 1 && y <= 12) ctx.saveEdit(p.id, { salary: +salary.value, years: y }); };
    box.append(el('small', {}, d.pay ? `${d.source}: ${d.pay.map(money).join(', ')}` : 'No contract on file. Enter salary and years left.'),
      el('div', { className: 'row' }, el('label', {}, 'Salary per year ($M)', salary), el('label', {}, 'Years left', years), el('button', { type: 'button', className: 'quiet', onclick: save }, 'Apply')));
  }
  return box;
}
export function drawTrade(next) {
  if (next) ctx = next; if (!ctx) return;
  for (const side of ['give', 'get']) {
    basket[side] = basket[side].filter(id => pool(side).some(p => p.id === id));
    const list = pool(side), find = $(`${side}find`).value.toLowerCase();
    $(`${side}pool`).replaceChildren(...list.filter(p => !basket[side].includes(p.id) && `${p.name} ${ctx.section(p)}`.toLowerCase().includes(find)).sort(ctx.byWar).map(p => chip(p, side, false)));
    $(`${side}basket`).replaceChildren(...(basket[side].length ? basket[side].map(id => chip(list.find(p => p.id === id), side, true)) : [ctx.el('p', {}, 'Drag players here or press Add.')]));
  }
  $('terror').textContent = '';
  const give = selected('give'), get = selected('get'), b = balance(give, get), ready = give.length && get.length;
  const share = Math.max(0, Math.min(100, 50 + b.net / Math.max(20, Math.abs(b.out), Math.abs(b.back)) * 50));
  $('needle').style.left = `${ready ? share : 50}%`;
  $('verdict').textContent = !ready ? 'Add at least one player to each side.' : b.unknown ? `${b.unknown} player(s) not valued, so this balance is incomplete.`
    : `${b.verdict} You give ${money(b.out)} of surplus and get ${money(b.back)}. Net ${money(b.net)}.`;
}
const selected = side => basket[side].map(id => describe(pool(side).find(p => p.id === id)));
export function setupTrade(lock) {
  for (const side of ['give', 'get']) {
    $(`${side}find`).oninput = () => drawTrade();
    const zone = $(`${side}zone`);
    zone.ondragover = e => e.preventDefault();
    zone.ondrop = e => { e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.side === side) add(side, d.id); } catch { /* not a player */ } };
  }
  $('tradeform').onsubmit = async e => {
    e.preventDefault(); const give = selected('give'), get = selected('get'), why = $('twhy').value.trim();
    if (!give.length || !get.length || !why) { $('terror').textContent = 'Add players to both sides and your reasoning.'; return; }
    if ([...give, ...get].some(p => !p.pay)) { $('terror').textContent = 'Enter the missing contract terms first.'; return; }
    await lock({ give, get, why, confidence: $('tconf').value, other: $('tother').value.trim(), process: { surplus: balance(give, get).net, unvalued: balance(give, get).unknown } });
    basket.give = []; basket.get = []; $('tradeform').reset(); $('terror').textContent = ''; drawTrade();
  };
}
export const clearReceived = () => { basket.get = []; };
