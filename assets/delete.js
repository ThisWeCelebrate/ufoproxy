// Deleting a UFO Proxy account without the app (release-web1..4), against Supabase:
//
//   delete-account.html  POST /auth/v1/otp {email, create_user:false}?redirect_to=…/delete-confirm.html
//                        Supabase mails a one-time sign-in link (the "Magic link" template,
//                        docs/backend/email/delete-link.html). Unknown addresses get the same
//                        answer as known ones, so the page never tells who has an account.
//   delete-confirm.html  the link lands here with #access_token=… (implicit flow). GET /auth/v1/user
//                        names the account; typing DELETE calls POST /rest/v1/rpc/delete_account
//                        (supabase/migrations/20261108000000_delete_account.sql), the same function
//                        the app calls. "Keep my account" signs the link's session out.
//
// The token lives in memory only and is wiped from the address bar at once. No dependencies.
(function () {
  'use strict';
  var cfg = window.UFO_SUPABASE || {};
  var ready = /^https:\/\/[^<>\s]+$/.test(cfg.url || '') && !!cfg.key && !/[<>]/.test(cfg.key);
  var base = ready ? cfg.url.replace(/\/+$/, '') : '';
  var RESEND_S = 60; // Supabase allows one email per address a minute

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function show(state, step) {
    $$('[data-state]').forEach(function (el) {
      el.hidden = el.getAttribute('data-state').split(' ').indexOf(state) < 0;
    });
    var label = $('#step'); // Evolution 9's header label; Evolution 11's header has none
    if (step && label) label.textContent = step;
  }
  function scene(name) {
    $$('[data-scene]').forEach(function (el) { el.hidden = el.getAttribute('data-scene') !== name; });
  }
  function fail(title, text) {
    var box = $('[data-state="error"]');
    $('[data-error-title]', box).textContent = title;
    $('[data-error-text]', box).textContent = text || '';
    box.hidden = false;
  }
  function clearFail() { $('[data-state="error"]').hidden = true; }
  function busy(btn, on) {
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }

  function call(method, path, token, body) {
    var headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.text().then(function (t) {
          var json = null;
          try { json = t ? JSON.parse(t) : null; } catch (e) { /* not JSON */ }
          return { status: r.status, ok: r.ok, json: json || {} };
        });
      });
  }
  var offline = function () {
    fail('Couldn’t reach UFO Proxy', 'Check your connection and try again. Nothing was changed.');
  };
  var down = function () {
    fail('Something went wrong on our side', 'Nothing was changed. Try again in a few minutes.');
  };
  function waitSeconds(res) {
    var m = /(\d+)\s*second/.exec((res.json && (res.json.msg || res.json.message || res.json.error_description)) || '');
    return m ? +m[1] : RESEND_S;
  }

  // ── delete-account.html ──
  function ask() {
    if (!ready) { show('off', 'Account'); return; }
    show('ask', 'Account');
    var form = $('form[data-state="ask"]');
    var input = $('#email');
    var hint = $('#email-hint');
    var box = input.closest('.fr') || input.parentNode; // `.fr.bad`: the field's red edge
    var btn = $('button[type="submit"]', form);
    var email = '';
    var timer = 0;

    function bad(text) {
      box.classList.add('bad'); hint.textContent = text; hint.hidden = false; hint.classList.add('bad');
      input.setAttribute('aria-invalid', 'true'); input.focus();
    }
    input.addEventListener('input', function () {
      box.classList.remove('bad'); hint.hidden = true; input.removeAttribute('aria-invalid');
    });

    function countdown(s) {
      var out = $('[data-resend]');
      clearInterval(timer);
      var tick = function () {
        if (s <= 0) {
          clearInterval(timer);
          out.innerHTML = '';
          var a = document.createElement('a');
          a.href = '#'; a.className = 'lnk'; a.textContent = 'Send again';
          a.addEventListener('click', function (e) { e.preventDefault(); send(a); });
          out.appendChild(a); out.className = '';
          return;
        }
        out.textContent = 'Send again in ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
        out.className = 'mute';
        s--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    function send(btnEl) {
      clearFail();
      busy(btnEl, true);
      var to = location.href.replace(/[^/]*([?#].*)?$/, 'delete-confirm.html');
      call('POST', '/auth/v1/otp?redirect_to=' + encodeURIComponent(to), null, { email: email, create_user: false })
        .then(function (res) {
          busy(btnEl, false);
          var code = res.json.error_code || '';
          if (res.ok || code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found') {
            // the same answer whether or not the address has an account
            $$('[data-email]').forEach(function (el) { el.textContent = email; });
            scene('mail');
            show('sent', 'Step 2 of 3');
            countdown(RESEND_S);
          } else if (res.status === 429 || /^over_/.test(code)) {
            fail('Too many emails', 'Wait a minute and try again. The last link we sent still works for 10 minutes.');
            if (!$('[data-state="sent"]').hidden) countdown(waitSeconds(res));
          } else if (res.status === 400 || res.status === 422) {
            show('ask', 'Account'); scene('delete');
            bad('That doesn’t look like an email address.');
          } else {
            down();
          }
        }, function () { busy(btnEl, false); offline(); });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { bad('Enter the email address of your UFO Proxy account.'); return; }
      send(btn);
    });
    $('[data-another]').addEventListener('click', function (e) {
      e.preventDefault();
      clearInterval(timer); clearFail();
      scene('delete'); show('ask', 'Account');
      input.focus(); input.select();
    });
  }

  // ── delete-confirm.html ──
  function confirm() {
    if (!ready) { show('off', 'Account'); return; }
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    var q = new URLSearchParams(location.search);
    var token = p.get('access_token');
    var error = p.get('error_description') || q.get('error_description');
    var errorCode = p.get('error_code') || q.get('error_code') || '';
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);

    function nolink(text) {
      if (text) $('[data-nolink-text]').textContent = text;
      show('nolink', 'Step 3 of 3');
    }
    if (!token) {
      nolink(errorCode === 'otp_expired' || /expired/i.test(error || '')
        ? 'This link has expired or was already used. Links work once and only for 10 minutes.'
        : null);
      return;
    }

    call('GET', '/auth/v1/user', token).then(function (res) {
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) nolink('This link has expired or was already used. Links work once and only for 10 minutes.');
        else { nolink(); down(); }
        return;
      }
      var email = res.json.email || 'your account';
      $$('[data-email]').forEach(function (el) { el.textContent = email; });
      show('confirm', 'Step 3 of 3');
      var form = $('form[data-state="confirm"]');
      var word = $('#word');
      var btn = $('button[type="submit"]', form);
      word.addEventListener('input', function () { btn.disabled = word.value.trim().toUpperCase() !== 'DELETE'; });
      word.focus();
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (word.value.trim().toUpperCase() !== 'DELETE') return;
        clearFail(); busy(btn, true);
        call('POST', '/rest/v1/rpc/delete_account', token, {}).then(function (r) {
          busy(btn, false);
          if (r.ok) {
            token = null;
            scene('sleep');
            show('done', 'Done');
          } else if (r.status === 401 || r.status === 403) {
            nolink('Your link ran out before you confirmed. Ask for a new one; it works for 10 minutes.');
          } else {
            down();
          }
        }, function () { busy(btn, false); offline(); });
      });
      $('[data-keep]').addEventListener('click', function () {
        var leave = function () { location.href = 'index.html'; };
        call('POST', '/auth/v1/logout', token).then(leave, leave);
      });
    }, function () { nolink(); offline(); });
  }

  window.UfoDelete = { ask: ask, confirm: confirm };
})();
