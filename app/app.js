/* Mohab TV - TV app.
 * Runs inside the Tizen shell (tizen-shell/), which defines window.AHMED_TV = {db, key, ...}
 * and loads this file from the web (or from its bundled copy when offline).
 * Target: Samsung Tizen 4.0 (2018) = Chromium 56. Keep to ES5 + Promise/XHR.
 * No object spread, no optional chaining, no padStart, no Array.flat. */
(function () {
  'use strict';

  var VERSION = '1.1.0';
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
    resume: [],
    profile: 'ahmed'
  };
  var PROFILES = {
    ahmed: { name: 'أحمد جمال', av: 'أ', title: 'Welcome Ahmed Gamal' },
    mohab: { name: 'مهاب', av: 'م', title: 'Welcome Mohab' }
  };
  function pkey(k) { return k + '_' + S.profile; }
  function isAhmed() { return S.profile !== 'mohab'; }
  // Ahmed's channel list lives online (edited from the phone); Mohab's is kept on the TV for now
  function favList() { return isAhmed() ? asArray(S.cfg.favorites) : (store.get('favs_mohab', []) || []); }
  function favName() { return isAhmed() ? ((S.cfg.settings && S.cfg.settings.favName) || 'أحمد جمال') : 'مهاب'; }

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
    var r = { pal: pal, key: 'normal', eyebrow: g.e, title: isAhmed() ? (st.title || PROFILES.ahmed.title) : (st.titleMohab || PROFILES.mohab.title), sub: isAhmed() ? (st.sub || g.s) : 'أهلاً يا مهاب، كل حاجة جاهزة', art: 'normal', deco: 'none' };
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
    return '<svg viewBox="0 0 720 520"><g fill="none" stroke="' + acc + '"><circle cx="380" cy="250" r="220" stroke-opacity=".18" stroke-width="2"/><circle cx="380" cy="250" r="160" stroke-opacity=".3" stroke-width="2"/><circle cx="380" cy="250" r="100" stroke-opacity=".55" stroke-width="3"/></g><text x="380" y="284" text-anchor="middle" font-family="Reem Kufi,sans-serif" font-size="100" font-weight="700" fill="' + acc + '">M</text></svg>';
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
    if (!isAhmed()) return '';
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
      qStop();
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
    show($('np'), !!Q.cur && !Screens[name].video && name !== 'who');
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

  /* ---- who is watching ---- */
  Screens.who = {
    enter: function () { F.set($('who-' + S.profile) || $('who-ahmed'), true); },
    back: function () { Pop.show({ kicker: 'Mohab TV', title: 'تقفلوا التطبيق؟', text: '', buttons: [{ label: 'لأ، خليه' }, { label: 'أيوه اقفل', fn: exitApp }] }); }
  };
  function selectProfile(p) {
    S.profile = p === 'mohab' ? 'mohab' : 'ahmed'; store.set('profile', S.profile); store.set('profileSet', 1);
    S.resume = store.get(pkey('resume'), []) || [];
    S.li = 0; S.ci = 0; S.prev = null; lastLookKey = '';
    buildLists();
    Screens.movies._built = false; Screens.series._built = false;
    $('pchip').textContent = PROFILES[S.profile].name;
    var t = todaysMessage();
    if (t && store.get('seenMsg', '') !== iso(new Date()) + '|' + t) go('open'); else go('home');
    maybeShowUrgent();
  }

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
      Pop.show({ kicker: 'Mohab TV', title: 'عايزين تعملوا إيه؟', text: '', buttons: [{ label: 'رجوع' }, { label: 'تغيير المستخدم', fn: function () { qStop(); go('who'); } }, { label: 'اقفل التطبيق', fn: exitApp }] });
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
      var last = S.byId[(store.get(pkey('last'), {}) || {}).id];
      $('h-last').textContent = last ? '· ' + String(last.name).slice(0, 18) : '';
      var sp = store.get('speed', null);
      $('h-spd').textContent = sp && sp.mbps ? '· ' + fmtMbps(sp.mbps) + ' ميجا' : '· قياس';
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
      var last = store.get(pkey('last'), {}) || {};
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
    store.set(pkey('last'), { id: c.id, list: S.lists[S.li].name });
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
    var favs = favList().slice(), idx = -1;
    each(favs, function (f, i) { if (f && +f.id === c.id) idx = i; });
    if (idx >= 0) { favs.splice(idx, 1); toast('اتشالت ' + c.name + ' من قائمة ' + favName()); }
    else { favs.push({ id: c.id, name: c.name }); toast('اتضافت ' + c.name + ' لقائمة ' + favName() + ' رقم ' + favs.length); }
    if (isAhmed()) { S.cfg.favorites = favs; store.set('cfg', S.cfg); } else store.set('favs_mohab', favs);
    var curId = c.id; buildLists(); var p = findChannel(curId, S.lists[S.li] ? S.lists[S.li].name : null); S.li = p.li; S.ci = p.ci;
    if (isAhmed()) Remote.put('favorites', favs).catch(function () { toast('مقدرتش أحفظ التغيير أونلاين، هيتحفظ على التلفزيون بس'); });
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
  function favIdMap() { var m = {}; each(favList(), function (f) { if (f) m[+f.id] = 1; }); return m; }
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
        onerror: function () { show($('p-spin'), false); Pop.show({ kicker: 'Mohab TV', title: 'الفيديو مش راضي يشتغل', text: 'ممكن تكون مشكلة في السيرفر. جرّبوا كمان شوية أو اختاروا حاجة تانية.', buttons: [{ label: 'رجوع', fn: function () { go(V.backTo || 'home'); } }], onBack: function () { go(V.backTo || 'home'); } }); }
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
    S.resume = S.resume.slice(0, 30); store.set(pkey('resume'), S.resume);
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
    var favIds = favList(), fav = [];
    each(favIds, function (f) { if (!f) return; var c = S.byId[+f.id]; if (c) fav.push(c); });
    var lists = [];
    lists.push({ name: favName(), items: fav.length ? fav : S.streams.slice(0, 200), fav: true });
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
    if (cur === 'open' || cur === 'who') return;
    store.set('seenMsg', key);
    Pop.show({ kicker: 'رسالة جديدة', title: 'من مهاب', text: t, buttons: [{ label: 'تمام' }] });
  }
  function maybeShowUrgent() {
    var u = S.cfg.urgent; if (!u || !u.text || !isAhmed() || cur === 'who') return;
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
        profile: S.profile,
        watching: Q.cur ? 'قرآن: ' + Q.cur.title + ' · ' + Q.cur.sub : cur === 'live' && c ? c.name : (cur === 'player' ? (V.title || '') + (V.sub ? ' · ' + V.sub : '') : ''),
        exp: S.user && S.user.exp ? S.user.exp : null, accountOk: !!S.user && !S.accountError, error: S.accountError || '', channels: S.streams.length
      }).catch(function () { });
    }
  };

  /* ---------------------------------------------------------------- speed test */
  function fmtMbps(v) { return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }
  var Speed = {
    open: false, running: false, xhr: null, t: null,
    show: function () { Speed.open = true; show($('speed'), true); Speed.run(); },
    close: function () { Speed.stop(); Speed.open = false; show($('speed'), false); if (cur === 'home') Home.renderInfo(); },
    stop: function () { Speed.running = false; clearInterval(Speed.t); if (Speed.xhr) { try { Speed.xhr.abort(); } catch (e) { } Speed.xhr = null; } },
    draw: function (v, msg, hint) {
      $('sp-num').textContent = fmtMbps(v); $('sp-bar').style.width = clamp(v / 50 * 100, 1, 100) + '%';
      if (msg != null) $('sp-msg').textContent = msg; if (hint != null) $('sp-hint').textContent = hint;
    },
    verdict: function (v) {
      if (v < 2) return 'النت ضعيف جدًا، القنوات هتقطّع.';
      if (v < 5) return 'النت يكفي القنوات العادية بس، ممكن يقطّع في HD.';
      if (v < 12) return 'النت كويس للقنوات HD.';
      if (v < 25) return 'النت ممتاز للقنوات والأفلام بجودة عالية.';
      return 'النت ممتاز جدًا، يكفي أعلى جودة.';
    },
    finish: function (v, failed) {
      Speed.stop();
      if (failed && !v) { Speed.draw(0, 'مقدرناش نقيس السرعة. اتأكدوا إن النت شغّال وجرّبوا تاني.', 'OK إعادة القياس · رجوع للخروج'); return; }
      store.set('speed', { mbps: v, at: Date.now() });
      Speed.draw(v, Speed.verdict(v), 'OK إعادة القياس · رجوع للخروج');
    },
    run: function () {
      Speed.stop(); Speed.running = true;
      Speed.draw(0, 'بنقيس سرعة التحميل…', 'استنوا ثواني');
      if (MOCK) { var n = 0, target = 18 + Math.random() * 20; Speed.t = setInterval(function () { n++; var v = target * Math.min(1, n / 12) * (0.9 + Math.random() * 0.2); Speed.draw(v); if (n >= 24) Speed.finish(target); }, 250); return; }
      var total = 0, start = 0, lastLoaded = 0, MAXMS = 8000;
      function mbps() { var dt = (Date.now() - start) / 1000; return dt > 0.25 ? (total * 8 / 1e6) / dt : 0; }
      function one() {
        var x = Speed.xhr = new XMLHttpRequest(); lastLoaded = 0;
        x.open('GET', 'https://speed.cloudflare.com/__down?bytes=25000000&r=' + Date.now() + Math.random(), true);
        x.responseType = 'arraybuffer';
        x.onprogress = function (e) {
          if (!Speed.running) return;
          if (!start) { start = Date.now(); lastLoaded = e.loaded; return; }
          total += e.loaded - lastLoaded; lastLoaded = e.loaded;
          Speed.draw(mbps());
          if (Date.now() - start >= MAXMS) Speed.finish(mbps());
        };
        x.onload = function () { if (!Speed.running) return; if (start && Date.now() - start < MAXMS) one(); else Speed.finish(mbps()); };
        x.onerror = x.ontimeout = function () { if (Speed.running) Speed.finish(mbps(), true); };
        x.send();
      }
      one();
      Speed.t = setInterval(function () { if (Speed.running && start && Date.now() - start >= MAXMS + 1500) Speed.finish(mbps()); else if (Speed.running && !start && Date.now() - t0 > 12000) Speed.finish(0, true); }, 500);
      var t0 = Date.now();
    },
    key: function (k) { if (k === 'back') Speed.close(); else if (k === 'ok' && !Speed.running) Speed.run(); }
  };

  /* -------------------------------------------------------------------- quran */
  // Recitations come from mp3quran.net (reciter list + audio servers). The built-in list below is
  // the default set and the offline fallback; the phone panel can change which reciters show.
  var Q_DEFAULT = [{"id":118,"name":"محمود خليل الحصري","m":[[118,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/mahmoud-husary/r1/",0],[119,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/mahmoud-husary/r2/",0],[120,"ورش عن نافع - مرتل","https://cdn.mp3quran.net/audio/mahmoud-husary/r3/",0],[270,"قالون عن نافع - مرتل","https://cdn.mp3quran.net/audio/mahmoud-husary/r5/",0],[269,"الدوري عن أبي عمرو - مرتل","https://cdn.mp3quran.net/audio/mahmoud-husary/r4/",0]]},{"id":51,"name":"عبدالباسط عبدالصمد","m":[[53,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/",0],[51,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r1/",0],[52,"ورش عن نافع - مرتل","https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r2/",0]]},{"id":112,"name":"محمد صديق المنشاوي","m":[[112,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/",0],[113,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/muhammad-minshawi/r2/",0],[114,"حفص عن عاصم - المصحف المعلم","https://cdn.mp3quran.net/audio/muhammad-minshawi/r3/",0],[10924,"حفص عن عاصم - تسجيل عام 1387 هـ - 1967م","https://cdn.mp3quran.net/audio/muhammad-minshawi/r4/","1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,25,26,27,28,29,30,31,32,33,34,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114"]]},{"id":125,"name":"مصطفى إسماعيل","m":[[125,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/mustafa-ismail/r1/",0],[288,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/mustafa-ismail/r2/",0]]},{"id":121,"name":"محمود علي البنا","m":[[121,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/mahmoud-banna/r1/",0],[122,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/mahmoud-banna/r2/",0]]},{"id":106,"name":"محمد الطبلاوي","m":[[106,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/muhammad-tablawi/r1/",0],[10912,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/muhammad-tablawi/r2/",0]]},{"id":241,"name":"محمد رفعت","m":[[241,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/muhammad-refaat/r1/","1,10,11,12,17,18,19,20,48,54,55,56,69,72,73,75,76,77,78,79,81,82,83,85,86,87,88,89,96,98,100"]]},{"id":9,"name":"أحمد نعينع","m":[[9,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/ahmad-naina/r1/",0]]},{"id":123,"name":"مشاري العفاسي","m":[[123,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/mishary-alafasy/r1/",0],[124,"الدوري عن الكسائي - مرتل","https://cdn.mp3quran.net/audio/mishary-alafasy/r2/","12,14,25,87,97,99"]]},{"id":102,"name":"ماهر المعيقلي","m":[[102,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/maher-muaiqly/r1/",0],[133,"حفص عن عاصم - المصحف المجود","https://cdn.mp3quran.net/audio/maher-muaiqly/r3/",0],[103,"حفص عن عاصم - المصحف المعلم","https://cdn.mp3quran.net/audio/maher-muaiqly/r2/","1,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114"]]},{"id":54,"name":"عبدالرحمن السديس","m":[[54,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/",0]]},{"id":31,"name":"سعود الشريم","m":[[31,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/saud-shuraim/r1/",0]]},{"id":30,"name":"سعد الغامدي","m":[[30,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/saad-ghamdi/r1/",0]]},{"id":92,"name":"ياسر الدوسري","m":[[92,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/yasser-dosari/r1/",0]]},{"id":86,"name":"ناصر القطامي","m":[[86,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/nasser-qatami/r1/",0]]},{"id":253,"name":"إسلام صبحي","m":[[253,"حفص عن عاصم - مرتل","https://cdn.mp3quran.net/audio/islam-sobhi/r1/","1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,38,41,42,43,44,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114"]]}];
  var Q_RADIO = {"118":"https://backup.qurango.net/radio/mahmoud_khalil_alhussary","51":"https://backup.qurango.net/radio/abdulbasit_abdulsamad","112":"https://backup.qurango.net/radio/mohammed_siddiq_alminshawi","125":"https://backup.qurango.net/radio/mustafa_ismail","121":"https://backup.qurango.net/radio/mahmoud_ali__albanna","106":"https://backup.qurango.net/radio/mohammad_altablaway","9":"https://backup.qurango.net/radio/ahmad_nauina","123":"https://backup.qurango.net/radio/mishary_alafasi","102":"https://backup.qurango.net/radio/maher","54":"https://backup.qurango.net/radio/abdulrahman_alsudaes","31":"https://backup.qurango.net/radio/saud_alshuraim","30":"https://backup.qurango.net/radio/saad_alghamdi","92":"https://backup.qurango.net/radio/yasser_aldosari","86":"https://backup.qurango.net/radio/nasser_alqatami"};
  var SUWAR = ["الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس","هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه","الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم","لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر","فصلت","الشورى","الزخرف","الدّخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق","الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة","الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج","نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس","التكوير","الإنفطار","المطففين","الإنشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد","الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات","القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر","المسد","الإخلاص","الفلق","الناس"];
  var Q_LIVE = [
    { name: 'إذاعة القرآن الكريم من القاهرة', url: 'https://stream.radiojar.com/8s5u5tpdtwzuv' },
    { name: 'إذاعة القرآن الكريم - السعودية', url: 'https://stream.radiojar.com/0tpy1h0kxtzuv' },
    { name: 'تفسير القرآن الكريم', url: 'https://backup.qurango.net/radio/tafseer' },
    { name: 'أذكار الصباح', url: 'https://backup.qurango.net/radio/athkar_sabah' },
    { name: 'أذكار المساء', url: 'https://backup.qurango.net/radio/athkar_masa' }
  ];
  var Q = { api: null, audio: null, cur: null, rec: null, mo: null };
  function pad3(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
  function qChosenIds() {
    var a = asArray((S.cfg.settings || {}).quran).map(function (x) { return +(x && x.id ? x.id : x); }).filter(function (x) { return x > 0; });
    return a.length ? a : Q_DEFAULT.map(function (r) { return r.id; });
  }
  function qLoad() {
    var ids = qChosenIds(), sig = ids.join(','), c = store.get('qapi', null);
    if (c && c.sig === sig && Date.now() - c.at < 7 * 864e5) { Q.api = c.d; return Promise.resolve(); }
    if (MOCK) { Q.api = {}; return Promise.resolve(); }
    return Promise.all([
      http('GET', 'https://www.mp3quran.net/api/v3/reciters?language=ar', undefined, 25000),
      http('GET', 'https://www.mp3quran.net/api/v3/radios?language=ar', undefined, 25000).catch(function () { return null; })
    ]).then(function (r) {
      var d = {}, radios = asArray(r[1] && r[1].radios);
      each(asArray(r[0] && r[0].reciters), function (x) {
        if (ids.indexOf(x.id) < 0) return;
        var ms = asArray(x.moshaf).slice().sort(function (a, b) { function w(m) { return m.moshaf_type === 11 ? 0 : m.moshaf_type === 12 ? 1 : 2 + m.moshaf_type / 1000; } return w(a) - w(b); });
        var rad = '';
        each(radios, function (ra) { if (String(ra.name).trim() === String(x.name).trim() && (!rad || ra.url.length < rad.length)) rad = ra.url; });
        d[x.id] = { id: x.id, name: x.name, radio: rad, m: ms.map(function (m) { return [m.id, m.name, m.server, m.surah_total < 114 ? m.surah_list : 0]; }) };
      });
      Q.api = d; store.set('qapi', { at: Date.now(), sig: sig, d: d });
    }).catch(function () { Q.api = (c && c.d) || {}; });
  }
  function qReciters() {
    var out = [];
    each(qChosenIds(), function (id) {
      var r = Q.api && Q.api[id];
      if (!r) each(Q_DEFAULT, function (x) { if (x.id === id) r = { id: x.id, name: x.name, m: x.m, radio: Q_RADIO[id] || '' }; });
      if (r && r.m && r.m.length) out.push(r);
    });
    return out;
  }
  function moLabel(m) { return String(m[1]).replace(/^حفص عن عاصم\s*-\s*/, '').replace(/^المصحف\s+/, ''); }
  function moList(m) { if (!m[3]) { var a = []; for (var i = 1; i <= 114; i++) a.push(i); return a; } return String(m[3]).split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x >= 1 && x <= 114; }); }

  function qAudio() {
    if (Q.audio) return Q.audio;
    var a = Q.audio = new Audio(); a.preload = 'auto';
    a.addEventListener('ended', function () { qNext(1, true); });
    a.addEventListener('timeupdate', qDrawNp); a.addEventListener('playing', qDrawNp); a.addEventListener('pause', qDrawNp);
    a.addEventListener('error', function () { if (!Q.cur || MOCK) return; toast('التلاوة دي مش راضية تشتغل دلوقتي، جرّبوا غيرها'); });
    return a;
  }
  function qStart(url) {
    try { Player.stop(); } catch (e) { }
    var a = qAudio();
    if (!MOCK) { a.src = url; var p = a.play(); if (p && p.catch) p.catch(function () { }); }
    show($('np'), cur && !Screens[cur].video); qDrawNp(); qMark(); Status.soon();
  }
  function qPlay(rec, mo, idx) {
    var list = moList(mo), n = list[idx]; if (!n) return;
    Q.cur = { rec: rec, mo: mo, idx: idx, list: list, n: n, title: 'سورة ' + SUWAR[n - 1], sub: rec.name + ' · ' + moLabel(mo) };
    qStart(mo[2] + pad3(n) + '.mp3');
  }
  function qRadio(name, url, sub) { Q.cur = { radio: true, title: name, sub: sub || 'بث مباشر' }; qStart(url); }
  function qNext(d, auto) {
    if (!Q.cur || Q.cur.radio) return;
    var i = Q.cur.idx + d;
    if (i < 0 || i >= Q.cur.list.length) { if (auto) qStop(); return; }
    qPlay(Q.cur.rec, Q.cur.mo, i);
  }
  function qToggle() { var a = qAudio(); if (MOCK) return; if (a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () { }); } else a.pause(); }
  function qStop() {
    if (Q.audio) { try { Q.audio.pause(); Q.audio.removeAttribute('src'); Q.audio.load(); } catch (e) { } }
    Q.cur = null; if ($('np')) show($('np'), false); qMark();
  }
  function qDrawNp() {
    if (!Q.cur) return;
    var a = Q.audio, d = a && isFinite(a.duration) ? a.duration : 0, c = a ? a.currentTime || 0 : 0;
    $('np-t').textContent = (a && a.paused && !MOCK ? '❚❚  ' : '') + Q.cur.title; $('np-s').textContent = Q.cur.sub;
    $('np-f').style.width = (d ? clamp(c / d * 100, 0, 100) : (Q.cur.radio ? 100 : 0)) + '%';
    $('np-time').textContent = Q.cur.radio ? 'مباشر' : (d ? fmtDur(c) + ' / ' + fmtDur(d) : '');
  }
  function qMark() {
    var g = $('r-grid'); if (!g) return;
    each(g.children, function (e) { e.classList.toggle('on', !!(Q.cur && !Q.cur.radio && Q.rec && Q.cur.rec.id === Q.rec.id && Q.cur.mo[0] === Q.mo[0] && e._n === Q.cur.n)); });
  }

  Screens.quran = {
    bar: true,
    enter: function (arg, prev) {
      var scr = this, rows = $('q-rows');
      function build() {
        rows.innerHTML = ''; resetScroll($('s-quran'));
        var recs = qReciters();
        rows.appendChild(rowEl('القرّاء', recs.length + ' قارئ', recs.map(function (r, i) {
          var e = el('div', 'qc f', '<span class="qa">' + (i + 1) + '</span><b>' + esc(r.name) + '</b><small>' + esc(r.m.slice(0, 2).map(moLabel).join(' · ')) + '</small>');
          e.style.background = artBg(r.id + 2, 150);
          e._ok = function () { scr._focusId = r.id; go('reciter', r); };
          e._rid = r.id; return e;
        })));
        rows.appendChild(rowEl('إذاعات مباشرة', 'بث ٢٤ ساعة', Q_LIVE.map(function (x, i) {
          var e = el('div', 'qc radio f', '<span class="qa">◉</span><b>' + esc(x.name) + '</b><small>بث مباشر</small>');
          e.style.background = artBg(i + 11, 150);
          e._ok = function () { qRadio(x.name, x.url); };
          return e;
        })));
        var first = null;
        each(rows.querySelectorAll('.qc'), function (e) { if (e._rid === scr._focusId) first = e; });
        F.set(first || rows.querySelector('.f'));
      }
      if (prev === 'reciter' && rows.children.length) { var back = null; each(rows.querySelectorAll('.qc'), function (e) { if (e._rid === scr._focusId) back = e; }); if (back) { F.set(back, true); return; } }
      build();
      if (!Q.api) qLoad().then(function () { if (cur === 'quran') build(); });
    },
    back: function () { go('home'); }
  };
  Screens.reciter = {
    enter: function (rec) {
      Q.rec = rec; $('r-name').textContent = rec.name;
      var ctas = $('r-ctas'); ctas.innerHTML = '';
      var b1 = el('span', 'btn f', '<span class="tri"></span>تشغيل المصحف كامل'); b1._ok = function () { qPlay(rec, Q.mo, 0); }; ctas.appendChild(b1);
      if (rec.radio) { var b2 = el('span', 'btn f', 'بث متواصل ٢٤ ساعة'); b2._ok = function () { qRadio(rec.name, rec.radio, 'بث متواصل'); }; ctas.appendChild(b2); }
      var box = $('r-moshaf'); box.innerHTML = '';
      each(rec.m, function (m) {
        var p = el('span', 'f', esc(moLabel(m))); p._m = m;
        p._focus = function () { if (Q.mo !== m) renderSurahs(rec, m); };
        p._ok = function () { var f = $('r-grid').firstChild; if (f) F.set(f); };
        box.appendChild(p);
      });
      show(box, rec.m.length > 1);
      var start = Q.cur && !Q.cur.radio && Q.cur.rec.id === rec.id ? Q.cur.mo : rec.m[0];
      each(rec.m, function (m) { if (m[0] === start[0]) start = m; });
      renderSurahs(rec, start);
      F.set(b1, true);
    },
    back: function () { go('quran'); }
  };
  function renderSurahs(rec, m) {
    Q.mo = m;
    each($('r-moshaf').children, function (p) { p.classList.toggle('act', p._m === m); });
    var g = $('r-grid'); g.innerHTML = ''; g._mode = 'grid'; g._y = 0; g.style.webkitTransform = g.style.transform = '';
    var list = moList(m), frag = document.createDocumentFragment();
    each(list, function (n, idx) {
      var e = el('div', 'su f', '<b>' + n + '</b><span>' + esc(SUWAR[n - 1]) + '</span>'); e._n = n;
      e._ok = function () { if (Q.cur && !Q.cur.radio && Q.cur.rec.id === rec.id && Q.cur.mo[0] === m[0] && Q.cur.n === n) qToggle(); else qPlay(rec, m, idx); };
      frag.appendChild(e);
    });
    g.appendChild(frag); qMark();
  }

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
    if (Speed.open) { Speed.key(k); return; }
    var sc = Screens[cur];
    if (Q.cur && !sc.video) {
      if (k === 'playpause' || k === 'play' || k === 'pause') { qToggle(); return; }
      if (k === 'ff') { qNext(1); return; }
      if (k === 'rw') { qNext(-1); return; }
      if (k === 'stop') { qStop(); return; }
    }
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
      '<div id="topbar" class="hidden"><div class="brand"><div class="mark">M</div><b>Mohab <i>TV</i></b><span class="pchip" id="pchip"></span></div>',
      '<div class="nav" id="nav"><span class="f" data-go="home" id="nav-home">الرئيسية</span><span class="f" data-go="live" id="nav-live">البث المباشر</span><span class="f" data-go="movies" id="nav-movie">الأفلام</span><span class="f" data-go="series" id="nav-series">المسلسلات</span><span class="f" data-go="quran" id="nav-quran">القرآن الكريم</span></div>',

      '<section class="screen" id="s-who"><div class="fill amb"></div><div class="fill grain"></div><div class="who"><div class="wbrand"><div class="mark">M</div><b>Mohab <i>TV</i></b></div><h2>مين اللي هيتفرج؟</h2>',
      '<div class="wrow"><div class="wp f" id="who-ahmed"><span class="av">أ</span><b>أحمد جمال</b></div><div class="wp f" id="who-mohab"><span class="av">م</span><b>مهاب</b><small>قريبًا</small></div></div></div></section>',
      '<div class="clock"><div class="t" id="clk"></div><div class="d" id="dt"></div></div></div>',

      '<section class="screen" id="s-open"><div class="fill amb"></div><div class="fill grain"></div><div class="openmsg"><div class="k">رسالة النهارده</div><h2 id="om-text"></h2><div class="sig">مهاب</div><div><span class="go f" id="om-go">OK للدخول</span></div></div></section>',

      '<section class="screen" id="s-home"><div class="fill amb"></div><div class="fill grain"></div><div class="fill deco" id="h-deco"></div>',
      '<div class="subs hidden" id="h-subs"></div><div class="art" id="h-art"></div>',
      '<div class="hero"><div class="eyebrow" id="h-eye"></div><h1 class="welcome" id="h-title"></h1><div class="sub" id="h-sub"></div>',
      '<div class="ctas"><span class="btn f" id="h-resume"><span class="tri"></span>كمّل المشاهدة<small id="h-last"></small></span><span class="btn f" id="h-all">كل القنوات</span><span class="btn f" id="h-speed">سرعة النت<small id="h-spd"></small></span></div></div>',
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

      '<section class="screen" id="s-quran"><div class="fill amb"></div><div class="fill grain"></div><div class="qhead"><div class="eyebrow">بسم الله الرحمن الرحيم</div><h1>القرآن الكريم</h1></div>',
      '<div class="vwrap" style="top:330px;height:750px"><div class="vscroll" id="q-rows"></div></div></section>',

      '<section class="screen" id="s-reciter"><div class="fill amb"></div><div class="fill grain"></div><div class="qhead" style="top:60px"><div class="eyebrow">القرآن الكريم</div><h1 id="r-name"></h1><div class="ctas" id="r-ctas"></div><div class="seasons" id="r-moshaf"></div></div>',
      '<div class="grid" style="top:480px;bottom:120px"><div class="gin vscroll" id="r-grid"></div></div></section>',

      '<div id="np" class="hidden"><div class="npi"><b id="np-t"></b><span id="np-s"></span></div><div class="npbar"><i id="np-f"></i></div><span class="npt" id="np-time"></span><span class="nph">⏯ إيقاف وتشغيل</span></div>',

      '<div id="speed" class="hidden"><div class="box"><div class="k">قياس سرعة النت</div><div class="spd"><b id="sp-num">0</b><span>ميجابت في الثانية</span></div><div class="spbar"><i id="sp-bar"></i></div><p id="sp-msg"></p><div class="sph" id="sp-hint"></div></div></div>',

      '<div id="pop" class="hidden"><div class="box"><div class="k" id="pop-k"></div><h5 id="pop-h"></h5><p id="pop-p"></p><div class="acts" id="pop-acts"></div></div></div>',
      '<div id="toast" class="hidden"></div>',
      '<div id="boot"><div class="mark">M</div><p id="boot-msg">Mohab TV</p></div>'
    ].join('');
    each(document.querySelectorAll('#nav .f'), function (n) { n._ok = function () { go(n.getAttribute('data-go')); }; });
    $('h-resume')._ok = function () { go('live'); };
    $('h-all')._ok = function () { go('live', { openList: true }); };
    $('h-speed')._ok = function () { Speed.show(); };
    $('who-ahmed')._ok = function () { selectProfile('ahmed'); };
    // Mohab's section is not built yet: show a notice and stay on the picker
    $('who-mohab')._ok = function () { Pop.show({ kicker: 'مهاب', title: 'قريبًا', text: 'القسم ده لسه بيتجهّز. اختاروا أحمد جمال.', buttons: [{ label: 'تمام' }] }); };
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
      // the user picker shows only on the very first launch; later it is reached from Back on the home screen
      if (store.get('profileSet', 0)) selectProfile(S.profile); else go('who');
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
        if (Q.audio && Q.cur) { try { Q.audio.pause(); } catch (e) { } qDrawNp(); }
      } else {
        if (Date.now() - hiddenAt > 60 * 60 * 1000) { location.reload(); return; }
        poll();
        if (cur === 'live') { var c = S.lists[S.li] && S.lists[S.li].items[S.ci]; if (c) startChannel(c); }
        else if (cur === 'player') { V.start = Player.cur || (V.res && V.res.pos) || 0; Screens.player.enter(V); }
      }
    });
  }

  window.MohabTV = window.AhmedTV = { version: VERSION, go: function (n, a) { go(n, a); }, state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
