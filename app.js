/* Economist reader: offline library on this device, synced through a private GitHub repository. */
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const keyFrom = s => { const d = new Date(String(s).replace(/(\d+)(st|nd|rd|th)/, '$1')); return isNaN(d) ? null : d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
const label = k => new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const fullName = iss => label(iss.key) + (iss.name ? ' · ' + iss.name : '');
const counts = iss => { let have = 0, all = 0; (iss.sections || []).forEach(s => s.entries.forEach(e => { all++; if (e.article != null) have++; })); return { have, all }; };
const tally = iss => { const c = iss.tally || counts(iss); return c.all ? `${c.have} of ${c.all} articles` : `${iss.count || 0} articles`; };
const slim = a => ({ id: a.id, title: a.title, section: a.section, page: a.page, pages: a.pages });
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

/* ---- this device's library (IndexedDB) ---- */
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('economist-reader', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('issues', { keyPath: 'key' }); d.createObjectStore('articles', { keyPath: ['key', 'id'] }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
const req = q => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const range = key => IDBKeyRange.bound([key, -Infinity], [key, Infinity]);
const db = {
  async list() { const d = await idb(); return req(d.transaction('issues').objectStore('issues').getAll()); },
  async get(key) { const d = await idb(); return req(d.transaction('issues').objectStore('issues').get(key)); },
  async article(key, id) { const d = await idb(); return req(d.transaction('articles').objectStore('articles').get([key, id])); },
  async articles(key) { const d = await idb(); return (await req(d.transaction('articles').objectStore('articles').getAll(range(key)))).map(({ key: k, ...a }) => a); },
  async save(doc, arts) {
    const d = await idb(), tx = d.transaction(['issues', 'articles'], 'readwrite');
    tx.objectStore('issues').put(doc);
    arts.forEach(a => tx.objectStore('articles').put({ ...a, key: doc.key }));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  },
  async replace(doc, arts) {
    const d = await idb(), tx = d.transaction(['issues', 'articles'], 'readwrite');
    tx.objectStore('articles').delete(range(doc.key));
    tx.objectStore('issues').put(doc);
    arts.forEach(a => tx.objectStore('articles').put({ ...a, key: doc.key }));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  },
  async patch(key, fields) { const doc = await db.get(key); if (doc) await db.save({ ...doc, ...fields }, []); },
  async remove(key) {
    const d = await idb(), tx = d.transaction(['issues', 'articles'], 'readwrite');
    tx.objectStore('issues').delete(key); tx.objectStore('articles').delete(range(key));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  }
};

/* ---- private GitHub repository ---- */
const cfg = () => ({ user: ls.get('ec-user') || '', repo: ls.get('ec-repo') || 'issue-reader-library', token: ls.get('ec-token') || '' });
const configured = () => { const c = cfg(); return !!(c.user && c.repo && c.token); };
const b64enc = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = b64 => { const s = atob(b64.replace(/\s/g, '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); };

async function gh(path, { method = 'GET', body, raw } = {}) {
  const c = cfg();
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.user)}/${encodeURIComponent(c.repo)}/contents/${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + c.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
    const err = new Error(r.status === 401 ? 'GitHub refused the access key (it may be wrong or expired)' : r.status === 403 ? 'GitHub refused access: ' + (msg || 'check the key\'s permissions') : r.status === 404 ? 'Library folder not found: check the username and folder name' : `GitHub error ${r.status}${msg ? ': ' + msg : ''}`);
    err.status = r.status; throw err;
  }
  return raw ? r.text() : r.json();
}
async function getJson(path) {
  const meta = await gh(path); if (!meta) return null;
  const text = meta.content ? b64dec(meta.content) : await gh(path, { raw: true });
  return { data: JSON.parse(text), sha: meta.sha };
}
const putJson = (path, data, sha, message) => gh(path, { method: 'PUT', body: { message, content: b64enc(JSON.stringify(data)), ...(sha ? { sha } : {}) } });
async function updateJson(path, empty, change, message) {
  for (let i = 0; ; i++) {
    const cur = await getJson(path);
    const next = change(cur ? cur.data : empty);
    try { await putJson(path, next, cur && cur.sha, message); return next; }
    catch (e) { if (i < 3 && (e.status === 409 || e.status === 422)) { await sleep(700); continue; } throw e; }
  }
}
const entryOf = d => ({ key: d.key, name: d.name, count: d.count, hasToc: d.hasToc, tally: counts(d), updated: d.updated });

async function upload(key, onProg) {
  const doc = await db.get(key); if (!doc) return;
  const arts = await db.articles(key);
  const { read, pending, synced, ...shared } = doc;
  const path = `issues/${key}.json`;
  if (onProg) onProg('Uploading to your library…');
  const meta = await gh(path);
  await putJson(path, { doc: shared, articles: arts }, meta && meta.sha, `Issue ${key}`);
  await updateJson('index.json', { issues: [] }, idx => ({ issues: [...(idx.issues || []).filter(x => x.key !== key), entryOf(doc)] }), `Index: ${key}`);
  await db.patch(key, { pending: false, synced: true });
}
async function removeRemote(key) {
  const path = `issues/${key}.json`, meta = await gh(path);
  if (meta) await gh(path, { method: 'DELETE', body: { message: `Remove ${key}`, sha: meta.sha } });
  await updateJson('index.json', { issues: [] }, idx => ({ issues: (idx.issues || []).filter(x => x.key !== key) }), `Index: remove ${key}`);
}
const tomb = { list: () => { try { return JSON.parse(ls.get('ec-deleted') || '[]'); } catch (e) { return []; } }, set: l => ls.set('ec-deleted', JSON.stringify(l)) };

let syncState = { text: '', cls: '' }, syncing = null;
function setSync(text, cls) { syncState = { text, cls: cls || '' }; const el = $('#sy'); if (el) { el.textContent = text; el.className = cls || ''; } }
async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!configured()) { setSync('Not connected to your GitHub library: issues stay on this device.'); return false; }
    if (!navigator.onLine) { setSync('Offline: showing issues saved on this device.'); return false; }
    setSync('Checking for new issues…');
    let changed = false;
    try {
      for (const k of tomb.list()) { await removeRemote(k); tomb.set(tomb.list().filter(x => x !== k)); }
      const locals = await db.list();
      for (const d of locals.filter(d => d.pending)) await upload(d.key);
      const idx = await getJson('index.json');
      const remote = idx ? idx.data.issues || [] : [];
      const have = Object.fromEntries((await db.list()).map(d => [d.key, d]));
      for (const r of remote) {
        const l = have[r.key];
        if (l && (l.updated || 0) >= (r.updated || 0)) continue;
        setSync(`Downloading ${label(r.key)}…`);
        const f = await getJson(`issues/${r.key}.json`); if (!f) continue;
        await db.replace({ ...f.data.doc, read: l ? l.read || [] : [], synced: true, pending: false }, f.data.articles);
        changed = true;
      }
      const keys = new Set(remote.map(r => r.key));
      for (const l of Object.values(have)) if (l.synced && !l.pending && !keys.has(l.key)) { await db.remove(l.key); changed = true; }
      changed = (await syncRead()) || changed;
      setSync('Up to date · checked ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
    } catch (e) { setSync('Sync failed: ' + (e.message || e) + '. Saved issues still work offline.', 'bad'); }
    return changed;
  })();
  try { return await syncing; } finally { syncing = null; }
}
async function syncRead() {
  const locals = await db.list();
  const mine = Object.fromEntries(locals.map(d => [d.key, d.read || []]));
  const cur = await getJson('state.json');
  const theirs = (cur && cur.data.read) || {};
  let changed = false, needPush = false;
  const merged = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const u = [...new Set([...(mine[k] || []), ...(theirs[k] || [])])];
    merged[k] = u;
    if (mine[k] && u.length > mine[k].length) { await db.patch(k, { read: u }); changed = true; }
    if (u.length > (theirs[k] || []).length) needPush = true;
  }
  if (needPush) await updateJson('state.json', { read: {} }, s => { const r = { ...(s.read || {}) }; for (const k in merged) r[k] = [...new Set([...(r[k] || []), ...merged[k]])]; return { read: r }; }, 'Reading progress');
  return changed;
}
let readTimer = null;
const pushReadSoon = () => { clearTimeout(readTimer); readTimer = setTimeout(() => { if (configured() && navigator.onLine) syncRead().catch(() => {}); }, 3000); };

function issueDoc(key, tocRaw, articles, built, name, read) {
  return {
    key, name: name || (tocRaw && tocRaw.name) || '', hasToc: !!tocRaw, tocRaw,
    sections: built.sections, matched: built.matched, tocCount: built.tocCount,
    index: articles.map(slim), count: articles.length, read: read || [], updated: Date.now()
  };
}

/* ---- reading-size control and navigation ---- */
let fs = +(ls.get('ec-fs') || 19);
const setFs = v => { fs = Math.max(15, Math.min(26, v)); document.documentElement.style.setProperty('--fs', fs + 'px'); ls.set('ec-fs', fs); };
setFs(fs);
$('#fsm').onclick = () => setFs(fs - 1); $('#fsp').onclick = () => setFs(fs + 1);
$('#back').onclick = () => { const h = location.hash.slice(1); location.hash = h.startsWith('a-') ? 'i-' + h.split('-')[1] : ''; };
$('#gear').onclick = () => { location.hash = 'settings'; };
function chrome(title, back, tools) { $('#bt').textContent = title; $('#back').hidden = !back; $('#tools').hidden = !tools; $('#gear').hidden = back; }

/* ---- import ---- */
async function importFiles(files) {
  const st = $('#st'), pr = $('#pr'), bar = pr.firstElementChild;
  const prog = (msg, p) => { st.textContent = msg; if (p != null) bar.style.width = Math.round(p * 100) + '%'; };
  if (!window.pdfjsLib || !window.EcoCore) { prog('The PDF reader failed to load. Reload the app and try again.'); return; }
  pr.style.display = 'block';
  const tocs = [], pqs = [];
  let i = 0;
  for (const f of files) {
    i++;
    try {
      prog(`Reading ${f.name} (${i} of ${files.length})…`, 0);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      const pq = await EcoCore.parseProquest(pdf, p => bar.style.width = Math.round(p * 100) + '%');
      if (pq.articles.length) pqs.push(pq);
      else { const t = await EcoCore.parseToc(pdf); if (t.sections.length) tocs.push(t); }
    } catch (e) { prog(`${f.name}: could not be read (${e.message}).`); await sleep(1500); }
  }
  const keys = [...new Set([...tocs.map(t => keyFrom(t.issue)), ...pqs.map(p => keyFrom(p.date))].filter(Boolean))];
  if (!keys.length) { prog('No ProQuest export or contents page found in those files.'); pr.style.display = 'none'; return; }
  for (const key of keys) {
    const old = await db.get(key);
    const articles = old ? await db.articles(key) : [];
    let next = articles.reduce((m, a) => Math.max(m, a.id + 1), 0);
    const fresh = [];
    for (const p of pqs.filter(p => keyFrom(p.date) === key))
      for (const a of p.articles) {
        if (articles.some(b => b.title === a.title && b.page === a.page)) continue;
        const n = { ...a, id: next++ }; articles.push(n); fresh.push(n);
      }
    const t = tocs.find(t => keyFrom(t.issue) === key);
    const tocRaw = t ? { sections: t.sections, issue: t.issue, name: t.name } : (old && old.tocRaw) || null;
    const built = EcoCore.buildContents(tocRaw, articles);
    const name = old && old.customName ? old.name : (tocRaw && tocRaw.name) || (old && old.name) || '';
    const doc = { ...issueDoc(key, tocRaw, articles, built, name, old && old.read), cover: (t && t.cover) || (old && old.cover) || '', customName: !!(old && old.customName), pending: true, synced: !!(old && old.synced) };
    await db.save(doc, fresh);
  }
  bar.style.width = '100%';
  if (configured() && navigator.onLine) {
    try { for (const key of keys) await upload(key, m => prog(m)); setSync('Uploaded · your other devices pick it up next time they open', 'ok'); }
    catch (e) { setSync('Saved on this device; upload failed (' + e.message + '). It retries on the next check.', 'bad'); }
  }
  pr.style.display = 'none';
  location.hash = 'i-' + keys[0];
}

/* ---- EPUB ---- */
/* ---- EPUB export (own zip writer, stored entries) ---- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const d = new Date(), dos = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, dos, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, dos, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/epub+zip' });
}
const xesc = s => esc(s).replace(/&#39;/g, '&#x27;');
function buildEpub(iss, byId) {
  const title = 'The Economist, ' + fullName(iss).replace(' · ', ': '), id = 'issue-reader-' + iss.key;
  const css = 'body{font-family:serif;line-height:1.5}h1{font-size:1.5em;line-height:1.15;margin:0 0 .3em}.k{font:bold .8em sans-serif;color:#c8102e;margin:1em 0 .2em}.r{font-style:italic;color:#666;margin:0 0 1.2em}.m{font:.75em sans-serif;color:#777}h3{font:bold 1em sans-serif;margin:1.4em 0 .4em}p{margin:0 0 .7em;text-indent:0}';
  const page = (t, body) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${xesc(t)}</title><link rel="stylesheet" href="s.css"/></head><body>${body}</body></html>`;
  const files = [], items = [], nav = [];
  let n = 0;
  for (const s of iss.sections) {
    const li = [];
    for (const e of s.entries) {
      const a = e.article != null && byId[e.article]; if (!a) continue;
      const f = 'a' + (++n) + '.xhtml';
      const body = `<p class="m">${xesc(s.name)} · page ${xesc(a.pages || a.page || '')}</p>${e.kicker ? `<p class="k">${xesc(e.kicker)}</p>` : ''}<h1>${xesc(e.title)}</h1>${e.title !== a.title ? `<p class="r">${xesc(a.title)}</p>` : ''}` + a.paragraphs.map(p => p.h ? `<h3>${xesc(p.t)}</h3>` : `<p>${xesc(p.t)}</p>`).join('');
      files.push({ name: 'OEBPS/' + f, data: page(e.title, body) });
      items.push(f);
      li.push(`<li><a href="${f}">${xesc((e.kicker ? e.kicker + ': ' : '') + e.title)}</a></li>`);
    }
    if (li.length) nav.push(`<li><a href="a${n - li.length + 1}.xhtml">${xesc(s.name)}</a><ol>${li.join('')}</ol></li>`);
  }
  let coverBytes = null;
  const cm = /^data:image\/jpeg;base64,(.+)$/.exec(iss.cover || '');
  if (cm) { const bin = atob(cm[1]); coverBytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) coverBytes[i] = bin.charCodeAt(i); }
  const navx = page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav.join('')}</ol></nav>`);
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${xesc(title)}</dc:title><dc:language>en</dc:language>${coverBytes ? '<meta name="cover" content="cover"/>' : ''}<meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="s.css" media-type="text/css"/>${coverBytes ? '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ''}${items.map((f, i) => `<item id="c${i}" href="${f}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine><itemref idref="nav"/>${items.map((f, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`;
  return zip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: navx },
    { name: 'OEBPS/s.css', data: css },
    ...(coverBytes ? [{ name: 'OEBPS/cover.jpg', data: coverBytes }] : []),
    ...files
  ]);
}


function saveFile(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---- views ---- */
async function viewLibrary() {
  chrome('Economist', false, false);
  $('#view').innerHTML = `
    ${configured() ? '' : `<div class="card"><h3>Connect your library</h3><p>Add your GitHub username and access key once on each device, and issues imported on one device appear on the others. Without it, this device keeps its own library.</p><a class="btn" href="#settings">Connect</a></div>`}
    <div class="drop" id="drop"><label class="btn" for="f">Import PDFs</label><input id="f" type="file" accept="application/pdf,.pdf" multiple>
    <small>Pick the ProQuest export(s) and the Table of Contents PDF together. New files merge into the same issue.</small>
    <div class="prog" id="pr"><i></i></div><div class="status" id="st" role="status"></div></div>
    <div class="lib"><h3>Issues</h3>
    <div class="sync"><span id="sy" class="${esc(syncState.cls)}">${esc(syncState.text)}</span>${configured() ? '<button class="btn alt" id="chk">Check for new issues</button>' : ''}</div>
    <div id="list"><p class="empty">Loading…</p></div></div>`;
  $('#f').onchange = e => importFiles([...e.target.files]);
  const d = $('#drop');
  d.ondragover = e => { e.preventDefault(); d.classList.add('on'); };
  d.ondragleave = () => d.classList.remove('on');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('on'); importFiles([...e.dataTransfer.files]); };
  if ($('#chk')) $('#chk').onclick = async () => { if (await sync()) renderList(); };
  await renderList();
}
async function renderList() {
  const el = $('#list'); if (!el) return;
  let all = [];
  try { all = (await db.list()).sort((a, b) => b.key.localeCompare(a.key)); } catch (e) { el.innerHTML = '<p class="empty">This browser is not letting the app save data (private browsing can cause this).</p>'; return; }
  const img = c => /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(c || '') ? `<img class="cov" src="${c}" alt="">` : '<span class="cov none"></span>';
  el.innerHTML = all.length ? all.map(i => `<div class="issue">${img(i.cover)}<a href="#i-${esc(i.key)}">${esc(label(i.key))}${i.name ? `<em>${esc(i.name)}</em>` : ''}<span>${esc(tally(i))}${i.hasToc ? '' : ' · no contents page yet'}${i.pending ? ' · not uploaded yet' : ''}</span></a><button class="del" data-k="${esc(i.key)}" aria-label="Remove issue">Remove</button></div>`).join('') : '<p class="empty">No issues yet.</p>';
  el.querySelectorAll('.del').forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = configured() ? 'Tap again: removes it on all devices' : 'Tap again to remove'; return; }
    const k = b.dataset.k; b.textContent = 'Removing…';
    const doc = await db.get(k);
    await db.remove(k);
    if (configured() && doc && doc.synced) {
      try { if (!navigator.onLine) throw new Error('offline'); await removeRemote(k); }
      catch (e) { tomb.set([...new Set([...tomb.list(), k])]); }
    }
    renderList();
  });
}

async function viewIssue(key) {
  const iss = await db.get(key); if (!iss) return viewLibrary();
  chrome(label(key), true, false);
  const read = new Set(iss.read || []), byId = Object.fromEntries((iss.index || []).map(a => [a.id, a]));
  const sum = iss.hasToc ? tally(iss) + ' available' : 'No contents page imported yet, so ProQuest titles are shown. Import the Table of Contents PDF to add the real titles.';
  const cov = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(iss.cover || '') ? `<img class="hcov" src="${iss.cover}" alt="Cover picture">` : '';
  $('#view').innerHTML = `<div class="ihead"><div class="htop"><div><p class="meta">${esc(label(key))}</p><h2 id="nm">${esc(iss.name || 'Untitled issue')}</h2></div>${cov}</div>
    <form id="rn" hidden><input id="rni" maxlength="80" aria-label="Issue name"><button class="btn alt" type="submit">Save</button></form>
    <p class="note">${esc(sum)} · <button class="lnk" id="ren">Rename</button></p>
    <div class="exp"><button class="btn" id="ep">Download EPUB</button><span class="status" id="eps" role="status"></span></div></div>` +
    iss.sections.map(s => `<h3 class="sec">${esc(s.name)}</h3><ul class="toc">${s.entries.map(e => {
      const a = e.article != null ? byId[e.article] : null;
      const inner = `<span class="pg">${esc(e.page ?? '')}</span><span>${e.kicker ? `<span class="k">${esc(e.kicker)}</span>` : ''}<span class="t">${esc(e.title)}</span>${a && !e.pqOnly ? `<span class="pq">${esc(a.title)}</span>` : ''}${!a ? '<span class="pq">Not in your ProQuest export</span>' : ''}${e.pqOnly && iss.hasToc ? '<span class="pq">Not listed in the contents</span>' : ''}</span>`;
      return `<li class="${a && read.has(a.id) ? 'read' : ''}">${a ? `<a href="#a-${esc(key)}-${a.id}">${inner}</a>` : `<div class="na">${inner}</div>`}</li>`;
    }).join('')}</ul>`).join('');
  $('#ren').onclick = () => { $('#rn').hidden = false; $('#rni').value = iss.name || ''; $('#rni').focus(); };
  $('#rn').onsubmit = async ev => {
    ev.preventDefault();
    const v = $('#rni').value.trim(); $('#nm').textContent = v || 'Untitled issue'; $('#rn').hidden = true;
    await db.patch(key, { name: v, customName: true, updated: Date.now(), pending: true });
    if (configured() && navigator.onLine) upload(key).catch(() => {});
  };
  $('#ep').onclick = async () => {
    const st = $('#eps');
    try {
      const list = await db.articles(key), map = Object.fromEntries(list.map(a => [a.id, a]));
      const fn = `Economist ${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6)}${iss.name ? ' - ' + iss.name.replace(/[\\/:*?"<>|]/g, '') : ''}.epub`;
      saveFile(buildEpub(iss, map), fn); st.textContent = 'Downloaded.';
    } catch (e) { st.textContent = 'Could not build the e-book (' + (e.message || e) + ').'; }
  };
  try { const y = sessionStorage.getItem('ec-y-' + key); if (y) scrollTo(0, +y); } catch (e) {}
}

async function viewArticle(key, id) {
  const iss = await db.get(key); if (!iss) return viewLibrary();
  const flat = iss.sections.flatMap(s => s.entries.map(e => ({ ...e, sec: s.name }))).filter(e => e.article != null);
  const idx = flat.findIndex(e => e.article === id);
  const meta = (iss.index || []).find(a => a.id === id) || {};
  const e = flat[idx] || { title: meta.title, sec: meta.section };
  chrome(e.sec || meta.section || '', true, true);
  const a = await db.article(key, id);
  if (!a) { $('#view').innerHTML = '<p class="empty">This article is not on this device yet.</p>'; return; }
  const link = (x, r) => x ? `<a class="${r ? 'r' : ''}" href="#a-${esc(key)}-${x.article}"><small>${r ? 'Next' : 'Previous'}</small>${esc(x.title)}</a>` : '<span></span>';
  $('#view').innerHTML = `<article><p class="meta">${esc(e.sec || a.section)} · page ${esc(a.pages || a.page || '')}</p>
    ${e.kicker ? `<div class="kick">${esc(e.kicker)}</div>` : ''}<h2>${esc(e.title)}</h2>
    ${e.title !== a.title ? `<p class="rub">${esc(a.title)}</p>` : ''}
    <div class="body">${a.paragraphs.map(p => p.h ? `<h3>${esc(p.t)}</h3>` : `<p>${esc(p.t)}</p>`).join('') || '<p>No text in the export for this item.</p>'}</div>
    <nav class="pn">${link(flat[idx - 1], false)}${link(flat[idx + 1], true)}</nav></article>`;
  scrollTo(0, 0);
  if (!(iss.read || []).includes(id)) { await db.patch(key, { read: [...(iss.read || []), id] }); pushReadSoon(); }
}

function viewSettings() {
  chrome('Library settings', true, false);
  const c = cfg(), guess = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  $('#view').innerHTML = `<div class="card" style="margin-top:24px"><h3>Your GitHub library</h3>
    <p>Issues are stored in your private GitHub folder so every device you connect sees the same library. Each device also keeps its own copy for reading offline. The key stays in this app on this device.</p>
    <form id="cf">
      <label class="field"><span>GitHub username</span><input id="cu" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(c.user || guess)}"></label>
      <label class="field"><span>Private folder (repository) name</span><input id="cr" autocapitalize="none" spellcheck="false" value="${esc(c.repo)}"></label>
      <label class="field"><span>Access key (starts with github_pat_)</span><input id="ct" type="password" autocomplete="current-password" spellcheck="false" placeholder="${c.token ? 'Saved: leave empty to keep it' : 'Paste the key here'}"></label>
      <div class="row"><button class="btn" type="submit">Save and test</button>${c.token ? '<button class="btn alt" type="button" id="cx">Disconnect this device</button>' : ''}</div>
      <p class="status" id="cs" role="status"></p>
    </form></div>`;
  $('#cf').onsubmit = async ev => {
    ev.preventDefault();
    const st = $('#cs'), tok = $('#ct').value.trim();
    ls.set('ec-user', $('#cu').value.trim()); ls.set('ec-repo', $('#cr').value.trim() || 'issue-reader-library');
    if (tok) ls.set('ec-token', tok);
    if (!configured()) { st.textContent = 'All three fields are needed.'; st.className = 'status bad'; return; }
    st.textContent = 'Testing…'; st.className = 'status';
    try {
      await gh('index.json');
      st.textContent = 'Connected. Syncing…'; st.className = 'status ok';
      await sync();
      st.textContent = 'Connected. ' + syncState.text; st.className = 'status ' + syncState.cls;
    } catch (e) { st.textContent = e.message; st.className = 'status bad'; }
  };
  if ($('#cx')) $('#cx').onclick = () => { ls.set('ec-token', ''); viewSettings(); };
}

let lastHash = '';
function render() {
  const prev = lastHash; lastHash = location.hash.slice(1);
  if (prev.startsWith('i-')) try { sessionStorage.setItem('ec-y-' + prev.slice(2), scrollY); } catch (e) {}
  const h = lastHash;
  if (h === 'settings') viewSettings();
  else if (h.startsWith('a-')) { const [, k, id] = h.split('-'); viewArticle(k, +id); }
  else if (h.startsWith('i-')) viewIssue(h.slice(2));
  else viewLibrary();
}
addEventListener('hashchange', render);
addEventListener('online', () => sync().then(ch => { if (ch && !location.hash) renderList(); }));
render();
sync().then(ch => { if (ch && (!location.hash || location.hash === '#')) renderList(); });
}
