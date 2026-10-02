/* TikTok TV - TizenBrew mod for https://www.tiktok.com
 * Remote: Up/Down = prev/next video, OK = play/pause (and unmute),
 *         Left/Right = seek 5s, Back = close popup / exit, Red = stats overlay.
 * Telemetry: counters persist in localStorage under "tttv.stats" and every
 * action logs to the console with the [TikTokTV] prefix.
 */
(function () {
  'use strict';
  if (window.__tttvLoaded) return;
  window.__tttvLoaded = true;

  var VERSION = '0.1.1';
  var KEY = {
    UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, OK: 13,
    BACK: 10009, ESC: 27,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19,
    NEXT: 10233, PREV: 10232, FF: 417, REW: 412,
    RED: 403
  };
  var SEEK_SECONDS = 5;

  // ---------- telemetry ----------
  var STATS_KEY = 'tttv.stats';
  var stats = loadStats();
  stats.launches = (stats.launches || 0) + 1;
  stats.lastLaunch = new Date().toISOString();
  stats.version = VERSION;
  saveStats();

  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* storage blocked */ }
  }
  function count(name, n) {
    stats[name] = (stats[name] || 0) + (n || 1);
    saveStats();
  }
  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[TikTokTV]');
    console.log.apply(console, args);
  }
  window.addEventListener('error', function (e) {
    count('jsErrors');
    stats.lastError = String(e.message).slice(0, 200);
    saveStats();
  });

  // ---------- toast ----------
  var toastEl, toastTimer;
  function toast(text, ms) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,.75);color:#fff;font:600 28px/1.3 sans-serif;padding:14px 28px;' +
        'border-radius:14px;z-index:2147483647;pointer-events:none;transition:opacity .3s';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 1200);
  }

  // ---------- clutter ----------
  var css = [
    // "Get the app" banners and prompts
    '[data-e2e="download-app"]', '[data-e2e="top-get-app"]', '[class*="DownloadApp"]',
    '[class*="BottomBanner"]', '[class*="GetAppButton"]', '[class*="PromotionBanner"]'
  ].join(',') + '{display:none!important}' +
    'html,body{cursor:none!important}';
  function injectCss() {
    if (document.getElementById('tttv-css') || !document.head) return;
    var s = document.createElement('style');
    s.id = 'tttv-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Only exact, known-safe targets. Generic "close" guesses opened TikTok's sign-up flow in testing.
  function byText(selector, re, root) {
    var els = (root || document).querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      if (els[i].offsetParent !== null && re.test(els[i].textContent.trim())) return els[i];
    }
    return null;
  }
  function loginModal() {
    var m = document.querySelector('[data-e2e="login-modal"]');
    return m && m.offsetParent !== null ? m : null;
  }
  function closeToasts() {
    var t = document.querySelector('button[aria-label="Close toast"]');
    if (t && t.offsetParent !== null) { t.click(); count('toastsClosed'); }
  }
  // Login popup: switch it to the QR-code option once so the user can log in from their phone.
  var qrShownFor = null;
  function handleLoginModal() {
    var m = loginModal();
    if (!m || qrShownFor === m) return;
    var qr = byText('[role="button"], button, a, div', /^use qr code$/i, m);
    if (qr) {
      qr.click();
      qrShownFor = m;
      count('loginQrShown');
      log('login popup: switched to QR code');
      toast('Scan the QR code with the TikTok app on your phone · Back = skip', 8000);
    }
  }
  var sendingEscape = false;
  function closePopup() {
    var m = loginModal();
    if (!m) return false;
    var container = m.closest('[class*="Modal"]') || m.parentElement.parentElement || document;
    var skip = byText('[role="button"], button, div', /^skip$/i, container);
    if (skip) {
      skip.click();
      count('loginSkipped');
      log('login popup: skipped');
    } else {
      sendingEscape = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      sendingEscape = false;
      count('loginEscape');
      log('login popup: no skip button, sent Escape');
    }
    return true;
  }

  // ---------- video helpers ----------
  function visibleArea(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }
  function currentVideo() {
    var vids = document.querySelectorAll('video');
    var best = null, bestArea = 0;
    for (var i = 0; i < vids.length; i++) {
      var a = visibleArea(vids[i]);
      if (a > bestArea) { bestArea = a; best = vids[i]; }
    }
    return best;
  }
  function videoId(v) {
    if (!v) return null;
    var item = v.closest('article, [data-e2e="recommend-list-item-container"]');
    return (item && (item.id || item.getAttribute('data-scroll-index'))) || v.currentSrc || v.src || null;
  }
  function scrollableAncestor(el) {
    while (el && el !== document.body) {
      var st = getComputedStyle(el);
      // TikTok's feed column is overflow:hidden but still scrolls programmatically.
      if (/(auto|scroll|hidden)/.test(st.overflowY) && el.scrollHeight > el.clientHeight * 1.5) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Try each method in order until the visible video changes; record which one worked
  // so a TikTok layout change shows up in the stats instead of silently breaking.
  var NAV_METHODS = {
    button: function (dir) {
      var sel = dir > 0
        ? '[data-e2e="feed-navigation-next"], [data-e2e="arrow-down"], button[aria-label*="next video" i]'
        : '[data-e2e="feed-navigation-prev"], [data-e2e="arrow-up"], button[aria-label*="previous video" i]';
      var b = document.querySelector(sel);
      if (!b || b.disabled) return false; // disabled while TikTok's login popup is up
      b.click();
      return true;
    },
    scroll: function (dir) {
      var v = currentVideo();
      var box = scrollableAncestor(v || document.body);
      box.scrollBy({ top: dir * box.clientHeight, behavior: 'smooth' });
      return true;
    }
  };
  var navBusy = false;
  function navigate(dir) {
    if (navBusy) return;
    navBusy = true;
    var before = videoId(currentVideo());
    var order = ['button', 'scroll'];
    var start = Date.now();
    (function attempt(i) {
      if (i >= order.length) {
        log('navigation failed', dir > 0 ? 'next' : 'prev');
        count('navFailed');
        toast('Could not change video');
        navBusy = false;
        return;
      }
      var name = order[i];
      if (!NAV_METHODS[name](dir)) return attempt(i + 1);
      setTimeout(function () {
        var after = videoId(currentVideo());
        if (after && after !== before) {
          count('nav.' + name);
          log('nav', dir > 0 ? 'next' : 'prev', 'via', name, (Date.now() - start) + 'ms');
          var v = currentVideo();
          if (v && v.paused) v.play().catch(function () {});
          navBusy = false;
        } else {
          attempt(i + 1);
        }
      }, 900);
    })(0);
  }

  function togglePlay() {
    var v = currentVideo();
    if (!v) { toast('No video'); count('noVideo'); return; }
    if (v.muted) { v.muted = false; count('unmuted'); }
    if (v.paused) { v.play().catch(function () {}); toast('▶ Play'); }
    else { v.pause(); toast('❚❚ Pause'); }
  }
  function seek(sec) {
    var v = currentVideo();
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + sec));
    toast((sec > 0 ? '+' : '') + sec + 's');
  }

  function goBack() {
    if (closePopup()) return;
    if (location.pathname.indexOf('/foryou') !== 0 && history.length > 1) {
      history.back();
      return;
    }
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {
      log('exit not available outside the TV');
    }
  }

  var statsEl;
  function toggleStats() {
    if (statsEl) { statsEl.remove(); statsEl = null; return; }
    statsEl = document.createElement('pre');
    statsEl.style.cssText = 'position:fixed;top:5%;right:3%;max-width:40%;background:rgba(0,0,0,.85);' +
      'color:#0f0;font:20px/1.4 monospace;padding:20px;border-radius:12px;z-index:2147483647;white-space:pre-wrap';
    statsEl.textContent = 'TikTok TV ' + VERSION + ' stats\n' + JSON.stringify(stats, null, 2);
    document.body.appendChild(statsEl);
    count('statsViewed');
  }

  // ---------- keys ----------
  var ACTIONS = {};
  ACTIONS[KEY.DOWN] = ['next', function () { navigate(1); }];
  ACTIONS[KEY.NEXT] = ['next', function () { navigate(1); }];
  ACTIONS[KEY.UP] = ['prev', function () { navigate(-1); }];
  ACTIONS[KEY.PREV] = ['prev', function () { navigate(-1); }];
  ACTIONS[KEY.OK] = ['playpause', togglePlay];
  ACTIONS[KEY.PLAYPAUSE] = ['playpause', togglePlay];
  ACTIONS[KEY.PLAY] = ['playpause', togglePlay];
  ACTIONS[KEY.PAUSE] = ['playpause', togglePlay];
  ACTIONS[KEY.RIGHT] = ['seek', function () { seek(SEEK_SECONDS); }];
  ACTIONS[KEY.FF] = ['seek', function () { seek(SEEK_SECONDS); }];
  ACTIONS[KEY.LEFT] = ['seek', function () { seek(-SEEK_SECONDS); }];
  ACTIONS[KEY.REW] = ['seek', function () { seek(-SEEK_SECONDS); }];
  ACTIONS[KEY.BACK] = ['back', goBack];
  ACTIONS[KEY.ESC] = ['back', goBack];
  ACTIONS[KEY.RED] = ['stats', toggleStats];

  document.addEventListener('keydown', function (e) {
    if (sendingEscape) return; // our own Escape is meant for TikTok's popup
    var t = e.target;
    // Let typing and the login popup get the keys, except Back which should still close things.
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if ((typing || loginModal()) && e.keyCode !== KEY.BACK) { count('key.passedToPopup'); return; }
    var action = ACTIONS[e.keyCode];
    if (!action) { count('key.unmapped'); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    count('key.' + action[0]);
    action[1]();
  }, true);

  // ---------- start ----------
  function init() {
    injectCss();
    closeToasts();
    handleLoginModal();
    log('loaded v' + VERSION, 'launch #' + stats.launches);
    toast('TikTok TV ready  ·  ▲▼ swipe  ·  OK play/pause', 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // TikTok is a single-page app that re-renders; keep CSS present and handle popups as they appear.
  setInterval(function () { injectCss(); closeToasts(); handleLoginModal(); }, 2000);
})();
