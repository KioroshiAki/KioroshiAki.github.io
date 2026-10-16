// Jukebox card: shows a random track and controls the global player.
(function () {
  'use strict';

  var cfgEl = document.getElementById('ka-jukebox-config');
  var cfg = {};
  try {
    cfg = JSON.parse((cfgEl && cfgEl.textContent) || '{}');
  } catch (e) {
    cfg = {};
  }
  if (cfg.enable === false) return;
  if (window.__kaJukeboxMounted) return;
  window.__kaJukeboxMounted = true;

  var WINDOW_MS = (parseInt(cfg.windowseconds, 10) || 15) * 1000;
  var MAX_REROLLS = parseInt(cfg.maxrerolls, 10) || 5;

  // Keep the rate-limit window across PJAX navigation.
  var rerollTimes = [];

  // Read the playlist injected by the player.
  function playlist() {
    var el = document.getElementById('ka-music-data');
    if (!el) return [];
    try {
      return (JSON.parse(el.textContent || '{}').tracks) || [];
    } catch (e) {
      return [];
    }
  }

  // Get the global player instance.
  function player() {
    return window.__kaMusicPlayer || null;
  }

  // Detect light or dark mode from the page.
  function detectScheme() {
    var dark = false;
    try {
      if (document.documentElement.classList.contains('dark') ||
          document.body.classList.contains('dark')) {
        dark = true;
      } else {
        var bg = getComputedStyle(document.body).backgroundColor || '';
        var m = bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          var parts = m[1].split(',').map(function (x) { return parseFloat(x); });
          if (parts.length >= 3) {
            dark = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255 < 0.5;
          }
        }
      }
    } catch (e) { /* Fall back to light. */ }
    return dark ? 'dark' : 'light';
  }

  // Apply the theme to all jukebox widgets.
  function syncScheme() {
    var widgets = document.querySelectorAll('[data-jb="widget"]');
    for (var i = 0; i < widgets.length; i++) {
      widgets[i].setAttribute('data-jb-scheme', detectScheme());
    }
  }

  var schemeObserver = null;
  // Watch theme changes only while a jukebox exists.
  function watchScheme() {
    if (schemeObserver) return;
    try {
      schemeObserver = new MutationObserver(syncScheme);
      schemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      schemeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* Ignore observer errors. */ }
  }
  // Stop watching theme changes.
  function stopSchemeWatch() {
    if (!schemeObserver) return;
    schemeObserver.disconnect();
    schemeObserver = null;
  }

  // Initialize one jukebox widget.
  function initWidget(root) {
    if (!root || root.getAttribute('data-jb-ready') === '1') return;
    root.setAttribute('data-jb-ready', '1');

    var disc = root.querySelector('[data-jb="cover"]');
    var titleEl = root.querySelector('[data-jb="title"]');
    var artistEl = root.querySelector('[data-jb="artist"]');
    var playBtn = root.querySelector('[data-jb="play"]');
    var rerollBtn = root.querySelector('[data-jb="reroll"]');
    var hintEl = root.querySelector('[data-jb="hint"]');
    var toastEl = root.querySelector('[data-jb="toast"]');

    var shown = -1;
    var toastTimer = null;
    var lockTimer = null;

    // Show a temporary toast.
    function toast(text, ms) {
      if (!toastEl) return;
      toastEl.textContent = text;
      toastEl.setAttribute('data-show', 'true');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.removeAttribute('data-show');
      }, ms || 2600);
    }

    // Pick a random index different from the current one.
    function pickIndex(exclude) {
      var list = playlist();
      if (!list.length) return -1;
      if (list.length === 1) return 0;
      var i = exclude;
      var guard = 0;
      while (i === exclude && guard < 30) {
        i = Math.floor(Math.random() * list.length);
        guard += 1;
      }
      return i;
    }

    // Current player index.
    function playerIndex() {
      var ap = player();
      try {
        return ap ? ap.list.index : -1;
      } catch (e) {
        return -1;
      }
    }

    // Render the card state.
    function render() {
      var list = playlist();
      var track = list[shown];

      if (!track) {
        titleEl.textContent = '播放器未启用';
        artistEl.textContent = '';
        hintEl.textContent = '本站歌单为空或播放器已关闭，检查 data/music.yaml 与 params.toml 的 musicPlayer.enable。';
        playBtn.disabled = true;
        rerollBtn.disabled = true;
        root.setAttribute('data-jb-state', 'empty');
        return;
      }

      titleEl.textContent = track.name || '未知曲目';
      artistEl.textContent = track.artist || '';
      if (disc) {
        disc.style.backgroundImage = track.cover ? "url('" + track.cover + "')" : '';
      }

      var same = playerIndex() === shown;
      var ap = player();
      var playing = !!(same && ap && !ap.paused);

      root.setAttribute('data-jb-state', playing ? 'playing' : (same ? 'current' : 'idle'));
      playBtn.disabled = playing || !ap;
      playBtn.textContent = !ap ? '播放器不可用' : (playing ? '正在播放' : (same ? '继续播放' : '播放这首'));
      if (!ap) hintEl.textContent = '播放器当前不可用，可能所有曲目都无法播放。';
      rerollBtn.disabled = list.length < 2 || !ap;
    }
    root.__jbRender = render;
    root.__jbError = function () {
      if (playerIndex() === shown) hintEl.textContent = '这首暂时放不了，点「换一首」试试。';
    };

    // Play the shown track through the global player.
    playBtn.addEventListener('click', function () {
      var ap = player();
      var list = playlist();
      if (!ap || !list[shown]) return;
      // Expand the player if it is collapsed.
      if (document.querySelector('.mp-panel[data-mp-collapsed="true"]') &&
          typeof window.__kaMusicPlayerExpand === 'function') {
        window.__kaMusicPlayerExpand();
      }
      ap.list.switch(shown);
      ap.play();
      setTimeout(render, 80);
    });

    // Rate-limited reroll.
    rerollBtn.addEventListener('click', function () {
      var list = playlist();
      if (list.length < 2) return;

      var now = Date.now();
      rerollTimes = rerollTimes.filter(function (t) { return now - t < WINDOW_MS; });

      if (rerollTimes.length >= MAX_REROLLS) {
        var wait = Math.max(1, Math.ceil((WINDOW_MS - (now - rerollTimes[0])) / 1000));
        toast('换得太快了，' + wait + ' 秒后再试', Math.min(3200, wait * 1000));
        rerollBtn.disabled = true;
        if (lockTimer) clearInterval(lockTimer);
        var left = wait;
        lockTimer = setInterval(function () {
          left -= 1;
          if (left <= 0) {
            clearInterval(lockTimer);
            lockTimer = null;
            render();
          }
        }, 1000);
        return;
      }

      rerollTimes.push(now);
      shown = pickIndex(shown);
      render();
    });

    // Bind player events once; render all mounted widgets.
    function bindPlayer() {
      var ap = player();
      if (!ap || ap.__jbBound) return;
      ap.__jbBound = true;
      ['play', 'pause'].forEach(function (evt) {
        ap.on(evt, renderAll);
      });
      // APlayer fires listswitch before updating list.index.
      ap.on('listswitch', function () { setTimeout(renderAll, 0); });
      ap.on('error', notifyJukeboxError);
    }

    bindPlayer();
    shown = pickIndex(-1);
    render();
    hintEl.textContent = player()
      ? '播放器在页面右下角，翻页也不会中断。'
      : '播放器当前不可用，可能所有曲目都无法播放。';
  }

  // Initialize all widgets after load or PJAX.
  function initAll() {
    var widgets = document.querySelectorAll('[data-jb="widget"]');
    if (!widgets.length) {
      stopSchemeWatch();
      return;
    }
    watchScheme();
    syncScheme();
    for (var i = 0; i < widgets.length; i++) initWidget(widgets[i]);
  }

  // Render every mounted widget.
  function renderAll() {
    var widgets = document.querySelectorAll('[data-jb="widget"]');
    for (var i = 0; i < widgets.length; i++) {
      if (typeof widgets[i].__jbRender === 'function') widgets[i].__jbRender();
    }
  }

  // Show a per-widget error hint.
  function notifyJukeboxError() {
    renderAll();
    var widgets = document.querySelectorAll('[data-jb="widget"]');
    for (var i = 0; i < widgets.length; i++) {
      if (typeof widgets[i].__jbError === 'function') widgets[i].__jbError();
    }
  }

  document.addEventListener('ka:music-dead', renderAll);
  initAll();

  document.addEventListener('pjax:complete', function () {
    // Wait until PJAX has inserted the new content.
    setTimeout(initAll, 0);
  });
})();
