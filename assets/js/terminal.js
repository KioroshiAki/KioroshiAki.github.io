// Site terminal overlay: command shell, virtual filesystem, and seccomp easter egg.
(function () {
  'use strict';

  if (window.__kaTerminalMounted) return;
  var cfgEl = document.getElementById('ka-terminal-config');
  var cfg = {};
  try {
    cfg = JSON.parse((cfgEl && cfgEl.textContent) || '{}');
  } catch (e) {
    cfg = {};
  }
  var MAX_LINES = parseInt(cfg.historymax, 10) || 300;
  var DUCK_TO = parseFloat(cfg.duckvolume);
  if (isNaN(DUCK_TO)) DUCK_TO = 0.2;

  /* Build the overlay DOM. */
  var scope = document.createElement('div');
  scope.className = 'tm-scope';
  scope.setAttribute('data-tm-scheme', 'dark');
  scope.innerHTML = [
    '<div class="tm-veil" data-open="false" aria-hidden="true"></div>',
    '<div class="tm-log" data-open="false" aria-live="polite"></div>',
    '<div class="tm-scrollbar" data-open="false" aria-hidden="true"><i></i></div>',
    '<form class="tm-bar" data-open="false" autocomplete="off">',
      '<label class="tm-prompt" data-root="false" aria-hidden="true">$</label>',
      '<input class="tm-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command input">',
      '<button class="tm-run" type="submit">Run <kbd>\u21b5</kbd></button>',
    '</form>',
    '<button class="tm-launcher" type="button" aria-label="Toggle terminal">',
      '<span class="tm-ico" aria-hidden="true">&gt;_</span>',
      '<kbd class="tm-launcher-key">Ctrl+`</kbd>',
    '</button>'
  ].join('');
  document.body.appendChild(scope);
  window.__kaTerminalMounted = true;

  var veil = scope.querySelector('.tm-veil');
  var log = scope.querySelector('.tm-log');
  var sb = scope.querySelector('.tm-scrollbar');
  var sbThumb = sb ? sb.querySelector('i') : null;
  var bar = scope.querySelector('.tm-bar');
  var promptEl = scope.querySelector('.tm-prompt');
  var input = scope.querySelector('.tm-input');
  var launcher = scope.querySelector('.tm-launcher');
  var launcherKey = scope.querySelector('.tm-launcher-key');

  var open = false;
  var root = false;
  var HOME = '/home/ka';
  var cwd = HOME;
  var history = [];
  var histIndex = -1;
  var prevOverflow = '';

  // Update the overlay theme from the page.
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
          var p = m[1].split(',').map(function (x) { return parseFloat(x); });
          if (p.length >= 3) dark = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 < 0.5;
        }
      }
    } catch (e) { /* Ignore theme detection errors. */ }
    scope.setAttribute('data-tm-scheme', dark ? 'dark' : 'light');
  }
  detectScheme();
  try {
    var mo = new MutationObserver(detectScheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* Ignore observer errors. */ }

  /* Duck the player while the terminal is open. */
  var audio = (function () {
    var savedVolume = null;
    var savedMuted = false;
    var duckTarget = DUCK_TO;
    var ducked = false;

    // Get the global player.
    function player() { return window.__kaMusicPlayer || null; }

    // Lower the player volume and preserve mute state.
    function duckOn() {
      var ap = player();
      if (!ap || typeof ap.volume !== 'function' || !ap.audio) return false;
      if (ducked) return true;
      try {
        savedVolume = ap.audio.volume;
        savedMuted = !!ap.audio.muted;
        // Do not raise a lower user volume.
        duckTarget = Math.min(savedVolume, DUCK_TO);
        ducked = true;
        ap.volume(duckTarget, true);       /* Do not persist this change. */
        // APlayer.volume() unmutes; restore the user's mute state.
        ap.audio.muted = savedMuted;
        return true;
      } catch (e) { return false; }
    }

    // Restore the previous volume and mute state.
    function duckOff() {
      var ap = player();
      if (!ducked) return;
      if (!ap || !ap.audio) {
        savedVolume = null;
        savedMuted = false;
        duckTarget = DUCK_TO;
        ducked = false;
        return;
      }
      try {
        var currentMuted = !!ap.audio.muted;
        // Keep user volume changes made while the terminal was open.
        if (Math.abs(ap.audio.volume - duckTarget) < 0.001) ap.volume(savedVolume, true);
        ap.audio.muted = currentMuted;
      } catch (e) { /* Ignore volume restore errors. */ }
      savedVolume = null;
      savedMuted = false;
      duckTarget = DUCK_TO;
      ducked = false;
    }

    return {
      on: duckOn,
      off: duckOff,
      // Return the current ducking state.
      status: function () {
        return { duckTo: duckTarget, savedVolume: savedVolume, savedMuted: savedMuted, ducked: ducked };
      }
    };
  })();
  /* Virtual filesystem. / is the root; ~ maps to /home/ka (content/). */
  var FLAG_TEXT = 'KioAki{0h_my_g0d_u_fxxked_my_S3CC0MP!!!!!}';
  var RUN_SH = '#!/bin/sh\n# Publish this article (really, do not ask).\nset -eu\nexec "$BLOG_ROOT/tools/publish" "$(dirname -- "$0")"\n';
  var CHAL_README = [
    'seccomp-please — pwn, 400 pts, TSCTF-J 2026 (leftover)',
    '',
    'the flag is in this directory. carrying it out is the whole puzzle:',
    'this box has a seccomp filter attached, and the supervisor living in',
    '~/etc is what actually decides whether a syscall gets through.',
    '',
    'you do not get the supervisor\'s source -- it prints its own rules if',
    'you ask it nicely.',
    '',
    'the rest of the box is a stock ubuntu image: "pkg list" shows what is',
    'installed. do not expect the usual tools to behave here.'
  ].join('\n');

  var VFS = (function () {
    var root = { name: '/', kind: 'dir', path: '/', children: {} };
    var homeSeg = 'home/ka';

    // Get or create a directory.
    function dir(p) {
      var node = root;
      String(p).split('/').filter(Boolean).forEach(function (seg) {
        if (!node.children[seg]) {
          node.children[seg] = { name: seg, kind: 'dir', path: node.path + '/' + seg, children: {} };
        }
        node = node.children[seg];
      });
      return node;
    }
    // Add a file to a directory.
    function file(d, name, data, size) {
      var node = { name: name, kind: 'file', data: String(data == null ? '' : data) };
      if (size != null) node.size = size;          /* Fake byte count for ls -l. */
      d.children[name] = node;
    }
    // Render a fake index.md from the site map entry.
    function frontMatter(pg) {
      var external = pg.u ? String(pg.u).replace(/"/g, '\\"') : '';
      return '---\ntitle: "' + (pg.t || '') + '"\ndate: ' + (pg.d || '') + '\n' +
             (external ? 'externalUrl: "' + external + '"\n' : '') +
             '---\n\n' + (pg.s || '');
    }

    var el = document.getElementById('ka-site-map');
    var map = {};
    try { map = JSON.parse((el && el.textContent) || '{}') || {}; } catch (e) { map = {}; }
    var pages = map.pages || [];
    var sections = map.sections || [];

    // Mount a page or section bundle into the VFS.
    function mountBundle(entry, isArticle) {
      var segs = String(entry.p || '').split('/').filter(Boolean);
      if (!segs.length) return;
      var base = homeSeg + '/' + segs.join('/');
      var d = dir(base);
      var meta = {
        title: entry.t || segs[segs.length - 1],
        url: entry.u || entry.p,
        external: !!entry.u,
        date: entry.d || ''
      };
      if (isArticle) d.article = meta;
      else d.section = meta;
      file(d, 'index.md', frontMatter(entry));
      (entry.f || []).forEach(function (name) {
        var parts = String(name).split('/');
        var holder = parts.length > 1 ? dir(base + '/' + parts.slice(0, -1).join('/')) : d;
        file(holder, parts[parts.length - 1], '(binary)');
      });
      if (isArticle) file(d, 'run.sh', RUN_SH);
    }

    pages.forEach(function (pg) { mountBundle(pg, true); });
    sections.forEach(function (sec) { mountBundle(sec, false); });

    var etc = dir(homeSeg + '/etc');
    file(etc, 'supervisor', '(executable)', 18744);
    file(etc, 'filter.bpf', '(compiled seccomp filter)', 336);
    file(etc, 'remind_to_delete_log_arg_and_this.txt', '');

    var chal = dir(homeSeg + '/challenge');
    file(chal, 'README', CHAL_README);
    file(chal, 'flag', FLAG_TEXT);

    return {
      // Look up a path in the VFS.
      get: function (p) {
        var node = root, ok = true;
        String(normPath(p)).split('/').filter(Boolean).forEach(function (seg) {
          if (!ok || !node.children || !node.children[seg]) { ok = false; return; }
          node = node.children[seg];
        });
        return ok ? node : null;
      }
    };
  })();

  // Resolve the current page to a content directory.
  function cwdForLocation() {
    var path = window.location.pathname || '/';
    try { path = decodeURIComponent(path); } catch (e) { /* Ignore decode errors. */ }
    path = path.replace(/\/+/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    if (!path || path === '/') return HOME;

    var parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 2] === 'page' && /^\d+$/.test(parts[parts.length - 1])) {
      parts = parts.slice(0, -2);
    }
    // Map series taxonomy pages to the matching posts directory.
    if (parts[0] === 'series') {
      var seriesPath = HOME + '/posts' + (parts.length > 1 ? '/' + parts.slice(1).join('/') : '');
      if (VFS.get(seriesPath)) return seriesPath;
    }
    // Other article index pages fall back to ~/posts.
    if (parts[0] === 'series' || parts[0] === 'categories' || parts[0] === 'tags' || parts[0] === 'authors') {
      var postsPath = HOME + '/posts';
      if (VFS.get(postsPath)) return postsPath;
    }
    while (parts.length) {
      var candidate = HOME + '/' + parts.join('/');
      if (VFS.get(candidate)) return candidate;
      parts.pop();
    }
    return HOME;
  }
  cwd = cwdForLocation();

  /* Output helpers. */
  // Pad text to a fixed width.
  function padEnd(s, n) {
    s = String(s);
    return s + new Array(Math.max(1, n - s.length + 1)).join(' ');
  }
  // Escape HTML.
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Append one rendered line.
  function pushLine(html, cls) {
    var line = document.createElement('div');
    line.className = 'tm-line ' + (cls || 'tm-ok');
    line.innerHTML = html;
    // Keep DOM order for text selection.
    log.appendChild(line);
    while (log.childElementCount > MAX_LINES) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    updateScrollbar();
  }
  // Print escaped text.
  function print(text, cls) { pushLine(esc(text), cls); }
  // Print the prompt line.
  function printPrompt(cmd) {
    pushLine('<span class="tm-path">' + esc(displayPath(cwd)) + '</span> <b>&gt;</b> ' + esc(cmd), 'tm-cmd');
  }
  // Update the prompt and placeholder.
  function updatePrompt() {
    promptEl.textContent = root ? '#' : '$';
    promptEl.setAttribute('data-root', root ? 'true' : 'false');
    input.placeholder = displayPath(cwd);
  }

  /* Custom scrollbar. */
  // Update the scrollbar thumb.
  function updateScrollbar() {
    if (!sb || !sbThumb) return;
    var h = log.clientHeight;
    var sh = log.scrollHeight;
    if (sh <= h + 2) { sb.style.opacity = '0'; return; }
    var thumbH = Math.max(24, Math.round(h * h / sh));
    var maxPos = h - thumbH;
    var pos = Math.round((log.scrollTop / (sh - h)) * maxPos);
    sbThumb.style.height = thumbH + 'px';
    sbThumb.style.transform = 'translateY(' + pos + 'px)';
    sb.style.opacity = '1';
  }
  log.addEventListener('scroll', updateScrollbar, { passive: true });

  /* Open and close. */
  // Open or close the terminal.
  function setOpen(next) {
    open = next;
    var v = next ? 'true' : 'false';
    veil.setAttribute('data-open', v);
    log.setAttribute('data-open', v);
    if (sb) sb.setAttribute('data-open', v);
    bar.setAttribute('data-open', v);
    document.documentElement.setAttribute('data-tm-open', v);   /* Hide the player panel. */
    launcherKey.textContent = next ? 'Esc' : 'Ctrl+`';
    launcher.setAttribute('aria-label', next ? 'Close terminal (Esc)' : 'Open terminal (Ctrl+`)');
    if (next) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      audio.on();
      input.focus();
      log.scrollTop = log.scrollHeight;
      updateScrollbar();
    } else {
      input.blur();
      audio.off();
      document.body.style.overflow = prevOverflow;
    }
  }
  // Toggle the terminal.
  function toggle() { setOpen(!open); }

  // Use PJAX for internal links and a new tab for external links.
  function go(url, external) {
    setOpen(false);
    var a = document.createElement('a');
    a.href = url;
    var sameSite = a.protocol === window.location.protocol && a.host === window.location.host;

    // External pages open in a new tab.
    if (external || !sameSite) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      if (a.parentNode) a.parentNode.removeChild(a);
      return;
    }

    // Dynamic anchors have no PJAX listener.
    if (typeof window.__kaPjaxNavigate === 'function' && window.__kaPjaxNavigate(a.href)) return;
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
    if (a.parentNode) a.parentNode.removeChild(a);
  }
  /* Path helpers. */
  // Format a canonical path for display.
  function displayPath(p) {
    p = String(p == null ? HOME : p);
    if (p === HOME) return '~';
    if (p.indexOf(HOME + '/') === 0) return '~' + p.slice(HOME.length);
    return p || '/';
  }
  // Normalize a path to an absolute VFS path.
  function normPath(p) {
    var s = String(p == null ? '' : p);
    if (s === '~') s = HOME;
    else if (s.indexOf('~/') === 0) s = HOME + s.slice(1);
    if (s.charAt(0) !== '/') s = '/' + s;
    var out = [];
    s.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') { if (out.length) out.pop(); }
      else out.push(seg);
    });
    return '/' + out.join('/');
  }
  // Resolve a user path against the current directory.
  function resolvePath(name) {
    if (name == null || name === '') return cwd;
    var s = String(name).trim();
    if (s === '~') return HOME;
    if (s.indexOf('~/') === 0) return normPath(HOME + s.slice(1));
    if (s.charAt(0) === '/') return normPath(s);
    return normPath(cwd + '/' + s);
  }
  /* Sandbox directories. */
  // Check whether a path is inside ~/etc or ~/challenge.
  function inSandbox(p) {
    p = String(p);
    return p === HOME + '/etc' || p === HOME + '/challenge' ||
           p.indexOf(HOME + '/etc/') === 0 || p.indexOf(HOME + '/challenge/') === 0;
  }

  var SHELL_PID = 1402;

  // Draw a cow speech bubble.
  function cowArt(text) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var buf = '';
      para.split(/\s+/).forEach(function (w) {
        if (buf && (buf + ' ' + w).length > 36) { lines.push(buf); buf = w; }
        else { buf = buf ? buf + ' ' + w : w; }
      });
      lines.push(buf);
    });
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, l.length); });
    var out = [' _' + new Array(w + 2).join('_') + '_'];
    if (lines.length === 1) {
      out.push('< ' + lines[0] + new Array(w - lines[0].length + 1).join(' ') + ' >');
    } else {
      lines.forEach(function (l, i) {
        var pad = new Array(w - l.length + 1).join(' ');
        var mark = i === 0 ? '/' : (i === lines.length - 1 ? '\\' : '|');
        var close = i === 0 ? '\\' : (i === lines.length - 1 ? '/' : '|');
        out.push(mark + ' ' + l + pad + ' ' + close);
      });
    }
    out.push(' -' + new Array(w + 2).join('-') + '-');
    out.push('        \\   ^__^');
    out.push('         \\  (oo)\\_______');
    out.push('            (__)\\       )\\/\\');
    out.push('                ||----w |');
    out.push('                ||     ||');
    return out.join('\n');
  }

  // Sandbox runtime for the seccomp easter egg.
  var RUNTIME = (function () {
    var attached = false;
    var logging = true;
    var SUP_PID = 1401;
    var pidSeed = 1403;

    /* First matching rule wins; no match allows. */
    var RULES = [
      { prog: 'cat',    sc: 'write', when: 'fd target is a tty',      act: 'deny' },
      { prog: 'cowsay', sc: 'read',  when: 'fd target is not a pipe', act: 'deny' },
      { prog: 'supervisor', trusted: true, act: 'allow' }
    ];

    // Describe a tty file descriptor.
    function ttyFd() { return { kind: 'tty', name: '/dev/pts/0' }; }
    // Describe a pipe file descriptor.
    function pipeFd(v) { return { kind: 'pipe', name: v }; }
    // Describe a file descriptor.
    function fileFd(p) { return { kind: 'file', name: p }; }

    // Check whether a rule condition matches the target fd.
    function hits(when, fd) {
      if (when === 'fd target is a tty') return fd.kind === 'tty';
      if (when === 'fd target is not a pipe') return fd.kind !== 'pipe';
      return false;
    }

    // Apply the first matching rule.
    function judge(prog, nr, fd) {
      for (var i = 0; i < RULES.length; i++) {
        var r = RULES[i];
        if (r.prog !== prog) continue;
        if (r.trusted) return { act: 'allow', why: 'rule #' + i + ': ' + prog + ' is trusted' };
        if (r.sc !== nr) continue;
        if (hits(r.when, fd)) {
          return { act: r.act, why: 'rule #' + i + ': ' + prog + ' ' + nr + ', ' + r.when };
        }
        return { act: 'allow', why: 'rule #' + i + ': condition not met' };
      }
      return { act: 'allow', why: 'no rule matched' };
    }

    // Dump the rule table.
    function rulesDump() {
      var out = ['rules (first match wins; prog = basename of /proc/<pid>/exe):'];
      RULES.forEach(function (r, i) {
        out.push(r.trusted
          ? '  [' + i + '] prog=' + padEnd(r.prog, 11) + padEnd('(trusted)', 41) + '-> ' + r.act
          : '  [' + i + '] prog=' + padEnd(r.prog, 11) + 'sc=' + padEnd(r.sc, 6) +
            'when=' + padEnd(r.when, 27) + '-> ' + r.act);
      });
      out.push(padEnd('  [no match]', 63) + '-> allow');
      out.push('note: only read and write are notified to the supervisor.');
      return out.join('\n');
    }

    // Gate read/write syscalls; log only when a process is denied.
    function sys(self, nr, fd) {
      if (!attached || (nr !== 'read' && nr !== 'write')) return true;
      var target = (fd && fd.target) || ttyFd();
      var v = judge(self.prog, nr, target);
      if (v.act === 'allow') return true;
      self.killed = true;
      if (logging) {
        print('[filter]     ' + self.prog + '(' + self.pid + ') ' + nr +
              '(fd ' + (fd ? fd.nr : '?') + ' → ' + target.name + ') → USER_NOTIF', 'tm-dim');
        print('[supervisor] deny  : ' + v.why + ' → SIGSYS', 'tm-err');
        print('[shell]      ' + self.prog + ': killed by SIGSYS (bad system call)', 'tm-err');
        print('[supervisor] hint: type "silent" to mute; type "--log /dev/pts/0" to restore this log', 'tm-dim');
      }
      return false;
    }

    var PROGRAMS = {
      // cat: read a file or stdin.
      cat: function (argv, self, io) {
        var files = argv.filter(function (a) { return a.charAt(0) !== '-'; });
        if (!files.length) {
          // Read from stdin.
          if (!sys(self, 'read', { nr: 0, target: io.in })) return;
          var fromPipe = io.read();
          if (!sys(self, 'write', { nr: 1, target: io.out })) return;
          io.write(fromPipe);
          return;
        }
        var chunks = [];
        for (var i = 0; i < files.length; i++) {
          var p = resolvePath(files[i]), node = VFS.get(p);
          if (!node) { io.fail('cat: ' + files[i] + ': No such file or directory'); return; }
          if (node.kind === 'dir') { io.fail('cat: ' + files[i] + ': Is a directory'); return; }
          if (!sys(self, 'read', { nr: 3, target: fileFd(p) })) return;
          chunks.push(node.data);
        }
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write(chunks.join(''));
      },
      // cowsay: print text in a cow bubble.
      cowsay: function (argv, self, io) {
        var text = argv.join(' ').trim();
        if (!text) {
          if (!sys(self, 'read', { nr: 0, target: io.in })) return;
          text = io.read();
        }
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write(cowArt(String(text).replace(/\n+$/, '') || '(nothing on stdin)'));
      },
      // ls: list a VFS directory.
      ls: function (argv, self, io) {
        var long = false, rest = [];
        argv.forEach(function (a) {
          if (a.charAt(0) === '-' && a.length > 1) { if (a.indexOf('l') >= 0) long = true; }
          else rest.push(a);
        });
        var arg = rest[0];
        var p = resolvePath(arg || '');
        var node = VFS.get(p);
        if (!node) { io.fail('ls: cannot access ' + (arg || p) + ': No such file or directory'); return; }
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        if (node.kind === 'file') { io.write(node.name); return; }
        var names = Object.keys(node.children).sort();
        if (long || io.out.kind !== 'tty') {
          io.write(names.map(function (n) {
            var kid = node.children[n], dir = kid.kind === 'dir';
            var size = dir ? 4096 : (kid.size != null ? kid.size : String(kid.data || '').length);
            var meta = dir && (kid.article || kid.section);
            var date = (meta && meta.date) || '2026-01-01';
            return (dir ? 'drwxr-xr-x' : '-rw-r--r--') + ' 1 ka ka ' +
                   padEnd(size, 5) + ' ' + date + ' ' + n + (dir ? '/' : '');
          }).join('\n'));
        } else {
          io.write(names.map(function (n) {
            return node.children[n].kind === 'dir' ? n + '/' : n;
          }).join('  '));
        }
      },
      // ps: list the fake processes.
      ps: function (argv, self, io) {
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        var supArgs = logging ? '--log /dev/pts/0' : '--silent';
        io.write('  PID TTY          TIME CMD\n' +
                 padEnd(SUP_PID, 6) + ' pts/0    00:00:00 supervisor ' + supArgs + '\n' +
                 padEnd(SHELL_PID, 6) + ' pts/0    00:00:00 -sh');
      },
      // echo: print arguments.
      echo: function (argv, self, io) {
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write(argv.join(' '));
      },
      // whoami: print the current user.
      whoami: function (argv, self, io) {
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write(root ? 'root' : 'ka');
      },
      // id: print uid and gid.
      id: function (argv, self, io) {
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write(root ? 'uid=0(root) gid=0(root) groups=0(root)'
                      : 'uid=1000(ka) gid=1000(ka) groups=1000(ka),27(sudo)');
      },
      // uname: print a fake kernel string.
      uname: function (argv, self, io) {
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        io.write('Linux ka-srv 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux');
      },
      // seccomp-tools: show the attached filter.
      'seccomp-tools': function (argv, self, io) {
        var sub = argv[0];
        if (!sub) { print('usage: seccomp-tools dump|disasm|asm', 'tm-dim'); return; }
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        if (sub !== 'dump') {
          io.write('seccomp-tools: ' + sub + ': this build only ships "dump"');
          return;
        }
        if (!attached) {
          io.write('attached: no  (nothing is filtering this shell right now)');
          return;
        }
        io.write(
          'attached: yes   listener: supervisor (pid ' + SUP_PID + ')   action: USER_NOTIF\n' +
          'notified syscalls: read, write      everything else: ALLOW\n' +
          '\n' +
          ' line  CODE  JT   JF      K\n' +
          '=================================\n' +
          ' 0000: 0x20 0x00 0x00 0x00000000  A = sys_number\n' +
          ' 0001: 0x15 0x01 0x00 0x00000000  if (A == read) goto 0003\n' +
          ' 0002: 0x15 0x00 0x01 0x00000001  if (A == write) goto 0003\n' +
          ' 0003: 0x06 0x00 0x00 0x7fc00000  return USER_NOTIF\n' +
          ' 0004: 0x06 0x00 0x00 0x7fff0000  return ALLOW\n' +
          '\n' +
          'the filter sees arguments by value: it knows "fd 1", not what fd 1\n' +
          'points at. deciding that is the listener\'s job (the supervisor).'
        );
      },
      // supervisor: inspect or control the referee.
      supervisor: function (argv, self, io) {
        var arg = argv[0];
        if (arg === '--print-rules') {
          if (!sys(self, 'write', { nr: 1, target: io.out })) return;
          io.write(rulesDump());
          return;
        }
        if (!sys(self, 'write', { nr: 1, target: io.out })) return;
        if (arg === '--silent' || arg === 'silent') {
          logging = false;
          io.write('supervisor: deny log muted; type "--log /dev/pts/0" to restore');
          return;
        }
        if (arg === '--log' || arg === '-v' || arg === '--verbose') {
          logging = true;
          io.write('supervisor: deny log -> ' + (argv[1] || '/dev/pts/0'));
          return;
        }
        io.write('usage: supervisor [--print-rules] [--silent] [--log FILE]\n' +
                 '\n' +
                 'the supervisor is the referee for the seccomp filter attached to this box:\n' +
                 'the filter only knows how to hand syscalls over, the verdicts live here.\n' +
                 '  --silent    mute deny logs (same as typing "silent")\n' +
                 '  --log FILE  restore deny logs (use /dev/pts/0 for this terminal)\n' +
                 'run with --print-rules to dump the rule table.');
      }
    };

    // Attach the sandbox filter.
    function attach() {
      if (attached) return;
      attached = true;
    }
    // Detach the sandbox filter.
    function detach() {
      if (!attached) return;
      attached = false;
    }

    /* Execute a command line. */
    function exec(line) {
      var body = String(line);
      if (body.indexOf('>') >= 0) {
        print('sh: >: this sandbox has no writable filesystem', 'tm-err');
        return;
      }
      var stdinFrom = null;
      body = body.replace(/(^|\s)<\s*(\S+)/g, function (m, sp, target) {
        stdinFrom = target;
        return sp;
      }).trim();

      var inFile = null;
      if (stdinFrom) {
        var fp = resolvePath(stdinFrom), fn = VFS.get(fp);
        if (!fn) { print('sh: ' + stdinFrom + ': No such file or directory', 'tm-err'); return; }
        if (fn.kind === 'dir') { print('sh: ' + stdinFrom + ': Is a directory', 'tm-err'); return; }
        inFile = { path: fp, text: fn.data };
      }

      var segs = body.split('|').map(function (s) { return s.trim(); }).filter(Boolean);
      var pipeName = 'pipe:[' + (1000 + Math.floor(Math.random() * 9000)) + ']';
      var carry = '';

      // Attach the filter when the command touches the sandbox.
      var want = inSandbox(cwd) || segs.some(function (s) {
        return s.split(/\s+/).some(function (t) {
          return t && t.charAt(0) !== '-' && inSandbox(resolvePath(t));
        });
      });
      if (want) attach(); else detach();

      for (var i = 0; i < segs.length; i++) {
        var parts = segs[i].split(/\s+/);
        var name = parts[0], argv = parts.slice(1);
        if (name.indexOf('/') >= 0) {
          // Resolve program paths through the VFS.
          var hit = VFS.get(resolvePath(name));
          if (!hit) { print('sh: ' + name + ': No such file or directory', 'tm-err'); return; }
          name = hit.name;
        }
        var prog = PROGRAMS[name];
        if (!prog) { print('sh: ' + name + ': command not found', 'tm-err'); return; }
        var isLast = (i === segs.length - 1);
        var io = {
          in: (i === 0 && inFile) ? fileFd(inFile.path) : (i === 0 ? ttyFd() : pipeFd(pipeName)),
          out: isLast ? ttyFd() : pipeFd(pipeName),
          // Read from the current input.
          read: function () {
            if (io.in.kind === 'file') return inFile.text;    /* Feed file contents to stdin. */
            var d = carry; carry = '';
            return d;
          },
          // Write to the current output.
          write: function (text) {
            if (io.out.kind === 'tty') print(text);
            else carry += text;
          },
          // Print an error.
          fail: function (msg) { print(msg, 'tm-err'); }
        };
        var self = { prog: name, pid: pidSeed++, killed: false };
        try { prog(argv, self, io); } catch (e) { print(name + ': ' + (e && e.message), 'tm-err'); }
        if (self.killed) return;
      }
    }

    return {
      exec: exec,
      attach: attach,
      detach: detach,
      // Check whether a program exists.
      has: function (name) { return !!PROGRAMS[name]; },
      // List program names.
      names: function () { return Object.keys(PROGRAMS); },
      // Enable or disable deny logs.
      setLogging: function (on) { logging = !!on; }
    };
  })();
  /* Command layer: builtins run directly; programs go through the sandbox. */
  var PROG_DESC = {
    cat: 'print a file',
    cowsay: 'the cow that talks back',
    echo: 'print its arguments',
    id: 'who am i, really',
    ls: 'list a directory',
    ps: 'list processes',
    'seccomp-tools': 'look at the filter',
    supervisor: 'the referee (lives in ~/etc)',
    uname: 'kernel version',
    whoami: 'current user'
  };

  /* Installed packages; two are used by the easter egg. */
  var PACKAGES = [
    { name: 'coreutils', ver: '8.32-4.1ubuntu1.2', bins: 'cat echo id ls pwd whoami',
      desc: 'GNU core utilities' },
    { name: 'cowsay', ver: '3.03+dfsg2-8', bins: 'cowsay',
      desc: 'configurable talking cow (reads stdin, talks on stdout)' },
    { name: 'procps', ver: '2:3.3.17-6ubuntu2', bins: 'ps',
      desc: 'process utilities' },
    { name: 'seccomp-tools', ver: '1.6.0-1', bins: 'seccomp-tools',
      desc: 'seccomp filter inspection (dump)' },
    { name: 'tsctf-supervisor', ver: '0.4-1', bins: 'supervisor',
      desc: 'per-syscall referee for the sandbox filter in ~/etc' }
  ];

  /* Shell builtins. */
  var commands = {
    // Show help.
    help: {
      desc: 'show this help',
      run: function (a) {
        if (a[0]) {
          if (commands[a[0]]) { print(a[0] + ': ' + commands[a[0]].desc + '   (shell builtin)', 'tm-dim'); return; }
          if (RUNTIME.has(a[0])) { print(a[0] + ': ' + (PROG_DESC[a[0]] || '') + '   (a program)', 'tm-dim'); return; }
          print('help: no entry for ' + a[0], 'tm-err');
          return;
        }
        print('shell builtins:', 'tm-dim');
        Object.keys(commands).sort().forEach(function (n) {
          print('  ' + padEnd(n, 10) + commands[n].desc, 'tm-dim');
        });
        print('installed programs:', 'tm-dim');
        RUNTIME.names().sort().forEach(function (n) {
          print('  ' + padEnd(n, 16) + (PROG_DESC[n] || ''), 'tm-dim');
        });
        print('"pkg list" shows which package each program came from.', 'tm-dim');
      }
    },
    // Inspect the fake package list.
    pkg: {
      desc: 'package manager — "pkg list" shows what is installed',
      run: function (a) {
        var sub = a[0] || 'list', arg = a[1] || '';
        if (sub === 'list' || sub === 'ls') {
          print('Installed packages (' + PACKAGES.length + '):');
          PACKAGES.forEach(function (p) {
            print('  ' + padEnd(p.name, 18) + padEnd(p.ver, 20) + p.bins, 'tm-dim');
          });
          print('run "pkg show <name>" for details.', 'tm-dim');
          return;
        }
        if (sub === 'show' || sub === 'info') {
          var one = PACKAGES.filter(function (p) { return p.name === arg; })[0];
          if (!one) { print('pkg: ' + (arg || '?') + ': package not installed', 'tm-err'); return; }
          print('name:     ' + one.name);
          print('version:  ' + one.ver);
          print('summary:  ' + one.desc);
          print('binaries: ' + one.bins);
          return;
        }
        if (sub === 'search') {
          var found = PACKAGES.filter(function (p) {
            return (p.name + ' ' + p.desc + ' ' + p.bins).indexOf(arg) >= 0;
          });
          if (!found.length) { print('pkg: no package matches "' + arg + '"', 'tm-dim'); return; }
          found.forEach(function (p) { print('  ' + padEnd(p.name, 18) + p.desc, 'tm-dim'); });
          return;
        }
        if (sub === 'install') {
          print('pkg: E: The filesystem is read-only — this box is a leftover from TSCTF-J 2026', 'tm-err');
          return;
        }
        print('usage: pkg list | show <name> | search <kw> | install <name>', 'tm-dim');
      }
    },
    // Change directory.
    cd: {
      desc: 'change directory (/ for root, ~ for home; ~/challenge, …)',
      run: function (a) {
        var target = a[0] || '~';
        var p = resolvePath(target);
        var node = VFS.get(p);
        if (!node) { print('cd: ' + target + ': No such file or directory', 'tm-err'); return; }
        if (node.kind === 'file') { print('cd: ' + target + ': Not a directory', 'tm-err'); return; }
        var from = cwd;
        cwd = p;
        updatePrompt();
        if (cwd === from) return;
        if (inSandbox(cwd)) RUNTIME.attach(); else RUNTIME.detach();
      }
    },
    // Print the current directory.
    pwd: {
      desc: 'print the current directory',
      run: function () { print(displayPath(cwd)); }
    },
    // Show command history.
    history: {
      desc: 'show command history',
      run: function () {
        history.forEach(function (h, i) { print('  ' + padEnd(i + 1, 5) + h, 'tm-dim'); });
      }
    },
    // Locate a command.
    which: {
      desc: 'locate a command',
      run: function (a) {
        var n = a[0];
        if (!n) { print('usage: which <command>', 'tm-dim'); return; }
        if (n === 'supervisor') { print('/home/ka/etc/supervisor   (not on $PATH)'); return; }
        if (RUNTIME.has(n)) { print('/usr/bin/' + n); return; }
        if (commands[n]) { print(n + ': shell builtin', 'tm-dim'); return; }
        print('which: no ' + n + ' in (/usr/local/bin:/usr/bin:/bin)', 'tm-err');
      }
    },
    // Describe a command.
    man: {
      desc: 'describe a command (same as "help <cmd>")',
      run: function (a) { commands.help.run(a); }
    },
    // Show the terminal's audio treatment.
    audio: {
      desc: 'show the audio treatment applied while the terminal is open',
      run: function () {
        var s = audio.status();
        print('while terminal is open: volume -> ' + s.duckTo, 'tm-dim');
        print('volume before summon: ' + (s.savedVolume === null ? '(not ducked yet)' : s.savedVolume), 'tm-dim');
        print('muted before summon: ' + (s.ducked ? String(s.savedMuted) : '(not ducked yet)'), 'tm-dim');
      }
    },
    // Mute supervisor deny logs.
    silent: {
      desc: 'mute supervisor deny logs',
      run: function () {
        RUNTIME.setLogging(false);
        print('supervisor: deny log muted; type "--log /dev/pts/0" to restore', 'tm-dim');
      }
    },
    // Switch to the root prompt.
    sudo: {
      desc: 'sudo su — switch to the red # prompt',
      run: function (a) {
        if (a[0] !== 'su' && a[0] !== '-i') { print('usage: sudo su', 'tm-err'); return; }
        if (root) { print('already root.', 'tm-dim'); return; }
        root = true;
        updatePrompt();
        print('prompt is now # — type exit to go back.', 'tm-note');
      }
    },
    // Clear the log.
    clear: { desc: 'clear the log', run: function () { log.textContent = ''; } },
    // Leave root or close the terminal.
    exit: {
      desc: 'leave root shell, or close the terminal',
      run: function () {
        if (root) { root = false; updatePrompt(); print('logout', 'tm-dim'); return; }
        setOpen(false);
      }
    }
  };

  // Run a command line.
  function run(raw) {
    var line = String(raw).trim();
    if (!line) return;
    printPrompt(line);
    history.push(line);
    histIndex = history.length;
    var argv = line.split(/\s+/);
    var name = argv[0];

    // Hidden log restore command.
    if (name === '--log') {
      RUNTIME.setLogging(true);
      print('supervisor: deny log -> ' + (argv[1] || '/dev/pts/0'), 'tm-dim');
      return;
    }

    // run.sh navigates to the article or external link.
    if (name === './run.sh' || name === 'run.sh') {
      var here = VFS.get(cwd);
      if (!here || !here.article) { print('run.sh: no publishable page here (' + displayPath(cwd) + ')', 'tm-err'); return; }
      print('run.sh: publishing "' + here.article.title + '" …', 'tm-dim');
      go(here.article.url, here.article.external);
      return;
    }
    try {
      if (commands[name]) { commands[name].run(argv.slice(1)); return; }
      // Let the runtime resolve paths.
      if (RUNTIME.has(name) || name.indexOf('/') >= 0) { RUNTIME.exec(line); return; }
    } catch (e) {
      print(name + ': ' + (e && e.message), 'tm-err');
      return;
    }
    print('sh: ' + name + ': command not found (try "help")', 'tm-err');
  }

  bar.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = '';
    run(v);
  });

  /* Tab completion. */
  // Complete commands and paths.
  function complete() {
    var raw = input.value;
    var cut = raw.search(/\S*$/);
    var head = raw.slice(0, cut);
    var frag = raw.slice(cut);

    if (head.trim() === '') {
      var pool = Object.keys(commands).concat(RUNTIME.names());
      var here = VFS.get(cwd);
      if (here && here.article) pool.push('./run.sh');
      pool = pool.sort();
      var hits = pool.filter(function (n) { return n.indexOf(frag) === 0; });
      if (hits.length === 1) { input.value = hits[0] + ' '; return; }
      if (hits.length > 1) { print(hits.join('   '), 'tm-dim'); return; }
      return;
    }

    var slash = frag.lastIndexOf('/');
    var base = slash >= 0 ? frag.slice(0, slash + 1) : '';
    var node = VFS.get(resolvePath(base || ''));
    if (!node || !node.children) return;
    var names = Object.keys(node.children).sort().map(function (n) {
      return base + n + (node.children[n].kind === 'dir' ? '/' : '');
    }).filter(function (n) { return n.indexOf(frag) === 0; });
    if (names.length === 1) {
      var last = names[0].charAt(names[0].length - 1);
      input.value = head + names[0] + (last === '/' ? '' : ' ');
    } else if (names.length > 1) {
      print(names.join('   '), 'tm-dim');
    }
  }

  /* Keyboard. */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.code === 'Backquote' || e.key === '`')) {
      e.preventDefault();
      toggle();
      return;
    }
    if (!open) return;
    // Keep keys away from theme handlers.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      histIndex = Math.max(0, histIndex - 1);
      input.value = history[histIndex] || '';
      return;
    }
    if (e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      histIndex = Math.min(history.length, histIndex + 1);
      input.value = history[histIndex] || '';
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    }
  }, true);

  /* Mouse. */
  launcher.addEventListener('click', function () { toggle(); });
  veil.addEventListener('mousedown', function () { setOpen(false); });

  /* Debug API. */
  window.__kaTerminal = {
    // Open the terminal.
    open: function () { setOpen(true); },
    // Close the terminal.
    close: function () { setOpen(false); },
    toggle: toggle,
    print: print,
    // Run a command from the console.
    run: run,
    commands: commands,
    go: go,
    audioStatus: audio.status,
    // Return terminal state.
    state: function () { return { open: open, root: root, cwd: displayPath(cwd), cwdRaw: cwd }; }
  };

  /* Initial state. */
  document.documentElement.setAttribute('data-tm-open', 'false');
  updatePrompt();
  print('type "help" for available commands — Tab completes.', 'tm-dim');
  window.addEventListener('resize', function () {
    updateScrollbar();
  });
  document.addEventListener('pjax:complete', function () {
    if (!open) {
      cwd = cwdForLocation();
      updatePrompt();
      if (inSandbox(cwd)) RUNTIME.attach(); else RUNTIME.detach();
    }
    setTimeout(updateScrollbar, 60);
  });
})();
