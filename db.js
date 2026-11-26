const STORES = ['seasons','teams','snapshots','players','contracts','projections','decisions','results','grades','settings'];
const wrap = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const open = () => { const r = indexedDB.open('front-office', 1);
  r.onupgradeneeded = () => STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
  return wrap(r); };
const dbp = open();
const store = async (s, mode = 'readonly') => (await dbp).transaction(s, mode).objectStore(s);
export const all = async s => wrap((await store(s)).getAll());
export const put = async (s, row) => wrap((await store(s, 'readwrite')).put(row));
export const add = async (s, row) => wrap((await store(s, 'readwrite')).add(row));
export const remove = async (s, id) => wrap((await store(s, 'readwrite')).delete(id));
export async function backup() { const out = {}; for (const s of STORES) out[s] = await all(s); return out; }
export async function restore(data) {
  if (!STORES.every(s => Array.isArray(data[s]))) throw new Error('Not a Front Office backup');
  const t = (await dbp).transaction(STORES, 'readwrite');
  for (const s of STORES) { t.objectStore(s).clear(); data[s].forEach(r => t.objectStore(s).put(r)); }
  return new Promise((ok, no) => { t.oncomplete = ok; t.onabort = () => no(t.error); });
}
