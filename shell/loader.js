/* Mohab TV launcher.
 * This is the only code installed on the TV. Every launch it loads the newest app.css + app.js
 * from appUrl with ordinary <link>/<script src> tags, and falls back to the copy bundled inside
 * the package (bundled/) when the internet copy cannot be loaded.
 * It keeps the splash up until the app says it is ready, shows what stage it is at, and prints
 * any script error on the screen so a photo of the TV is enough to diagnose a problem. */
(function () {
  'use strict';
  var SHELL_VERSION = '1.1.0';
  var S = window.AHMED_TV = window.AHMED_TV || {};
  S.shellVersion = SHELL_VERSION;
  var base = String(S.appUrl || '');
  if (base && base.charAt(base.length - 1) !== '/') base += '/';
  if (/YOUR-PROJECT|YOUR-SITE/.test(base)) base = '';

  var splash = document.getElementById('splash');
  var statusEl = document.getElementById('splash-status');
  var errBox = document.getElementById('shell-errors');
  var errors = 0, appUp = false;

  function status(t) { if (statusEl) statusEl.textContent = t; }
  function hideSplash() { if (splash && splash.parentNode) splash.parentNode.removeChild(splash); splash = null; }
  function showError(t) {
    if (!errBox || errors >= 6) return;
    errors++;
    var d = document.createElement('div');
    d.textContent = t;
    errBox.appendChild(d);
    errBox.style.display = 'block';
  }
  window.onerror = function (msg, src, line, col) {
    showError('ERR ' + msg + ' @ ' + String(src || '').split('/').pop().split('?')[0] + ':' + line + ':' + col);
  };
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    showError('PROMISE ' + (r && (r.stack || r.message) ? String(r.stack || r.message).slice(0, 300) : String(r)));
  });
  // the app calls this when its first screen is on
  S.ready = function () { appUp = true; hideSplash(); };

  function addCss(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  function addScript(src, cross, ok, fail) {
    var sc = document.createElement('script'), done = false, t;
    function finish(good) { if (done) return; done = true; clearTimeout(t); if (good) ok(); else { if (sc.parentNode) sc.parentNode.removeChild(sc); fail(); } }
    if (cross) sc.crossOrigin = 'anonymous';
    sc.onload = function () { finish(true); };
    sc.onerror = function () { finish(false); };
    t = setTimeout(function () { finish(false); }, 25000);
    sc.src = src;
    document.body.appendChild(sc);
  }
  function started(where) {
    S.appVersion = where;
    status('v' + SHELL_VERSION + ' · ' + where);
    // an old app build never calls ready(): do not leave the splash up forever
    setTimeout(function () { if (!appUp && window.AhmedTV) hideSplash(); }, 6000);
    setTimeout(function () { if (!appUp && !window.AhmedTV) showError('APP DID NOT START (' + where + ')'); }, 8000);
  }
  function fromBundle(why) {
    status('bundled' + (why ? ' (' + why + ')' : ''));
    addCss('bundled/app.css');
    addScript('bundled/app.js', false, function () { started('bundled' + (why ? ' · ' + why : '')); }, function () { showError('BUNDLED APP FAILED TO LOAD'); });
  }
  function fromWeb(ver) {
    status('loading ' + ver);
    addCss(base + 'app.css?v=' + encodeURIComponent(ver));
    addScript(base + 'app.js?v=' + encodeURIComponent(ver), true, function () { started('web ' + ver); }, function () { fromBundle('web failed'); });
  }

  if (!base) { fromBundle('no appUrl'); return; }
  status('checking for updates');
  var x = new XMLHttpRequest(), settled = false;
  function go(ver) { if (settled) return; settled = true; fromWeb(ver); }
  // if the version file cannot be read, still try the web copy with a cache-buster that changes every 10 minutes
  var bucket = 't' + Math.floor(Date.now() / 600000);
  try {
    x.open('GET', base + 'manifest.json?t=' + Date.now(), true);
    x.timeout = 6000;
    x.onload = function () { var v = ''; try { v = String(JSON.parse(x.responseText).version || ''); } catch (e) { } go(v || bucket); };
    x.onerror = x.ontimeout = function () { go(bucket); };
    x.send();
  } catch (e) { go(bucket); }
  setTimeout(function () { go(bucket); }, 7000);
})();
