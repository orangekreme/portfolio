/* Arcade profile system — "SELECT PLAYER" splash, profile circle, and a
   friends-only passcode gate. Pure client-side presentation (no real auth);
   the active profile drives data-view on <html>, which CSS uses to show/hide
   content tagged with data-views="...". The pre-paint <head> script sets the
   initial profile to avoid a flash. */
(function () {
  /* Levels of connection. Internal ids stay recruiter/friend/self (used by
     data-views="..." gating across the site); only the labels are "Level N".
     Level 0 = recruiter (surface), Level 1 = friend, Level 2 = self (locked). */
  var PROFILES = [
    { id: 'recruiter', label: 'Level 0', letter: '0', sub: 'Surface level',     locked: false },
    { id: 'friend',    label: 'Level 1', letter: '1', sub: 'What friends know', locked: false },
    { id: 'self',      label: 'Level 2', letter: '2', sub: 'Password required', locked: true  }
  ];
  var IDS = PROFILES.map(function (p) { return p.id; });

  /* ===========================================================
     EDIT ME — the locked-profile passcodes (an easter egg, not real
     security). Each profile has its own question + answer. Matching is
     case-insensitive and ignores surrounding spaces.
     =========================================================== */
  var GATES = {
    self: {
      question: "you know the password:",
      hint: "password is my favorite food",
      answer: "friedchicken!"
    }
  };

  function byId(id) { return PROFILES.filter(function (p) { return p.id === id; })[0]; }
  function current() {
    var v = document.documentElement.getAttribute('data-view');
    return IDS.indexOf(v) > -1 ? v : 'recruiter';
  }
  // Vault unlock is per-session only (no persistence) — the passcode is
  // required again on every fresh page load.
  var unlockedSelf = false;
  function unlocked(id) { return id === 'self' ? unlockedSelf : true; }
  function setUnlocked(id) { if (id === 'self') unlockedSelf = true; }
  function hasChosen() {
    try { return !!sessionStorage.getItem('vd-view'); } catch (e) { return false; }
  }

  var splash, circle, gatePanel, gridPanel, gateInput, gateMsg, pendingId, vaultMode, insertKeyBtn;

  function apply(id) {
    if (IDS.indexOf(id) === -1) return;
    document.documentElement.setAttribute('data-view', id);
    try { sessionStorage.setItem('vd-view', id); } catch (e) {}
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('view', id);
      window.history.replaceState({}, '', url);
    } catch (e) {}
    updateCircle();
    updateInsertKey();
  }

  /* ---------- profile circle (persistent switcher, top-left) ---------- */
  function updateCircle() {
    if (!circle) return;
    var p = byId(current());
    circle.setAttribute('data-profile', p.id);
    circle.querySelector('.pf-avatar-letter').textContent = p.letter;
    circle.setAttribute('aria-label', 'Profile: ' + p.label + ' — click to switch');
    circle.querySelector('.pf-circle-name').textContent = p.label;
  }

  function buildCircle() {
    circle = document.createElement('button');
    circle.type = 'button';
    circle.id = 'pf-circle';
    circle.className = 'pf-circle';
    circle.innerHTML =
      '<span class="pf-avatar pf-avatar--sm"><span class="pf-avatar-letter"></span></span>' +
      '<span class="pf-circle-name"></span>';
    circle.addEventListener('click', openSplash);
    document.body.appendChild(circle);
    updateCircle();
  }

  /* ---------- "Insert Key" for inner Level-2 pages ----------
     The homepage has an inline #vault-btn in the hero; inner pages don't, so
     without this you'd have to go back home to enter the vault passcode. This
     floating button appears only in Level 2 while the vault is still locked,
     and opens the same passcode popup in place. */
  function buildInsertKey() {
    if (document.getElementById('vault-btn')) return; // homepage already has one inline
    insertKeyBtn = document.createElement('button');
    insertKeyBtn.type = 'button';
    insertKeyBtn.id = 'pf-insert-key';
    insertKeyBtn.className = 'pf-insert-key';
    insertKeyBtn.innerHTML = '🔑 Insert Key';
    insertKeyBtn.addEventListener('click', openVault);
    document.body.appendChild(insertKeyBtn);
    updateInsertKey();
  }
  function updateInsertKey() {
    if (!insertKeyBtn) return;
    var locked = document.documentElement.getAttribute('data-vault') !== 'open';
    insertKeyBtn.style.display = (current() === 'self' && locked) ? '' : 'none';
  }

  /* ---------- splash overlay ("SELECT PLAYER") ---------- */
  function avatarMarkup(p, withLock) {
    var lock = withLock ? '<span class="pf-lock" aria-hidden="true">&#128274;</span>' : '';
    return '<span class="pf-avatar" data-profile="' + p.id + '">' +
             '<span class="pf-avatar-letter">' + p.letter + '</span>' + lock +
           '</span>';
  }

  function buildSplash() {
    splash = document.createElement('div');
    splash.id = 'splash';
    splash.className = 'pf-splash';
    splash.setAttribute('role', 'dialog');
    splash.setAttribute('aria-label', 'Select a profile');

    var tiles = PROFILES.map(function (p) {
      var locked = p.locked && !unlocked(p.id);
      return '<button type="button" class="pf-tile" data-profile="' + p.id + '">' +
               avatarMarkup(p, locked) +
               '<span class="pf-tile-label">' + p.label + '</span>' +
             '</button>';
    }).join('');

    splash.innerHTML =
      '<div class="pf-splash-inner">' +
        '<p class="pf-splash-kicker">Insert coin</p>' +
        '<h1 class="pf-splash-title">Select Player</h1>' +
        '<div class="pf-grid">' + tiles + '</div>' +
        '<div class="pf-gate" hidden>' +
          '<button type="button" class="pf-gate-back">&#8592; Back</button>' +
          '<p class="pf-gate-q"></p>' +
          '<form class="pf-gate-form">' +
            '<input type="text" class="pf-gate-input" autocomplete="off" ' +
              'autocapitalize="off" spellcheck="false" placeholder="ENTER PASSCODE" />' +
            '<button type="submit" class="pf-gate-ok">OK</button>' +
          '</form>' +
          '<p class="pf-gate-msg" role="status"></p>' +
        '</div>' +
        '<p class="pf-splash-hint">welcome to the game of my life.</p>' +
      '</div>';

    document.body.appendChild(splash);

    gridPanel = splash.querySelector('.pf-grid');
    gatePanel = splash.querySelector('.pf-gate');
    gateInput = splash.querySelector('.pf-gate-input');
    gateMsg   = splash.querySelector('.pf-gate-msg');

    splash.querySelectorAll('.pf-tile').forEach(function (tile) {
      tile.addEventListener('click', function () { selectProfile(tile.getAttribute('data-profile')); });
    });
    splash.querySelector('.pf-gate-back').addEventListener('click', function () {
      vaultMode = false;
      closeSplash();
    });
    splash.querySelector('.pf-gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      tryPasscode();
    });
  }

  function onHome() {
    var p = location.pathname;
    return p === '/' || p === '' || p.endsWith('/') || /index\.html$/i.test(p);
  }
  /* Picking a profile takes you to that level's home (the browse page), like
     Netflix. On the home page we switch in place; from any inner page we
     navigate back to the home page for the chosen level. */
  function enter(id) {
    if (onHome()) {
      apply(id);
      closeSplash();
    } else {
      try { sessionStorage.setItem('vd-view', id); } catch (e) {}
      window.location.href = 'index.html?view=' + id;
    }
  }

  /* Every level is selectable from the splash. Level 2 (self) is no longer
     gated here — you enter it freely, but its subsections stay hidden until
     the vault passcode is entered via the "Continue" button (see openVault). */
  function selectProfile(id) {
    if (byId(id)) enter(id);
  }

  /* The "Insert Key" opens a small passcode popup (NOT the SELECT PLAYER splash).
     Correct answer reveals the vault (the Personal subsections). Reuses the
     .pc-pass-* popup styles from styles.css so it matches the postcards passcode. */
  var vaultModal, vaultInput, vaultMsg;
  function buildVaultPrompt() {
    vaultModal = document.createElement('div');
    vaultModal.className = 'pc-pass-modal';
    vaultModal.id = 'vault-modal';
    vaultModal.setAttribute('role', 'dialog');
    vaultModal.setAttribute('aria-modal', 'true');
    vaultModal.innerHTML =
      '<div class="pc-pass-box">' +
        '<button class="pc-pass-close" type="button" aria-label="Close">&#10005;</button>' +
        '<p class="pc-pass-title">&#128273; Insert Key</p>' +
        ((GATES.self && GATES.self.hint) ? '<p class="pc-pass-hint">' + GATES.self.hint + '</p>' : '') +
        '<form class="pc-pass-form">' +
          '<input type="password" class="pc-pass-input" placeholder="Passcode" autocomplete="off" autocapitalize="off" spellcheck="false" />' +
          '<button type="submit" class="pc-pass-ok">Enter</button>' +
        '</form>' +
        '<p class="pc-pass-msg"></p>' +
      '</div>';
    document.body.appendChild(vaultModal);
    vaultInput = vaultModal.querySelector('.pc-pass-input');
    vaultMsg = vaultModal.querySelector('.pc-pass-msg');
    vaultModal.querySelector('.pc-pass-close').addEventListener('click', closeVault);
    vaultModal.addEventListener('click', function (e) { if (e.target === vaultModal) closeVault(); });
    vaultModal.querySelector('.pc-pass-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var guess = (vaultInput.value || '').trim().toLowerCase();
      var answer = ((GATES.self && GATES.self.answer) || '').trim().toLowerCase();
      if (guess && guess === answer) {
        setUnlocked('self');
        document.documentElement.setAttribute('data-vault', 'open');
        updateInsertKey();
        closeVault();
        var personal = document.getElementById('personal');
        if (personal) personal.scrollIntoView({ behavior: 'smooth' });
      } else {
        vaultMsg.textContent = 'Wrong — try again';
        vaultInput.select();
      }
    });
  }
  function openVault() {
    if (!vaultModal) return;
    vaultMsg.textContent = ''; vaultInput.value = '';
    vaultModal.classList.add('is-open');
    document.body.classList.add('pf-no-scroll');
    setTimeout(function () { vaultInput.focus(); }, 30);
  }
  function closeVault() {
    if (!vaultModal) return;
    vaultModal.classList.remove('is-open');
    document.body.classList.remove('pf-no-scroll');
    vaultInput.blur();
  }

  function showGrid() {
    gatePanel.hidden = true;
    gridPanel.hidden = false;
  }

  function openGate(id) {
    pendingId = id;
    gridPanel.hidden = true;
    gatePanel.hidden = false;
    splash.querySelector('.pf-gate-q').textContent = (GATES[id] && GATES[id].question) || '';
    gateMsg.textContent = '';
    gateMsg.classList.remove('is-bad');
    gateInput.value = '';
    setTimeout(function () { gateInput.focus(); }, 30);
  }

  function tryPasscode() {
    var guess = (gateInput.value || '').trim().toLowerCase();
    var g = GATES[pendingId];
    var answer = ((g && g.answer) || '').trim().toLowerCase();
    if (guess && answer && guess === answer) {
      setUnlocked(pendingId);
      refreshLocks();
      if (vaultMode) {
        vaultMode = false;
        document.documentElement.setAttribute('data-vault', 'open');
        updateInsertKey();
        closeSplash();
        var personal = document.getElementById('personal');
        if (personal) personal.scrollIntoView({ behavior: 'smooth' });
      } else {
        enter(pendingId);
      }
    } else {
      gateMsg.textContent = 'ACCESS DENIED — TRY AGAIN';
      gateMsg.classList.add('is-bad');
      gatePanel.classList.remove('pf-shake');
      // reflow to restart the animation
      void gatePanel.offsetWidth;
      gatePanel.classList.add('pf-shake');
      gateInput.select();
    }
  }

  // Re-render lock badges/sublabels after unlocking
  function refreshLocks() {
    PROFILES.forEach(function (p) {
      var tile = splash.querySelector('.pf-tile[data-profile="' + p.id + '"]');
      if (!tile) return;
      var locked = p.locked && !unlocked(p.id);
      var lock = tile.querySelector('.pf-lock');
      if (locked && !lock) {
        tile.querySelector('.pf-avatar').insertAdjacentHTML('beforeend',
          '<span class="pf-lock" aria-hidden="true">&#128274;</span>');
      } else if (!locked && lock) {
        lock.remove();
      }
    });
  }

  function openSplash() {
    if (!splash) return;
    showGrid();
    splash.classList.add('is-open');
    document.body.classList.add('pf-no-scroll');
  }
  function closeSplash() {
    if (!splash) return;
    splash.classList.remove('is-open');
    document.body.classList.remove('pf-no-scroll');
  }

  function init() {
    buildSplash();
    buildCircle();
    buildInsertKey();
    buildVaultPrompt();

    // Level 2 "Insert Key" → passcode prompt, until the vault is open.
    var vaultBtn = document.getElementById('vault-btn');
    if (vaultBtn) {
      vaultBtn.addEventListener('click', function (e) {
        if (document.documentElement.getAttribute('data-vault') !== 'open') {
          e.preventDefault();
          openVault();
        }
      });
    }

    // First visit (no stored profile and no ?view= param) → show the picker.
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('view');
    if (!hasChosen() && !(fromUrl && IDS.indexOf(fromUrl) > -1)) {
      openSplash();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
