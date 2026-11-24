/* =====================================================================
   ImHomi · panel de soporte (decisión 51)
   Entra con el ingreso de la API (con el código si la cuenta tiene
   verificación en dos pasos), lista los casos por estado, muestra el hilo,
   responde y cierra. Solo lo abre una cuenta con users.role = 'support':
   la API contesta 403 SIN_PERMISO a cualquier otra.

   La sesión vive solo en la memoria de esta pestaña: nada en localStorage
   ni en sessionStorage. Recargar o cerrar la pestaña pide entrar de nuevo.

   Todo lo que escribió una persona entra con textContent o createElement,
   nunca como HTML. Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const api = (document.body.dataset.api || '').replace(/\/+$/, '');

  const views = {
    login: $('#sop-login'),
    otp: $('#sop-otp'),
    denied: $('#sop-denied'),
    need2fa: $('#sop-need2fa'),
    expired: $('#sop-expired'),
    panel: $('#sop-panel'),
  };
  if (Object.values(views).some((v) => !v)) return;
  const authScreen = $('#main');
  const panel = views.panel;

  /** Un elemento con su clase y su texto (siempre como texto). */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  /** Un ícono del sprite de soporte.html. */
  const icon = (id, cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  };

  /* ---------- La sesión, en memoria ---------- */
  let session = null; // { access, refresh, name }
  let tempToken = null;

  const show = (name, focus) => {
    const inPanel = name === 'panel';
    authScreen.hidden = inPanel;
    panel.hidden = !inPanel;
    document.body.classList.toggle('is-auth', !inPanel);
    Object.entries(views).forEach(([k, v]) => { if (k !== 'panel') v.hidden = k !== name; });
    $('#sop-logout').hidden = !inPanel;
    $('#sop-who').hidden = !inPanel;
    if (focus) focus.focus();
  };

  const setError = (box, text) => {
    box.textContent = text || '';
    box.hidden = !text;
  };

  /** Un pedido a la API. Devuelve { ok, status, data, message, code }. */
  async function call(method, path, body, { auth = true, retried = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session) headers.Authorization = 'Bearer ' + session.access;
    let response;
    let json = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      response = await fetch(api + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      clearTimeout(timer);
      json = await response.json().catch(() => null);
    } catch (e) {
      return { ok: false, status: 0, message: 'No pudimos conectar. Revisá tu internet y probá de nuevo.' };
    }
    // El token de acceso venció: se renueva una vez y se reintenta.
    if (response.status === 401 && auth && session && !retried) {
      if (await renew()) return call(method, path, body, { auth, retried: true });
      expire();
      return { ok: false, status: 401, message: 'Tu sesión terminó.' };
    }
    const data = json && 'data' in json ? json.data : json;
    const raw = json && json.message;
    return {
      ok: response.ok,
      status: response.status,
      data,
      code: json && json.code,
      message: Array.isArray(raw) ? raw[0] : (typeof raw === 'string' ? raw : ''),
    };
  }

  // Una sola renovación a la vez: la bandeja pide varias cosas juntas, y dos
  // renovaciones con el mismo refresh se pisarían.
  let renewing = null;
  function renew() {
    if (!renewing) {
      renewing = (async () => {
        if (!session) return false;
        const r = await call('POST', '/auth/refresh', { refresh_token: session.refresh }, { auth: false });
        if (!session || !r.ok || !r.data || !r.data.access_token) return false;
        session.access = r.data.access_token;
        session.refresh = r.data.refresh_token || session.refresh;
        return true;
      })().finally(() => { renewing = null; });
    }
    return renewing;
  }

  async function startSession(data) {
    const user = data.user || {};
    session = {
      access: data.access_token,
      refresh: data.refresh_token,
      name: [user.user_name, user.last_name].filter(Boolean).join(' ') || user.email || '',
    };
    tempToken = null;
    $('#sop-password').value = '';
    paintOtp('');
    await openPanel();
  }

  /** Corta la sesión en la API y limpia todo lo de la bandeja. */
  function endSession() {
    const refresh = session && session.refresh;
    session = null;
    if (refresh) call('POST', '/auth/logout', { refresh_token: refresh }, { auth: false });
    cases = [];
    cursor = null;
    current = null;
    counts = {};
    drafts.clear();
    $('#sop-cases').replaceChildren();
    $('#sop-case-body').hidden = true;
    showCaseEmpty();
    panel.dataset.view = 'list';
  }

  function logout() {
    endSession();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    show('login', $('#sop-email'));
    setError($('#sop-login-error'), '');
  }

  /** La sesión venció y no se pudo renovar: se dice, con volver a entrar. */
  function expire() {
    if (!session) return;
    endSession();
    show('expired', $('#sop-expired-title'));
  }

  /* ---------- Entrar ---------- */
  const busy = (btn, on, label) => {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    const t = $('.go-t', btn);
    if (label && t) t.textContent = label;
  };

  // Decisión 66: el panel va a exigir la verificación en dos pasos. Cuando la
  // API rechace una cuenta sin 2FA, contesta con este código y se muestra
  // cómo prenderla. Hoy no llega nunca.
  const CODE_NEEDS_2FA = 'PANEL_REQUIERE_2FA';
  const needs2fa = (r) => r && r.code === CODE_NEEDS_2FA;

  const emailIn = $('#sop-email');
  const passIn = $('#sop-password');
  const loginErr = $('#sop-login-error');

  // El error se va en cuanto se corrige un campo.
  [emailIn, passIn].forEach((input) => input.addEventListener('input', () => {
    setError(loginErr, '');
    input.closest('.field').classList.remove('is-bad');
  }));

  // Mostrar u ocultar la contraseña.
  const eye = $('#sop-eye');
  eye.addEventListener('click', () => {
    const showing = passIn.type === 'text';
    passIn.type = showing ? 'password' : 'text';
    eye.setAttribute('aria-pressed', showing ? 'false' : 'true');
    eye.setAttribute('aria-label', showing ? 'Mostrar la contraseña' : 'Ocultar la contraseña');
  });

  // Bloq Mayús: se avisa mientras se escribe la contraseña.
  const caps = $('#sop-caps');
  const checkCaps = (e) => {
    if (!e.getModifierState) return;
    caps.textContent = e.getModifierState('CapsLock') ? 'Bloq Mayús está activado.' : '';
  };
  passIn.addEventListener('keydown', checkCaps);
  passIn.addEventListener('keyup', checkCaps);
  passIn.addEventListener('blur', () => { caps.textContent = ''; });

  $('#sop-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailIn.value.trim().toLowerCase();
    const password = passIn.value;
    if (!email || !password) {
      if (!email) emailIn.closest('.field').classList.add('is-bad');
      if (!password) passIn.closest('.field').classList.add('is-bad');
      (email ? passIn : emailIn).focus();
      return setError(loginErr, !email && !password ? 'Escribí tu correo y tu contraseña.'
        : !email ? 'Escribí tu correo.' : 'Escribí tu contraseña.');
    }
    setError(loginErr, '');
    const go = $('#sop-login-go');
    busy(go, true, 'Entrando…');
    const r = await call('POST', '/auth/login', { email, password }, { auth: false });
    if (!r.ok) {
      busy(go, false, 'Entrar');
      if (needs2fa(r)) return show('need2fa', $('#sop-need2fa-title'));
      return setError(loginErr, r.status === 429
        ? (r.message || 'Hiciste varios intentos seguidos. Esperá un momento.')
        : (r.message || 'No pudimos entrar. Probá de nuevo.'));
    }
    if (r.data && r.data.status === 'otp_required') {
      busy(go, false, 'Entrar');
      tempToken = r.data.temp_token;
      $('#sop-otp-email').textContent = r.data.masked_email || 'tu correo';
      paintOtp('');
      setError($('#sop-otp-error'), '');
      $('#sop-otp-ok').textContent = '';
      show('otp', $('#sop-code'));
      return;
    }
    await startSession(r.data);
    busy(go, false, 'Entrar');
  });

  /* ---------- El código: seis casillas sobre un solo campo ---------- */
  const code = $('#sop-code');
  const otpBox = $('#sop-otp-box');
  const cells = $$('.otp-cell', otpBox);
  const otpErr = $('#sop-otp-error');

  function paintOtp(value) {
    const digits = String(value).replace(/\D/g, '').slice(0, 6);
    if (code.value !== digits) code.value = digits;
    cells.forEach((cell, i) => {
      cell.textContent = digits[i] || '';
      cell.classList.toggle('is-full', i < digits.length);
      cell.classList.toggle('is-active', i === Math.min(digits.length, 5));
    });
    otpBox.classList.toggle('is-complete', digits.length === 6);
  }
  const caretToEnd = () => { const n = code.value.length; try { code.setSelectionRange(n, n); } catch (e) { /* sin selección */ } };
  code.addEventListener('input', () => {
    paintOtp(code.value);
    otpBox.classList.remove('is-bad');
    setError(otpErr, '');
  });
  code.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    e.preventDefault();
    paintOtp(text);
    otpBox.classList.remove('is-bad');
    setError(otpErr, '');
  });
  code.addEventListener('focus', () => { otpBox.classList.add('is-focus'); caretToEnd(); });
  code.addEventListener('blur', () => otpBox.classList.remove('is-focus'));
  code.addEventListener('click', caretToEnd);
  code.addEventListener('keyup', caretToEnd);

  $('#sop-otp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = code.value.trim();
    if (!/^\d{6}$/.test(value)) {
      otpBox.classList.add('is-bad');
      code.focus();
      return setError(otpErr, 'El código tiene 6 dígitos.');
    }
    setError(otpErr, '');
    $('#sop-otp-ok').textContent = '';
    const go = $('#sop-otp-go');
    busy(go, true, 'Confirmando…');
    const r = await call('POST', '/auth/verify-otp', { temp_token: tempToken, code: value }, { auth: false });
    if (!r.ok) {
      busy(go, false, 'Confirmar');
      if (r.status === 401) {
        show('login', emailIn);
        return setError(loginErr, r.message || 'El ingreso venció. Entrá de nuevo.');
      }
      if (needs2fa(r)) return show('need2fa', $('#sop-need2fa-title'));
      otpBox.classList.add('is-bad');
      otpBox.classList.remove('is-shake');
      void otpBox.offsetWidth;
      otpBox.classList.add('is-shake');
      paintOtp('');
      code.focus();
      return setError(otpErr, r.message || 'Ese código no sirve. Probá de nuevo.');
    }
    await startSession(r.data);
    busy(go, false, 'Confirmar');
  });

  // Reenviar, con una espera corta para no apretarlo diez veces.
  const resend = $('#sop-otp-resend');
  let resendTimer = null;
  const cooldown = (secs) => {
    clearInterval(resendTimer);
    let left = secs;
    resend.disabled = true;
    resend.textContent = `Reenviar en ${left} s`;
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        resend.disabled = false;
        resend.textContent = 'Reenviar el código';
      } else resend.textContent = `Reenviar en ${left} s`;
    }, 1000);
  };
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    const r = await call('POST', '/auth/resend-otp', { temp_token: tempToken }, { auth: false });
    setError(otpErr, r.ok ? '' : (r.message || 'No pudimos reenviarlo.'));
    $('#sop-otp-ok').textContent = r.ok ? 'Te mandamos un código nuevo.' : '';
    if (r.ok) { paintOtp(''); code.focus(); cooldown(30); } else resend.disabled = false;
  });

  $('#sop-otp-back').addEventListener('click', () => {
    tempToken = null;
    clearInterval(resendTimer);
    resend.disabled = false;
    resend.textContent = 'Reenviar el código';
    show('login', passIn);
  });
  $('#sop-logout').addEventListener('click', () => logout());
  $('#sop-denied-back').addEventListener('click', () => show('login', emailIn));
  $('#sop-need2fa-back').addEventListener('click', () => show('login', passIn));
  $('#sop-expired-back').addEventListener('click', () => show('login', emailIn.value ? passIn : emailIn));

  // WCAG 2.2.2: la escena del ingreso se puede pausar.
  const pause = $('#sop-pause');
  pause.addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('paused');
    document.documentElement.classList.toggle('paused', on);
    pause.classList.toggle('is-paused', on);
    $('.pause-t', pause).textContent = on ? 'Reanudar la animación' : 'Pausar la animación';
  });

  /* ---------- Fechas, en la hora de Costa Rica ---------- */
  const TZ = 'America/Costa_Rica';
  const fmtFull = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const fmtWeekday = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'short' });
  const fmtShort = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: 'numeric', month: 'short' });
  const fmt = (iso) => fmtFull.format(new Date(iso));
  const dayKey = (d) => fmtKey.format(d);
  const strip = (s) => s.replace(/\.$/, '');
  /** Cuánto hace, corto, para la lista: "7 min", "3 h", "ayer", "lun", "12 nov". */
  function ago(iso) {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `${mins} min`;
    if (mins < 60 * 24 && dayKey(d) === dayKey(new Date())) return `${Math.floor(mins / 60)} h`;
    if (dayKey(d) === dayKey(new Date(Date.now() - 864e5))) return 'ayer';
    if (mins < 60 * 24 * 6) return strip(fmtWeekday.format(d));
    return strip(fmtShort.format(d));
  }
  /** Cuánto hace, dicho entero, como en la app. */
  function agoLong(iso) {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return 'recién';
    if (mins < 60) return `hace ${mins} min`;
    if (mins < 60 * 24) return `hace ${Math.floor(mins / 60)} h`;
    const days = Math.floor(mins / (60 * 24));
    return days === 1 ? 'ayer' : `hace ${days} días`;
  }
  function dayLabel(d) {
    const k = dayKey(d);
    if (k === dayKey(new Date())) return 'Hoy';
    if (k === dayKey(new Date(Date.now() - 864e5))) return 'Ayer';
    return fmtDay.format(d);
  }
  const timeEl = (iso, cls, text) => {
    const t = el('time', cls, text);
    t.dateTime = iso;
    t.title = fmt(iso);
    return t;
  };
  // Lo de "hace cuánto" se refresca solo.
  setInterval(() => {
    $$('[data-ago]').forEach((t) => { t.textContent = (t.dataset.ago === 'long' ? agoLong : ago)(t.dateTime); });
  }, 60000);

  /* ---------- Avatares ---------- */
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = Array.from(words[0])[0] || '';
    const last = words.length > 1 ? Array.from(words[words.length - 1])[0] || '' : '';
    return (first + last).toUpperCase();
  }
  const avatar = (name, seed, cls) => el('span', `av av--${Math.abs(Number(seed) || 0) % 5}${cls ? ' ' + cls : ''}`, initials(name));
  const supportAvatar = (cls) => {
    const a = el('span', 'av av--sup' + (cls ? ' ' + cls : ''));
    a.append(icon('house'));
    return a;
  };

  /* ---------- La bandeja ---------- */
  const STATUS = { open: 'Abierta', answered: 'Respondida', closed: 'Cerrada' };
  const TITLES = { open: 'Abiertas', answered: 'Respondidas', closed: 'Cerradas', '': 'Todas' };
  const EMPTY = {
    open: ['Bandeja al día', 'No hay consultas esperando respuesta. Las nuevas aparecen acá.'],
    answered: ['Nada respondido por ahora', 'Las que contestes quedan acá hasta que la persona vuelva a escribir o las cierres.'],
    closed: ['Ninguna cerrada todavía', 'Cuando cierres un caso, queda acá con su hilo completo.'],
    '': ['Todavía no llegó ninguna consulta', 'Cuando alguien escriba desde “Ayuda y soporte” en la app, aparece acá.'],
  };
  let filter = 'open';
  let topic = null; // la clave del tema elegido, o null para todos
  let cases = [];
  let cursor = null;
  let current = null;
  let counts = {}; // { open: { n, more }, … }
  const drafts = new Map(); // lo que se estaba respondiendo en cada caso
  let listSeq = 0;

  const topicKey = (c) => (c.topic ? 'tema-' + c.topic.id_help_topic : 'otro');
  const topicTitle = (c) => (c.topic ? c.topic.title : 'Otro tema');
  const topicColor = (c) => (c.topic ? c.topic.id_help_topic % 5 : 'x');

  function paintMe() {
    const name = session ? session.name : '';
    $('#sop-who').textContent = name;
    $('#sop-me').textContent = initials(name);
  }

  async function openPanel() {
    const r = await loadList(true);
    if (r === 'denied' || r === 'expired' || !session) return;
    paintMe();
    show('panel');
    refreshCounts();
    const m = /^#caso-(\d{1,10})$/.exec(location.hash);
    if (m) openCase(Number(m[1]));
  }

  /** La cuenta entró, pero no es de soporte: se cierra su sesión. */
  function deny(r) {
    const refresh = session && session.refresh;
    session = null;
    if (refresh) call('POST', '/auth/logout', { refresh_token: refresh }, { auth: false });
    if (needs2fa(r)) show('need2fa', $('#sop-need2fa-title'));
    else show('denied', $('#sop-denied-title'));
  }

  function skeletonList() {
    const list = $('#sop-cases');
    list.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const li = el('li', 'skel');
      li.setAttribute('aria-hidden', 'true');
      li.append(el('span', 'sk'), el('span', 'sk'), el('span', 'sk'), el('span', 'sk'));
      list.append(li);
    }
    $('#sop-list-msg').hidden = true;
    $('#sop-more').hidden = true;
  }

  async function loadList(reset) {
    const seq = ++listSeq;
    const state = $('#sop-list-state');
    const more = $('#sop-more');
    if (reset) {
      cases = [];
      cursor = null;
      skeletonList();
    } else busy(more, true);
    state.textContent = 'Cargando casos…';
    const q = new URLSearchParams();
    if (filter) q.set('status', filter);
    if (cursor) q.set('cursor', cursor);
    const r = await call('GET', '/support/admin/cases' + (q.toString() ? '?' + q : ''));
    busy(more, false);
    if (seq !== listSeq) return 'stale';
    if (r.status === 401 && !session) return 'expired';
    if (r.status === 403) {
      deny(r);
      return 'denied';
    }
    if (!r.ok) {
      listMessage('error', r.message || 'No pudimos cargar los casos.');
      state.textContent = r.message || 'No pudimos cargar los casos.';
      return 'error';
    }
    cases = cases.concat((r.data && r.data.data) || []);
    cursor = (r.data && r.data.next_cursor) || null;
    // Con todo cargado, la cuenta de ese estado es exacta.
    if (filter && !cursor) { counts[filter] = { n: cases.length, more: false }; paintCounts(); }
    renderList();
    return 'ok';
  }

  /** Cuántos hay en cada estado: la primera tanda de cada uno (de a 20). */
  async function refreshCounts() {
    const statuses = ['open', 'answered', 'closed'];
    const res = await Promise.all(statuses.map((s) => call('GET', '/support/admin/cases?status=' + s)));
    if (!session) return;
    res.forEach((r, i) => {
      if (r.ok && r.data && Array.isArray(r.data.data)) {
        counts[statuses[i]] = { n: r.data.data.length, more: !!r.data.next_cursor };
      }
    });
    paintCounts();
  }

  function paintCounts() {
    const label = (c) => (c ? c.n + (c.more ? '+' : '') : '');
    const all = ['open', 'answered', 'closed'].map((s) => counts[s]);
    $$('[data-count]').forEach((n) => {
      const k = n.dataset.count;
      if (k === 'all') {
        n.textContent = all.every(Boolean)
          ? all.reduce((a, c) => a + c.n, 0) + (all.some((c) => c.more) ? '+' : '') : '';
      } else n.textContent = label(counts[k]);
      if (k === 'open') n.classList.toggle('has', !!(counts.open && counts.open.n));
    });
  }

  function illo(kind) {
    const box = el('div', 'illo');
    box.setAttribute('aria-hidden', 'true');
    const house = icon('house', 'illo-house');
    box.append(house);
    if (kind === 'error') {
      const w = el('span', 'illo-warn');
      w.append(icon('i-alert'));
      box.append(w);
    } else if (kind === 'done') {
      const c = el('span', 'illo-check');
      c.append(icon('i-check'));
      box.append(c);
    } else {
      const a = el('span', 'illo-bub illo-bub--in');
      a.append(el('i'), el('i'));
      const b = el('span', 'illo-bub illo-bub--out');
      b.append(el('i'));
      box.append(a, b);
    }
    return box;
  }

  function listMessage(kind, text, title, action) {
    const box = $('#sop-list-msg');
    box.replaceChildren();
    $('#sop-cases').replaceChildren();
    box.append(illo(kind === 'error' ? 'error' : (filter === 'open' && !topic ? 'done' : 'empty')));
    box.append(el('p', 'empty-h', title || (kind === 'error' ? 'No pudimos cargar la bandeja' : '')));
    box.append(el('p', 'empty-t', text));
    if (kind === 'error') {
      $('#sop-list-n').textContent = '';
      renderTopics();
      const retry = el('button', 'go go--ghost go--sm', 'Reintentar');
      retry.type = 'button';
      retry.addEventListener('click', () => { loadList(true); refreshCounts(); });
      box.append(retry);
    } else if (action) box.append(action);
    box.hidden = false;
    $('#sop-more').hidden = kind === 'error' || !cursor;
  }

  function itemFor(c) {
    const li = el('li');
    const b = el('button', 'sop-item');
    b.type = 'button';
    b.dataset.id = String(c.id_support_case);
    const isCurrent = current && current.id_support_case === c.id_support_case;
    if (isCurrent) { b.classList.add('is-current'); b.setAttribute('aria-current', 'true'); }
    const waiting = c.status === 'open';
    if (waiting) b.classList.add('is-waiting');
    const name = c.person.name || 'Cuenta eliminada';

    const top = el('span', 'item-top');
    top.append(el('span', 'item-name', name));
    if (waiting) {
      const dot = el('span', 'wait');
      dot.title = 'Espera respuesta de soporte';
      top.append(dot, el('span', 'sr', ' · espera respuesta · '));
    }
    const when = timeEl(c.last_message_at, 'item-when', ago(c.last_message_at));
    when.dataset.ago = 'short';
    top.append(when);

    const meta = el('span', 'item-meta');
    meta.append(el('span', '', '#' + c.id_support_case + ' · ' + topicTitle(c)));
    if (!filter) meta.append(el('span', 'item-st item-st--' + c.status, STATUS[c.status] || c.status));

    const prev = el('span', 'item-prev');
    if (c.last_message.sender === 'support') prev.append(el('b', '', 'Soporte: '));
    prev.append(document.createTextNode(c.last_message.preview));

    b.append(avatar(name, c.person.id_user), top, meta, prev);
    b.addEventListener('click', () => openCase(c.id_support_case));
    li.append(b);
    return li;
  }

  function renderList() {
    const list = $('#sop-cases');
    const shown = topic ? cases.filter((c) => topicKey(c) === topic) : cases;
    list.replaceChildren(...shown.map(itemFor));
    $('#sop-list-msg').hidden = true;
    $('#sop-more').hidden = !cursor;
    $('#sop-list-title').textContent = TITLES[filter];
    $('#sop-list-n').textContent = shown.length ? shown.length + (cursor && !topic ? '+' : '') : '';
    $('#sop-list-state').textContent = shown.length
      ? `${shown.length} ${shown.length === 1 ? 'caso' : 'casos'} en ${TITLES[filter].toLowerCase()}`
      : 'No hay casos en este estado.';
    const hint = $('#sop-list-hint');
    hint.hidden = !(topic && cursor);
    hint.textContent = topic && cursor ? 'El tema filtra lo cargado: “Ver más” trae los anteriores.' : '';
    if (!shown.length) {
      if (topic) {
        const all = el('button', 'go go--ghost go--sm', 'Ver todos los temas');
        all.type = 'button';
        all.addEventListener('click', () => { topic = null; renderList(); });
        const name = (topicsSeen.get(topic) || {}).title || 'este tema';
        listMessage('empty', `En lo cargado de ${TITLES[filter].toLowerCase()} no hay consultas de “${name}”.`, 'Nada de este tema', all);
      } else listMessage('empty', EMPTY[filter][1], EMPTY[filter][0]);
    }
    renderTopics();
  }

  // Los temas de lo cargado, con su cantidad.
  const topicsSeen = new Map();
  function renderTopics() {
    const tally = new Map();
    for (const c of cases) {
      const k = topicKey(c);
      const t = tally.get(k) || { title: topicTitle(c), color: topicColor(c), n: 0 };
      t.n += 1;
      tally.set(k, t);
      topicsSeen.set(k, t);
    }
    if (topic && !tally.has(topic)) tally.set(topic, { ...(topicsSeen.get(topic) || { title: 'Tema', color: 'x' }), n: 0 });
    const ul = $('#sop-topics');
    ul.replaceChildren();
    if (!tally.size) {
      ul.append(el('li', 'topics-none', 'Sin temas en esta bandeja.'));
      return;
    }
    const row = (key, title, n, color) => {
      const li = el('li');
      const b = el('button', 'topic');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(topic === key));
      const dot = el('span', 'topic-dot');
      if (color !== null) dot.classList.add('av--' + color);
      b.append(dot, el('span', 'topic-t', title), el('span', 'topic-n', n));
      b.addEventListener('click', () => { topic = topic === key || key === null ? null : key; renderList(); });
      li.append(b);
      return li;
    };
    ul.append(row(null, 'Todos los temas', cases.length, null));
    [...tally.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[1].title.localeCompare(b[1].title, 'es'))
      .forEach(([k, t]) => ul.append(row(k, t.title, t.n, t.color === 'x' ? null : t.color)));
  }

  function selectTab(tab) {
    filter = tab.dataset.status;
    $$('.sop-tab').forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    $('#sop-list-title').textContent = TITLES[filter];
    $('#sop-list-scroll').scrollTop = 0;
    loadList(true);
  }
  $$('.sop-tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab)));
  // Las flechas recorren las pestañas, como pide el patrón de tablist.
  $('.tabs').addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const tabs = $$('.sop-tab');
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
    next.focus();
    selectTab(next);
  });
  $('#sop-more').addEventListener('click', () => loadList(false));

  const refreshBtn = $('#sop-refresh');
  async function refreshAll() {
    refreshBtn.classList.add('is-spin');
    const jobs = [loadList(true), refreshCounts()];
    if (current) jobs.push(openCase(current.id_support_case, { focus: false, quiet: true }));
    await Promise.all(jobs);
    refreshBtn.classList.remove('is-spin');
  }
  refreshBtn.addEventListener('click', refreshAll);

  /* ---------- El caso ---------- */
  const caseEmpty = $('#sop-case-empty');
  const caseBody = $('#sop-case-body');
  const caseSkel = $('#sop-case-skel');
  const caseErr = $('#sop-case-error');
  const reply = $('#sop-reply');
  let caseSeq = 0;

  function showCaseEmpty(title, text, retryId) {
    caseEmpty.hidden = false;
    caseEmpty.classList.toggle('is-error', !!title);
    if (caseSkel) caseSkel.hidden = true;
    $('#sop-case-empty-h').textContent = title || 'Elegí un caso de la lista';
    $('#sop-case-empty-t').textContent = text || 'El hilo se abre acá, con los datos del teléfono de la persona.';
    const retry = $('#sop-case-retry');
    retry.hidden = !retryId;
    retry.dataset.id = retryId ? String(retryId) : '';
    $('.empty-keys', caseEmpty).hidden = !!title;
    const art = $('.illo', caseEmpty);
    art.replaceWith(illo(title ? 'error' : 'empty'));
  }
  $('#sop-case-retry').addEventListener('click', (e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (id) openCase(id);
  });

  function markCurrent() {
    $$('.sop-item').forEach((b) => {
      const on = !!current && Number(b.dataset.id) === current.id_support_case;
      b.classList.toggle('is-current', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  function saveDraft() {
    if (current) {
      if (reply.value.trim()) drafts.set(current.id_support_case, reply.value);
      else drafts.delete(current.id_support_case);
    }
  }

  async function openCase(id, { focus = true, quiet = false } = {}) {
    const seq = ++caseSeq;
    const same = current && current.id_support_case === id;
    if (!same) saveDraft();
    setError(caseErr, '');
    if (!quiet) panel.dataset.view = 'case';
    // El esqueleto solo si tarda: un caso que llega enseguida no parpadea.
    const skelTimer = quiet ? null : setTimeout(() => {
      if (seq !== caseSeq) return;
      caseBody.hidden = true;
      caseEmpty.hidden = true;
      caseSkel.hidden = false;
    }, 140);
    const r = await call('GET', '/support/admin/cases/' + id);
    clearTimeout(skelTimer);
    if (seq !== caseSeq) return;
    caseSkel.hidden = true;
    if (!r.ok) {
      if (r.status === 401 && !session) return;
      if (quiet) return;
      caseBody.hidden = true;
      showCaseEmpty('No pudimos abrir el caso', r.message || 'Probá de nuevo en un momento.', r.status === 404 ? null : id);
      return;
    }
    current = r.data;
    if (history.replaceState) history.replaceState(null, '', '#caso-' + id);
    renderCase({ keepScroll: quiet && same });
    markCurrent();
    if (focus) $('#sop-case-title').focus({ preventScroll: true });
  }

  function fact(iconId, label, values, extra) {
    const row = el('div', 'fact');
    row.append(icon(iconId), el('dt', '', label));
    values.filter(Boolean).forEach((v) => {
      if (typeof v === 'string') row.append(el('dd', '', v));
      else row.append(v);
    });
    if (extra) row.append(extra);
    return row;
  }
  const PLATFORM = { ios: 'iOS', android: 'Android' };
  /** El correo, que en un renglón angosto se corta después de un punto o la arroba. */
  function mailDd(email) {
    const dd = el('dd', 'mail');
    email.split(/(?<=[.@])/).forEach((part, i) => {
      if (i) dd.append(document.createElement('wbr'));
      dd.append(document.createTextNode(part));
    });
    return dd;
  }

  function renderFacts(c) {
    const meta = $('#sop-case-meta');
    meta.replaceChildren();
    const name = c.person.name || 'Cuenta eliminada';
    let copy = null;
    if (c.person.email) {
      copy = el('button', 'ibtn');
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copiar el correo');
      copy.append(icon('i-copy'));
      const email = c.person.email;
      copy.addEventListener('click', () => {
        if (!navigator.clipboard) return toast('No se pudo copiar desde este navegador.', true);
        navigator.clipboard.writeText(email).then(() => toast('Correo copiado.'), () => toast('No se pudo copiar.', true));
      });
    }
    const plat = PLATFORM[c.platform] || c.platform || '';
    const os = c.os_version || '';
    const osLine = os && os.toLowerCase().startsWith(plat.toLowerCase()) ? os : [plat, os].filter(Boolean).join(' ');
    meta.append(
      fact('i-user', 'Cuenta', [name, c.person.email ? mailDd(c.person.email) : (c.person.name ? '' : 'La persona cerró su cuenta')], copy),
      fact('i-box', 'Versión de la app', [c.app_version || 'No la mandó']),
      fact('i-phone', 'Plataforma', [osLine || 'No la mandó']),
      fact('i-phone', 'Teléfono', [c.device_model || 'No lo mandó']),
      fact('i-cal', 'Abierta', [fmt(c.created_at), agoLong(c.created_at)]),
      fact('i-clock', 'Última actividad', [fmt(c.last_message_at)]),
    );
    if (c.closed_at) meta.append(fact('i-archive', 'Cerrada', [fmt(c.closed_at)]));
    // Los correlationId de los pedidos que le fallaron a la app antes de
    // escribir: se buscan tal cual en el registro de la API (Railway).
    const ids = Array.isArray(c.recent_request_ids)
      ? c.recent_request_ids.filter((x) => typeof x === 'string' && x) : [];
    if (ids.length) {
      // Discretos y copiables: un clic selecciona el id entero, y el botón
      // copia todos, uno por renglón, para pegarlos en el buscador de registros.
      const list = el('dd', 'rids');
      ids.forEach((id) => list.append(el('code', 'rid', id)));
      const copyIds = el('button', 'ibtn');
      copyIds.type = 'button';
      copyIds.setAttribute('aria-label', ids.length === 1 ? 'Copiar el id del pedido' : `Copiar los ${ids.length} ids de pedido`);
      copyIds.append(icon('i-copy'));
      copyIds.addEventListener('click', () => {
        if (!navigator.clipboard) return toast('No se pudo copiar desde este navegador.', true);
        navigator.clipboard.writeText(ids.join('\n'))
          .then(() => toast(ids.length === 1 ? 'Id copiado.' : 'Ids copiados.'), () => toast('No se pudo copiar.', true));
      });
      meta.append(fact('i-alert', 'Pedidos que fallaron', [list], copyIds));
    }
    $('#sop-facts-sum').textContent = [c.device_model || plat, c.app_version ? 'App ' + c.app_version : '']
      .filter(Boolean).join(' · ') || 'Datos del caso';
  }

  const facts = $('#sop-facts');
  const factsToggle = $('#sop-facts-toggle');
  factsToggle.addEventListener('click', () => {
    const open = !facts.classList.contains('is-open');
    facts.classList.toggle('is-open', open);
    factsToggle.setAttribute('aria-expanded', String(open));
  });

  const validShot = (url) => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(url);

  function renderThread(c) {
    const thread = $('#sop-thread');
    thread.replaceChildren();
    const personName = c.person.name || 'Cuenta eliminada';
    let lastDay = null;
    let prev = null;
    for (const m of c.messages) {
      const at = new Date(m.created_at);
      const key = dayKey(at);
      if (key !== lastDay) {
        const day = el('li', 'day', dayLabel(at));
        day.setAttribute('role', 'presentation');
        thread.append(day);
        lastDay = key;
        prev = null;
      }
      const support = m.sender === 'support';
      const li = el('li', 'sop-msg sop-msg--' + (support ? 'support' : 'person'));
      if (prev && prev.sender === m.sender && prev.author_name === m.author_name && at - new Date(prev.created_at) < 10 * 60000) {
        li.classList.add('is-cont');
      }
      const av = support ? supportAvatar('msg-av') : avatar(personName, c.person.id_user, 'msg-av');
      av.setAttribute('aria-hidden', 'true');
      const col = el('div', 'msg-col');
      const bubble = el('div', 'msg-bubble', m.body);
      if (validShot(m.attachment_url)) bubble.append(shotFor(m.attachment_url, personName));
      const metaLine = el('span', 'msg-meta');
      if (support) {
        metaLine.append(el('b', '', 'Soporte'), document.createTextNode(' · ' + m.author_name + ' · '));
      } else {
        metaLine.append(el('b', '', m.author_name || personName), document.createTextNode(' · '));
      }
      metaLine.append(timeEl(m.created_at, '', fmtTime.format(at)));
      col.append(bubble, metaLine);
      li.append(av, col);
      thread.append(li);
      prev = m;
    }
  }

  function shotFor(url, name) {
    const b = el('button', 'shot');
    b.type = 'button';
    b.setAttribute('aria-label', 'Ver la captura en grande');
    const img = document.createElement('img');
    img.alt = 'Captura que adjuntó ' + name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => b.classList.add('is-broken'));
    // Si el hilo estaba abajo, que siga abajo cuando la captura termina de cargar.
    img.addEventListener('load', () => {
      const wrap = $('#sop-thread-wrap');
      if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < img.clientHeight + 120) wrap.scrollTop = wrap.scrollHeight;
    });
    img.src = url;
    const cap = el('span', 'shot-cap');
    cap.append(icon('i-image'), document.createTextNode('Ver la captura'));
    b.append(img, cap);
    b.addEventListener('click', () => openShot(url, img.alt));
    return b;
  }

  function renderCase({ keepScroll = false } = {}) {
    const c = current;
    caseEmpty.hidden = true;
    caseSkel.hidden = true;
    caseBody.hidden = false;
    const name = c.person.name || 'Cuenta eliminada';
    const title = $('#sop-case-title');
    title.replaceChildren(
      el('span', 'ct-id', '#' + c.id_support_case + ' · ' + topicTitle(c)),
      el('span', 'sr', ' — '),
      el('span', 'ct-name', name),
    );
    $('#sop-case-av').replaceWith(Object.assign(avatar(name, c.person.id_user, 'av--lg'), { id: 'sop-case-av' }));
    $('#sop-case-av').setAttribute('aria-hidden', 'true');
    const badge = $('#sop-case-status');
    badge.className = 'badge badge--' + c.status;
    badge.textContent = STATUS[c.status] || c.status;

    renderFacts(c);
    const wrap = $('#sop-thread-wrap');
    const keep = keepScroll ? wrap.scrollTop : null;
    renderThread(c);
    wrap.scrollTop = keep === null ? wrap.scrollHeight : keep;

    const closed = c.status === 'closed';
    $('#sop-reply-form').hidden = closed;
    $('#sop-close').hidden = closed;
    $('#sop-closed').hidden = !closed;
    $('#sop-closed-t').textContent = closed && c.closed_at
      ? `Cerrado el ${fmt(c.closed_at)}: no recibe más mensajes.`
      : 'El caso está cerrado: no recibe más mensajes.';
    if (!closed && !keepScroll) {
      reply.value = drafts.get(c.id_support_case) || '';
      paintReply();
    }
  }

  /* ---------- Responder ---------- */
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  $('#sop-mod').textContent = isMac ? '⌘' : 'Ctrl';
  const autosize = !(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));
  function paintReply() {
    const n = reply.value.length;
    $('#sop-reply-count').textContent = String(n);
    $('.counter').classList.toggle('is-near', n > 1800);
    $('#sop-reply-go').classList.toggle('is-empty', !reply.value.trim());
    if (autosize) {
      reply.style.height = 'auto';
      reply.style.height = Math.min(reply.scrollHeight, window.innerHeight * 0.38) + 'px';
    }
  }
  reply.addEventListener('input', () => {
    paintReply();
    setError(caseErr, '');
    if (current) drafts.set(current.id_support_case, reply.value);
  });
  reply.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#sop-reply-form').requestSubmit();
    } else if (e.key === 'Escape') reply.blur();
  });

  $('#sop-reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = reply.value.trim();
    if (!text) { reply.focus(); return setError(caseErr, 'Escribí la respuesta.'); }
    setError(caseErr, '');
    const go = $('#sop-reply-go');
    if (go.disabled) return;
    busy(go, true);
    const id = current.id_support_case;
    const r = await call('POST', '/support/admin/cases/' + id + '/messages', { body: text });
    busy(go, false);
    if (!r.ok) return setError(caseErr, r.message || 'No pudimos mandar la respuesta.');
    drafts.delete(id);
    reply.value = '';
    current = r.data;
    renderCase();
    paintReply();
    toast('Respuesta enviada: le llega un aviso en la app y un correo.');
    loadList(true);
    refreshCounts();
  });

  /* ---------- Cerrar, con confirmación ---------- */
  const confirmDlg = $('#sop-confirm');
  $('#sop-close').addEventListener('click', () => {
    if (!current) return;
    $('#sop-confirm-h').textContent = `¿Cerrar el caso #${current.id_support_case}?`;
    confirmDlg.showModal();
    $('#sop-confirm-cancel').focus();
  });
  $('#sop-confirm-cancel').addEventListener('click', () => confirmDlg.close());
  $('#sop-confirm-ok').addEventListener('click', async () => {
    const ok = $('#sop-confirm-ok');
    busy(ok, true, 'Cerrando…');
    const r = await call('POST', '/support/admin/cases/' + current.id_support_case + '/close');
    busy(ok, false, 'Cerrar el caso');
    confirmDlg.close();
    if (!r.ok) return toast(r.message || 'No pudimos cerrarlo.', true);
    current = r.data;
    drafts.delete(current.id_support_case);
    renderCase();
    toast('Caso cerrado: a la persona le llega un aviso.');
    $('#sop-case-title').focus({ preventScroll: true });
    loadList(true);
    refreshCounts();
  });

  /* ---------- La captura, grande ---------- */
  const lightbox = $('#sop-lightbox');
  function openShot(url, alt) {
    if (!validShot(url)) return;
    const img = $('#sop-lightbox-img');
    img.src = url;
    img.alt = alt;
    $('#sop-lightbox-open').href = url;
    lightbox.showModal();
    $('#sop-lightbox-close').focus();
  }
  $('#sop-lightbox-close').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('close', () => { $('#sop-lightbox-img').removeAttribute('src'); });

  /* ---------- Volver a la lista (teléfono) ---------- */
  function backToList() {
    saveDraft();
    panel.dataset.view = 'list';
    const item = current && $(`.sop-item[data-id="${current.id_support_case}"]`);
    if (item) item.focus(); else $('#sop-refresh').focus();
  }
  $('#sop-back').addEventListener('click', backToList);

  /* ---------- Avisos ---------- */
  const toastEl = $('#sop-toast');
  let toastTimer = null;
  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.classList.toggle('is-bad', !!bad);
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 4200);
  }

  /* ---------- Atajos de teclado (opcionales) ---------- */
  const keysDlg = $('#sop-keys');
  $('#sop-keys-open').addEventListener('click', () => keysDlg.showModal());
  $('#sop-keys-close').addEventListener('click', () => keysDlg.close());

  function move(step) {
    const items = $$('.sop-item');
    if (!items.length) return;
    const at = current ? items.findIndex((b) => Number(b.dataset.id) === current.id_support_case) : -1;
    const next = items[Math.max(0, Math.min(items.length - 1, at === -1 ? 0 : at + step))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    if (!current || Number(next.dataset.id) !== current.id_support_case) {
      openCase(Number(next.dataset.id), { focus: false });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (panel.hidden || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const tabs = $$('.sop-tab');
    switch (e.key) {
      case 'j': move(1); break;
      case 'k': move(-1); break;
      case 'r':
        if (!current || current.status === 'closed' || caseBody.hidden) return;
        panel.dataset.view = 'case';
        reply.focus();
        break;
      case '1': case '2': case '3': case '4': selectTab(tabs[Number(e.key) - 1]); tabs[Number(e.key) - 1].focus(); break;
      case 'u': refreshAll(); break;
      case '?': keysDlg.showModal(); break;
      case 'Escape':
        if (panel.dataset.view === 'case' && matchMedia('(max-width: 759.98px)').matches) backToList();
        else return;
        break;
      default: return;
    }
    e.preventDefault();
  });

  show('login', emailIn);
})();
