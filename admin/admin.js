/* Ahmed TV control panel: reads/writes the TV's settings in Firebase Realtime Database (REST). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); };
  const asArray = (v) => (!v ? [] : Array.isArray(v) ? v.filter((x) => x != null) : Object.keys(v).map((k) => v[k]));

  const ls = {
    get(k) { try { return localStorage.getItem('atvadmin_' + k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem('atvadmin_' + k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem('atvadmin_' + k); } catch (e) { /* ignore */ } }
  };

  let DB = '', KEY = '', ANON = '', doc = {}, catalog = null;
  const isSupa = () => /supabase\.(co|in)/.test(DB) || !!ANON;

  // ---------- connection
  function readHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return;
    const q = {};
    h.split('&').forEach((p) => { const kv = p.split('='); if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || ''); });
    if (q.db && q.key) { ls.set('db', q.db); ls.set('key', q.key); if (q.anon) ls.set('anon', q.anon); history.replaceState(null, '', location.pathname); }
  }
  function cleanDb(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\.json$/, ''); }
  function url(path) { return DB + '/' + path + '.json'; }
  async function req(method, path, body) {
    const r = await fetch(url(path), { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'denied' : 'http-' + r.status);
    return r.json();
  }
  async function rpc(fn, args) {
    const r = await fetch(DB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 || r.status === 404 ? 'denied' : 'http-' + r.status);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  // backend-neutral: whole document, one part, catalog
  const getDoc = () => (isSupa() ? rpc('tv_get', { k: KEY }) : req('GET', 'tv/' + KEY));
  const setPart = (p, v) => (isSupa() ? rpc('tv_set', { k: KEY, p, v }) : req('PUT', 'tv/' + KEY + '/' + p, v));
  const getCatalog = () => (isSupa() ? rpc('tv_get_part', { k: KEY, p: 'catalog' }) : req('GET', 'catalog/' + KEY));

  function genKey() {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  }
  function snippet(db, key, anon) {
    const app = location.origin + location.pathname.replace(/admin\/?(index\.html)?$/, '') + 'app/';
    return 'window.AHMED_TV = {\n  db: ' + JSON.stringify(db || 'https://xxxx.supabase.co') + ',\n' + (anon ? '  anon: ' + JSON.stringify(anon) + ',\n' : '') + '  key: ' + JSON.stringify(key || 'PASTE-KEY') + ',\n  appUrl: ' + JSON.stringify(app) + '\n};\n';
  }
  const snip = () => { $('c-snippet').textContent = snippet(cleanDb($('c-db').value), $('c-key').value.trim(), $('c-anon').value.trim()); };

  function showConnect(err) {
    $('main').hidden = true; $('connect').hidden = false;
    $('c-db').value = ls.get('db'); $('c-key').value = ls.get('key') || genKey(); $('c-anon').value = ls.get('anon');
    snip();
    $('c-err').hidden = !err; $('c-err').textContent = err || '';
    setSync('idle', 'مش متوصّل');
  }
  $('c-gen').onclick = () => { $('c-key').value = genKey(); snip(); };
  $('c-db').oninput = $('c-key').oninput = $('c-anon').oninput = snip;
  $('c-copy').onclick = () => copy($('c-snippet').textContent);
  $('c-save').onclick = async () => {
    const db = cleanDb($('c-db').value).replace(/\/rest\/v1.*$/, ''), key = $('c-key').value.trim(), anon = $('c-anon').value.trim();
    if (!/^https:\/\/.+/.test(db)) { showConnect('اكتب رابط قاعدة البيانات كامل، بيبدأ بـ https://'); return; }
    if (/supabase\.(co|in)/.test(db) && !anon) { showConnect('اكتب مفتاح Supabase (anon أو publishable).'); return; }
    ls.set('anon', anon);
    if (key.length < 24) { showConnect('المفتاح لازم يبقى ٢٤ حرف على الأقل. دوس "مفتاح جديد".'); return; }
    ls.set('db', db); ls.set('key', key); start();
  };
  $('disconnect').onclick = () => { ls.del('db'); showConnect(); };

  async function copy(t) {
    try { await navigator.clipboard.writeText(t); toast('اتنسخ'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('c-snippet')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('اتحدد، انسخه من القائمة'); }
  }

  // ---------- ui helpers
  let toastT;
  function toast(t, bad) { const e = $('toast'); e.textContent = t; e.classList.toggle('bad', !!bad); e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2200); }
  function setSync(state, text) { const s = $('sync'); s.dataset.state = state; s.textContent = text; }
  async function save(path, value, okMsg) {
    try { await setPart(path, value); toast(okMsg || 'اتبعت للتلفزيون'); return true; }
    catch (e) { toast(e.message === 'denied' ? 'قاعدة البيانات رفضت. راجع الإعداد والمفتاح.' : 'مقدرتش أحفظ. اتأكد من النت وجرّب تاني.', true); return false; }
  }

  // tabs
  function openTab(name) {
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    ls.set('tab', name);
    if (name === 'chs') loadCatalog();
  }
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => openTab(b.dataset.tab); });

  // ---------- status
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 90) return 'دلوقتي';
    const m = Math.round(s / 60); if (m < 60) return 'من ' + m + ' دقيقة';
    const h = Math.round(m / 60); if (h < 48) return 'من ' + h + ' ساعة';
    return 'من ' + Math.round(h / 24) + ' يوم';
  }
  function renderStatus() {
    const st = doc.status || {}, rows = [];
    const online = st.lastSeen && Date.now() - st.lastSeen < 3 * 60 * 1000;
    rows.push(['التلفزيون', st.lastSeen ? '<span class="pill ' + (online ? 'ok' : 'warn') + '">' + (online ? 'شغّال' : 'مقفول') + '</span> آخر ظهور ' + ago(st.lastSeen) : '<span class="pill warn">لسه ما اتوصّلش</span>']);
    if (online && st.watching) rows.push(['بيتفرجوا على', esc(st.watching)]);
    if (st.exp) { const d = new Date(st.exp * 1000), left = Math.ceil((d - new Date()) / 864e5); rows.push(['الاشتراك', d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ' <span class="pill ' + (left > 15 ? 'ok' : left > 0 ? 'warn' : 'bad') + '">' + (left > 0 ? 'باقي ' + left + ' يوم' : 'خلص') + '</span>']); }
    if (st.error) rows.push(['مشكلة', '<span class="pill bad">' + esc(st.error) + '</span>']);
    else if (st.lastSeen && doc.account && doc.account.username) rows.push(['الدخول', st.accountOk ? '<span class="pill ok">تمام</span> ' + (st.channels ? st.channels + ' قناة' : '') : '<span class="pill warn">لسه</span>']);
    if (st.version) rows.push(['النسخة', esc(st.version)]);
    $('st').innerHTML = rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('');
    setSync(online ? 'ok' : 'off', online ? 'التلفزيون شغّال' : 'التلفزيون مقفول');
  }
  $('st-refresh').onclick = () => refresh(true);

  // ---------- home
  $('u-send').onclick = async () => {
    const t = $('u-text').value.trim(); if (!t) { toast('اكتب الرسالة الأول', true); return; }
    if (await save('urgent', { id: Date.now(), text: t, at: Date.now() }, 'اتبعتت، هتظهر في خلال ٣٠ ثانية')) $('u-text').value = '';
  };
  $('w-save').onclick = () => saveSettings({ title: $('w-title').value.trim(), sub: $('w-sub').value.trim() });
  async function saveSettings(patch) {
    doc.settings = Object.assign({}, doc.settings || {}, patch);
    await save('settings', doc.settings, 'اتحفظ');
  }

  // ---------- messages
  function renderMessages() {
    const msgs = doc.messages || {}, today = iso(new Date());
    const keys = Object.keys(msgs).sort().reverse();
    const box = $('m-list');
    if (!keys.length) { box.innerHTML = '<p class="empty">مفيش رسايل لسه.</p>'; return; }
    box.innerHTML = keys.map((k) => {
      const d = parse(k), m = msgs[k], text = typeof m === 'string' ? m : (m && m.text) || '';
      return '<div class="item msg' + (k === today ? ' today' : k < today ? ' past' : '') + '"><div class="d"><b>' + d.getDate() + '</b>' + MON[d.getMonth()] + '</div><div class="t">' + esc(text) + (k === today ? '<small>النهارده</small>' : '') + '</div><button class="icon del" type="button" data-k="' + k + '" aria-label="امسح">✕</button></div>';
    }).join('');
    box.querySelectorAll('.del').forEach((b) => { b.onclick = async () => { const k = b.dataset.k; const next = Object.assign({}, doc.messages); delete next[k]; if (await save('messages', Object.keys(next).length ? next : null, 'اتمسحت')) { doc.messages = next; renderMessages(); } }; });
  }
  $('m-save').onclick = async () => {
    const k = $('m-date').value, t = $('m-text').value.trim();
    if (!k || !t) { toast('اختار اليوم واكتب الرسالة', true); return; }
    const next = Object.assign({}, doc.messages); next[k] = { text: t, at: Date.now() };
    if (await save('messages', next, k === iso(new Date()) ? 'اتحفظت، هتظهر لهم دلوقتي' : 'اتحفظت، هتظهر في يومها')) {
      doc.messages = next; $('m-text').value = ''; renderMessages();
    }
  };

  // ---------- birthdays
  let people = [];
  function renderPeople() {
    const box = $('b-list');
    if (!people.length) { box.innerHTML = '<p class="empty">مفيش حد لسه. دوس "ضيف شخص".</p>'; return; }
    box.innerHTML = people.map((p, i) => '<div class="person" data-i="' + i + '"><div class="r"><input type="text" class="pn" placeholder="الاسم (ماما)" aria-label="الاسم" value="' + esc(p.name) + '"><input type="date" class="pd" aria-label="التاريخ" value="' + esc(p.date) + '"><button class="icon del" type="button" aria-label="امسح">✕</button></div><input type="text" class="pt" placeholder="جملة التهنئة (كل سنة وانتي طيبة يا ماما)" aria-label="جملة التهنئة" value="' + esc(p.text) + '"></div>').join('');
    box.querySelectorAll('.person').forEach((row) => {
      const p = people[+row.dataset.i];
      row.querySelector('.pn').oninput = (e) => { p.name = e.target.value; };
      row.querySelector('.pd').oninput = (e) => { p.date = e.target.value; };
      row.querySelector('.pt').oninput = (e) => { p.text = e.target.value; };
      row.querySelector('.del').onclick = () => { people.splice(+row.dataset.i, 1); renderPeople(); };
    });
  }
  $('b-add').onclick = () => { people.push({ name: '', date: '', text: '' }); renderPeople(); const ins = $('b-list').querySelectorAll('.pn'); ins[ins.length - 1].focus(); };
  $('b-save').onclick = async () => {
    const clean = people.filter((p) => p.name.trim() && p.date).map((p) => ({ name: p.name.trim(), date: p.date, text: p.text.trim() }));
    if (clean.length < people.length) toast('في حد ناقصه الاسم أو التاريخ، مش هيتحفظ', true);
    if (await save('people', clean, 'اتحفظت أعياد الميلاد')) { doc.people = clean; people = clean.map((p) => Object.assign({}, p)); renderPeople(); }
  };

  // ---------- favorites
  let favs = [];
  function renderFavs() {
    $('f-title').textContent = 'قائمة ' + ((doc.settings && doc.settings.favName) || 'أحمد جمال');
    const box = $('f-list');
    if (!favs.length) { box.innerHTML = '<p class="empty">القائمة فاضية. ضيف قنوات من تحت.</p>'; return; }
    box.innerHTML = favs.map((f, i) => '<div class="item" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(f.name) + '</span><button class="icon up" type="button" aria-label="لفوق"' + (i ? '' : ' disabled') + '>▲</button><button class="icon dn" type="button" aria-label="لتحت"' + (i < favs.length - 1 ? '' : ' disabled') + '>▼</button><button class="icon del" type="button" aria-label="شيل">✕</button></div>').join('');
    box.querySelectorAll('.item').forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector('.up').onclick = () => { if (i > 0) { [favs[i - 1], favs[i]] = [favs[i], favs[i - 1]]; commitFavs(); } };
      row.querySelector('.dn').onclick = () => { if (i < favs.length - 1) { [favs[i + 1], favs[i]] = [favs[i], favs[i + 1]]; commitFavs(); } };
      row.querySelector('.del').onclick = () => { favs.splice(i, 1); commitFavs(); };
    });
  }
  const commitFavs = (() => { let t; return () => { renderFavs(); renderCatalog(); clearTimeout(t); t = setTimeout(() => save('favorites', favs, 'اتحفظ الترتيب'), 600); }; })();

  async function loadCatalog() {
    if (catalog) return;
    try { catalog = await getCatalog(); } catch (e) { catalog = null; }
    const sel = $('cat-filter');
    if (!catalog || !catalog.ch) { $('cat-note').textContent = 'لسه التلفزيون ما بعتش قائمة القنوات. شغّل التلفزيون بعد ما تحط بيانات الاشتراك، واستنى دقيقة.'; catalog = null; return; }
    const d = new Date(catalog.at);
    $('cat-note').textContent = asArray(catalog.ch).length + ' قناة من الاشتراك · آخر تحديث ' + d.getDate() + ' ' + MON[d.getMonth()];
    sel.innerHTML = '<option value="">كل الأقسام</option>' + asArray(catalog.cats).map((c) => '<option value="' + esc(c[0]) + '">' + esc(c[1]) + '</option>').join('');
    renderCatalog();
  }
  function renderCatalog() {
    const box = $('cat-list'); if (!catalog) { box.innerHTML = ''; return; }
    const q = $('cat-q').value.trim().toLowerCase(), cat = $('cat-filter').value;
    const have = new Set(favs.map((f) => +f.id));
    const all = asArray(catalog.ch).filter((c) => (!cat || String(c[2]) === cat) && (!q || String(c[1]).toLowerCase().includes(q)));
    const shown = all.slice(0, 80);
    box.innerHTML = shown.map((c) => '<div class="item"><span class="t">' + esc(c[1]) + '</span><button class="icon add" type="button" data-id="' + c[0] + '" aria-label="ضيف"' + (have.has(+c[0]) ? ' disabled' : '') + '>' + (have.has(+c[0]) ? '✓' : '+') + '</button></div>').join('') +
      (all.length > shown.length ? '<p class="empty">ظاهر ' + shown.length + ' من ' + all.length + '. دوّر بالاسم أو اختار قسم.</p>' : '') + (!all.length ? '<p class="empty">مفيش نتايج.</p>' : '');
    box.querySelectorAll('.add').forEach((b) => { b.onclick = () => { const c = asArray(catalog.ch).find((x) => +x[0] === +b.dataset.id); if (c && !have.has(+c[0])) { favs.push({ id: +c[0], name: c[1] }); commitFavs(); toast('اتضافت رقم ' + favs.length); } }; });
  }
  $('cat-q').oninput = renderCatalog;
  $('cat-filter').onchange = renderCatalog;

  // ---------- look
  let palette = 'gold';
  function renderLook() {
    const s = doc.settings || {};
    palette = s.palette || 'gold';
    document.querySelectorAll('#pal button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === palette ? 'true' : 'false'));
    $('l-auto').checked = s.auto !== false;
    $('l-force').value = s.force || 'auto';
    $('l-shift').value = String(parseInt(s.hijriShift, 10) || 0);
    $('l-fav').value = s.favName || '';
  }
  document.querySelectorAll('#pal button').forEach((b) => { b.onclick = () => { palette = b.dataset.k; document.querySelectorAll('#pal button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); saveSettings({ palette }); }; });
  $('l-save').onclick = () => saveSettings({ auto: $('l-auto').checked, force: $('l-force').value, hijriShift: parseInt($('l-shift').value, 10) || 0, favName: $('l-fav').value.trim() }).then(renderFavs);

  // ---------- account
  function renderAccount() { const a = doc.account || {}; $('a-server').value = a.server || ''; $('a-user').value = a.username || ''; $('a-pass').value = a.password || ''; }
  $('a-save').onclick = async () => {
    const a = { server: $('a-server').value.trim(), username: $('a-user').value.trim(), password: $('a-pass').value };
    if (!a.server || !a.username || !a.password) { toast('اكتب السيرفر واسم المستخدم وكلمة السر', true); return; }
    if (await save('account', a, 'اتحفظ، التلفزيون هيدخل لوحده')) { doc.account = a; catalog = null; }
  };

  // ---------- load
  async function refresh(manual) {
    try {
      const d = (await getDoc()) || {};
      doc = d; renderStatus();
      if (manual) toast('اتحدّث');
      return true;
    } catch (e) {
      setSync('err', e.message === 'denied' ? 'مرفوض' : 'مفيش اتصال');
      if (e.message === 'denied') showConnect(isSupa() ? 'Supabase رفض الاتصال. اتأكد إنك شغّلت ملف supabase.sql في SQL Editor، وإن مفتاح Supabase صح.' : 'قاعدة البيانات رفضت الاتصال. اتأكد إنك حطيت القواعد من ملف database.rules.json وإن المفتاح ٢٤ حرف أو أكتر.');
      return false;
    }
  }
  async function start() {
    DB = cleanDb(ls.get('db')); KEY = ls.get('key'); ANON = ls.get('anon');
    if (!DB || !KEY) { showConnect(); return; }
    $('connect').hidden = true; $('main').hidden = false;
    setSync('idle', 'بيحمّل…');
    if (!(await refresh(false))) return;
    $('w-title').value = (doc.settings && doc.settings.title) || '';
    $('w-sub').value = (doc.settings && doc.settings.sub) || '';
    $('m-date').value = iso(new Date());
    people = asArray(doc.people).map((p) => Object.assign({ name: '', date: '', text: '' }, p));
    favs = asArray(doc.favorites).map((f) => ({ id: +f.id, name: f.name }));
    renderMessages(); renderPeople(); renderFavs(); renderLook(); renderAccount();
    openTab(ls.get('tab') || 'home');
  }
  setInterval(() => { if (KEY && !document.hidden) refresh(false); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && KEY) refresh(false); });

  readHash();
  start();
})();
