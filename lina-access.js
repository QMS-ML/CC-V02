/*!
 * LINA QMS — who can open which page (role-based access)
 * Keep this file in the same folder as the HTML pages.
 * The login page is index.html.
 * Every page loads it: Home hides the buttons a role can't use, and each page
 * sends the user back to Home if their role isn't allowed.
 *
 * Roles = the "Level" in the Users sheet (login).
 * To change access: add or remove a role in the list next to the page.
 *
 * IMPORTANT: this file only decides what the MENU and the PAGES show. The real lock is on the server:
 * every Google Apps Script checks the login "pass" and the access level again (keep both lists in step).
 * This file also adds the pass to every request and sends the user to the login page when the pass has ended.
 *
 * ELECTRONIC SIGNATURE: for the actions in LINA_SIGNED (approvals, registrations, completions) this file shows the
 * signing panel, asks for the password again and sends it with the request. The scripts check it and refuse an
 * unsigned request, so the list below must match the signed actions in the scripts.
 */
const LINA_ROLES = ['Initiator', 'Department Head', 'Compliance Executive', 'QA Manager', 'Super Admin'];
// Super Admin = user management only (approves accounts, sets access levels); takes no part in change controls.

// Login script /exec URL (the same as SCRIPT_URL in index.html) – used here to cancel the pass at Logout
const LINA_AUTH_URL = 'https://script.google.com/macros/s/AKfycbyV-EZG6nF6w_BrMUJsdiekVKZqGxmiN9hCQw5-ERgosMCpKHF-PRmgNenjb9njVA3c3A/exec';

const LINA_ACCESS = {
  //  page                       roles allowed
  'CHANGE_CONTROL.html':       ['Initiator', 'Compliance Executive', 'QA Manager'],       // Change Control Initiation
  'CC_APPROVAL.html':          ['Department Head', 'QA Manager'],                         // Initial Approval
  'CC_FINAL_APPROVAL.html':    ['QA Manager'],                                            // Final Approval
  'IA_OTHER.html':             ['Compliance Executive', 'QA Manager'],                    // Impact Assessment – Assign Departments
  'IA_COMMENT.html':           ['Department Head', 'QA Manager'],                         // Impact Assessment – Department Comments (own department only)
  'IA_QC.html':                ['Compliance Executive', 'QA Manager'],                    // Quality Compliance IA
  'ACTION_PLAN.html':          ['Compliance Executive', 'QA Manager'],                    // Action Plan Registration
  'CC_PROGRESS.html':          ['Initiator', 'Department Head', 'Compliance Executive', 'QA Manager'], // Track My CC – CC Tracker (each sees own scope)
  'ACTION_TRACKER.html':       ['Initiator', 'Department Head', 'Compliance Executive', 'QA Manager'], // Track My CC – Action Item Tracker
  'ACTION_STATUS.html':        ['Compliance Executive', 'QA Manager'],                    // Progress Update – Action Item
  'ANALYTICS.html':            ['Department Head', 'Compliance Executive', 'QA Manager'], // Analytics
  'AUDIT_TRAIL.html':          ['Initiator', 'Department Head', 'Compliance Executive', 'QA Manager', 'Super Admin'], // View Audit Trails
  'PDF.html':                  ['Compliance Executive', 'QA Manager'],                    // CC Form (PDF)
  'USERS.html':                ['Super Admin']                                            // User Management
  // HOME.html and index.html are open to every logged-in user
};

function linaUser(){
  try { return JSON.parse(sessionStorage.getItem('lina_user') || 'null'); } catch (_) { return null; }
}
function linaCan(page, level){
  const allowed = LINA_ACCESS[String(page || '').split('?')[0]];
  return !allowed || allowed.indexOf(level) > -1;
}

/* ===== Login pass: added to every request to the LINA scripts; an ended pass sends the user to the login page ===== */
(function(){
  if (!window.fetch || window.__linaFetch) return;
  window.__linaFetch = true;
  const realFetch = window.fetch.bind(window);
  const isLina = url => typeof url === 'string' && url.indexOf('https://script.google.com/macros/') === 0;
  let leaving = false;
  function toLogin(msg){
    if (leaving) return; leaving = true;
    try { sessionStorage.removeItem('lina_user'); sessionStorage.setItem('lina_msg', msg || 'Your session has ended. Please log in again.'); } catch (_) {}
    location.replace('index.html?expired=1');
  }
  /* ----- Electronic signature: which actions are signed, and what the user is told they are signing ----- */
  const LINA_SIGNED = {
    submitCC:          b => 'Register this change control' + (b.title ? ': "' + b.title + '"' : ''),
    resubmitCC:        b => 'Resubmit the corrected change control ' + (b.ccNo || ''),
    reviewCC:          b => 'Initial approval: ' + ({ Approved: 'APPROVE', Returned: 'RETURN for correction', Rejected: 'REJECT' }[b.decision] || b.decision) + ' ' + (b.ccNo || ''),
    submitDeptComment: b => 'Impact assessment comment of ' + (b.department || 'the department') + ' for ' + (b.ccNo || ''),
    saveQIA:           b => b.submit === true ? 'Complete the Quality Compliance impact assessment for ' + (b.ccNo || '') : null,   // drafts are not signed
    saveAP:            b => b.submit === true ? 'Register the action plan for ' + (b.ccNo || '') : null,                           // drafts are not signed
    finalDecisionCC:   b => 'Final approval: ' + (b.decision === 'Approved' ? 'APPROVE' : 'DO NOT APPROVE') + ' ' + (b.ccNo || ''),
    finalReturnCC:     b => 'Final approval: RETURN ' + (b.ccNo || '') + ' for correction',
    updateItem:        b => (b.status === 'Completed' || b.status === 'Cancelled') ? 'Close action item ' + (b.no || '') + ' as ' + b.status : null
  };
  const SIGN_CSS = `
  #lina-sign{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(6,34,61,.55);font-family:'DM Sans',sans-serif;}
  #lina-sign.show{display:flex;}
  #lina-sign .ls-card{width:100%;max-width:460px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;color:#1a2433;}
  #lina-sign .ls-head{background:linear-gradient(135deg,#06223d,#0f4c81);color:#fff;padding:16px 22px;font-size:16px;font-weight:700;}
  #lina-sign .ls-body{padding:20px 22px 6px;}
  #lina-sign .ls-label{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#5a6b80;}
  #lina-sign .ls-what{font-size:15.5px;font-weight:700;color:#06223d;margin:4px 0 10px;line-height:1.4;overflow-wrap:anywhere;}
  #lina-sign .ls-who{font-size:13px;background:#e8f0f8;border:1px solid #d6e1ec;border-radius:9px;padding:8px 12px;color:#0a3459;font-weight:600;}
  #lina-sign .ls-legal{font-size:12px;line-height:1.55;color:#5a6b80;margin:12px 0 14px;}
  #lina-sign label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;}
  #lina-sign input{width:100%;height:44px;border:1.5px solid #d6e1ec;border-radius:10px;padding:0 12px;font:inherit;font-size:15px;outline:none;box-sizing:border-box;}
  #lina-sign input:focus{border-color:#0f4c81;box-shadow:0 0 0 3px rgba(15,76,129,.13);}
  #lina-sign .ls-err{min-height:18px;margin-top:8px;font-size:12.5px;font-weight:600;color:#c0392b;line-height:1.4;}
  #lina-sign .ls-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 22px 20px;}
  #lina-sign .ls-btn{height:40px;border-radius:10px;padding:0 20px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;}
  #lina-sign .ls-cancel{background:#fff;color:#0f4c81;border:1.5px solid #b5cde3;}
  #lina-sign .ls-ok{background:#0f4c81;color:#fff;border:1.5px solid #0f4c81;min-width:110px;}
  #lina-sign .ls-btn:disabled{opacity:.6;cursor:wait;}`;
  let signEl = null;
  function signPanel(){
    if (signEl) return signEl;
    const css = document.createElement('style'); css.textContent = SIGN_CSS; document.head.appendChild(css);
    signEl = document.createElement('div');
    signEl.id = 'lina-sign'; signEl.setAttribute('role', 'dialog'); signEl.setAttribute('aria-modal', 'true'); signEl.setAttribute('aria-label', 'Electronic signature');
    signEl.innerHTML = '<div class="ls-card"><div class="ls-head">✍ Electronic signature</div><div class="ls-body">'
      + '<div class="ls-label">You are signing</div><div class="ls-what" id="lsWhat"></div><div class="ls-who" id="lsWho"></div>'
      + '<p class="ls-legal">By entering my password I sign this action. This electronic signature is the legally binding equivalent of my handwritten signature. My name, the meaning of the signature and the date and time are recorded by the system.</p>'
      + '<label for="lsPw">Your password</label><input type="password" id="lsPw" autocomplete="off">'
      + '<div class="ls-err" id="lsErr" role="alert"></div></div>'
      + '<div class="ls-foot"><button type="button" class="ls-btn ls-cancel" id="lsCancel">Cancel</button><button type="button" class="ls-btn ls-ok" id="lsOk">Sign</button></div></div>';
    document.body.appendChild(signEl);
    return signEl;
  }
  // Shows the panel; gives back the password typed, or null when the user cancels
  function askSignature(what, error){
    const el = signPanel(), u = linaUser() || {};
    const pw = el.querySelector('#lsPw'), err = el.querySelector('#lsErr'), okB = el.querySelector('#lsOk'), noB = el.querySelector('#lsCancel');
    el.querySelector('#lsWhat').textContent = what;
    el.querySelector('#lsWho').textContent = 'Signing as ' + (u.name || u.username || '') + (u.name && u.username ? ' (' + u.username + ')' : '') + (u.position ? ' · ' + u.position : '');
    pw.value = ''; pw.disabled = okB.disabled = noB.disabled = false; okB.textContent = 'Sign';
    err.textContent = error || '';
    el.classList.add('show');
    setTimeout(() => pw.focus(), 30);
    return new Promise(resolve => {
      const done = v => {
        okB.onclick = noB.onclick = pw.onkeydown = null;
        if (v === null) closeSignature(); else { pw.disabled = okB.disabled = noB.disabled = true; okB.textContent = 'Signing…'; }
        resolve(v);
      };
      const sign = () => { if (!pw.value) { err.textContent = 'Enter your password to sign.'; pw.focus(); return; } done(pw.value); };
      okB.onclick = sign;
      noB.onclick = () => done(null);
      pw.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sign(); } else if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    });
  }
  function closeSignature(){ if (signEl) { signEl.classList.remove('show'); signEl.querySelector('#lsPw').value = ''; } }
  const answer = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

  window.fetch = async function(url, opt){
    const lina = isLina(url);
    let body = null;
    if (lina && opt && typeof opt.body === 'string') {
      try {
        body = JSON.parse(opt.body);
        const u = linaUser();
        if (u && u.token && !body.token) { body.token = u.token; opt = Object.assign({}, opt, { body: JSON.stringify(body) }); }
      } catch (_) { body = null; }
    }
    const rule = body && LINA_SIGNED[body.action], what = rule ? rule(body) : null;
    if (!what) {                                   // ordinary request
      const res = await realFetch(url, opt);
      if (lina) {
        try { const r = await res.clone().json(); if (r && r.auth === 'login') toLogin(r.message); } catch (_) {}
      }
      return res;
    }
    // signed action: ask for the password, send it with the request; a wrong password asks again
    let error = '';
    for (;;) {
      const pw = await askSignature(what, error);
      if (pw === null) return answer({ success: false, sign: 'cancelled', message: 'Not signed, so nothing was saved.' });
      let res;
      try { res = await realFetch(url, Object.assign({}, opt, { body: JSON.stringify(Object.assign({}, body, { sign: { password: pw } })) })); }
      catch (e) { closeSignature(); throw e; }
      let r = null;
      try { r = await res.clone().json(); } catch (_) {}
      if (r && r.sign === 'wrong') { error = r.message || 'Wrong password. Nothing was saved.'; continue; }
      closeSignature();
      if (r && (r.auth === 'login' || r.sign === 'locked')) toLogin(r.message);
      return res;
    }
  };
  // Logout: also cancel the pass on the server (each page keeps its own logout(), this runs first)
  function wrapLogout(){
    const pageLogout = window.logout;
    if (typeof pageLogout !== 'function' || pageLogout.__lina) return;
    const wrapped = function(){
      try {
        const u = linaUser();
        if (u && u.token) realFetch(LINA_AUTH_URL, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                                                     body: JSON.stringify({ action: 'logout', token: u.token }) }).catch(() => {});
      } catch (_) {}
      return pageLogout.apply(this, arguments);
    };
    wrapped.__lina = true;
    window.logout = wrapped;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapLogout); else wrapLogout();
  window.addEventListener('load', wrapLogout);
})();

// Page guard: not logged in → LOGIN; role not allowed → HOME
(function(){
  const page = decodeURIComponent(location.pathname.split('/').pop() || '');
  if (page === 'index.html' || page === '') return;   // the login page (also when opened as just the folder / site address)
  const u = linaUser();
  if (!u || !u.token) { try { sessionStorage.removeItem('lina_user'); } catch (_) {} location.replace('index.html'); return; }   // no login pass → log in
  if (!linaCan(page, u.level)) location.replace('HOME.html?denied=' + encodeURIComponent(page));
})();

/* ===== Icon buttons: Home, Back, Logout (same look on every page, in the LINA UI style) ===== */
(function(){
  const ICON = {
    home:   '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/></svg>',
    back:   '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>',
    power:  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M7.2 6.2a8 8 0 1 0 9.6 0"/></svg>'
  };
  const CSS = `
  .gl-btn{display:inline-flex !important;align-items:center;justify-content:center;gap:8px;padding:0 !important;cursor:pointer;
    text-decoration:none !important;font-family:inherit;border:none !important;color:#fff !important;
    background:var(--blue,#0f4c81) !important;box-shadow:0 2px 8px rgba(15,76,129,.22) !important;transition:background .15s,transform .12s,box-shadow .15s;}
  .gl-btn svg{width:20px;height:20px;flex:none;}
  .gl-btn:hover{background:var(--blue-dark,#0a3459) !important;box-shadow:0 4px 12px rgba(15,76,129,.3) !important;transform:translateY(-1px);}
  .gl-btn:active{transform:translateY(0);}
  .gl-btn:focus-visible{outline:3px solid #5fd0dc;outline-offset:2px;}
  .gl-round{width:40px !important;height:40px !important;min-width:40px;border-radius:50% !important;}
  .gl-logout{height:40px !important;padding:0 16px 0 12px !important;border-radius:20px !important;font-size:13px !important;font-weight:600 !important;}
  .gl-logout svg{width:18px;height:18px;}
  header.header-dark .gl-btn{background:rgba(255,255,255,.12) !important;border:1px solid rgba(255,255,255,.28) !important;box-shadow:none !important;}
  header.header-dark .gl-btn:hover{background:rgba(255,255,255,.22) !important;}
  .gl-wrap{display:inline-flex;align-items:center;gap:10px;background:none !important;border:none !important;padding:0 !important;cursor:pointer;
    font-weight:600;font-size:13.5px;color:var(--blue,#0f4c81);font-family:inherit;text-decoration:none !important;}
  .gl-wrap .gl-dot{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
    background:var(--blue-light,#e8f0f8);color:var(--blue,#0f4c81);border:1px solid var(--border,#dce3eb);transition:background .15s,color .15s;}
  .gl-wrap .gl-dot svg{width:16px;height:16px;}
  .gl-wrap:hover .gl-dot{background:var(--blue,#0f4c81);color:#fff;}`;
  // Long words / pasted text without spaces wrap inside their box instead of running off the page
  const WRAP_CSS = `
  p, li, h1, h2, h3, h4, b, span, label, small, div, dd, dt{overflow-wrap:break-word;}
  td, th, .cm, .done-cm, .sec p, .meta-grid b, .dsec p{overflow-wrap:anywhere;word-break:break-word;}
  .rv-title, .rv-no, .ttl, .cc, h1, h2, h3, .title-bar p{overflow-wrap:anywhere;}
  .rv-head > *, .title-bar > *, td > div{min-width:0;}
  .sec p, .dsec p, .done-cm{white-space:pre-wrap;}`;
  function style(){ if (document.getElementById('gl-css')) return; const s = document.createElement('style'); s.id = 'gl-css'; s.textContent = CSS + WRAP_CSS; document.head.appendChild(s); }
  function iconOnly(el, cls, icon, label){
    el.classList.add('gl-btn', ...cls); el.innerHTML = icon; el.title = label; el.setAttribute('aria-label', label);
  }
  function withLabel(el, icon, cls, text){
    el.classList.add('gl-wrap'); el.innerHTML = '<span class="gl-dot">' + icon + '</span><span>' + text + '</span>';
  }
  function apply(){
    style();
    // dark (gradient) headers, e.g. Home, get light-on-dark buttons
    document.querySelectorAll('header').forEach(h => { if ((getComputedStyle(h).backgroundImage || 'none') !== 'none') h.classList.add('header-dark'); });
    document.querySelectorAll('.btn-home, #btnHome').forEach(el => iconOnly(el, ['gl-round'], ICON.home, 'Home'));
    document.querySelectorAll('.btn-logout, .btn-back[onclick*="logout"]').forEach(el => {
      el.classList.add('gl-btn', 'gl-logout'); el.innerHTML = ICON.power + '<span>Logout</span>'; el.title = 'Logout'; el.setAttribute('aria-label', 'Logout');
    });
    document.querySelectorAll('.btn-backlist').forEach(el => withLabel(el, ICON.back, '', (el.textContent || '').replace(/^\s*←\s*/, '') || 'Back'));
    document.querySelectorAll('button.back').forEach(el => withLabel(el, ICON.back, '', 'Back'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
