/* Ahmed TV - TV app.
 * Runs inside the Tizen shell (tizen-shell/), which defines window.AHMED_TV = {db, key, ...}
 * and loads this file from the web (or from its bundled copy when offline).
 * Target: Samsung Tizen 4.0 (2018) = Chromium 56. Keep to ES5 + Promise/XHR.
 * No object spread, no optional chaining, no padStart, no Array.flat. */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var CFG = window.AHMED_TV || {};
  var IS_TV = !!(window.webapis && window.webapis.avplay);
  var DB = String(CFG.db || '').replace(/\/+$/, '');
  var KEY = String(CFG.key || '');
  var MOCK = !!CFG.mock;
  var POLL_MS = 30000;

  /* ------------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function enc(s) { return encodeURIComponent(s); }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function show(e, on) { if (e) e.classList.toggle('hidden', !on); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function hexA(hex, a) { var n = parseInt(String(hex).slice(1), 16); return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function b64(s) { if (!s) return ''; try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; } }
  function fmtClock(d) { var h = d.getHours(); return ((h % 12) || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? ' ص' : ' م'); }
  function fmtDur(sec) { sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s); }
  function minsLeft(sec) { var m = Math.round(sec / 60); return m >= 60 ? 'فاضل ' + Math.floor(m / 60) + ' ساعة ' + (m % 60) + ' د' : 'فاضل ' + m + ' دقيقة'; }

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function fmtDate(d) { return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function fmtLongDate(d) { return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }

  var store = {
    get: function (k, def) { try { var v = localStorage.getItem('atv_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('atv_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  function http(method, url, body, timeout, headers) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
      if (headers) for (var h in headers) x.setRequestHeader(h, headers[h]);
      x.timeout = timeout || 20000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          if (!x.responseText) return resolve(null);
          try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(new Error('bad-json')); }
        } else reject(new Error('http-' + x.status));
      };
      x.onerror = function () { reject(new Error('network')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      if (body !== undefined) { x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); }
      else x.send();
    });
  }

  /* ------------------------------------- remote control (Supabase or Firebase) */
  // Supabase: db = https://xxxx.supabase.co + anon = project's anon/publishable key (see supabase.sql)
  // Firebase: db = Realtime Database URL
  var SUPA = /supabase\.(co|in)/.test(DB) || !!CFG.anon;
  function rpc(fn, args, timeout) { return http('POST', DB + '/rest/v1/rpc/' + fn, args, timeout || 20000, { apikey: CFG.anon || '' }); }
  var Remote = {
    ok: function () { return !!(DB && KEY); },
    url: function (p) { return DB + '/' + p + '.json'; },
    load: function () {
      if (!Remote.ok()) return Promise.reject(new Error('no-db'));
      return SUPA ? rpc('tv_get', { k: KEY }, 12000) : http('GET', Remote.url('tv/' + KEY), undefined, 12000);
    },
    // status is the only patched part; it is always written whole
    patch: function (p, o) {
      if (!Remote.ok()) return Promise.resolve();
      if (SUPA) { if (o && o.lastSeen && o.lastSeen['.sv']) o.lastSeen = Date.now(); return rpc('tv_set', { k: KEY, p: p, v: o }); }
      return http('PATCH', Remote.url('tv/' + KEY + (p ? '/' + p : '')), o);
    },
    put: function (p, o) { if (!Remote.ok()) return Promise.resolve(); return SUPA ? rpc('tv_set', { k: KEY, p: p, v: o }) : http('PUT', Remote.url('tv/' + KEY + '/' + p), o); },
    putCatalog: function (o) { if (!Remote.ok()) return Promise.resolve(); return SUPA ? rpc('tv_set', { k: KEY, p: 'catalog', v: o }, 60000) : http('PUT', Remote.url('catalog/' + KEY), o, 60000); }
  };

  /* ------------------------------------------------------- Xtream Codes API */
  function normServer(s) {
    s = String(s || '').trim().replace(/\/+$/, '').replace(/\/player_api\.php.*$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }
  var X = {
    acc: null,
    base: function () { return X.acc.server + '/player_api.php?username=' + enc(X.acc.username) + '&password=' + enc(X.acc.password); },
    call: function (action, extra) { return http('GET', X.base() + (action ? '&action=' + action : '') + (extra || ''), undefined, 60000); },
    path: function (kind, id, ext) { return X.acc.server + '/' + kind + '/' + enc(X.acc.username) + '/' + enc(X.acc.password) + '/' + id + '.' + ext; },
    liveUrl: function (id) { return X.path('live', id, IS_TV ? S.liveExt : 'm3u8'); },
    movieUrl: function (id, ext) { return X.path('movie', id, ext || 'mp4'); },
    epUrl: function (id, ext) { return X.path('series', id, ext || 'mp4'); }
  };

  /* ------------------------------------------------------------------ state */
  var S = {
    cfg: store.get('cfg', {}) || {},
    user: null, liveExt: 'ts', accountError: '',
    streams: [], byId: {}, cats: [], lists: [],
    li: 0, ci: 0, prev: null,
    movies: null, series: null,
    resume: store.get('resume', []) || []
  };

  /* --------------------------------------------------------------- occasions */
  var PAL = {
    gold: { bg: '#07080c', bg2: '#12131b', acc: '#d9b26a', glow: 'rgba(217,178,106,.20)', g2: 'rgba(60,80,170,.22)' },
    ruby: { bg: '#0a0607', bg2: '#1a0c0e', acc: '#e5484d', glow: 'rgba(229,72,77,.20)', g2: 'rgba(120,40,60,.25)' },
    emerald: { bg: '#05100c', bg2: '#0b1d17', acc: '#34c79a', glow: 'rgba(52,199,154,.18)', g2: 'rgba(30,90,120,.24)' },
    sapphire: { bg: '#05070f', bg2: '#0c1328', acc: '#6ea8ff', glow: 'rgba(110,168,255,.18)', g2: 'rgba(120,80,200,.22)' }
  };
  var OCC = {
    friday: { bg: '#04120e', bg2: '#0a2219', acc: '#d6b46a', glow: 'rgba(214,180,106,.22)', g2: 'rgba(16,120,80,.30)', eyebrow: 'الجمعة', title: 'جمعة مباركة', sub: 'ربنا يتقبل منكم صالح الأعمال · متنسوش سورة الكهف', art: 'friday', deco: 'stars' },
    bday: { bg: '#140810', bg2: '#26101c', acc: '#f0a8bc', glow: 'rgba(240,168,188,.24)', g2: 'rgba(217,178,106,.18)', art: 'bday', deco: 'confetti' },
    ramadan: { bg: '#070b1f', bg2: '#101a3d', acc: '#f2c25a', glow: 'rgba(242,194,90,.24)', g2: 'rgba(90,70,190,.30)', title: 'رمضان كريم', art: 'ramadan', deco: 'lanterns' },
    fitr: { bg: '#05161a', bg2: '#0b2a30', acc: '#8fe3cf', glow: 'rgba(143,227,207,.20)', g2: 'rgba(242,194,90,.20)', eyebrow: 'عيد الفطر', title: 'عيد فطر سعيد', sub: 'كل عام وأنتم بخير', art: 'eid', deco: 'stars' },
    adha: { bg: '#120c05', bg2: '#26180a', acc: '#f0b35e', glow: 'rgba(240,179,94,.24)', g2: 'rgba(180,80,40,.22)', eyebrow: 'عيد الأضحى المبارك', title: 'عيد أضحى مبارك', sub: 'تقبل الله منا ومنكم، وكل سنة وانتم طيبين', art: 'eid', deco: 'stars' }
  };
  var RULES = ['bday', 'adha', 'fitr', 'ramadan', 'friday'];

  var hijriFmt = null;
  try { hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch (e) { hijriFmt = null; }
  function hijriTabular(d) { // Kuwaiti algorithm, used when the TV has no Umm al-Qura calendar
    var day = d.getDate(), m = d.getMonth() + 1, y = d.getFullYear();
    if (m < 3) { y -= 1; m += 12; }
    var a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
    var jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
    var iyear = 10631 / 30, shift1 = 8.01 / 60, z = jd - 1948084;
    var cyc = Math.floor(z / 10631); z -= 10631 * cyc;
    var j = Math.floor((z - shift1) / iyear); z -= Math.floor(j * iyear + shift1);
    var im = Math.floor((z + 28.5001) / 29.5); if (im === 13) im = 12;
    return { month: im, day: z - Math.floor(29.5001 * im - 29) };
  }
  function hijri(d) {
    var shift = parseInt((S.cfg.settings || {}).hijriShift, 10) || 0;
    var x = new Date(d.getTime() - shift * 864e5);
    if (hijriFmt && hijriFmt.formatToParts) {
      try {
        var o = {}; each(hijriFmt.formatToParts(x), function (p) { o[p.type] = parseInt(p.value, 10); });
        if (o.month >= 1 && o.month <= 12 && o.day >= 1) return { month: o.month, day: o.day };
      } catch (e) { }
    }
    return hijriTabular(x);
  }
  function greeting(h) {
    if (h >= 5 && h < 12) return { e: 'صباح الخير', s: 'صباحكم فل يا أحلى بابا وماما' };
    if (h >= 12 && h < 17) return { e: 'نهاركم سعيد', s: 'يومكم حلو إن شاء الله' };
    if (h >= 17 && h < 22) return { e: 'مساء الخير', s: 'مساء الفل، القنوات جاهزة للسهرة' };
    return { e: 'تصبحوا على خير', s: 'متسهروش كتير، ونوم الهنا' };
  }
  function resolveLook(now) {
    var st = S.cfg.settings || {}, h = now.getHours(), g = greeting(h);
    var pal = PAL[st.palette] || PAL.gold;
    var r = { pal: pal, key: 'normal', eyebrow: g.e, title: st.title || 'Welcome Ahmed Gamal', sub: st.sub || g.s, art: 'normal', deco: 'none' };
    var md = iso(now).slice(5), hj = hijri(now), c = {};
    each(asArray(S.cfg.people), function (p) { if (p && p.date && String(p.date).slice(-5) === md && !c.bday) c.bday = p; });
    if (hj.month === 12 && hj.day >= 9 && hj.day <= 13) c.adha = 1;
    if (hj.month === 10 && hj.day <= 3) c.fitr = 1;
    if (hj.month === 9) c.ramadan = hj.day;
    if (now.getDay() === 5 && h < 18) c.friday = 1;
    var pick = null, force = st.force || 'auto';
    if (force !== 'auto') {
      pick = force === 'normal' ? null : force;
      if (pick === 'bday' && !c.bday) c.bday = asArray(S.cfg.people)[0] || { name: '', text: 'كل سنة وانتم طيبين' };
      if (pick === 'ramadan' && !c.ramadan) c.ramadan = hj.month === 9 ? hj.day : 0;
    } else if (st.auto !== false) {
      for (var i = 0; i < RULES.length; i++) if (c[RULES[i]]) { pick = RULES[i]; break; }
    }
    if (pick) {
      var o = OCC[pick]; r.pal = o; r.key = pick; r.art = o.art; r.deco = o.deco;
      if (pick === 'bday') { var p = c.bday; r.eyebrow = 'عيد ميلاد ' + (p.name || ''); r.title = p.text || ('كل سنة وانت طيب يا ' + p.name); r.sub = 'عيد ميلاد سعيد، ربنا يخليك لينا · مهاب'; }
      else if (pick === 'ramadan') { r.eyebrow = c.ramadan ? 'اليوم ' + c.ramadan + ' رمضان' : 'رمضان'; r.title = o.title; r.sub = h < 18 ? 'رمضان كريم، وكل سنة وانتم طيبين' : 'تقبّل الله صيامكم، وكل سنة وانتم طيبين'; }
      else { r.eyebrow = o.eyebrow || r.eyebrow; r.title = o.title; r.sub = o.sub; }
    }
    return r;
  }
  function applyPalette(p) {
    var st = document.documentElement.style;
    st.setProperty('--bg', p.bg); st.setProperty('--bg-2', p.bg2); st.setProperty('--accent', p.acc);
    st.setProperty('--accent-soft', hexA(p.acc, 0.18)); st.setProperty('--glow', p.glow); st.setProperty('--glow-2', p.g2);
  }
  function svgArt(kind, acc) {
    if (kind === 'ramadan') return '<svg viewBox="0 0 720 520"><defs><radialGradient id="mg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="' + acc + '" stop-opacity=".55"/><stop offset="1" stop-color="' + acc + '" stop-opacity="0"/></radialGradient><mask id="cm"><rect width="720" height="520" fill="#fff"/><circle cx="330" cy="210" r="150" fill="#000"/></mask></defs><circle cx="390" cy="240" r="260" fill="url(#mg)"/><circle cx="390" cy="240" r="170" fill="' + acc + '" mask="url(#cm)"/></svg>';
    if (kind === 'friday') { var a = ''; for (var i = 0; i < 5; i++) { var x = 60 + i * 130; a += '<path d="M' + x + ' 470 V250 Q' + x + ' 170 ' + (x + 55) + ' 140 Q' + (x + 110) + ' 170 ' + (x + 110) + ' 250 V470" fill="none" stroke="' + acc + '" stroke-opacity="' + (0.25 + i * 0.12) + '" stroke-width="3"/>'; } return '<svg viewBox="0 0 720 520">' + a + '</svg>'; }
    if (kind === 'bday') return '<svg viewBox="0 0 720 520"><g stroke="' + acc + '" stroke-width="2" fill="none"><path d="M250 330 Q240 420 270 500"/><path d="M380 300 Q400 400 370 500"/><path d="M500 340 Q480 430 510 500"/></g><ellipse cx="250" cy="260" rx="62" ry="76" fill="' + acc + '" opacity=".9"/><ellipse cx="380" cy="220" rx="70" ry="86" fill="#fff" opacity=".88"/><ellipse cx="500" cy="270" rx="58" ry="72" fill="' + acc + '" opacity=".6"/></svg>';
    if (kind === 'eid') { var s = ''; for (var j = 0; j < 8; j++) { var an = j * Math.PI / 4, rr = j % 2 ? 95 : 180; s += (j ? 'L' : 'M') + (380 + Math.cos(an) * rr).toFixed(1) + ' ' + (250 + Math.sin(an) * rr).toFixed(1); } return '<svg viewBox="0 0 720 520"><g fill="none" stroke="' + acc + '" stroke-width="3"><path d="' + s + 'Z"/><path d="' + s + 'Z" transform="rotate(22.5 380 250)" opacity=".45"/><circle cx="380" cy="250" r="230" opacity=".2"/></g><circle cx="380" cy="250" r="46" fill="' + acc + '"/></svg>'; }
    return '<svg viewBox="0 0 720 520"><g fill="none" stroke="' + acc + '"><circle cx="380" cy="250" r="220" stroke-opacity=".18" stroke-width="2"/><circle cx="380" cy="250" r="160" stroke-opacity=".3" stroke-width="2"/><circle cx="380" cy="250" r="100" stroke-opacity=".55" stroke-width="3"/></g><text x="380" y="284" text-anchor="middle" font-family="Reem Kufi,sans-serif" font-size="100" font-weight="700" fill="' + acc + '">A</text></svg>';
  }
  function decoHtml(kind, acc) {
    var h = '', i;
    if (kind === 'lanterns') each([600, 720, 840], function (x, k) { var len = 30 + (k % 2) * 80; h += '<div class="lantern" style="left:' + x + 'px;animation-delay:' + (-k * 0.7) + 's;-webkit-animation-delay:' + (-k * 0.7) + 's"><svg width="70" height="' + (len + 130) + '"><line x1="35" y1="0" x2="35" y2="' + len + '" stroke="' + acc + '" stroke-opacity=".6" stroke-width="2"/><g transform="translate(0 ' + len + ')"><path d="M22 6 H48 L54 22 H16Z" fill="' + acc + '"/><path d="M16 22 H54 L60 80 Q35 104 10 80Z" fill="' + acc + '" fill-opacity=".22" stroke="' + acc + '" stroke-width="2"/><ellipse cx="35" cy="60" rx="10" ry="18" fill="' + acc + '" fill-opacity=".8"/><path d="M26 100 H44 L35 122Z" fill="' + acc + '"/></g></svg></div>'; });
    if (kind === 'confetti') { var cols = [acc, '#ffffff', '#f6d38b', '#e78aa5']; for (i = 0; i < 26; i++) { var du = (7 + Math.random() * 7).toFixed(1), dl = (-Math.random() * 12).toFixed(1); h += '<div class="conf" style="left:' + (Math.random() * 1920 | 0) + 'px;background:' + cols[i % 4] + ';opacity:.75;animation-duration:' + du + 's;-webkit-animation-duration:' + du + 's;animation-delay:' + dl + 's;-webkit-animation-delay:' + dl + 's"></div>'; } }
    if (kind === 'stars') for (i = 0; i < 40; i++) { var d2 = (2 + Math.random() * 3).toFixed(1), l2 = (-Math.random() * 3).toFixed(1); h += '<div class="star" style="left:' + (Math.random() * 1920 | 0) + 'px;top:' + (Math.random() * 600 | 0) + 'px;animation-duration:' + d2 + 's;-webkit-animation-duration:' + d2 + 's;animation-delay:' + l2 + 's;-webkit-animation-delay:' + l2 + 's"></div>'; }
    return h;
  }

  function asArray(v) { if (!v) return []; if (Array.isArray(v)) return v.filter(function (x) { return x != null; }); return Object.keys(v).map(function (k) { return v[k]; }); }
  function todaysMessage() {
    var m = (S.cfg.messages || {})[iso(new Date())];
    if (!m) return '';
    return typeof m === 'string' ? m : (m.text || '');
  }

  /* -------------------------------------------------------- generated art */
  var HUES = [['#7c2d12', '#f59e0b'], ['#1e3a8a', '#60a5fa'], ['#14532d', '#86efac'], ['#581c87', '#f0abfc'], ['#7f1d1d', '#fca5a5'], ['#0f766e', '#5eead4'], ['#3f3f46', '#e4e4e7'], ['#78350f', '#fde68a'], ['#312e81', '#a5b4fc'], ['#831843', '#f9a8d4']];
  function artBg(seed, ang) { var i = Math.abs(seed | 0), h = HUES[i % HUES.length]; return 'radial-gradient(60% 55% at ' + (20 + (i * 23) % 60) + '% ' + (25 + (i * 17) % 40) + '%,' + hexA(h[1], 0.35) + ',transparent 70%),radial-gradient(80% 70% at 80% 100%,' + h[0] + ',transparent 70%),linear-gradient(' + (ang || 160) + 'deg,' + h[0] + ',#050507)'; }

  /* ------------------------------------------------------------------ focus */
  function tx(e) {
    var cs = window.getComputedStyle(e), m = cs.transform || cs.webkitTransform;
    if (!m || m === 'none') return [0, 0];
    var v = m.match(/matrix\(([^)]+)\)/); if (!v) return [0, 0];
    var p = v[1].split(','); return [parseFloat(p[4]) || 0, parseFloat(p[5]) || 0];
  }
  function ancestor(e, cls, stop) { while (e && e !== stop && e !== document.body) { if (e.classList && e.classList.contains(cls)) return e; e = e.parentNode; } return null; }
  // rect of an element as it will be once running scroll transitions finish
  function rectOf(e) {
    var r = e.getBoundingClientRect(), dx = 0, dy = 0;
    var st = ancestor(e, 'strip'); if (st) dx += (st._x || 0) - tx(st)[0];
    var vs = ancestor(e, 'vscroll'); if (vs) dy += (vs._y || 0) - tx(vs)[1];
    return { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy, width: r.width, height: r.height };
  }
  var F = {
    el: null,
    root: null,
    set: function (e, noScroll) {
      if (!e) return;
      if (F.el && F.el !== e) F.el.classList.remove('focus');
      F.el = e; e.classList.add('focus');
      var st = ancestor(e, 'strip'); if (st) st._last = e;
      if (!noScroll) keepVisible(e);
      if (e._focus) e._focus();
    },
    candidates: function () {
      var out = [], roots = [F.root];
      if (!$('topbar').classList.contains('hidden')) roots.push($('topbar'));
      each(roots, function (r) { if (!r) return; each(r.querySelectorAll('.f'), function (e) { if (e.offsetParent !== null && !e.classList.contains('nofocus')) out.push(e); }); });
      return out;
    },
    move: function (dir) {
      var cur = F.el;
      if (!cur || cur.offsetParent === null) { var c0 = F.candidates(); if (c0.length) F.set(c0[0]); return false; }
      var a = rectOf(cur), ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2, best = null, bs = 1e12;
      var horiz = dir === 'left' || dir === 'right';
      each(F.candidates(), function (b) {
        if (b === cur) return;
        var r = rectOf(b); if (!r.width) return;
        var bx = (r.left + r.right) / 2, by = (r.top + r.bottom) / 2, p, ov, sd;
        if (dir === 'left') p = ax - bx; else if (dir === 'right') p = bx - ax; else if (dir === 'up') p = ay - by; else p = by - ay;
        if (p <= 8) return;
        if (horiz) { ov = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top); sd = Math.abs(by - ay); }
        else { ov = Math.min(a.right, r.right) - Math.max(a.left, r.left); sd = Math.abs(bx - ax); }
        var s = p + (ov > 0 ? 0 : sd * 3) + (horiz ? sd * 2 : sd * 0.5);
        if (s < bs) { bs = s; best = b; }
      });
      if (!best) return false;
      if (!horiz) { var st = ancestor(best, 'strip'); if (st && st._last && st._last !== best && st._last.offsetParent !== null && ancestor(cur, 'strip') !== st) best = st._last; }
      F.set(best);
      return true;
    }
  };
  function keepVisible(e) {
    var st = ancestor(e, 'strip');
    if (st) {
      var r = rectOf(e), x = st._x || 0, minL = 70, maxR = 1840;
      if (r.left < minL) x += (minL - r.left);
      if (r.right > maxR) x -= (r.right - maxR);
      if (x < 0) x = 0;
      if (x !== (st._x || 0)) { st._x = x; st.style.webkitTransform = st.style.transform = 'translateX(' + x + 'px)'; }
    }
    var vs = ancestor(e, 'vscroll');
    if (vs) {
      var row = ancestor(e, 'row', vs) || e, y = -row.offsetTop;
      if (vs._mode === 'grid') { y = -Math.max(0, e.offsetTop - 10); }
      if (y > 0) y = 0;
      if (y !== (vs._y || 0)) { vs._y = y; vs.style.webkitTransform = vs.style.transform = 'translateY(' + y + 'px)'; }
      if (vs._onscroll) vs._onscroll();
    }
  }
  function resetScroll(container) {
    each(container.querySelectorAll('.strip,.vscroll'), function (s) { s._x = 0; s._y = 0; s._last = null; s.style.webkitTransform = s.style.transform = ''; });
  }

  /* --------------------------------------------------------- lazy images */
  function img(src, onfail) {
    var i = new Image();
    i.setAttribute('data-src', src || '');
    i.onerror = function () { if (i.parentNode) i.parentNode.removeChild(i); if (onfail) onfail(); };
    return i;
  }
  function loadImages(container) {
    each(container.querySelectorAll('img[data-src]'), function (i) { var s = i.getAttribute('data-src'); i.removeAttribute('data-src'); if (s) i.src = s; else if (i.onerror) i.onerror(); });
  }
  function loadVisibleRows(vs) {
    var y = vs._y || 0;
    each(vs.children, function (row) { var top = row.offsetTop + y; if (top > -500 && top < 1000) loadImages(row); });
  }

  /* ----------------------------------------------------------------- player */
  var Player = {
    token: 0, video: null, hls: null, opts: {}, playing: false, dur: 0, cur: 0,
    init: function () {
      if (IS_TV) {
        var o = document.createElement('object');
        o.id = 'av'; o.setAttribute('type', 'application/avplayer');
        o.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;z-index:-1';
        document.body.insertBefore(o, document.body.firstChild);
      } else {
        var v = document.createElement('video');
        v.id = 'vid'; v.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;background:#000;z-index:-1';
        v.setAttribute('playsinline', '');
        document.body.insertBefore(v, document.body.firstChild);
        Player.video = v;
        v.addEventListener('waiting', function () { Player.emit('buffer', true); });
        v.addEventListener('playing', function () { Player.emit('buffer', false); Player.playing = true; });
        v.addEventListener('timeupdate', function () { Player.cur = v.currentTime * 1000; Player.dur = (v.duration || 0) * 1000; Player.emit('time', Player.cur); });
        v.addEventListener('ended', function () { Player.emit('end'); });
        v.addEventListener('error', function () { Player.emit('error', 'video'); });
      }
    },
    emit: function (ev, a) { var f = Player.opts['on' + ev]; if (f) try { f(a); } catch (e) { } },
    play: function (url, opts) {
      Player.stop();
      Player.opts = opts || {}; Player.playing = false; Player.cur = 0; Player.dur = 0;
      var tk = ++Player.token;
      document.body.classList.add('video');
      Player.emit('buffer', true);
      if (MOCK) { setTimeout(function () { if (tk === Player.token) Player.emit('buffer', false); }, 500); return; }
      if (IS_TV) {
        var av = webapis.avplay;
        try {
          av.open(url);
          av.setDisplayRect(0, 0, 1920, 1080);
          try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { }
          av.setListener({
            onbufferingstart: function () { if (tk === Player.token) Player.emit('buffer', true); },
            onbufferingcomplete: function () { if (tk === Player.token) Player.emit('buffer', false); },
            oncurrentplaytime: function (t) { if (tk !== Player.token) return; Player.cur = t; Player.emit('time', t); },
            onstreamcompleted: function () { if (tk === Player.token) Player.emit('end'); },
            onerror: function (e) { if (tk === Player.token) Player.emit('error', e); },
            onevent: function () { }
          });
          av.prepareAsync(function () {
            if (tk !== Player.token) return;
            try {
              av.play(); Player.playing = true;
              try { Player.dur = av.getDuration(); } catch (e) { }
              if (Player.opts.start > 0) av.seekTo(Player.opts.start, function () { }, function () { });
              Player.emit('buffer', false);
            } catch (e) { Player.emit('error', e); }
          }, function (e) { if (tk === Player.token) Player.emit('error', e); });
        } catch (e) { Player.emit('error', e); }
      } else {
        var v = Player.video;
        if (/\.m3u8/.test(url) && window.Hls && window.Hls.isSupported()) { Player.hls = new window.Hls(); Player.hls.loadSource(url); Player.hls.attachMedia(v); }
        else v.src = url;
        var p = v.play(); if (p && p.catch) p.catch(function () { });
        if (Player.opts.start > 0) v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); v.currentTime = Player.opts.start / 1000; });
      }
    },
    stop: function () {
      Player.token++; Player.playing = false;
      if (IS_TV) { try { webapis.avplay.stop(); } catch (e) { } try { webapis.avplay.close(); } catch (e) { } }
      else if (Player.video) { if (Player.hls) { try { Player.hls.destroy(); } catch (e) { } Player.hls = null; } Player.video.removeAttribute('src'); try { Player.video.load(); } catch (e) { } }
    },
    toggle: function () {
      if (IS_TV) { try { var st = webapis.avplay.getState(); if (st === 'PLAYING') { webapis.avplay.pause(); Player.playing = false; } else { webapis.avplay.play(); Player.playing = true; } } catch (e) { } }
      else if (Player.video) { if (Player.video.paused) { Player.video.play(); Player.playing = true; } else { Player.video.pause(); Player.playing = false; } }
      return Player.playing;
    },
    duration: function () { if (IS_TV) { try { Player.dur = webapis.avplay.getDuration() || Player.dur; } catch (e) { } } return Player.dur; },
    seek: function (ms) {
      ms = Math.max(0, ms);
      if (IS_TV) { try { webapis.avplay.seekTo(ms, function () { }, function () { }); } catch (e) { } }
      else if (Player.video) Player.video.currentTime = ms / 1000;
      Player.cur = ms;
    }
  };

  /* ------------------------------------------------------------------- toast & popup */
  var toastT;
  function toast(t) { var e = $('toast'); e.textContent = t; show(e, true); clearTimeout(toastT); toastT = setTimeout(function () { show(e, false); }, 2800); }

  var Pop = {
    open: false, prevFocus: null, onBack: null,
    show: function (o) {
      Pop.prevFocus = F.el; Pop.open = true; Pop.onBack = o.onBack || null;
      $('pop-k').textContent = o.kicker || ''; $('pop-h').textContent = o.title || ''; $('pop-p').textContent = o.text || '';
      var acts = $('pop-acts'); acts.innerHTML = '';
      each(o.buttons || [{ label: 'تمام' }], function (b) { var x = el('span', 'btn f', esc(b.label)); x._ok = function () { Pop.close(); if (b.fn) b.fn(); }; acts.appendChild(x); });
      show($('pop'), true);
      if (F.el) F.el.classList.remove('focus');
      F.el = null; F.set(acts.firstChild, true);
    },
    close: function () { show($('pop'), false); Pop.open = false; var e = F.el; if (e) e.classList.remove('focus'); F.el = null; if (Pop.prevFocus && Pop.prevFocus.offsetParent !== null) F.set(Pop.prevFocus, true); },
    key: function (k) {
      var acts = $('pop-acts').children, i = Array.prototype.indexOf.call(acts, F.el);
      if (k === 'left' && i < acts.length - 1) F.set(acts[i + 1], true);
      else if (k === 'right' && i > 0) F.set(acts[i - 1], true);
      else if (k === 'ok' && F.el && F.el._ok) F.el._ok();
      else if (k === 'back') { Pop.close(); if (Pop.onBack) Pop.onBack(); }
    }
  };

  /* ------------------------------------------------------------- screens */
  var Screens = {}, cur = null, curArg = null;
  function go(name, arg) {
    var prev = cur;
    if (cur && Screens[cur].leave) Screens[cur].leave(name);
    cur = name; curArg = arg;
    each(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('on', s.id === 's-' + name); });
    show($('topbar'), !!Screens[name].bar);
    each(document.querySelectorAll('#nav .f'), function (n) { n.classList.toggle('act', n.getAttribute('data-go') === name); });
    if (!Screens[name].video) { document.body.classList.remove('video'); if (prev && Screens[prev] && Screens[prev].video) Player.stop(); }
    F.root = $('s-' + name);
    if (F.el) F.el.classList.remove('focus');
    F.el = null;
    Screens[name].enter(arg, prev);
    if (!F.el) { var c = F.candidates(); if (c.length) F.set(c[0]); }
    Status.soon();
  }

  /* ---- open (today's message first) ---- */
  Screens.open = {
    enter: function () {
      var t = todaysMessage(); $('om-text').textContent = t;
      store.set('seenMsg', iso(new Date()) + '|' + t);
      F.set($('om-go'), true);
    },
    key: function (k) { if (k === 'ok' || k === 'back') { go('home'); return true; } return true; }
  };

  /* ---- home ---- */
  var lastLookKey = '';
  Screens.home = {
    bar: true,
    enter: function (arg, prev) {
      Home.render();
      if (prev === 'open' || !prev || prev === 'boot') F.set($('h-resume'), true);
      else { var c = F.candidates(); var fav = $('h-rows').querySelector('.ch'); F.set(fav || $('h-resume'), true); }
    },
    back: function () {
      Pop.show({ kicker: 'Ahmed TV', title: 'تقفلوا التطبيق؟', text: '', buttons: [{ label: 'لأ، خليه' }, { label: 'أيوه اقفل', fn: exitApp }] });
    }
  };
  var Home = {
    renderLook: function () {
      var now = new Date(), r = resolveLook(now);
      applyPalette(r.pal);
      $('h-eye').textContent = r.eyebrow;
      var w = $('h-title'), t = String(r.title || '');
      if (r.key === 'normal' && /^[\x00-\x7F]+$/.test(t) && t.indexOf(' ') > 0) { var parts = t.split(' '), first = parts.shift(); w.className = 'welcome latin'; w.innerHTML = esc(first) + ' <em>' + esc(parts.join(' ')) + '</em>'; }
      else { w.className = 'welcome'; w.textContent = t; }
      $('h-sub').textContent = r.sub;
      var key = r.key + r.pal.acc;
      if (key !== lastLookKey) { lastLookKey = key; $('h-art').innerHTML = svgArt(r.art, r.pal.acc); $('h-deco').innerHTML = decoHtml(r.deco, r.pal.acc); }
    },
    renderInfo: function () {
      var m = todaysMessage(); show($('h-msg'), !!m); $('h-msgt').textContent = m;
      var n = $('h-notice'), note = '';
      if (!Remote.ok()) note = 'التطبيق لسه مش متوصّل بلوحة التحكم. مهاب هيظبطه.';
      else if (!X.acc) note = 'لسه مفيش اشتراك متسجّل. مهاب هيضيفه من الموبايل وهيشتغل لوحده.';
      else if (S.accountError) note = S.accountError;
      n.textContent = note; show(n, !!note && !m);
      var u = S.user, sb = $('h-subs');
      if (u && u.exp) {
        var d = new Date(u.exp * 1000), left = Math.ceil((d - new Date()) / 864e5);
        sb.innerHTML = '<span class="dot" style="background:' + (left > 15 ? '#4ade80' : (left > 0 ? '#facc15' : '#ef4444')) + '"></span>الاشتراك ساري حتى<b>' + esc(fmtLongDate(d)) + '</b>· ' + (left > 0 ? 'باقي ' + left + ' يوم' : 'الاشتراك خلص');
        show(sb, true);
      } else if (u && u.status) { sb.innerHTML = '<span class="dot"></span>الاشتراك: <b>' + esc(u.status === 'Active' ? 'شغّال' : u.status) + '</b>'; show(sb, true); }
      else show(sb, false);
      var last = S.byId[(store.get('last', {}) || {}).id];
      $('h-last').textContent = last ? '· ' + last.name : '';
    },
    renderRows: function () {
      var rows = $('h-rows'); rows.innerHTML = ''; resetScroll($('s-home'));
      var fav = S.lists[0];
      if (fav && fav.items.length) rows.appendChild(rowEl(fav.name, fav.items.length + ' قناة', fav.items.slice(0, 60).map(function (c, i) { return chCard(c, i, 0); })));
      var res = S.resume.slice(0, 20);
      if (res.length) rows.appendChild(rowEl('كمّل المشاهدة', '', res.map(resumeCard)));
      if (S.movies && S.movies.latest.length) rows.appendChild(rowEl('أفلام جديدة', 'من اشتراككم', S.movies.latest.slice(0, 20).map(function (it) { return posterCard(it, 'movie'); })));
      if (S.series && S.series.latest.length) rows.appendChild(rowEl('مسلسلات جديدة', 'من اشتراككم', S.series.latest.slice(0, 20).map(function (it) { return posterCard(it, 'series'); })));
      rows._onscroll = function () { loadVisibleRows(rows); };
      loadVisibleRows(rows);
    },
    render: function () { Home.renderLook(); Home.renderInfo(); Home.renderRows(); }
  };

  function rowEl(title, count, cards) {
    var r = el('div', 'row'); r.appendChild(el('div', 'rowt', esc(title) + (count ? '<span>' + esc(count) + '</span>' : '')));
    var w = el('div', 'swrap'), s = el('div', 'strip'); each(cards, function (c) { s.appendChild(c); }); w.appendChild(s); r.appendChild(w); return r;
  }
  function chCard(c, i, li) {
    var e = el('div', 'ch f nologo', '<span class="num">' + (i + 1) + '</span><span class="mono">' + esc(c.name) + '</span><span class="nm">' + esc(c.name) + '</span>');
    if (c.logo) { var im = img(c.logo); e.appendChild(im); im.onload = function () { e.className = e.className.replace('nologo', 'haslogo'); }; }
    e._ok = function () { go('live', { li: li, ci: i }); };
    return e;
  }
  function posterCard(it, type) {
    var e = el('div', 'post f');
    var g = el('div', 'gen'); g.style.background = artBg(it.id); e.appendChild(g);
    var shade = el('div', 'shade'), pt = el('div', 'pt', esc(it.name));
    e.appendChild(shade); e.appendChild(pt);
    if (it.img) { var im = img(it.img); e.appendChild(im); im.onload = function () { shade.style.display = 'none'; pt.style.display = 'none'; }; }
    if (it.rating > 0) e.appendChild(el('span', 'rt', '★ ' + (Math.round(it.rating * 10) / 10)));
    e._item = it; e._type = type;
    e._ok = function () { go('detail', { type: type, item: it }); };
    return e;
  }
  function resumeCard(r) {
    var e = el('div', 'land f'), g = el('div', 'gen fill'); g.style.background = artBg(r.id, 200); e.appendChild(g);
    if (r.img) e.appendChild(img(r.img));
    var sub = r.type === 'series' && r.ep ? 'م' + r.ep.season + ' · ح' + r.ep.num + ' · ' : '';
    e.appendChild(el('div', 'shade')); e.appendChild(el('div', 'pt', esc(r.name)));
    e.appendChild(el('div', 's2', esc(sub + (r.dur ? minsLeft((r.dur - r.pos) / 1000) : ''))));
    e.appendChild(el('div', 'pbar', '<i style="width:' + (r.dur ? clamp(r.pos / r.dur * 100, 2, 100) : 0) + '%"></i>'));
    e._ok = function () { resumePlay(r); };
    return e;
  }

  /* ---- live ---- */
  var playLater = null, osdT, numT, digits = '';
  Screens.live = {
    video: true,
    enter: function (arg) {
      var last = store.get('last', {}) || {};
      if (arg && arg.li != null) { S.li = arg.li; S.ci = arg.ci; }
      else if (!S.lists[S.li] || !S.lists[S.li].items[S.ci]) {
        var pos = findChannel(last.id, last.list); S.li = pos.li; S.ci = pos.ci;
      }
      show($('l-list'), false);
      if (!S.lists.length || !S.lists[S.li] || !S.lists[S.li].items.length) { toast('مفيش قنوات لسه'); setTimeout(function () { go('home'); }, 50); return; }
      tune(S.li, S.ci, true);
      if (arg && arg.openList) openList();
      F.el = null;
    },
    leave: function () { clearTimeout(playLater); show($('l-list'), false); },
    key: function (k) {
      var listOn = !$('l-list').classList.contains('hidden');
      if (listOn) return listKey(k);
      if (/^d\d$/.test(k)) { digit(k.slice(1)); return true; }
      switch (k) {
        case 'up': case 'chup': zap(1); return true;
        case 'down': case 'chdown': zap(-1); return true;
        case 'left': case 'right': case 'yellow': case 'prech': recall(); return true;
        case 'ok': if (digits) { commitDigits(); return true; } openList(); return true;
        case 'info': osd(true); return true;
        case 'green': toggleFav(); return true;
        case 'back': if (!$('l-osd').classList.contains('off')) { osd(false); return true; } go('home'); return true;
      }
      return true;
    }
  };
  function findChannel(id, listName) {
    for (var li = 0; li < S.lists.length; li++) { if (listName && S.lists[li].name !== listName) continue; var items = S.lists[li].items; for (var ci = 0; ci < items.length; ci++) if (items[ci].id === id) return { li: li, ci: ci }; }
    if (listName) return findChannel(id, null);
    return { li: 0, ci: 0 };
  }
  function zap(d) { var items = S.lists[S.li].items; tune(S.li, (S.ci + d + items.length) % items.length); }
  function recall() { if (!S.prev) { osd(true); return; } var p = S.prev; tune(p.li, p.ci); }
  function tune(li, ci, now) {
    var L = S.lists[li]; if (!L || !L.items[ci]) return;
    if (S.lists[S.li] && !(li === S.li && ci === S.ci)) S.prev = { li: S.li, ci: S.ci };
    S.li = li; S.ci = ci;
    var c = L.items[ci];
    $('o-no').textContent = ci + 1; $('o-of').textContent = 'من ' + L.items.length;
    $('o-name').textContent = c.name; $('o-list').textContent = L.name; $('l-listname').textContent = L.name;
    var lg = $('o-logo'); if (c.logo) { lg.style.display = ''; lg.onerror = function () { lg.style.display = 'none'; }; lg.src = c.logo; } else lg.style.display = 'none';
    $('o-now').textContent = ''; $('o-next').textContent = ''; $('o-nowl').textContent = ''; $('o-nextl').textContent = ''; $('o-prog').style.width = '0';
    osd(true);
    clearTimeout(playLater);
    playLater = setTimeout(function () { startChannel(c); }, now ? 0 : 380);
  }
  var retryT;
  function startChannel(c) {
    clearTimeout(retryT);
    var tries = 0;
    function attempt() {
      Player.play(X.acc ? X.liveUrl(c.id) : '', {
        onbuffer: function (b) { show($('l-spin'), b); },
        onerror: function () {
          show($('l-spin'), false);
          if (tries++ < 1) { retryT = setTimeout(attempt, 2500); return; }
          $('o-now').innerHTML = '<span class="err">القناة مش شغالة دلوقتي، جرّبوا قناة تانية</span>'; osd(true, 8000);
        }
      });
    }
    attempt();
    store.set('last', { id: c.id, list: S.lists[S.li].name });
    Status.watching = c.name; Status.soon();
    loadEpg(c);
  }
  var loadEpg = debounce(function (c) {
    if (!X.acc || MOCK) return;
    X.call('get_short_epg', '&stream_id=' + c.id + '&limit=2').then(function (r) {
      var cc = S.lists[S.li] && S.lists[S.li].items[S.ci]; if (!cc || cc.id !== c.id) return;
      var l = (r && r.epg_listings) || [];
      function tm(x) { var t = parseInt(x.start_timestamp, 10); return t ? fmtClock(new Date(t * 1000)) : ''; }
      if (l[0]) {
        var s = parseInt(l[0].start_timestamp, 10) * 1000, e = parseInt(l[0].stop_timestamp, 10) * 1000;
        $('o-nowl').textContent = 'الآن' + (s ? ' · ' + fmtClock(new Date(s)) + ' – ' + fmtClock(new Date(e)) : '');
        $('o-now').textContent = b64(l[0].title);
        if (s && e > s) $('o-prog').style.width = clamp((Date.now() - s) / (e - s) * 100, 0, 100) + '%';
      }
      if (l[1]) { $('o-nextl').textContent = 'التالي · ' + tm(l[1]); $('o-next').textContent = b64(l[1].title); }
    }).catch(function () { });
  }, 600);
  function osd(on, ms) {
    var o = $('l-osd'); o.classList.toggle('off', !on); show($('l-top'), on);
    clearTimeout(osdT);
    if (on) { $('o-clock').textContent = fmtClock(new Date()); osdT = setTimeout(function () { o.classList.add('off'); show($('l-top'), false); }, ms || 5000); }
  }
  function digit(d) {
    digits = (digits + d).slice(0, 4);
    var nb = $('l-num'); nb.textContent = digits + '_'; show(nb, true);
    clearTimeout(numT); numT = setTimeout(commitDigits, 1700);
  }
  function commitDigits() {
    clearTimeout(numT); var n = parseInt(digits, 10); digits = ''; show($('l-num'), false);
    var items = S.lists[S.li].items;
    if (n >= 1 && n <= items.length) tune(S.li, n - 1); else toast('مفيش قناة رقم ' + n + ' في القائمة دي');
  }
  function toggleFav() {
    var c = S.lists[S.li].items[S.ci]; if (!c) return;
    var favs = asArray(S.cfg.favorites).slice(), idx = -1;
    each(favs, function (f, i) { if (f && +f.id === c.id) idx = i; });
    if (idx >= 0) { favs.splice(idx, 1); toast('اتشالت ' + c.name + ' من قائمة أحمد جمال'); }
    else { favs.push({ id: c.id, name: c.name }); toast('اتضافت ' + c.name + ' لقائمة أحمد جمال رقم ' + favs.length); }
    S.cfg.favorites = favs; store.set('cfg', S.cfg);
    var curId = c.id; buildLists(); var p = findChannel(curId, S.lists[S.li] ? S.lists[S.li].name : null); S.li = p.li; S.ci = p.ci;
    Remote.put('favorites', favs).catch(function () { toast('مقدرتش أحفظ التغيير أونلاين، هيتحفظ على التلفزيون بس'); });
  }

  // channel list overlay
  var LS = { li: 0, sel: 0 };
  function openList() { LS.li = S.li; LS.sel = S.ci; renderList(); show($('l-list'), true); osd(false); }
  function renderList() {
    var L = S.lists[LS.li], n = L.items.length, box = $('cl-rows'), h = '';
    $('cl-name').textContent = L.name; $('cl-count').textContent = n + ' قناة' + (S.lists.length > 1 ? ' · ' + (LS.li + 1) + '/' + S.lists.length : '');
    var start = clamp(LS.sel - 4, 0, Math.max(0, n - 9));
    var favIds = favIdMap();
    for (var i = start; i < Math.min(n, start + 9); i++) {
      var c = L.items[i];
      h += '<div class="li' + (i === LS.sel ? ' sel' : '') + (LS.li === S.li && i === S.ci ? ' playing' : '') + '"><span class="n">' + (i + 1) + '</span><span class="lg">' + (c.logo ? '<img src="' + esc(c.logo) + '" onerror="this.style.display=\'none\'">' : '') + '</span><span class="nmx">' + esc(c.name) + '</span>' + (favIds[c.id] && !L.fav ? '<span class="fav">★</span>' : '') + '</div>';
    }
    box.innerHTML = h;
  }
  function favIdMap() { var m = {}; each(asArray(S.cfg.favorites), function (f) { if (f) m[+f.id] = 1; }); return m; }
  function listKey(k) {
    var n = S.lists[LS.li].items.length;
    if (k === 'up') LS.sel = (LS.sel - 1 + n) % n;
    else if (k === 'down') LS.sel = (LS.sel + 1) % n;
    else if (k === 'chup') LS.sel = Math.max(0, LS.sel - 9);
    else if (k === 'chdown') LS.sel = Math.min(n - 1, LS.sel + 9);
    else if (k === 'left' || k === 'right') { LS.li = (LS.li + (k === 'left' ? 1 : -1) + S.lists.length) % S.lists.length; LS.sel = LS.li === S.li ? S.ci : 0; }
    else if (k === 'ok') { show($('l-list'), false); if (!(LS.li === S.li && LS.sel === S.ci)) tune(LS.li, LS.sel); else osd(true); return true; }
    else if (k === 'back') { show($('l-list'), false); return true; }
    else if (/^d\d$/.test(k)) { show($('l-list'), false); digit(k.slice(1)); return true; }
    renderList(); return true;
  }

  /* ---- movies & series ---- */
  function vodScreen(type) {
    var P = type === 'movie' ? 'm' : 's';
    return {
      bar: true,
      enter: function (arg, prev) {
        var data = type === 'movie' ? S.movies : S.series, scr = this;
        if (prev === 'detail' && scr._built && data) { if (scr._focus && scr._focus.offsetParent !== null) F.set(scr._focus, true); return; }
        if (!data) {
          show($(P + '-spin'), true); $(P + '-rows').innerHTML = '';
          setBill(P, { name: type === 'movie' ? 'الأفلام' : 'المسلسلات', plot: 'بنحمّل القائمة من اشتراككم…' }, type);
          loadVod(type).then(function () { show($(P + '-spin'), false); if (cur === (type === 'movie' ? 'movies' : 'series')) { scr._built = false; scr.enter(); } })
            .catch(function () { show($(P + '-spin'), false); setBill(P, { name: 'حصلت مشكلة', plot: 'مقدرناش نجيب القائمة من السيرفر. جرّبوا تاني كمان شوية.' }, type); });
          F.set($('nav-' + type), true);
          return;
        }
        if (!scr._built) buildVodRows(P, type, data);
        scr._built = true;
        var first = $(P + '-rows').querySelector('.f'); if (first) F.set(first);
      },
      key: function (k) { if (F.el && F.el._item && F.el._type === type) this._focus = F.el; return false; },
      back: function () { go('home'); }
    };
  }
  Screens.movies = vodScreen('movie');
  Screens.series = vodScreen('series');

  function setBill(P, it, type) {
    $(P + '-eye').textContent = it.eyebrow || (type === 'movie' ? 'فيلم' : 'مسلسل') + (it.genre ? ' · ' + it.genre : '');
    $(P + '-title').textContent = it.name || '';
    $(P + '-meta').innerHTML = metaHtml(it);
    $(P + '-plot').textContent = it.plot || '';
    var art = $(P + '-bart');
    if (it.backdrop) { art.style.background = '#000 url("' + String(it.backdrop).replace(/"/g, '') + '") center top / cover no-repeat'; art.innerHTML = ''; }
    else {
      art.style.background = artBg(it.id || 3, 200);
      art.innerHTML = it.img ? '<img src="' + esc(it.img) + '" style="position:absolute;left:220px;top:110px;width:300px;height:450px;object-fit:cover;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6)" onerror="this.style.display=\'none\'">' : '';
    }
  }
  function metaHtml(it) {
    var h = '';
    if (it.rating > 0) h += '<span class="r">تقييم ' + (Math.round(it.rating * 10) / 10) + '</span>';
    if (it.year) h += '<span>' + esc(it.year) + '</span>';
    if (it.genre) h += '<span class="tag">' + esc(String(it.genre).split(',')[0]) + '</span>';
    if (it.duration) h += '<span>' + esc(it.duration) + '</span>';
    return h;
  }
  var infoCache = {};
  function vodInfo(type, it) {
    var k = type + it.id; if (infoCache[k]) return Promise.resolve(infoCache[k]);
    if (MOCK || !X.acc) return Promise.resolve(null);
    var p = type === 'movie' ? X.call('get_vod_info', '&vod_id=' + it.id) : X.call('get_series_info', '&series_id=' + it.id);
    return p.then(function (r) { infoCache[k] = r; return r; });
  }
  function enrich(type, it, r) {
    var inf = (r && r.info) || {}, o = {};
    for (var k in it) o[k] = it[k];
    o.plot = inf.plot || inf.description || it.plot || '';
    o.genre = inf.genre || it.genre || '';
    o.year = (inf.releasedate || inf.releaseDate || inf.release_date || '').slice(0, 4) || it.year || '';
    o.rating = parseFloat(inf.rating) || it.rating || 0;
    o.duration = inf.duration ? String(inf.duration).replace(/^0?(\d+):(\d\d):\d\d$/, function (m, h, mm) { return (+h ? +h + ' ساعة ' : '') + (+mm) + ' د'; }) : '';
    var bd = inf.backdrop_path; o.backdrop = (bd && (Array.isArray(bd) ? bd[0] : bd)) || it.backdrop || '';
    o.cast = inf.cast || inf.actors || ''; o.director = inf.director || '';
    o.img = it.img || inf.movie_image || inf.cover || '';
    return o;
  }
  function buildVodRows(P, type, data) {
    var rows = $(P + '-rows'); rows.innerHTML = ''; resetScroll($('s-' + (type === 'movie' ? 'movies' : 'series')));
    var res = S.resume.filter(function (r) { return r.type === type; });
    if (res.length) rows.appendChild(rowEl('كمّل المشاهدة', '', res.map(resumeCard)));
    rows.appendChild(rowEl('أحدث الإضافات', '', data.latest.slice(0, 30).map(function (it) { return posterCard(it, type); })));
    var shown = 0;
    each(data.cats, function (c) {
      if (shown >= 40) return;
      var items = data.byCat[c.id]; if (!items || !items.length) return; shown++;
      var cards = items.slice(0, 30).map(function (it) { return posterCard(it, type); });
      if (items.length > 30) { var more = el('div', 'post more f', 'عرض الكل<br>' + items.length); more._ok = function () { go('grid', { type: type, title: c.name, items: items }); }; cards.push(more); }
      rows.appendChild(rowEl(c.name, items.length + '', cards));
    });
    var showBill = debounce(function (e) {
      if (!e || !e._item) return;
      var it = e._item; setBill(P, it, type);
      vodInfo(type, it).then(function (r) { if (F.el === e && r) setBill(P, enrich(type, it, r), type); }).catch(function () { });
    }, 450);
    each(rows.querySelectorAll('.post'), function (p) { p._focus = function () { showBill(p); }; });
    rows._onscroll = function () { loadVisibleRows(rows); };
    loadVisibleRows(rows);
    if (data.latest[0]) setBill(P, data.latest[0], type);
  }

  function loadVod(type) {
    if (MOCK) { mockVod(); return Promise.resolve(); }
    if (!X.acc) return Promise.reject(new Error('no-account'));
    var a = type === 'movie' ? ['get_vod_categories', 'get_vod_streams'] : ['get_series_categories', 'get_series'];
    return Promise.all([X.call(a[0]), X.call(a[1])]).then(function (r) {
      var cats = asArray(r[0]).map(function (c) { return { id: String(c.category_id), name: c.category_name }; });
      var items = asArray(r[1]).map(function (s) {
        if (type === 'movie') return { id: +s.stream_id, name: s.name, img: s.stream_icon, cat: String(s.category_id), rating: parseFloat(s.rating) || 0, added: +s.added || 0, ext: s.container_extension || 'mp4', year: s.year || '' };
        var bd = s.backdrop_path;
        return { id: +s.series_id, name: s.name, img: s.cover, cat: String(s.category_id), rating: parseFloat(s.rating) || 0, added: +s.last_modified || 0, plot: s.plot || '', genre: s.genre || '', year: String(s.releaseDate || s.release_date || '').slice(0, 4), backdrop: (bd && (Array.isArray(bd) ? bd[0] : bd)) || '' };
      });
      var data = indexVod(cats, items);
      if (type === 'movie') S.movies = data; else S.series = data;
      if (cur === 'home') Home.renderRows();
    });
  }
  function indexVod(cats, items) {
    var byCat = {};
    each(items, function (it) { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
    for (var k in byCat) byCat[k].sort(function (a, b) { return b.added - a.added; });
    var latest = items.slice().sort(function (a, b) { return b.added - a.added; }).slice(0, 40);
    return { cats: cats, items: items, byCat: byCat, latest: latest };
  }

  /* ---- grid (see all) ---- */
  var gridArg = null;
  Screens.grid = {
    bar: false,
    enter: function (arg) {
      gridArg = arg;
      $('g-title').textContent = arg.title;
      var gin = $('g-in'); gin.innerHTML = ''; gin._mode = 'grid'; gin._y = 0; gin.style.webkitTransform = gin.style.transform = '';
      var shownN = 0;
      function more() {
        var frag = document.createDocumentFragment();
        each(arg.items.slice(shownN, shownN + 56), function (it) { var p = posterCard(it, arg.type); p._focus = function () { if (shownN - arg.items.indexOf(it) < 15 && shownN < arg.items.length) more(); }; frag.appendChild(p); });
        shownN += 56; gin.appendChild(frag); loadGrid();
      }
      function loadGrid() { var y = gin._y || 0; each(gin.querySelectorAll('img[data-src]'), function (i) { var t = i.parentNode.offsetTop + y; if (t > -400 && t < 1300) { var s = i.getAttribute('data-src'); i.removeAttribute('data-src'); if (s) i.src = s; } }); }
      gin._onscroll = loadGrid;
      more();
      F.set(gin.firstChild, true);
    },
    back: function () { go(curArg.type === 'movie' ? 'movies' : 'series'); }
  };

  /* ---- detail ---- */
  var D = {}, detailFrom = null;
  Screens.detail = {
    enter: function (arg, prev) {
      if (prev && prev !== 'player' && prev !== 'detail') detailFrom = prev;
      D = { type: arg.type, item: arg.item, info: null, season: null };
      var it = arg.item;
      fillDetail(it);
      $('d-ctas').innerHTML = ''; $('d-seasons').innerHTML = ''; $('d-eps').innerHTML = ''; show($('d-epswrap'), false);
      var wait = el('span', 'btn f', 'لحظة…'); $('d-ctas').appendChild(wait); F.set(wait, true);
      vodInfo(arg.type, it).then(function (r) {
        if (cur !== 'detail' || D.item !== it) return;
        D.info = r; var full = enrich(arg.type, it, r); D.full = full; fillDetail(full);
        buildDetailActions();
      }).catch(function () { if (cur === 'detail' && D.item === it) { D.info = null; buildDetailActions(); } });
    },
    back: function () { go(detailFrom || (D.type === 'movie' ? 'movies' : 'series'), detailFrom === 'grid' ? gridArg : undefined); }
  };
  function fillDetail(it) {
    $('d-eye').textContent = (D.type === 'movie' ? 'فيلم' : 'مسلسل') + (it.genre ? ' · ' + String(it.genre).split(',')[0] : '');
    $('d-title').textContent = it.name; $('d-meta').innerHTML = metaHtml(it); $('d-plot').textContent = it.plot || '';
    var small = []; if (it.cast) small.push('بطولة: ' + it.cast); if (it.director) small.push('إخراج: ' + it.director);
    $('d-small').textContent = small.join(' · ');
    var art = $('d-bart');
    if (it.backdrop) { art.style.background = '#000 url("' + String(it.backdrop).replace(/"/g, '') + '") center top / cover no-repeat'; art.innerHTML = ''; }
    else { art.style.background = artBg(it.id, 200); art.innerHTML = it.img ? '<img src="' + esc(it.img) + '" style="position:absolute;left:200px;top:120px;width:340px;height:510px;object-fit:cover;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6)" onerror="this.style.display=\'none\'">' : ''; }
  }
  function findResume(type, id) { for (var i = 0; i < S.resume.length; i++) if (S.resume[i].type === type && S.resume[i].id === id) return S.resume[i]; return null; }
  function buildDetailActions() {
    var box = $('d-ctas'); box.innerHTML = '';
    var it = D.full || D.item, r = findResume(D.type, it.id);
    function btn(html, fn) { var b = el('span', 'btn f', html); b._ok = fn; box.appendChild(b); return b; }
    if (D.type === 'movie') {
      var ext = (D.info && D.info.movie_data && D.info.movie_data.container_extension) || it.ext || 'mp4';
      var first;
      if (r && r.pos > 60000) { first = btn('<span class="tri"></span>كمّل<small>· ' + minsLeft((r.dur - r.pos) / 1000) + '</small>', function () { playMovie(it, ext, r.pos); }); btn('من الأول', function () { playMovie(it, ext, 0); }); }
      else first = btn('<span class="tri"></span>شاهد', function () { playMovie(it, ext, 0); });
      F.set(first, true);
      return;
    }
    var eps = (D.info && D.info.episodes) || {}, seasons = Object.keys(eps).sort(function (a, b) { return a - b; });
    if (!seasons.length) { var none = btn('مفيش حلقات متاحة', function () { }); F.set(none, true); return; }
    var target = null;
    if (r && r.ep) target = { season: String(r.ep.season), id: r.ep.id };
    var b1 = target
      ? btn('<span class="tri"></span>كمّل الحلقة ' + r.ep.num + (r.dur ? '<small>· ' + minsLeft((r.dur - r.pos) / 1000) + '</small>' : ''), function () { var e = findEp(eps, target.season, target.id); if (e) playEpisode(it, target.season, e, r.pos); })
      : btn('<span class="tri"></span>شاهد الحلقة الأولى', function () { playEpisode(it, seasons[0], eps[seasons[0]][0], 0); });
    var sbox = $('d-seasons'); sbox.innerHTML = '';
    each(seasons, function (s) {
      var p = el('span', 'f', 'الموسم ' + s); p._season = s;
      p._focus = function () { if (D.season !== s) renderEpisodes(it, eps, s); };
      p._ok = function () { var e1 = $('d-eps').firstChild; if (e1) F.set(e1); };
      sbox.appendChild(p);
    });
    renderEpisodes(it, eps, target ? target.season : seasons[0]);
    F.set(b1, true);
  }
  function findEp(eps, season, id) { var l = eps[season] || []; for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function renderEpisodes(it, eps, s) {
    D.season = s;
    each($('d-seasons').children, function (p) { p.classList.toggle('act', p._season === s); });
    var box = $('d-eps'); box.innerHTML = ''; box._x = 0; box._last = null; box.style.webkitTransform = box.style.transform = '';
    var r = findResume('series', it.id), done = (r && r.done) || {};
    each(eps[s] || [], function (e, i) {
      var inf = e.info || {}, num = e.episode_num || (i + 1);
      var card = el('div', 'ep f');
      var th = el('div', 'th'); th.style.background = artBg((it.id | 0) + i, 190);
      if (inf.movie_image) th.appendChild(img(inf.movie_image));
      th.appendChild(el('b', '', num));
      if (r && r.ep && String(r.ep.id) === String(e.id) && r.dur) th.appendChild(el('div', 'pbar', '<i style="width:' + clamp(r.pos / r.dur * 100, 2, 100) + '%"></i>'));
      else if (done[e.id]) th.appendChild(el('div', 'pbar', '<i style="width:100%"></i>'));
      card.appendChild(th);
      var title = e.title && !/^\s*$/.test(e.title) && String(e.title).indexOf(it.name) !== 0 ? e.title : 'الحلقة ' + num;
      card.appendChild(el('h6', '', esc(title)));
      card.appendChild(el('p', '', esc(inf.duration ? String(inf.duration).replace(/^00:/, '') : '')));
      card._ok = function () { var rr = findResume('series', it.id); playEpisode(it, s, e, rr && rr.ep && String(rr.ep.id) === String(e.id) ? rr.pos : 0); };
      box.appendChild(card);
    });
    show($('d-epswrap'), true);
    loadImages(box);
  }

  /* ---- vod player ---- */
  var V = {}, ctlT, seekT, saveT;
  Screens.player = {
    video: true,
    enter: function (arg) {
      V = arg; V.seekTo = null;
      $('p-title').textContent = arg.title; $('p-sub').textContent = arg.sub || '';
      show($('p-state'), false); show($('p-seek'), false);
      ctl(true);
      Player.play(arg.url, {
        start: arg.start || 0,
        onbuffer: function (b) { show($('p-spin'), b); },
        ontime: function () { drawBar(); },
        onend: function () { savePos(true); if (V.next) { toast('الحلقة الجاية…'); V.next(); } else go(V.backTo || 'home'); },
        onerror: function () { show($('p-spin'), false); Pop.show({ kicker: 'Ahmed TV', title: 'الفيديو مش راضي يشتغل', text: 'ممكن تكون مشكلة في السيرفر. جرّبوا كمان شوية أو اختاروا حاجة تانية.', buttons: [{ label: 'رجوع', fn: function () { go(V.backTo || 'home'); } }], onBack: function () { go(V.backTo || 'home'); } }); }
      });
      clearInterval(saveT); saveT = setInterval(function () { savePos(false); }, 10000);
      F.el = null;
    },
    leave: function () { savePos(false); clearInterval(saveT); Player.stop(); },
    key: function (k) {
      ctl(true);
      if (k === 'ok' || k === 'playpause' || k === 'play' || k === 'pause') {
        if (V.seekTo != null) { doSeek(); return true; }
        var p = Player.toggle(); $('p-state').textContent = p ? '❚❚' : '▶'; show($('p-state'), !p); return true;
      }
      if (k === 'right' || k === 'ff') { seekBy(k === 'ff' ? 60000 : 10000); return true; }
      if (k === 'left' || k === 'rw') { seekBy(k === 'rw' ? -60000 : -10000); return true; }
      if (k === 'up') { seekBy(300000); return true; }
      if (k === 'down') { seekBy(-300000); return true; }
      if (k === 'back' || k === 'stop') { if (V.seekTo != null) { V.seekTo = null; show($('p-seek'), false); drawBar(); return true; } go(V.backTo || 'home', V.backArg); return true; }
      return true;
    }
  };
  function ctl(on) { $('p-ctl').classList.toggle('off', !on); clearTimeout(ctlT); if (on) ctlT = setTimeout(function () { if (V.seekTo == null && Player.playing) $('p-ctl').classList.add('off'); }, 4000); }
  function seekBy(ms) {
    var d = Player.duration(); if (!d) return;
    V.seekTo = clamp((V.seekTo != null ? V.seekTo : Player.cur) + ms, 0, d - 3000);
    var diff = Math.round((V.seekTo - Player.cur) / 1000);
    $('p-seek').textContent = (diff >= 0 ? '+' : '−') + fmtDur(Math.abs(diff)); show($('p-seek'), true);
    drawBar(); clearTimeout(seekT); seekT = setTimeout(doSeek, 1200);
  }
  function doSeek() { clearTimeout(seekT); if (V.seekTo == null) return; Player.seek(V.seekTo); V.seekTo = null; show($('p-seek'), false); }
  function drawBar() {
    var d = Player.duration(), c = V.seekTo != null ? V.seekTo : Player.cur, pct = d ? clamp(c / d * 100, 0, 100) : 0;
    $('p-fill').style.width = pct + '%'; $('p-knob').style.left = pct + '%';
    $('p-cur').textContent = fmtDur(c / 1000); $('p-dur').textContent = d ? '-' + fmtDur((d - c) / 1000) : '';
  }
  function savePos(finished) {
    if (!V.res) return;
    var d = Player.duration(), p = Player.cur; if (!d || p < 5000) return;
    var r = V.res; r.pos = finished ? 0 : p; r.dur = d; r.at = Date.now();
    if (r.type === 'series' && r.ep) { r.done = r.done || {}; if (finished || p / d > 0.92) { r.done[r.ep.id] = 1; } }
    S.resume = S.resume.filter(function (x) { return !(x.type === r.type && x.id === r.id); });
    var drop = r.type === 'movie' && (finished || p / d > 0.95);
    if (!drop) S.resume.unshift(r);
    S.resume = S.resume.slice(0, 30); store.set('resume', S.resume);
  }
  function playMovie(it, ext, start) {
    go('player', { url: X.acc ? X.movieUrl(it.id, ext) : '', title: it.name, sub: it.year || '', start: start, backTo: 'detail', backArg: { type: 'movie', item: it },
      res: { type: 'movie', id: it.id, name: it.name, img: it.img, ext: ext, pos: start, dur: 0 } });
  }
  function playEpisode(it, season, e, start) {
    var eps = (D.info && D.info.episodes && D.info.episodes[season]) || [], idx = eps.indexOf(e), nxt = eps[idx + 1];
    var old = findResume('series', it.id);
    var num = e.episode_num || (idx + 1);
    go('player', {
      url: X.acc ? X.epUrl(e.id, e.container_extension) : '', title: it.name, sub: 'الموسم ' + season + ' · الحلقة ' + num, start: start,
      backTo: 'detail', backArg: { type: 'series', item: D.item },
      res: { type: 'series', id: it.id, name: it.name, img: it.img, done: old ? old.done : {}, pos: start, dur: 0, ep: { id: e.id, ext: e.container_extension, season: season, num: num } },
      next: nxt ? function () { playEpisode(it, season, nxt, 0); } : null
    });
  }
  function resumePlay(r) {
    if (r.type === 'movie') { var it = { id: r.id, name: r.name, img: r.img, ext: r.ext }; go('player', { url: X.acc ? X.movieUrl(r.id, r.ext) : '', title: r.name, start: r.pos, backTo: 'home', res: r }); return; }
    go('detail', { type: 'series', item: { id: r.id, name: r.name, img: r.img } });
  }

  /* --------------------------------------------------------------- data */
  function buildLists() {
    var favIds = asArray(S.cfg.favorites), fav = [];
    each(favIds, function (f) { if (!f) return; var c = S.byId[+f.id]; if (c) fav.push(c); });
    var lists = [];
    lists.push({ name: (S.cfg.settings && S.cfg.settings.favName) || 'أحمد جمال', items: fav.length ? fav : S.streams.slice(0, 200), fav: true });
    var byCat = {};
    each(S.streams, function (s) { (byCat[s.cat] = byCat[s.cat] || []).push(s); });
    each(S.cats, function (c) { if (byCat[c.id] && byCat[c.id].length) lists.push({ name: c.name, items: byCat[c.id] }); });
    S.lists = lists;
  }
  function setLive(cats, streams) {
    S.cats = cats; S.streams = streams; S.byId = {};
    each(streams, function (s) { S.byId[s.id] = s; });
    buildLists();
  }
  function login() {
    var a = S.cfg.account || {};
    if (!a.server || !a.username) { X.acc = null; S.user = null; return Promise.resolve(false); }
    X.acc = { server: normServer(a.server), username: String(a.username).trim(), password: String(a.password || '').trim() };
    return X.call('').then(function (r) {
      var u = r && r.user_info;
      if (!u || u.auth === 0 || u.auth === '0') { S.accountError = 'بيانات الاشتراك مش صح. مهاب هيراجعها.'; S.user = null; return false; }
      S.accountError = '';
      S.user = { exp: parseInt(u.exp_date, 10) || 0, status: u.status, max: u.max_connections };
      var fm = u.allowed_output_formats || [];
      S.liveExt = fm.indexOf('ts') >= 0 || !fm.length ? 'ts' : (fm.indexOf('m3u8') >= 0 ? 'm3u8' : fm[0]);
      store.set('user', S.user);
      return true;
    }).catch(function () { S.accountError = 'السيرفر مش بيرد دلوقتي. هنحاول تاني لوحدنا.'; S.user = store.get('user', null); return !!S.user; });
  }
  function loadLive() {
    var cached = store.get('live', null);
    if (cached && cached.s) setLive(cached.c, cached.s.map(function (x) { return { id: x[0], name: x[1], logo: x[2], cat: x[3] }; }));
    if (!X.acc) return Promise.resolve();
    var fresh = Promise.all([X.call('get_live_categories'), X.call('get_live_streams')]).then(function (r) {
      var cats = asArray(r[0]).map(function (c) { return { id: String(c.category_id), name: c.category_name }; });
      var streams = asArray(r[1]).map(function (s) { return { id: +s.stream_id, name: s.name, logo: s.stream_icon || '', cat: String(s.category_id) }; });
      setLive(cats, streams);
      store.set('live', { c: cats, s: streams.map(function (x) { return [x.id, x.name, x.logo, x.cat]; }) });
      uploadCatalog();
      if (cur === 'home') Home.render();
    });
    return cached && cached.s ? Promise.resolve() : fresh;
  }
  function uploadCatalog() {
    if (!Remote.ok() || !S.streams.length) return;
    var sig = S.streams.length + ':' + S.streams[0].id + ':' + S.streams[S.streams.length - 1].id + ':' + (S.cfg.account || {}).username;
    if (store.get('catsig', '') === sig) return;
    Remote.putCatalog({ at: Date.now(), cats: S.cats.map(function (c) { return [c.id, c.name]; }), ch: S.streams.map(function (s) { return [s.id, s.name, s.cat]; }) })
      .then(function () { store.set('catsig', sig); }).catch(function () { });
  }

  /* ------------------------------------------------------- remote config */
  function part(o, k) { try { return JSON.stringify(o ? o[k] : null) || 'null'; } catch (e) { return ''; } }
  function applyCfg(next, initial) {
    var prev = S.cfg; next = next || {};
    var changed = {}; each(['settings', 'account', 'favorites', 'messages', 'people', 'urgent'], function (k) { changed[k] = part(prev, k) !== part(next, k); });
    S.cfg = next; store.set('cfg', next);
    if (initial) return Promise.resolve();
    var p = Promise.resolve();
    if (changed.account) p = login().then(function () { store.set('catsig', ''); return loadLive(); }).then(function () { S.movies = null; S.series = null; Screens.movies._built = false; Screens.series._built = false; });
    return p.then(function () {
      if (changed.favorites || changed.settings) buildLists();
      if (cur === 'home' && (changed.settings || changed.people || changed.messages || changed.favorites || changed.account)) {
        var keep = F.el; Home.render(); if (keep && keep.offsetParent !== null) F.set(keep, true); else F.set($('h-resume'), true);
      }
      if (changed.messages) maybeShowTodayMessage();
      if (changed.urgent) maybeShowUrgent();
    });
  }
  function maybeShowTodayMessage() {
    var t = todaysMessage(); if (!t) return;
    var key = iso(new Date()) + '|' + t; if (store.get('seenMsg', '') === key) return;
    if (cur === 'open') return;
    store.set('seenMsg', key);
    Pop.show({ kicker: 'رسالة جديدة', title: 'من مهاب', text: t, buttons: [{ label: 'تمام' }] });
  }
  function maybeShowUrgent() {
    var u = S.cfg.urgent; if (!u || !u.text) return;
    var id = String(u.id || u.at || u.text); if (store.get('seenUrgent', '') === id) return;
    if (u.at && Date.now() - u.at > 2 * 864e5) return;
    store.set('seenUrgent', id);
    Pop.show({ kicker: 'رسالة جديدة', title: 'من مهاب', text: u.text, buttons: [{ label: 'تمام' }] });
  }
  function poll() {
    if (!Remote.ok() || document.hidden) return;
    Remote.load().then(function (r) { return applyCfg(r || {}, false); }).catch(function () { });
  }

  var Status = {
    watching: '', t: null,
    soon: function () { clearTimeout(Status.t); Status.t = setTimeout(Status.send, 4000); },
    send: function () {
      if (!Remote.ok() || MOCK) return;
      var c = cur === 'live' && S.lists[S.li] && S.lists[S.li].items[S.ci];
      Remote.patch('status', {
        lastSeen: { '.sv': 'timestamp' }, version: VERSION, shell: CFG.shellVersion || '', screen: cur || '',
        watching: cur === 'live' && c ? c.name : (cur === 'player' ? (V.title || '') + (V.sub ? ' · ' + V.sub : '') : ''),
        exp: S.user && S.user.exp ? S.user.exp : null, accountOk: !!S.user && !S.accountError, error: S.accountError || '', channels: S.streams.length
      }).catch(function () { });
    }
  };

  /* ------------------------------------------------------------------ keys */
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 10009: 'back', 8: 'back', 27: 'back', 427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 73: 'info', 10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 10190: 'prech' };
  function keyName(code) { if (code >= 48 && code <= 57) return 'd' + (code - 48); if (code >= 96 && code <= 105) return 'd' + (code - 96); return KEYS[code] || null; }
  function registerKeys() {
    if (!window.tizen || !tizen.tvinputdevice) return;
    each(['ChannelUp', 'ChannelDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'PreviousChannel'], function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { } });
  }
  function onKey(e) {
    var k = keyName(e.keyCode); if (!k) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (!cur) return;
    if (Pop.open) { Pop.key(k); return; }
    var sc = Screens[cur];
    if (sc.key && sc.key(k)) return;
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') F.move(k);
    else if (k === 'ok') { if (F.el && F.el._ok) F.el._ok(); }
    else if (k === 'back') { if (sc.back) sc.back(); else go('home'); }
    else if (k === 'chup' || k === 'chdown') { if (cur === 'home') go('live'); }
  }
  function exitApp() {
    Player.stop();
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { toast('اضغط زرار Home على الريموت'); }
  }

  /* ------------------------------------------------------------------ DOM */
  function buildDom() {
    var app = $('app') || document.body.appendChild(el('div'));
    app.id = 'app';
    app.innerHTML = [
      '<div id="topbar" class="hidden"><div class="brand"><div class="mark">A</div><b>Ahmed <i>TV</i></b></div>',
      '<div class="nav" id="nav"><span class="f" data-go="home" id="nav-home">الرئيسية</span><span class="f" data-go="live" id="nav-live">البث المباشر</span><span class="f" data-go="movies" id="nav-movie">الأفلام</span><span class="f" data-go="series" id="nav-series">المسلسلات</span></div>',
      '<div class="clock"><div class="t" id="clk"></div><div class="d" id="dt"></div></div></div>',

      '<section class="screen" id="s-open"><div class="fill amb"></div><div class="fill grain"></div><div class="openmsg"><div class="k">رسالة النهارده</div><h2 id="om-text"></h2><div class="sig">مهاب</div><div><span class="go f" id="om-go">OK للدخول</span></div></div></section>',

      '<section class="screen" id="s-home"><div class="fill amb"></div><div class="fill grain"></div><div class="fill deco" id="h-deco"></div>',
      '<div class="subs hidden" id="h-subs"></div><div class="art" id="h-art"></div>',
      '<div class="hero"><div class="eyebrow" id="h-eye"></div><h1 class="welcome" id="h-title"></h1><div class="sub" id="h-sub"></div>',
      '<div class="ctas"><span class="btn f" id="h-resume"><span class="tri"></span>كمّل المشاهدة<small id="h-last"></small></span><span class="btn f" id="h-all">كل القنوات</span></div></div>',
      '<div class="msg hidden" id="h-msg"><div class="h"><b>رسالة من مهاب</b><span>النهارده</span></div><p id="h-msgt"></p></div><div class="notice hidden" id="h-notice"></div>',
      '<div class="vwrap" style="top:690px;height:390px"><div class="vscroll" id="h-rows"></div></div></section>',

      '<section class="screen" id="s-live"><div class="spin hidden" id="l-spin"></div><div class="toplist hidden" id="l-top">القائمة: <b id="l-listname"></b></div><div class="numbox hidden" id="l-num"></div>',
      '<div class="osd off" id="l-osd"><div class="no"><b id="o-no"></b><span id="o-of"></span></div><div class="logo"><img id="o-logo" alt=""></div>',
      '<div class="mid"><div class="nm"><h3 id="o-name"></h3><span class="chip" id="o-list"></span></div><div class="epg"><div class="now"><div class="lbl" id="o-nowl"></div><div class="ttl" id="o-now"></div><div class="prog"><i id="o-prog"></i></div></div><div class="next"><div class="lbl" id="o-nextl"></div><div class="ttl" id="o-next"></div></div></div></div>',
      '<div class="side"><div class="t" id="o-clock"></div><div class="k">OK القائمة · ◀ ▶ آخر قناة<br>أخضر: مفضلة · رجوع: الرئيسية</div></div></div>',
      '<div class="chlist hidden" id="l-list"><div class="lh"><h4 id="cl-name"></h4><span id="cl-count"></span></div><div class="hint">◀ ▶ تغيير القائمة · OK تشغيل</div><div id="cl-rows"></div></div></section>',

      vodHtml('movies', 'm'), vodHtml('series', 's'),

      '<section class="screen" id="s-grid"><div class="fill" style="background:var(--bg)"></div><div class="gtitle" id="g-title"></div><div class="grid" style="top:200px"><div class="gin vscroll" id="g-in"></div></div></section>',

      '<section class="screen" id="s-detail"><div class="fill" style="background:var(--bg)"></div><div class="bill" style="height:1080px"><div class="bart" id="d-bart"></div><div class="bfade"></div></div>',
      '<div class="binfo" style="top:80px"><div class="eyebrow" id="d-eye"></div><h1 class="btitle" id="d-title"></h1><div class="bmeta" id="d-meta"></div><p class="bplot" id="d-plot"></p><div class="bsmall" id="d-small"></div><div class="ctas" id="d-ctas"></div><div class="seasons" id="d-seasons"></div></div>',
      '<div class="eps hidden" id="d-epswrap"><div class="strip" id="d-eps"></div></div></section>',

      '<section class="screen" id="s-player"><div class="spin hidden" id="p-spin"></div><div class="vstate hidden" id="p-state"></div><div class="seekmsg hidden" id="p-seek"></div>',
      '<div class="vctl" id="p-ctl"><h3 id="p-title"></h3><div class="s" id="p-sub"></div><div class="vbar"><i id="p-fill"></i><b id="p-knob"></b></div><div class="vtimes"><span id="p-cur"></span><span id="p-dur"></span></div></div></section>',

      '<div id="pop" class="hidden"><div class="box"><div class="k" id="pop-k"></div><h5 id="pop-h"></h5><p id="pop-p"></p><div class="acts" id="pop-acts"></div></div></div>',
      '<div id="toast" class="hidden"></div>',
      '<div id="boot"><div class="mark">A</div><p id="boot-msg">Ahmed TV</p></div>'
    ].join('');
    each(document.querySelectorAll('#nav .f'), function (n) { n._ok = function () { go(n.getAttribute('data-go')); }; });
    $('h-resume')._ok = function () { go('live'); };
    $('h-all')._ok = function () { go('live', { openList: true }); };
    $('om-go')._ok = function () { go('home'); };
  }
  function vodHtml(name, P) {
    return '<section class="screen" id="s-' + name + '"><div class="fill" style="background:var(--bg)"></div>' +
      '<div class="bill"><div class="bart" id="' + P + '-bart"></div><div class="bfade"></div><div class="binfo"><div class="eyebrow" id="' + P + '-eye"></div><h1 class="btitle" id="' + P + '-title"></h1><div class="bmeta" id="' + P + '-meta"></div><p class="bplot" id="' + P + '-plot"></p></div></div>' +
      '<div class="vwrap" style="top:600px;height:480px"><div class="vscroll" id="' + P + '-rows"></div></div><div class="spin hidden" id="' + P + '-spin"></div></section>';
  }

  function tickClock() {
    var d = new Date(); $('clk').textContent = fmtClock(d); $('dt').textContent = fmtDate(d);
    if (cur === 'home') { var m = d.getMinutes(); if (m === 0 || m === 30) Home.renderLook(); }
    if (cur === 'home' && Home._day !== iso(d)) { Home._day = iso(d); Home.render(); maybeShowTodayMessage(); }
  }

  /* ---------------------------------------------------------------- mock */
  function mockData() {
    var names = ['القرآن الكريم', 'الأولى المصرية', 'الحياة', 'CBC', 'ON', 'أون تايم سبورت', 'DMC', 'ماسبيرو زمان', 'صدى البلد', 'النهار', 'روتانا سينما', 'ناشيونال جيوغرافيك'];
    var cats = [{ id: '1', name: 'مصري' }, { id: '2', name: 'رياضة' }, { id: '3', name: 'أفلام' }];
    var streams = names.map(function (n, i) { return { id: 100 + i, name: n, logo: '', cat: String(1 + i % 3) }; });
    for (var i = 0; i < 40; i++) streams.push({ id: 200 + i, name: 'قناة تجريبية ' + (i + 1), logo: '', cat: String(1 + i % 3) });
    setLive(cats, streams);
    if (!asArray(S.cfg.favorites).length) { S.cfg.favorites = names.map(function (n, i) { return { id: 100 + i, name: n }; }); buildLists(); }
    S.user = { exp: Math.floor(Date.now() / 1000) + 128 * 864e2, status: 'Active' };
    X.acc = { server: 'http://example.invalid', username: 'demo', password: 'demo' };
  }
  function mockVod() {
    var mt = ['آخر قطار للصعيد', 'ليلة في القاهرة', 'ظل الملك', 'رحلة إلى سيوة', 'الصقر', 'بيت على النيل', 'عودة الغائب', 'مدينة الملح', 'الطريق الصحراوي', 'حكاية حب قديمة'];
    var st = ['بيت العيلة', 'سر القصر', 'كفر الريحان', 'المهندسة', 'أيام الدراسة', 'الضوء الأخير', 'شارع الألفي', 'حارة السقايين'];
    var cats = [{ id: '1', name: 'عربي' }, { id: '2', name: 'أكشن' }, { id: '3', name: 'كوميدي' }];
    var mi = [], si = [];
    for (var i = 0; i < 45; i++) mi.push({ id: 500 + i, name: mt[i % mt.length] + (i >= mt.length ? ' ' + (1 + Math.floor(i / mt.length)) : ''), cat: String(1 + i % 3), rating: 6 + (i % 4) * 0.6, added: 1000 - i, year: '2025', plot: 'قصة تجريبية للعرض. البيانات الحقيقية هتيجي من الاشتراك.', ext: 'mp4' });
    for (var j = 0; j < 24; j++) si.push({ id: 900 + j, name: st[j % st.length], cat: String(1 + j % 3), rating: 7 + (j % 3) * 0.4, added: 1000 - j, year: '2024', genre: 'دراما', plot: 'مسلسل تجريبي للعرض. البيانات الحقيقية هتيجي من الاشتراك.' });
    S.movies = indexVod(cats, mi); S.series = indexVod(cats, si);
    for (var k = 0; k < si.length; k++) { var eps = {}; for (var s = 1; s <= 2; s++) { eps[s] = []; for (var e = 1; e <= 12; e++) eps[s].push({ id: (900 + k) * 1000 + s * 100 + e, episode_num: e, title: '', container_extension: 'mp4', info: { duration: '00:45:00' } }); } infoCache['series' + (900 + k)] = { info: { plot: si[k].plot, genre: 'دراما', releaseDate: '2024' }, episodes: eps }; }
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    buildDom(); Player.init(); registerKeys();
    document.addEventListener('keydown', onKey);
    applyPalette(PAL.gold);
    tickClock(); setInterval(tickClock, 15000);
    var cached = S.cfg;
    var remote = Remote.ok()
      ? Promise.race([Remote.load(), new Promise(function (res, rej) { setTimeout(function () { rej(new Error('slow')); }, 8000); })]).then(function (r) { return applyCfg(r || {}, true); }).catch(function () { })
      : Promise.resolve();
    remote.then(function () {
      if (MOCK) { mockData(); return; }
      $('boot-msg').textContent = 'بنجهّز القنوات…';
      return login().then(function () { return loadLive(); }).catch(function () { });
    }).then(function () {
      buildLists();
      var b = $('boot'); if (b) b.parentNode.removeChild(b);
      var t = todaysMessage();
      if (t && store.get('seenMsg', '') !== iso(new Date()) + '|' + t) go('open'); else go('home');
      maybeShowUrgent();
      setInterval(poll, POLL_MS);
      setInterval(Status.send, 60000); Status.send();
      setTimeout(function () { if (!MOCK && X.acc) { loadVod('movie').catch(function () { }); setTimeout(function () { loadVod('series').catch(function () { }); }, 4000); } else if (MOCK) { mockVod(); if (cur === 'home') Home.renderRows(); } }, 3000);
    });

    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        hiddenAt = Date.now();
        if (cur === 'player') savePos(false);
        Player.stop();
      } else {
        if (Date.now() - hiddenAt > 60 * 60 * 1000) { location.reload(); return; }
        poll();
        if (cur === 'live') { var c = S.lists[S.li] && S.lists[S.li].items[S.ci]; if (c) startChannel(c); }
        else if (cur === 'player') { V.start = Player.cur || (V.res && V.res.pos) || 0; Screens.player.enter(V); }
      }
    });
  }

  window.AhmedTV = { version: VERSION, go: function (n, a) { go(n, a); }, state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
