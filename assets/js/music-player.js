/* Floating music player using APlayer and NetEase's public outer URL. */
(function () {
  'use strict';

  if (window.__kaMusicPlayerMounted) return;
  var dataEl = document.getElementById('ka-music-data');
  if (!dataEl || typeof APlayer === 'undefined') return;

  var cfg;
  try {
    cfg = JSON.parse(dataEl.textContent || '{}');
  } catch (e) {
    return;
  }

  /* Hugo lowercases option keys; read them case-insensitively. */
  var DEFAULTS = {
    startcollapsed: false,
    draggable: true,
    resumeacrosspages: true,
    autoplay: false,
    volume: 0.5,
    order: 'list',
    loop: 'all',
    listfolded: true,
    listmaxheight: '220px',
    preload: 'none',
    storagename: 'ka-music-player'
  };
  var opts = {};
  (function () {
    var raw = cfg.options || {};
    for (var k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) opts[String(k).toLowerCase()] = raw[k];
    }
  })();
  // Read an option with a default.
  function opt(key) {
    var k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(opts, k) ? opts[k] : DEFAULTS[k];
  }

  var template = cfg.outerUrlTemplate || 'https://music.163.com/song/media/outer/url?id={id}.mp3';
  // Build a playable URL for a track.
  function trackUrl(t) {
    if (t.url) return t.url;
    if (!t.id) return '';
    return template.replace('{id}', encodeURIComponent(String(t.id)));
  }

  var audio = (cfg.tracks || [])
    .map(function (t) {
      return {
        name: t.name || '未知曲目',
        artist: t.artist || '',
        url: trackUrl(t),
        cover: t.cover || '',
        lrc: t.lrc || ''
      };
    })
    .filter(function (t) {
      return !!t.url;
    });

  if (!audio.length) return;

  var POS_KEY = 'ka-music-panel-pos-v1';
  var COLLAPSE_KEY = 'ka-music-panel-collapsed-v1';
  var STATE_KEY = 'ka-music-state-v1';

  var ICON_MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7.2h10v1.6H3z"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.2 3h1.6v4.2H13v1.6H8.8V13H7.2V8.8H3V7.2h4.2z"/></svg>';
  var ICON_LIST = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h2v2H2zm4 0h8v2H6zM2 7h2v2H2zm4 0h8v2H6zM2 10.5h2v2H2zm4 0h8v2H6z"/></svg>';

  /* Build the floating panel. */
  var panel = document.createElement('div');
  panel.className = 'mp-panel';
  panel.setAttribute('data-mp-collapsed', 'false');
  panel.setAttribute('data-mp-scheme', 'light');
  panel.innerHTML =
    '<div class="mp-handle">' +
      '<span class="mp-grip" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="mp-nowplaying"></span>' +
      '<span class="mp-tools">' +
        '<button type="button" class="mp-list-toggle" aria-label="显示或隐藏播放列表" title="播放列表"></button>' +
        '<button type="button" class="mp-collapse" aria-label="收起播放器" title="收起或展开"></button>' +
      '</span>' +
    '</div>' +
    '<div class="mp-body"></div>';
  document.body.appendChild(panel);
  window.__kaMusicPlayerMounted = true;

  var handle = panel.querySelector('.mp-handle');
  var bodyBox = panel.querySelector('.mp-body');
  var nowPlaying = panel.querySelector('.mp-nowplaying');
  var collapseBtn = panel.querySelector('.mp-collapse');
  var listBtn = panel.querySelector('.mp-list-toggle');
  collapseBtn.innerHTML = ICON_MINUS;
  listBtn.innerHTML = ICON_LIST;

  /* Freeze page selection while dragging inside the player. */
  var hasPointerEvents = 'PointerEvent' in window;
  // Start selection isolation.
  function beginSelectionIsolation(e) {
    if (e.button && e.button !== 0) return;
    document.documentElement.setAttribute('data-mp-selecting', 'true');
  }
  // End selection isolation.
  function endSelectionIsolation() {
    document.documentElement.removeAttribute('data-mp-selecting');
  }
  panel.addEventListener(hasPointerEvents ? 'pointerdown' : 'mousedown', beginSelectionIsolation, true);
  window.addEventListener(hasPointerEvents ? 'pointerup' : 'mouseup', endSelectionIsolation, true);
  window.addEventListener('pointercancel', endSelectionIsolation, true);
  window.addEventListener('blur', endSelectionIsolation);
  window.addEventListener('pagehide', endSelectionIsolation);
  document.addEventListener('pjax:complete', endSelectionIsolation);

  // Update the panel theme from the site.
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
    panel.setAttribute('data-mp-scheme', dark ? 'dark' : 'light');
  }
  detectScheme();

  try {
    var observer = new MutationObserver(detectScheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-default-appearance'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* Ignore missing MutationObserver. */ }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', detectScheme);
    } catch (e) { /* Ignore. */ }
  }

  // Read the theme accent color.
  function accentColor() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--color-primary-500').trim();
      if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v)) return 'rgb(' + v + ')';
    } catch (e) { /* Ignore. */ }
    return '#4a9ef0';
  }

  /* Create APlayer. */
  var mount = document.createElement('div');
  bodyBox.appendChild(mount);

  var hasLrc = audio.some(function (t) { return !!t.lrc; });
  var ap = new APlayer({
    container: mount,
    audio: audio,
    fixed: false,
    mini: false,
    autoplay: opt('autoplay') === true,
    theme: accentColor(),
    loop: opt('loop'),
    order: opt('order'),
    preload: opt('preload'),
    volume: opt('volume'),
    listFolded: opt('listfolded') !== false,
    listMaxHeight: opt('listmaxheight'),
    mutex: true,
    lrcType: hasLrc ? 3 : 0,
    storageName: opt('storagename')
  });
  window.__kaMusicPlayer = ap;

  // Update the collapsed title and artist.
  function updateNowPlaying(index) {
    try {
      var i = typeof index === 'number' ? index : ap.list.index;
      var cur = ap.list.audios[i] || {};
      nowPlaying.textContent = cur.name ? (cur.name + (cur.artist ? ' · ' + cur.artist : '')) : '';
    } catch (e) { /* Ignore. */ }
  }
  ap.on('listswitch', function (e) {
    // APlayer fires listswitch before updating list.index.
    updateNowPlaying(e && typeof e.index === 'number' ? e.index : ap.list.index);
  });
  updateNowPlaying();

  /* Collapse and expand. */
  // Collapse or expand the panel.
  function setCollapsed(collapsed, persist) {
    panel.setAttribute('data-mp-collapsed', collapsed ? 'true' : 'false');
    collapseBtn.innerHTML = collapsed ? ICON_PLUS : ICON_MINUS;
    collapseBtn.setAttribute('aria-label', collapsed ? '展开播放器' : '收起播放器');
    if (persist) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* Ignore. */ }
    }
    if (!collapsed) clampCurrentPosition(true);
  }

  // Allow other widgets to expand the panel.
  window.__kaMusicPlayerExpand = function () {
    setCollapsed(false, true);
  };

  collapseBtn.addEventListener('click', function () {
    setCollapsed(panel.getAttribute('data-mp-collapsed') !== 'true', true);
  });

  listBtn.addEventListener('click', function () {
    try { ap.list.toggle(); } catch (e) { /* Ignore. */ }
  });

  var collapsedSaved = null;
  try { collapsedSaved = localStorage.getItem(COLLAPSE_KEY); } catch (e) { collapsedSaved = null; }
  setCollapsed(collapsedSaved === null ? opt('startcollapsed') === true : collapsedSaved === '1', false);

  /* Drag position and persistence. */
  var dragging = false;
  var grabX = 0;
  var grabY = 0;

  // Check the mobile breakpoint.
  function isMobile() {
    return window.innerWidth < 640;
  }

  // Clamp and apply the panel position.
  function applyPosition(left, top, persist) {
    var r = panel.getBoundingClientRect();
    var maxLeft = Math.max(8, window.innerWidth - r.width - 8);
    var maxTop = Math.max(8, window.innerHeight - r.height - 8);
    var x = Math.min(Math.max(8, left), maxLeft);
    var y = Math.min(Math.max(8, top), maxTop);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.bottom = 'auto';
    if (persist) {
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: x, top: y })); } catch (e) { /* Ignore. */ }
    }
  }

  // Keep the panel inside the viewport.
  function clampCurrentPosition(persist) {
    if (isMobile() || opt('draggable') === false) return;
    var left = parseFloat(panel.style.left);
    var top = parseFloat(panel.style.top);
    if (isNaN(left) || isNaN(top)) return;
    applyPosition(left, top, persist);
  }

  // Restore the saved panel position.
  function restorePosition() {
    if (isMobile() || opt('draggable') === false) return;
    var saved;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      applyPosition(saved.left, saved.top, false);
    }
  }

  if (opt('draggable') !== false) {
    handle.addEventListener('pointerdown', function (e) {
      if (isMobile() || e.target.closest('.mp-tools')) return;
      var r = panel.getBoundingClientRect();
      dragging = true;
      grabX = e.clientX - r.left;
      grabY = e.clientY - r.top;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* Ignore. */ }
      e.preventDefault();
    });

    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      applyPosition(e.clientX - grabX, e.clientY - grabY, false);
    });

    // Finish dragging and persist the position.
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      var r = panel.getBoundingClientRect();
      applyPosition(r.left, r.top, true);
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* Ignore. */ }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  } else {
    handle.style.cursor = 'default';
  }

  window.addEventListener('resize', function () {
    if (isMobile()) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.bottom = '';
    } else {
      clampCurrentPosition(true);
    }
  });

  restorePosition();

  /* Playback state persistence. */
  var restoring = false;
  var stopped = false;
  var failedTracks = {};
  var lastTime = 0;

  // currentTime is 0 before metadata loads; keep the last known time.
  // Return the last known playback time.
  function safeCurrentTime() {
    try {
      var t = ap.audio.currentTime || 0;
      if (t > 0) lastTime = t;
    } catch (e) { /* Ignore. */ }
    return lastTime;
  }

  // Save track index, time, and pause state.
  function saveState(forceZero, index) {
    if (restoring || stopped) return;
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        i: typeof index === 'number' ? index : ap.list.index,
        t: forceZero ? 0 : safeCurrentTime(),
        p: ap.paused,
        ts: Date.now()
      }));
    } catch (e) { /* Ignore. */ }
  }

  var lastSave = 0;
  ap.on('timeupdate', function () {
    if (!stopped) delete failedTracks[ap.list.index];
    var now = Date.now();
    if (now - lastSave > 2000) {
      lastSave = now;
      saveState(false);
    }
  });
  ap.on('play', function () {
    // Remove a track from the failed set once it can play.
    delete failedTracks[ap.list.index];
    saveState(false);
  });
  ap.on('pause', function () { saveState(false); });
  ap.on('listswitch', function (e) {
    // Do not carry the previous track's time into the new one.
    lastTime = 0;
    saveState(true, e && typeof e.index === 'number' ? e.index : ap.list.index);
  });
  ap.on('seeked', function () {
    // Allow seeking back to 0 without keeping stale progress.
    lastTime = ap.audio.currentTime || 0;
    saveState(false);
  });
  window.addEventListener('pagehide', function () { saveState(false); });
  window.addEventListener('beforeunload', function () { saveState(false); });

  // Restore saved playback state.
  function restoreState() {
    if (opt('resumeacrosspages') === false) return;
    var st;
    try { st = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) { st = null; }
    if (!st || typeof st.i !== 'number' || !st.ts || Date.now() - st.ts > 6 * 3600 * 1000) return;
    if (st.i < 0 || st.i >= audio.length) return;

    restoring = true;
    lastTime = st.t > 0 ? st.t : 0;

    if (st.i !== 0) {
      ap.list.switch(st.i);
      // listswitch clears lastTime; put the saved time back.
      lastTime = st.t > 0 ? st.t : 0;
    }

    // Write currentTime directly; APlayer.seek() clamps before duration is known.
    // Apply the saved seek time.
    function applyTime() {
      if (!(st.t > 1)) return;
      lastTime = st.t;
      try {
        ap.audio.currentTime = st.t;
      } catch (e) {
        try { ap.seek(st.t); } catch (err) { /* Ignore. */ }
      }
    }

    setTimeout(function () {
      applyTime();
      if (st.p) {
        restoring = false;
        saveState(false);
        return;
      }

      ap.play();
      setTimeout(function () {
        // APlayer swallows the autoplay rejection; check paused instead.
        restoring = false;
        if (!ap.paused) {
          saveState(false);
          return;
        }
        try {
          ap.audio.preload = 'auto';
          ap.audio.load();
        } catch (e) { /* Ignore. */ }
        ap.audio.addEventListener('loadedmetadata', applyTime, { once: true });
        ap.notice('已恢复上次进度，点一下播放继续', 3200);
        saveState(false);
      }, 600);
    }, 120);

    setTimeout(updateNowPlaying, 300);
  }

  /* Error handling. */
  // Replace the player after every track has failed.
  function stopAllFailed() {
    stopped = true;
    try { ap.pause(); } catch (e) { /* Ignore. */ }
    // Stop APlayer's delayed automatic skipForward.
    if (typeof ap.skipForward === 'function') {
      ap.skipForward = function () { /* stopped */ };
    }
    bodyBox.innerHTML =
      '<div class="mp-dead">' +
      '<strong>歌单里的曲目当前都放不了</strong>' +
      '多半是它们已下架或需要会员——这个方案只能播放「免费档」歌曲。' +
      '可以检查 <code>data/music.yaml</code> 里的歌曲 ID 后换几首试试。' +
      '</div>';
    try { ap.destroy(); } catch (e) { /* Ignore. */ }
    window.__kaMusicPlayer = null;
    try { document.dispatchEvent(new Event('ka:music-dead')); } catch (e) { /* Ignore. */ }
  }

  // Track unique failed tracks; stop only after all fail.
  ap.on('error', function () {
    if (stopped) return;
    var idx = ap.list.index;
    if (typeof idx === 'number' && idx >= 0) failedTracks[idx] = true;

    if (Object.keys(failedTracks).length >= audio.length) {
      stopAllFailed();
      return;
    }

    ap.notice('这首暂时放不了，正在尝试下一首', 2500);
  });

  restoreState();
})();
