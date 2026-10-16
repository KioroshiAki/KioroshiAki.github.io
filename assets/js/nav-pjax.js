// PJAX navigation that keeps the footer, player, terminal, and jukebox alive.
(function () {
  'use strict';

  if (typeof window.Pjax === 'undefined') return;

  var cfgEl = document.getElementById('ka-navpjax-config');
  var cfg = {};
  try {
    cfg = JSON.parse((cfgEl && cfgEl.textContent) || '{}');
  } catch (e) {
    cfg = {};
  }
  if (cfg.enable === false) return;

  var maxNav = parseInt(cfg.maxNavigations, 10);
  if (!maxNav || maxNav < 1) maxNav = 100;
  var navCount = 0;
  var textCache = {};
  /* Persistent custom scripts must not be replayed. */
  var SKIP_RE = /\/js\/(?:music-player|nav-pjax|jukebox|terminal)\./;
  // Global listeners registered by the previous replay.
  var trackedListeners = [];

  // Debug stats.
  var stats = window.__navPjaxStats = { navigations: 0, reinits: 0, scripts: 0, readyCallbacks: 0, tracked: 0, removed: 0, lastError: null };

  // Progress bar.
  var bar = document.createElement('div');
  bar.className = 'np-progress';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<i></i>';
  document.body.appendChild(bar);
  var fill = bar.firstChild;
  try {
    var primary = getComputedStyle(document.documentElement).getPropertyValue('--color-primary-500').trim();
    if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(primary)) fill.style.background = 'rgb(' + primary + ')';
  } catch (e) { /* Use the CSS default color. */ }

  var hideTimer = null;
  // Show the progress bar.
  function showBar() {
    if (hideTimer) clearTimeout(hideTimer);
    bar.removeAttribute('data-done');
    bar.setAttribute('data-active', 'true');
  }
  // Finish and hide the progress bar.
  function finishBar() {
    bar.setAttribute('data-done', 'true');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      bar.removeAttribute('data-active');
      bar.removeAttribute('data-done');
    }, 300);
  }

  // Reinitialize theme scripts.
  // Collect same-origin theme scripts; skip persistent site scripts.
  function themeScriptUrls() {
    var out = [];
    var list = document.querySelectorAll('script[src]');
    for (var i = 0; i < list.length; i++) {
      var url = list[i].src || '';
      if (url.indexOf(window.location.origin + '/') !== 0) continue;
      if (url.indexOf('/js/') === -1) continue;
      if (SKIP_RE.test(url)) continue;
      if (out.indexOf(url) === -1) out.push(url);
    }
    return out;
  }

  // Fetch script text synchronously if it is not cached.
  function fetchText(url) {
    if (typeof textCache[url] === 'string') return textCache[url];
    try {
      // Synchronous request keeps replay ordered during pjax:complete.
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        textCache[url] = xhr.responseText;
        return textCache[url];
      }
    } catch (e) {
      stats.lastError = 'fetch failed: ' + url + ' ' + e;
    }
    return null;
  }

  // Remove listeners from the previous replay.
  function removeTrackedListeners() {
    var n = 0;
    trackedListeners.forEach(function (item) {
      try {
        item.target.removeEventListener(item.type, item.listener, item.options);
        n += 1;
      } catch (e) { /* Ignore one failed removal. */ }
    });
    trackedListeners = [];
    stats.removed += n;
  }

  // Re-execute theme scripts and run their ready callbacks.
  function reinitTheme() {
    var urls = themeScriptUrls();
    if (!urls.length) {
      stats.lastError = 'no theme scripts found';
      return;
    }
    stats.scripts = urls.length;

    // Clear listeners from the previous replay.
    removeTrackedListeners();

    // Capture ready callbacks instead of dispatching synthetic events.
    var pending = [];
    var targets = [window, document];
    var savedAdd = targets.map(function (t) { return t.addEventListener; });
    var READY = { DOMContentLoaded: 1, load: 1, readystatechange: 1 };
    targets.forEach(function (t, i) {
      t.addEventListener = function (type, listener, options) {
        if (READY[type]) {
          pending.push({ target: t, listener: listener, type: type });
          return;
        }
        // Track persistent global listeners for the next replay.
        trackedListeners.push({ target: t, type: type, listener: listener, options: options });
        return savedAdd[i].apply(t, arguments);
      };
    });

    var ok = 0;
    try {
      urls.forEach(function (url) {
        var text = fetchText(url);
        if (text === null) return;
        try {
          // Wrap top-level declarations in a function scope.
          (new Function(text))();
          ok += 1;
        } catch (e) {
          stats.lastError = 're-exec ' + url + ': ' + e;
          console.warn('[nav-pjax] 脚本重新执行出错（页面内容不受影响）：', url, e);
        }
      });
    } finally {
      targets.forEach(function (t, i) { t.addEventListener = savedAdd[i]; });
    }
    if (ok > 0) stats.reinits += 1;

    stats.readyCallbacks = pending.length;
    stats.tracked = trackedListeners.length;
    pending.forEach(function (item) {
      try {
        item.listener.call(item.target, new Event(item.type));
      } catch (e) {
        // Keep other scripts running if one fails.
        console.warn('[nav-pjax] 某个初始化回调出错：', e);
      }
    });
  }

  // Start PJAX.
  var pjax = new window.Pjax({
    elements: 'a[href]',
    // Keep selectors exact; footer stays to preserve persistent widgets.
    selectors: ['title', 'body > header', 'main'],
    scrollTo: 0,
    timeout: 8000
  });

  // Programmatic navigation for terminal run.sh.
  window.__kaPjaxNavigate = function (url) {
    if (!url || navCount >= maxNav || typeof pjax.loadUrl !== 'function') return false;
    try {
      pjax.loadUrl(url);
      return true;
    } catch (e) {
      stats.lastError = 'navigate ' + url + ': ' + e;
      return false;
    }
  };

  document.addEventListener('pjax:send', function () {
    showBar();
    // Disable smooth scrolling during the switch.
    document.documentElement.style.scrollBehavior = 'auto';
  });

  document.addEventListener('pjax:complete', function () {
    finishBar();
    navCount += 1;
    stats.navigations += 1;
    document.documentElement.style.scrollBehavior = '';
    reinitTheme();
  });

  document.addEventListener('pjax:error', function () {
    finishBar();
    document.documentElement.style.scrollBehavior = '';
  });

  // Fall back to a full load after too many navigations.
  document.addEventListener('click', function (e) {
    if (navCount < maxNav) return;
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    if (link.host !== window.location.host) return;
    if (link.hash && link.href.replace(link.hash, '') === window.location.href.replace(window.location.hash, '')) return;
    e.preventDefault();
    window.location.href = link.href;
  }, true);

  // Prefetch theme script text.
  try {
    var prefetch = themeScriptUrls();
    stats.scripts = prefetch.length;
    prefetch.forEach(function (url) {
      if (typeof textCache[url] === 'string') return;
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = function () {
          if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
            textCache[url] = xhr.responseText;
          }
        };
        xhr.send(null);
      } catch (e) { /* Ignore one failed prefetch. */ }
    });
  } catch (e) { /* Ignore prefetch errors. */ }
})();
