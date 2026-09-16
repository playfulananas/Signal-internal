// In-memory stand-in for the Firebase SDK, for Playwright tests that need server behavior real
// Firebase can't produce on demand: a held or rejected transaction, a failing write. The page still
// runs the real game code; only the three gstatic SDK modules js/firebase.js imports are replaced
// (route interception), and every database call goes through a Playwright binding to ONE shared
// Node-side store, so two browser contexts (two game clients) see each other's writes the way two
// real clients would.
//
// Scope: exactly what js/firebase.js uses (ref, set, get, update, onValue, runTransaction,
// serverTimestamp, anonymous auth). Values are handled RTDB-style: an explicit undefined anywhere
// in a written value is rejected (set, update and transaction results), null and empty
// objects/arrays are dropped, {'.sv':'timestamp'} is replaced with Date.now().

const APP_JS = `export function initializeApp(config) { return { config }; }`;

const AUTH_JS = `
const user = { uid: 'fake-' + Math.random().toString(36).slice(2, 10), isAnonymous: true };
const auth = { currentUser: user, authStateReady: async () => {} };
export function getAuth() { return auth; }
export async function signInAnonymously() { auth.currentUser = user; return { user }; }
export function onAuthStateChanged(_auth, cb) { setTimeout(() => cb(user), 0); return () => {}; }
`;

const DB_JS = `
const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const snap = v => ({ exists: () => v !== null && v !== undefined, val: () => clone(v) });
const listeners = new Map();
let nextId = 1;
window.__fakeDbDeliver = (id, value) => { const cb = listeners.get(id); if (cb) cb(snap(value)); };
const call = (...args) => window.__fakeDb(...args);
// Real RTDB rejects any explicit undefined in a written value. Checked here, in the page, because
// clone() (and the binding's serialization) would otherwise silently drop it before the store sees it.
function assertNoUndefined(value, op, path = '') {
  if (value === undefined) throw new Error(op + " failed: value argument contains undefined in property '" + (path || '(root)') + "'");
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, op, path ? path + '.' + k : k);
  }
}
export function getDatabase() { return {}; }
export function ref(_db, path) { return { path: String(path).split('/').filter(Boolean).join('/') }; }
export function serverTimestamp() { return { '.sv': 'timestamp' }; }
export async function set(r, value) { assertNoUndefined(value, 'set'); await call('set', r.path, clone(value)); }
export async function update(r, value) { assertNoUndefined(value, 'update'); await call('update', r.path, clone(value)); }
export async function get(r) { const { value } = await call('get', r.path); return snap(value); }
export function onValue(r, cb) {
  const id = 'l' + nextId++;
  listeners.set(id, cb);
  call('listen', r.path, id);
  return () => { listeners.delete(id); call('unlisten', r.path, id); };
}
export async function runTransaction(r, updater) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const { value, version } = await call('get', r.path);
    const next = updater(clone(value));
    if (next === undefined) return { committed: false, snapshot: snap(value) };
    assertNoUndefined(next, 'transaction');
    const res = await call('cas', r.path, clone(next), version);
    if (res.ok) return { committed: true, snapshot: snap(res.value) };
  }
  throw new Error('fake transaction: too many retries');
}
`;

export function createFakeFirebase() {
  const root = {};
  let version = 0;
  const listeners = []; // { page, id, path }
  const writes = [];    // { label, op, path, value, at }
  // Test hooks. beforeWrite({label, op, path, value}) may throw to fail a set/update.
  // beforeCas({label, path, value}) may await (hold the transaction) or return 'conflict'.
  const hooks = { beforeWrite: null, beforeCas: null };

  const keysOf = path => (path ? String(path).split('/').filter(Boolean) : []);
  const related = (a, b) => !a || !b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

  function clean(v) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) {
      const items = v.map(clean);
      if (items.every(x => x === undefined)) return undefined;
      if (items.every(x => x !== undefined)) return items;
      return Object.fromEntries(items.map((x, i) => [i, x]).filter(([, x]) => x !== undefined));
    }
    if (typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const c = clean(x);
        if (c !== undefined) out[k] = c;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return v;
  }

  function getAt(path) {
    let node = root;
    for (const k of keysOf(path)) {
      if (node === null || typeof node !== 'object') return null;
      node = node[k];
    }
    return node === undefined ? null : JSON.parse(JSON.stringify(node));
  }

  function prune(node) {
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') {
        prune(v);
        if (!Object.keys(v).length) delete node[k];
      }
    }
  }

  function setAt(path, value) {
    const keys = keysOf(path);
    const cleaned = clean(JSON.parse(JSON.stringify(value === undefined ? null : value)));
    if (!keys.length) {
      for (const k of Object.keys(root)) delete root[k];
      if (cleaned && typeof cleaned === 'object') Object.assign(root, cleaned);
      return;
    }
    let node = root;
    for (const k of keys.slice(0, -1)) {
      if (!node[k] || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    if (cleaned === undefined) delete node[keys.at(-1)];
    else node[keys.at(-1)] = cleaned;
    prune(root);
  }

  async function deliver(listener) {
    await listener.page.evaluate(([id, value]) => window.__fakeDbDeliver && window.__fakeDbDeliver(id, value), [listener.id, getAt(listener.path)]).catch(() => {});
  }

  async function notify(path) {
    for (const l of [...listeners]) if (related(l.path, path)) await deliver(l);
  }

  async function handle(label, page, op, path, payload, extra) {
    switch (op) {
      case 'get':
        return { value: getAt(path), version };
      case 'set':
      case 'update': {
        if (hooks.beforeWrite) await hooks.beforeWrite({ label, op, path, value: payload });
        if (op === 'set') setAt(path, payload);
        else for (const [k, v] of Object.entries(payload ?? {})) setAt(`${path}/${k}`, v);
        version++;
        writes.push({ label, op, path, value: payload, at: Date.now() });
        await notify(path);
        return { ok: true };
      }
      case 'cas': {
        if (hooks.beforeCas && (await hooks.beforeCas({ label, path, value: payload })) === 'conflict') return { ok: false };
        if (extra !== version) return { ok: false };
        setAt(path, payload);
        version++;
        writes.push({ label, op: 'cas', path, value: payload, at: Date.now() });
        await notify(path);
        return { ok: true, value: getAt(path) };
      }
      case 'listen': {
        const listener = { page, id: payload, path };
        listeners.push(listener);
        setTimeout(() => deliver(listener), 0);
        return { ok: true };
      }
      case 'unlisten': {
        const i = listeners.findIndex(l => l.page === page && l.id === payload);
        if (i >= 0) listeners.splice(i, 1);
        return { ok: true };
      }
      default:
        throw new Error(`fake firebase: unknown op ${op}`);
    }
  }

  return {
    hooks,
    writes,
    getAt,
    // Server-side write, as if another client wrote it: bumps the version and notifies listeners.
    async serverSet(path, value) {
      setAt(path, value);
      version++;
      await notify(path);
    },
    // Replaces the Firebase SDK in every page of this context and routes its calls to the store.
    async attach(context, label) {
      await context.route('https://www.gstatic.com/firebasejs/**', route => {
        const url = route.request().url();
        const body = url.includes('firebase-app') ? APP_JS : url.includes('firebase-auth') ? AUTH_JS : url.includes('firebase-database') ? DB_JS : '';
        return route.fulfill({ status: 200, contentType: 'text/javascript', body });
      });
      await context.exposeBinding('__fakeDb', (source, op, path, payload, extra) => handle(label, source.page, op, path, payload, extra));
    },
  };
}
