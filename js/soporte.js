/* =====================================================================
   ImHomi · panel de soporte (decisión 51)
   Entra con el ingreso de la API (con el código si la cuenta tiene
   verificación en dos pasos), lista los casos por estado, muestra el hilo,
   responde y cierra. Revisa las verificaciones de anuncios (decisión 54):
   compara las fotos y el punto con lo que dice el anuncio, y aprueba o
   rechaza con el motivo. Y atiende los reportes (decisión 52): descarta lo
   reportado o lo oculta con el motivo que lee el autor. Solo lo abre una cuenta con users.role = 'support':
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

  /* ---------- La sesión del panel, en memoria ----------
     Decisión 66: el panel tiene su propia sesión, que solo se emite después
     del código de la verificación en dos pasos. Dura 8 horas fijas y no se
     renueva: vencida, se vuelve a entrar con la contraseña y el código. La
     sesión de la app no abre el panel (401 PANEL_SESION_INVALIDA). */
  let session = null; // { access, name, agentId, expiresAt }
  let tempToken = null;
  let expiryTimer = null;

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
  async function call(method, path, body, { auth = true, token = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const bearer = token || (auth && session ? session.access : null);
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const sent = auth ? session : null;
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
    const data = json && 'data' in json ? json.data : json;
    const raw = json && json.message;
    const result = {
      ok: response.ok,
      status: response.status,
      data,
      code: json && json.code,
      details: (json && json.details) || null,
      message: Array.isArray(raw) ? raw[0] : (typeof raw === 'string' ? raw : ''),
    };
    // La sesión del panel ya no vale (venció, se cerró, le quitaron el rol,
    // la cuenta cerró sus sesiones): no se renueva, se vuelve a entrar.
    // Solo si es la sesión con que salió el pedido: una respuesta vieja no
    // echa a quien ya entró de nuevo.
    if (sent && sent === session) {
      if (response.status === 401) expire(result.message);
      else if (response.status === 403 && result.code === CODE_NEEDS_2FA) {
        endSession();
        showNeeds2fa(result.message);
      }
    }
    return result;
  }

  /** El código y la contraseña dieron una sesión del panel: se abre. */
  async function startSession(data) {
    session = {
      access: data.access_token,
      name: (data.agent && data.agent.name) || '',
      agentId: (data.agent && data.agent.id_user) || null,
      expiresAt: data.expires_at || null,
    };
    tempToken = null;
    $('#sop-password').value = '';
    paintOtp('');
    await openPanel();
  }

  /** A las 8 horas la sesión vence sola: se avisa en el momento, no en el próximo clic. */
  function armExpiry() {
    clearTimeout(expiryTimer);
    const at = session && session.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
    if (!Number.isFinite(at)) return;
    // setTimeout no aguanta más de ~24 días; 8 horas entran de sobra.
    expiryTimer = setTimeout(() => expire(), Math.max(0, at - Date.now()) + 1000);
  }

  /** Corta la sesión en la API y limpia todo lo de la bandeja. */
  function endSession() {
    const token = session && session.access;
    session = null;
    clearTimeout(expiryTimer);
    // Revoca la sesión en el momento (H7). Contesta lo mismo aunque ya no valga.
    if (token) call('POST', '/support/admin/session/logout', undefined, { auth: false, token });
    cases = [];
    cursor = null;
    current = null;
    counts = {};
    drafts.clear();
    $('#sop-cases').replaceChildren();
    $('#sop-case-body').hidden = true;
    showCaseEmpty();
    resetVerifs();
    resetReports();
    paintSection('cases');
    panel.dataset.view = 'list';
  }

  function logout() {
    endSession();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    show('login', $('#sop-email'));
    setError($('#sop-login-error'), '');
  }

  /** La sesión del panel terminó: se dice, con volver a entrar. */
  const EXPIRED_TEXT = 'Por seguridad, la sesión del panel dura 8 horas y se cierra si cambia algo de la cuenta. Lo que no llegaste a enviar no salió.';
  function expire(message) {
    if (!session) return;
    endSession();
    $('#sop-expired-text').textContent = message || EXPIRED_TEXT;
    show('expired', $('#sop-expired-title'));
  }

  /* ---------- Entrar ---------- */
  const busy = (btn, on, label) => {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    const t = $('.go-t', btn);
    if (label && t) t.textContent = label;
  };

  // Decisión 66: el panel solo abre con la verificación en dos pasos. Una
  // cuenta de soporte sin ella recibe este código y se le muestra cómo
  // prenderla; una sin el rol, SIN_PERMISO.
  const CODE_NEEDS_2FA = 'PANEL_REQUIERE_2FA';
  const CODE_NO_ROLE = 'SIN_PERMISO';
  const CODE_OWN_CASE = 'SOPORTE_CASO_PROPIO';
  const CODE_CASE_CLOSED = 'CASO_CERRADO';
  // El panel tiene un tope de códigos por cuenta y por hora, contando todos
  // los orígenes. La API no dice cuánto falta: si no viene, se espera esto.
  const CODE_OTP_LIMIT = 'OTP_DEMASIADOS';
  const OTP_LIMIT_WAIT = 10 * 60;
  const OWN_CASE = 'Esta consulta es tuya: la contesta otra persona del equipo.';
  const needs2fa = (r) => r && r.status === 403 && r.code === CODE_NEEDS_2FA;
  const noRole = (r) => r && r.status === 403 && r.code === CODE_NO_ROLE;
  function showNeeds2fa(message) {
    // Va el mensaje de la API tal cual. Si ya trae el camino en la app, los
    // pasos de la tarjeta sobran; si no lo trae, lo dicen ellos.
    $('#sop-need2fa-text').textContent = message || 'El panel solo abre con el código que llega a tu correo. Prendela desde la app y volvé a entrar:';
    $('#sop-need2fa .crumbs').hidden = !!message && /Seguridad y 2FA/.test(message);
    show('need2fa', $('#sop-need2fa-title'));
  }
  // La API dice lo mismo que el título ("Esta cuenta no tiene acceso al panel
  // de soporte."): abajo va qué hacer.
  function showDenied() {
    show('denied', $('#sop-denied-title'));
  }
  /** Lo que se muestra de un ingreso que no entró. */
  const loginMessage = (r) => (r.status === 429
    ? (r.message || 'Hiciste varios intentos seguidos. Esperá un momento.')
    : (r.message || 'No pudimos entrar. Probá de nuevo.'));

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
    const r = await call('POST', '/support/admin/session/login', { email, password }, { auth: false });
    busy(go, false, 'Entrar');
    if (!r.ok) {
      if (needs2fa(r) || noRole(r)) {
        passIn.value = '';
        return needs2fa(r) ? showNeeds2fa(r.message) : showDenied();
      }
      if (r.code === CODE_OTP_LIMIT) blockCodes(email, r);
      passIn.focus();
      return setError(loginErr, loginMessage(r));
    }
    // El panel siempre pide el código: no hay ingreso con la contraseña sola.
    if (!r.data || r.data.status !== 'otp_required' || !r.data.temp_token) {
      return setError(loginErr, 'No pudimos entrar. Probá de nuevo.');
    }
    passIn.value = '';
    tempToken = r.data.temp_token;
    $('#sop-otp-email').textContent = r.data.masked_email || 'tu correo';
    paintOtp('');
    setError($('#sop-otp-error'), '');
    $('#sop-otp-ok').textContent = '';
    otpEmail = email;
    resumeBlock();
    show('otp', $('#sop-code'));
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
    const r = await call('POST', '/support/admin/session', { temp_token: tempToken, code: value }, { auth: false });
    if (!r.ok) {
      busy(go, false, 'Confirmar');
      // 401 PERMISO_VENCIDO: pasó el tiempo o cambió la contraseña en el medio.
      if (r.status === 401) {
        tempToken = null;
        show('login', passIn);
        return setError(loginErr, r.message || 'El ingreso venció. Entrá de nuevo.');
      }
      // Le quitaron el rol o apagó el 2FA mientras tanto.
      if (needs2fa(r)) { tempToken = null; return showNeeds2fa(r.message); }
      if (noRole(r)) { tempToken = null; return showDenied(); }
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

  // Reenviar, con una espera corta para no apretarlo diez veces, y larga si
  // la cuenta llegó al tope de códigos (OTP_DEMASIADOS).
  const resend = $('#sop-otp-resend');
  let resendTimer = null;
  let otpEmail = null; // la cuenta del paso del código
  let otpBlock = null; // { email, until }: la cuenta que llegó al tope y hasta cuándo esperar
  const waitLabel = (left) => (left >= 90 ? `Reenviar en ${Math.ceil(left / 60)} min` : `Reenviar en ${left} s`);
  const cooldown = (secs) => {
    clearInterval(resendTimer);
    let left = Math.max(1, Math.round(secs));
    resend.disabled = true;
    resend.textContent = waitLabel(left);
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        resend.disabled = false;
        resend.textContent = 'Reenviar el código';
      } else resend.textContent = waitLabel(left);
    }, 1000);
  };
  function blockCodes(email, r) {
    const secs = Number(r.details && r.details.retry_after_seconds) || OTP_LIMIT_WAIT;
    otpBlock = { email, until: Date.now() + secs * 1000 };
    if (email === otpEmail) cooldown(secs);
  }
  /** Al volver al paso del código con una cuenta que llegó al tope, "Reenviar" sigue esperando. */
  function resumeBlock() {
    clearInterval(resendTimer);
    const left = otpBlock && otpBlock.email === otpEmail ? (otpBlock.until - Date.now()) / 1000 : 0;
    if (left > 0) cooldown(left);
    else { resend.disabled = false; resend.textContent = 'Reenviar el código'; }
  }
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    const r = await call('POST', '/support/admin/session/resend', { temp_token: tempToken }, { auth: false });
    if (!r.ok && r.status === 401) {
      // El permiso de paso tiene tope (30 minutos desde la contraseña).
      tempToken = null;
      resend.disabled = false;
      show('login', passIn);
      return setError(loginErr, r.message || 'El ingreso venció. Entrá de nuevo.');
    }
    setError(otpErr, r.ok ? '' : (r.message || 'No pudimos reenviarlo.'));
    $('#sop-otp-ok').textContent = r.ok ? ((r.data && r.data.message) || 'Te mandamos un código nuevo.') : '';
    // Llegó al tope de códigos: el mensaje de la API queda en la tarjeta y
    // "Reenviar" espera. El código que ya llegó sigue sirviendo.
    if (!r.ok && r.code === CODE_OTP_LIMIT) return blockCodes(otpEmail, r);
    if (r.ok) {
      // Cada reenvío trae su permiso de paso: el anterior ya no sirve.
      if (r.data && r.data.temp_token) tempToken = r.data.temp_token;
      if (r.data && r.data.masked_email) $('#sop-otp-email').textContent = r.data.masked_email;
      paintOtp('');
      code.focus();
      cooldown(30);
    } else resend.disabled = false;
  });

  $('#sop-otp-back').addEventListener('click', () => {
    tempToken = null;
    otpEmail = null;
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
    const until = session && session.expiresAt ? new Date(session.expiresAt) : null;
    const role = $('.me-role');
    role.textContent = until && !Number.isNaN(until.getTime())
      ? 'Hasta ' + fmtTime.format(until) : 'Equipo de soporte';
    role.title = until && !Number.isNaN(until.getTime())
      ? 'La sesión del panel dura 8 horas y no se renueva: ' + fmt(until.toISOString()) : '';
  }

  async function openPanel() {
    // Quién es y hasta cuándo vale la sesión, de la API.
    const me = await call('GET', '/support/admin/session');
    if (!session) return;
    if (me.ok && me.data) {
      if (me.data.agent && me.data.agent.name) session.name = me.data.agent.name;
      if (me.data.agent && me.data.agent.id_user) session.agentId = me.data.agent.id_user;
      if (me.data.expires_at) session.expiresAt = me.data.expires_at;
    }
    armExpiry();
    // El enlace del correo a soporte: `#caso-<id>`, `#verificacion-<id>` o
    // `#reporte-<id>`.
    const m = /^#caso-(\d{1,10})$/.exec(location.hash);
    const v = /^#verificacion-(\d{1,10})$/.exec(location.hash);
    const rp = /^#reporte-(\d{1,10})$/.exec(location.hash);
    if (v) paintSection('verifs');
    else if (rp) paintSection('reports');
    const r = v ? await loadVerList(true) : rp ? await loadRepList(true) : await loadList(true);
    if (r === 'ended' || !session) return;
    paintMe();
    show('panel');
    refreshCounts();
    refreshVerCounts();
    refreshRepCounts();
    if (v) openVer(Number(v[1]));
    else if (rp) openRep(Number(rp[1]));
    else if (m) openCase(Number(m[1]));
  }

  /** La sesión abrió, pero la cuenta no es de soporte: se cierra. */
  function deny() {
    endSession();
    showDenied();
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
    if (!session) return 'ended'; // la sesión terminó en el medio: call() ya lo mostró
    if (seq !== listSeq) return 'stale';
    if (noRole(r)) {
      deny();
      return 'ended';
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
    // En el selector de sección, las que esperan respuesta.
    const sect = $('[data-sect-count="cases"]');
    sect.textContent = counts.open && counts.open.n ? label(counts.open) : '';
    sect.classList.toggle('has', !!(counts.open && counts.open.n));
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
    } else if (kind === 'pin') {
      const c = el('span', 'illo-pin');
      c.append(icon('i-pin'));
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
    $$('#sop-cases .sop-item').forEach((b) => {
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
      if (!session) return; // la sesión terminó: call() ya mostró qué pasó
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
  // iOS no da el nombre del teléfono sino su código ("iPhone16,1"): acá se
  // traduce, en la web y no en la app, para que un iPhone nuevo se sume sin
  // publicar otra versión. Fuentes: AppleDB, DeviceAtlas y la lista de
  // adamawolf, donde coinciden. El código va siempre al lado del nombre.
  const IPHONE = {
    '10,1': '8', '10,4': '8', '10,2': '8 Plus', '10,5': '8 Plus', '10,3': 'X', '10,6': 'X',
    '11,2': 'XS', '11,4': 'XS Max', '11,6': 'XS Max', '11,8': 'XR',
    '12,1': '11', '12,3': '11 Pro', '12,5': '11 Pro Max', '12,8': 'SE (2.ª generación)',
    '13,1': '12 mini', '13,2': '12', '13,3': '12 Pro', '13,4': '12 Pro Max',
    '14,4': '13 mini', '14,5': '13', '14,2': '13 Pro', '14,3': '13 Pro Max', '14,6': 'SE (3.ª generación)',
    '14,7': '14', '14,8': '14 Plus', '15,2': '14 Pro', '15,3': '14 Pro Max',
    '15,4': '15', '15,5': '15 Plus', '16,1': '15 Pro', '16,2': '15 Pro Max',
    '17,3': '16', '17,4': '16 Plus', '17,1': '16 Pro', '17,2': '16 Pro Max', '17,5': '16e',
    '18,3': '17', '18,4': 'Air', '18,1': '17 Pro', '18,2': '17 Pro Max', '18,5': '17e',
    '19,2': '18 Pro', '19,3': '18 Pro Max', '19,7': '18 Pro Max', '19,4': 'Duo',
  };
  /** El teléfono para leer: [nombre, código]. Sin nombre conocido, el código solo. */
  function deviceLines(model) {
    if (!model) return ['No lo mandó'];
    const sim = / \(simulador\)$/.test(model);
    const code = model.replace(/ \(simulador\)$/, '');
    // Las versiones anteriores mandaban la arquitectura de la Mac.
    if (code === 'arm64' || code === 'x86_64') return ['Simulador', 'Sin el modelo que simula'];
    const m = /^iPhone(\d+,\d+)$/.exec(code);
    const name = m && IPHONE[m[1]] ? 'iPhone ' + IPHONE[m[1]] : null;
    if (!name) return [model];
    return [sim ? name + ' (simulador)' : name, code];
  }
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
      fact('i-phone', 'Teléfono', deviceLines(c.device_model)),
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
    $('#sop-facts-sum').textContent = [c.device_model ? deviceLines(c.device_model)[0] : plat, c.app_version ? 'App ' + c.app_version : '']
      .filter(Boolean).join(' · ') || 'Datos del caso';
  }

  const facts = $('#sop-facts');
  const factsToggle = $('#sop-facts-toggle');
  factsToggle.addEventListener('click', () => {
    const open = !facts.classList.contains('is-open');
    facts.classList.toggle('is-open', open);
    factsToggle.setAttribute('aria-expanded', String(open));
  });

  // Las capturas son privadas (decisión 66): la API manda un enlace firmado a
  // api.cloudinary.com que vence en attachment_expires_at (10 minutos). No se
  // guarda: vencido, o si la imagen falla, se pide el caso de nuevo.
  const validShot = (url) => typeof url === 'string' && /^https:\/\/(api|res)\.cloudinary\.com\//.test(url);
  const shotExpired = (m) => {
    const at = m && m.attachment_expires_at ? new Date(m.attachment_expires_at).getTime() : NaN;
    return Number.isFinite(at) && at - Date.now() < 15000;
  };
  const findMsg = (id) => (current ? current.messages.find((m) => m.id_support_message === id) : null);
  /** Pide el caso abierto de nuevo, con enlaces nuevos, sin moverse de lugar. */
  async function refreshCase() {
    if (current) await openCase(current.id_support_case, { focus: false, quiet: true });
  }
  // Un reintento por captura cada medio minuto: si el enlace nuevo también
  // falla, la captura se marca rota en vez de pedir el caso sin fin.
  const shotRetries = new Map();
  const mayRetry = (id) => {
    const last = shotRetries.get(id) || 0;
    if (Date.now() - last < 30000) return false;
    shotRetries.set(id, Date.now());
    return true;
  };

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
      if (validShot(m.attachment_url)) bubble.append(shotFor(m, personName));
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

  function shotFor(m, name) {
    const url = m.attachment_url;
    const id = m.id_support_message;
    const b = el('button', 'shot');
    b.type = 'button';
    b.setAttribute('aria-label', 'Ver la captura en grande');
    const img = document.createElement('img');
    img.alt = 'Captura que adjuntó ' + name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (mayRetry(id)) refreshCase(); else b.classList.add('is-broken');
    });
    // Si el hilo estaba abajo, que siga abajo cuando la captura termina de cargar.
    img.addEventListener('load', () => {
      const wrap = $('#sop-thread-wrap');
      if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < img.clientHeight + 120) wrap.scrollTop = wrap.scrollHeight;
    });
    img.src = url;
    const cap = el('span', 'shot-cap');
    cap.append(icon('i-image'), document.createTextNode('Ver la captura'));
    b.append(img, cap);
    b.addEventListener('click', () => openShot(id, img.alt));
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
    // Una consulta que escribió esta misma cuenta desde la app la contesta
    // otra persona del equipo (la API la rechaza con SOPORTE_CASO_PROPIO).
    const own = !!(session && session.agentId && c.person.id_user === session.agentId);
    $('#sop-reply-form').hidden = closed || own;
    $('#sop-close').hidden = closed || own;
    $('#sop-closed').hidden = !(closed || own);
    $('#sop-closed').classList.toggle('is-own', own && !closed);
    $('#sop-closed-t').textContent = closed
      ? (c.closed_at ? `Cerrado el ${fmt(c.closed_at)}: no recibe más mensajes.` : 'El caso está cerrado: no recibe más mensajes.')
      : (own ? OWN_CASE : '');
    if (!closed && !own && !keepScroll) {
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
    if (!r.ok) {
      if (r.code === CODE_OWN_CASE) { renderCase({ keepScroll: true }); return toast(r.message || OWN_CASE, true); }
      if (r.code === CODE_CASE_CLOSED) return caseWasClosed(id);
      return setError(caseErr, r.message || 'No pudimos mandar la respuesta.');
    }
    drafts.delete(id);
    reply.value = '';
    current = r.data;
    renderCase();
    paintReply();
    toast('Respuesta enviada: le llega un aviso en la app y un correo.');
    loadList(true);
    refreshCounts();
  });

  /**
   * 409 CASO_CERRADO: lo cerró alguien más (otra persona del equipo, en ese
   * mismo instante). La API no devuelve el caso por ahí; se pide con GET, que
   * queda anotado, y se avisa corto.
   */
  async function caseWasClosed(id) {
    toast('Este caso ya estaba cerrado.');
    if (current && current.id_support_case === id) await refreshCase();
    loadList(true);
    refreshCounts();
  }

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
    if (!r.ok && r.code === CODE_CASE_CLOSED) return caseWasClosed(current.id_support_case);
    if (!r.ok) return toast(r.message || (r.code === CODE_OWN_CASE ? OWN_CASE : 'No pudimos cerrarlo.'), true);
    current = r.data;
    drafts.delete(current.id_support_case);
    renderCase();
    toast('Caso cerrado: a la persona le llega un aviso.');
    $('#sop-case-title').focus({ preventScroll: true });
    loadList(true);
    refreshCounts();
  });

  /* ---------- La captura (o la foto), grande ---------- */
  // Un solo visor para las capturas de los casos y las fotos de las
  // verificaciones. `fresh` pide de nuevo lo que está abierto (el enlace
  // firmado venció) y devuelve la dirección nueva, o null.
  const lightbox = $('#sop-lightbox');
  let shotOpen = null; // { key, fresh }
  function showLightbox(url, alt, { label, closeLabel, key, fresh }) {
    shotOpen = { key, fresh };
    const img = $('#sop-lightbox-img');
    img.src = url;
    img.alt = alt;
    lightbox.setAttribute('aria-label', label);
    $('#sop-lightbox-close').setAttribute('aria-label', closeLabel);
    $('#sop-lightbox-open').href = url;
    lightbox.showModal();
    $('#sop-lightbox-close').focus();
  }
  async function openShot(id, alt) {
    let m = findMsg(id);
    if (shotExpired(m)) { await refreshCase(); m = findMsg(id); }
    const url = m && m.attachment_url;
    if (!validShot(url)) return toast('No pudimos abrir la captura. Probá de nuevo.', true);
    showLightbox(url, alt, {
      label: 'Captura adjunta',
      closeLabel: 'Cerrar la captura',
      key: 'big-' + id,
      fresh: async () => {
        await refreshCase();
        const n = findMsg(id);
        return n && validShot(n.attachment_url) ? n.attachment_url : null;
      },
    });
  }
  $('#sop-lightbox-close').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('close', () => { shotOpen = null; $('#sop-lightbox-img').removeAttribute('src'); });
  // El enlace venció con la imagen abierta, o falló: se pide uno nuevo una vez.
  $('#sop-lightbox-img').addEventListener('error', async () => {
    const open = shotOpen;
    if (!open || !lightbox.open || !$('#sop-lightbox-img').getAttribute('src')) return;
    if (!mayRetry(open.key)) {
      lightbox.close();
      return toast('No pudimos cargar la imagen.', true);
    }
    const url = await open.fresh();
    if (lightbox.open && shotOpen === open && url) {
      $('#sop-lightbox-img').src = url;
      $('#sop-lightbox-open').href = url;
    }
  });

  /* ---------- Volver a la lista (teléfono) ---------- */
  function backToList() {
    saveDraft();
    panel.dataset.view = 'list';
    const item = current && $(`#sop-cases .sop-item[data-id="${current.id_support_case}"]`);
    if (item) item.focus(); else $('#sop-refresh').focus();
  }
  $('#sop-back').addEventListener('click', backToList);

  /* =====================================================================
     VERIFICACIONES DE ANUNCIOS (decisión 54)
     El dueño manda tres fotos tomadas en la propiedad y el punto del
     teléfono; queda pendiente y el anuncio se publica sin la insignia hasta
     que alguien del equipo la aprueba o la rechaza con el motivo. El pin
     cambia recién al aprobarse (decisión 74). Las fotos son privadas: llegan
     con un enlace firmado que vence a los 10 minutos, como las capturas.
     ===================================================================== */
  const VSTATUS = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada', cancelled: 'Cancelada' };
  const VTITLES = { pending: 'Pendientes', approved: 'Aprobadas', rejected: 'Rechazadas', cancelled: 'Canceladas' };
  const VBADGE = { pending: 'open', approved: 'answered', rejected: 'rejected', cancelled: 'closed' };
  const VEMPTY = {
    pending: ['Nada para revisar', 'No hay verificaciones esperando. Cuando un dueño mande la suya, aparece acá y te llega un correo.'],
    approved: ['Ninguna aprobada todavía', 'Las que apruebes quedan acá, con quién y cuándo.'],
    rejected: ['Ninguna rechazada', 'Las que rechaces quedan acá, con el motivo que leyó el dueño.'],
    cancelled: ['Ninguna cancelada', 'Una pendiente se cancela sola cuando el dueño cambia la ubicación del anuncio o lo elimina.'],
  };
  const LISTING = { entire: 'Propiedad completa', room: 'Cuarto' };
  const AD_STATUS = { published: 'Publicado', paused: 'Pausado', rented: 'Alquilado', full: 'Lleno', deleted: 'Eliminado' };
  const PHOTO = { exterior: 'Exterior', interior: 'Interior', detail: 'Detalle' };
  const PHOTO_ALT = { exterior: 'del exterior', interior: 'del interior', detail: 'de un detalle' };
  const REVIEW_HOURS = 24; // el compromiso (VERIFICATION_REVIEW_HOURS en la API)
  const CODE_VER_RESOLVED = 'VERIFICACION_RESUELTA';
  const CODE_VER_OWN = 'VERIFICACION_PROPIA';
  const CODE_VER_NOT_FOUND = 'VERIFICACION_NO_ENCONTRADA';
  const OWN_VER = 'Este anuncio es tuyo: lo revisa otra persona del equipo.';

  let section = 'cases';
  let verFilter = 'pending';
  let verItems = [];
  let verCursor = null;
  let verCurrent = null;
  let verCounts = {}; // { pending: { n, more } }
  let verSeq = 0;
  let verListSeq = 0;
  let verPhotoTimer = null;
  const verDrafts = new Map(); // el motivo a medio escribir de cada una

  const verEmpty = $('#ver-empty');
  const verBody = $('#ver-body');
  const verSkel = $('#ver-skel');
  const verErr = $('#ver-error');
  const verApprove = $('#ver-approve');
  const verRejectOpen = $('#ver-reject-open');

  /* ---------- Cuánto falta para las 24 horas ---------- */
  function dueOf(createdIso) {
    return new Date(new Date(createdIso).getTime() + REVIEW_HOURS * 3600e3);
  }
  /** [texto, 'late' | 'soon' | ''] */
  function dueText(due) {
    const left = due.getTime() - Date.now();
    const span = (ms) => {
      const mins = Math.max(1, Math.round(ms / 60000));
      if (mins < 60) return `${mins} min`;
      const hours = Math.floor(mins / 60);
      if (hours < 48) return `${hours} h`;
      return `${Math.floor(hours / 24)} días`;
    };
    if (left > 0) return [`Quedan ${span(left)}`, left < 4 * 3600e3 ? 'soon' : ''];
    return [`Vencida hace ${span(-left)}`, 'late'];
  }
  function dueChip(createdIso) {
    const due = dueOf(createdIso);
    const [text, tone] = dueText(due);
    const t = el('time', 'due' + (tone ? ' due--' + tone : ''), text);
    t.dateTime = due.toISOString();
    t.title = 'Plazo: ' + fmt(due.toISOString());
    t.dataset.due = '1';
    return t;
  }
  // Se refresca solo, como el "hace cuánto".
  setInterval(() => {
    $$('[data-due]').forEach((t) => {
      const [text, tone] = dueText(new Date(t.dateTime));
      t.textContent = t.dataset.due === 'long' ? dueLong(new Date(t.dateTime))
        : t.dataset.due === 'long-rep' ? dueLongRep(new Date(t.dateTime)) : text;
      t.classList.toggle('due--late', tone === 'late');
      t.classList.toggle('due--soon', tone === 'soon');
    });
  }, 60000);
  const dueLong = (due) => {
    const [text, tone] = dueText(due);
    return tone === 'late'
      ? `El plazo de ${REVIEW_HOURS} horas venció el ${fmt(due.toISOString())} · ${text.toLowerCase()}`
      : `Revisala antes del ${fmt(due.toISOString())} · ${text.toLowerCase()}`;
  };

  /** El plazo de un reporte, dicho en masculino. */
  const dueLongRep = (due) => dueLong(due).replace('Revisala antes', 'Atendelo antes');

  /** Metros o kilómetros, como se leen. */
  function distText(m) {
    const n = Number(m) || 0;
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toLocaleString('es-CR', { maximumFractionDigits: n < 10000 ? 1 : 0 })} km`;
  }
  const coord = (n) => Number(n).toFixed(6);
  const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${coord(lat)},${coord(lng)}`;
  /** Un enlace que se abre en otra pestaña, y lo dice. */
  function extLink(href, text, cls) {
    const a = el('a', cls || 'link');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(icon('i-ext'), document.createTextNode(text), el('span', 'sr', ' (se abre en otra pestaña)'));
    return a;
  }

  /* ---------- La sección ---------- */
  /** Muestra una sección u otra, sin pedir nada. */
  function paintSection(name) {
    section = name;
    const cases = name === 'cases';
    const verifs = name === 'verifs';
    const reps = name === 'reports';
    $$('.sect-b').forEach((b) => {
      if (b.dataset.section === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#sop-nav-cases').hidden = !cases;
    $('#sop-side-topics').hidden = !cases;
    $('#sop-list').hidden = !cases;
    $('#sop-case').hidden = !cases;
    $('#ver-nav').hidden = !verifs;
    $('#ver-note').hidden = !verifs;
    $('#ver-list').hidden = !verifs;
    $('#ver-case').hidden = !verifs;
    $('#rep-nav').hidden = !reps;
    $('#rep-note').hidden = !reps;
    $('#rep-list').hidden = !reps;
    $('#rep-case').hidden = !reps;
    panel.dataset.section = name;
    panel.dataset.view = 'list';
  }

  /** Pasa a la otra sección y la pone al día. */
  function setSection(name) {
    if (section === name) return;
    if (section === 'cases') saveDraft();
    paintSection(name);
    if (history.replaceState) {
      const hash = name === 'verifs'
        ? (verCurrent ? '#verificacion-' + verCurrent.id_verification : '')
        : name === 'reports'
          ? (repCurrent ? '#reporte-' + repCurrent.id_report : '')
          : (current ? '#caso-' + current.id_support_case : '');
      history.replaceState(null, '', location.pathname + location.search + hash);
    }
    if (name === 'verifs') { loadVerList(true); refreshVerCounts(); }
    else if (name === 'reports') { loadRepList(true); refreshRepCounts(); }
    else { loadList(true); refreshCounts(); }
    $(`.sect-b[data-section="${name}"]`).focus();
  }
  $$('.sect-b').forEach((b) => b.addEventListener('click', () => setSection(b.dataset.section)));

  function resetVerifs() {
    verItems = [];
    verCursor = null;
    verCurrent = null;
    verCounts = {};
    verDrafts.clear();
    clearTimeout(verPhotoTimer);
    $('#ver-items').replaceChildren();
    verBody.hidden = true;
    showVerEmpty();
    paintVerCounts();
  }

  /* ---------- La lista ---------- */
  function skeletonVerList() {
    const list = $('#ver-items');
    list.replaceChildren();
    for (let i = 0; i < 6; i++) {
      const li = el('li', 'skel');
      li.setAttribute('aria-hidden', 'true');
      li.append(el('span', 'sk'), el('span', 'sk'), el('span', 'sk'), el('span', 'sk'));
      list.append(li);
    }
    $('#ver-list-msg').hidden = true;
    $('#ver-more').hidden = true;
  }

  async function loadVerList(reset) {
    const seq = ++verListSeq;
    const state = $('#ver-list-state');
    const more = $('#ver-more');
    if (reset) {
      verItems = [];
      verCursor = null;
      skeletonVerList();
    } else busy(more, true);
    state.textContent = 'Cargando verificaciones…';
    const q = new URLSearchParams({ status: verFilter });
    if (verCursor) q.set('cursor', verCursor);
    const r = await call('GET', '/support/admin/verifications?' + q);
    busy(more, false);
    if (!session) return 'ended';
    if (seq !== verListSeq) return 'stale';
    if (noRole(r)) { deny(); return 'ended'; }
    if (!r.ok) {
      verListMessage('error', r.message || 'No pudimos cargar las verificaciones.');
      state.textContent = r.message || 'No pudimos cargar las verificaciones.';
      return 'error';
    }
    verItems = verItems.concat((r.data && r.data.data) || []);
    verCursor = (r.data && r.data.next_cursor) || null;
    if (verFilter === 'pending' && !verCursor) { verCounts.pending = { n: verItems.length, more: false }; paintVerCounts(); }
    renderVerList();
    return 'ok';
  }

  /** Cuántas esperan: la primera tanda (de a 20). */
  async function refreshVerCounts() {
    const r = await call('GET', '/support/admin/verifications?status=pending');
    if (!session) return;
    if (r.ok && r.data && Array.isArray(r.data.data)) {
      verCounts.pending = { n: r.data.data.length, more: !!r.data.next_cursor };
    }
    paintVerCounts();
  }
  function paintVerCounts() {
    const c = verCounts.pending;
    const text = c && c.n ? c.n + (c.more ? '+' : '') : '';
    [$('[data-vcount="pending"]'), $('[data-sect-count="verifs"]')].forEach((n) => {
      n.textContent = text;
      n.classList.toggle('has', !!text);
    });
  }

  function verListMessage(kind, text, title) {
    const box = $('#ver-list-msg');
    box.replaceChildren();
    $('#ver-items').replaceChildren();
    box.append(illo(kind === 'error' ? 'error' : (verFilter === 'pending' ? 'done' : 'pin')));
    box.append(el('p', 'empty-h', title || (kind === 'error' ? 'No pudimos cargar las verificaciones' : '')));
    box.append(el('p', 'empty-t', text));
    if (kind === 'error') {
      $('#ver-list-n').textContent = '';
      const retry = el('button', 'go go--ghost go--sm', 'Reintentar');
      retry.type = 'button';
      retry.addEventListener('click', () => { loadVerList(true); refreshVerCounts(); });
      box.append(retry);
    }
    box.hidden = false;
    $('#ver-more').hidden = kind === 'error' || !verCursor;
  }

  function verItemFor(v) {
    const li = el('li');
    const b = el('button', 'sop-item ver-item');
    b.type = 'button';
    b.dataset.id = String(v.id_verification);
    if (verCurrent && verCurrent.id_verification === v.id_verification) {
      b.classList.add('is-current');
      b.setAttribute('aria-current', 'true');
    }
    const owner = v.owner.name || 'Cuenta eliminada';

    const top = el('span', 'item-top');
    top.append(el('span', 'item-name', v.ad.title));
    if (v.status === 'pending') {
      top.append(dueChip(v.created_at));
    } else if (v.reviewed_at) {
      const when = timeEl(v.reviewed_at, 'item-when', ago(v.reviewed_at));
      when.dataset.ago = 'short';
      top.append(when);
    }

    const meta = el('span', 'item-meta');
    meta.append(el('span', '', '#' + v.id_verification + ' · ' + owner));

    const tags = el('span', 'item-tags');
    tags.append(el('span', 'tagc', LISTING[v.ad.listing_type] || v.ad.listing_type));
    if (v.reverification) {
      const t = el('span', 'tagc tagc--pin');
      t.append(icon('i-pin'), document.createTextNode('Corrección del pin'));
      tags.append(t);
    }
    if (v.status !== 'pending' && v.reviewer) {
      tags.append(el('span', 'tagc tagc--who', (v.status === 'approved' ? 'Aprobó ' : 'Rechazó ') + v.reviewer.name));
    }

    b.append(avatar(owner, v.owner.id_user), top, meta, tags);
    if (v.reason && v.status !== 'pending') b.append(el('span', 'item-prev', v.reason));
    b.addEventListener('click', () => openVer(v.id_verification));
    li.append(b);
    return li;
  }

  function renderVerList() {
    const list = $('#ver-items');
    list.replaceChildren(...verItems.map(verItemFor));
    $('#ver-list-msg').hidden = true;
    $('#ver-more').hidden = !verCursor;
    $('#ver-list-title').textContent = VTITLES[verFilter];
    $('#ver-list-n').textContent = verItems.length ? verItems.length + (verCursor ? '+' : '') : '';
    $('#ver-list-state').textContent = verItems.length
      ? `${verItems.length} ${verItems.length === 1 ? 'verificación' : 'verificaciones'} ${VTITLES[verFilter].toLowerCase()}`
      : 'No hay verificaciones en este estado.';
    if (!verItems.length) verListMessage('empty', VEMPTY[verFilter][1], VEMPTY[verFilter][0]);
  }

  function selectVerTab(tab) {
    verFilter = tab.dataset.status;
    $$('.ver-tab').forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    $('#ver-list-title').textContent = VTITLES[verFilter];
    $('#ver-list-scroll').scrollTop = 0;
    loadVerList(true);
  }
  $$('.ver-tab').forEach((tab) => tab.addEventListener('click', () => selectVerTab(tab)));
  $('#ver-tabs').addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const tabs = $$('.ver-tab');
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
    next.focus();
    selectVerTab(next);
  });
  $('#ver-more').addEventListener('click', () => loadVerList(false));

  const verRefreshBtn = $('#ver-refresh');
  async function refreshVerifs() {
    verRefreshBtn.classList.add('is-spin');
    const jobs = [loadVerList(true), refreshVerCounts()];
    if (verCurrent) jobs.push(openVer(verCurrent.id_verification, { focus: false, quiet: true }));
    await Promise.all(jobs);
    verRefreshBtn.classList.remove('is-spin');
  }
  verRefreshBtn.addEventListener('click', refreshVerifs);
  $('#ver-keys-open').addEventListener('click', () => keysDlg.showModal());

  /* ---------- Una verificación ---------- */
  function showVerEmpty(title, text, retryId) {
    verEmpty.hidden = false;
    verEmpty.classList.toggle('is-error', !!title);
    verSkel.hidden = true;
    $('#ver-empty-h').textContent = title || 'Elegí una verificación de la lista';
    $('#ver-empty-t').textContent = text || 'Se abre acá con las fotos, el punto del teléfono y lo que dice el anuncio para comparar.';
    const retry = $('#ver-retry');
    retry.hidden = !retryId;
    retry.dataset.id = retryId ? String(retryId) : '';
    $('.illo', verEmpty).replaceWith(illo(title ? 'error' : 'pin'));
  }
  $('#ver-retry').addEventListener('click', (e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (id) openVer(id);
  });

  function markVerCurrent() {
    $$('#ver-items .sop-item').forEach((b) => {
      const on = !!verCurrent && Number(b.dataset.id) === verCurrent.id_verification;
      b.classList.toggle('is-current', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  async function openVer(id, { focus = true, quiet = false } = {}) {
    const seq = ++verSeq;
    if (section !== 'verifs') paintSection('verifs');
    setError(verErr, '');
    if (!quiet) panel.dataset.view = 'case';
    const skelTimer = quiet ? null : setTimeout(() => {
      if (seq !== verSeq) return;
      verBody.hidden = true;
      verEmpty.hidden = true;
      verSkel.hidden = false;
    }, 140);
    const r = await call('GET', '/support/admin/verifications/' + id);
    clearTimeout(skelTimer);
    if (seq !== verSeq) return;
    verSkel.hidden = true;
    if (!r.ok) {
      if (!session || quiet) return;
      verBody.hidden = true;
      verCurrent = null;
      markVerCurrent();
      const notFound = r.status === 404 || r.code === CODE_VER_NOT_FOUND;
      showVerEmpty(notFound ? 'No encontramos esa verificación' : 'No pudimos abrir la verificación',
        notFound ? 'Puede que el anuncio se haya borrado. Elegí otra de la lista.' : (r.message || 'Probá de nuevo en un momento.'),
        notFound ? null : id);
      return;
    }
    const same = verCurrent && verCurrent.id_verification === id;
    verCurrent = r.data;
    if (history.replaceState) history.replaceState(null, '', '#verificacion-' + id);
    renderVer({ keepScroll: quiet && same });
    markVerCurrent();
    if (focus) $('#ver-title').focus({ preventScroll: true });
  }
  const refreshVer = () => (verCurrent ? openVer(verCurrent.id_verification, { focus: false, quiet: true }) : null);

  /** Una sección del detalle, con su título. */
  function verSection(id, title, iconId, sub) {
    const sec = el('section', 'ver-sec');
    sec.setAttribute('aria-labelledby', id);
    const h = el('h3', 'ver-h');
    h.id = id;
    h.append(icon(iconId), document.createTextNode(title));
    sec.append(h);
    if (sub) sec.append(el('p', 'ver-sub', sub));
    return sec;
  }
  function row(label, ...values) {
    const wrap = el('div', 'ver-row');
    wrap.append(el('dt', '', label));
    values.filter((v) => v !== null && v !== undefined && v !== '').forEach((v) => {
      wrap.append(typeof v === 'string' ? el('dd', '', v) : v);
    });
    return wrap;
  }

  const photoExpired = (p) => {
    const at = p && p.expires_at ? new Date(p.expires_at).getTime() : NaN;
    return Number.isFinite(at) && at - Date.now() < 15000;
  };

  function photoButton(p, owner, index) {
    const label = PHOTO[p.photo_type] || p.photo_type;
    const li = el('li');
    const b = el('button', 'ver-photo');
    b.type = 'button';
    b.dataset.type = p.photo_type;
    const alt = `Foto ${PHOTO_ALT[p.photo_type] || ''} que tomó ${owner}`.replace(/\s+/g, ' ');
    b.setAttribute('aria-label', `Ver la foto ${PHOTO_ALT[p.photo_type] || ''} en grande`.replace(/\s+/g, ' '));
    const cap = el('span', 'ver-photo-cap', label);
    if (!validShot(p.url)) {
      b.classList.add('is-broken');
      b.disabled = true;
      b.append(icon('i-image'), cap, el('span', 'ver-photo-miss', 'No se pudo cargar'));
      li.append(b);
      return li;
    }
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (mayRetry('ver-' + verCurrent.id_verification + '-' + index)) refreshVer();
      else b.classList.add('is-broken');
    });
    img.src = p.url;
    b.append(img, cap);
    b.addEventListener('click', () => openVerPhoto(p.photo_type, alt));
    li.append(b);
    return li;
  }

  async function openVerPhoto(type, alt) {
    const find = () => verCurrent && verCurrent.photos.find((p) => p.photo_type === type);
    let p = find();
    if (photoExpired(p)) { await refreshVer(); p = find(); }
    if (!p || !validShot(p.url)) return toast('No pudimos abrir la foto. Probá de nuevo.', true);
    showLightbox(p.url, alt, {
      label: 'Foto de la verificación',
      closeLabel: 'Cerrar la foto',
      key: 'ver-big-' + (verCurrent && verCurrent.id_verification) + '-' + type,
      fresh: async () => {
        await refreshVer();
        const n = find();
        return n && validShot(n.url) ? n.url : null;
      },
    });
  }

  function openAdPhoto(url, index, title) {
    showLightbox(url, `Foto ${index + 1} del anuncio «${title}»`, {
      label: 'Foto del anuncio',
      closeLabel: 'Cerrar la foto',
      key: 'ad-' + url,
      fresh: async () => null,
    });
  }

  /** A los 10 minutos los enlaces de las fotos vencen: se dice y se ofrece pedirlos de nuevo. */
  function armPhotoExpiry(v) {
    clearTimeout(verPhotoTimer);
    const times = v.photos.map((p) => (p.expires_at ? new Date(p.expires_at).getTime() : NaN)).filter(Number.isFinite);
    if (!times.length) return;
    const at = Math.min(...times);
    verPhotoTimer = setTimeout(() => {
      if (!verCurrent || verCurrent.id_verification !== v.id_verification) return;
      const box = $('#ver-photos-expired');
      if (box) box.hidden = false;
      const grid = $('#ver-photos');
      if (grid) grid.classList.add('is-expired');
    }, Math.max(0, at - Date.now() - 15000));
  }

  function renderVer({ keepScroll = false } = {}) {
    const v = verCurrent;
    verEmpty.hidden = true;
    verSkel.hidden = true;
    verBody.hidden = false;
    const owner = v.owner.name || 'Cuenta eliminada';

    $('#ver-title').replaceChildren(
      el('span', 'ct-id', `#${v.id_verification} · ${v.reverification ? 'Corrección del pin' : 'Verificación'}`),
      el('span', 'sr', ' — '),
      el('span', 'ct-name', v.ad.title),
    );
    $('#ver-av').replaceWith(Object.assign(avatar(owner, v.owner.id_user, 'av--lg'), { id: 'ver-av' }));
    $('#ver-av').setAttribute('aria-hidden', 'true');
    const badge = $('#ver-status');
    badge.className = 'badge badge--' + VBADGE[v.status];
    badge.textContent = VSTATUS[v.status] || v.status;

    const scroll = $('#ver-scroll');
    const keep = keepScroll ? scroll.scrollTop : 0;
    const wrap = el('div', 'ver-wrap');

    // Qué pasa con ella: el plazo, o cómo se resolvió.
    if (v.status === 'pending') {
      const due = v.due_at ? new Date(v.due_at) : dueOf(v.created_at);
      const late = due.getTime() <= Date.now();
      const box = el('div', 'ver-banner' + (late ? ' ver-banner--late' : ''));
      box.append(icon('i-clock'));
      const t = el('time', '', dueLong(due));
      t.dateTime = due.toISOString();
      t.dataset.due = 'long';
      box.append(t);
      wrap.append(box);
      if (v.reverification) {
        const note = el('div', 'ver-banner ver-banner--info');
        note.append(icon('i-pin'), el('p', '', 'El anuncio ya está verificado. Si la aprobás, el pin pasa al punto nuevo; si la rechazás, sigue verificado con el de antes.'));
        wrap.append(note);
      }
    } else {
      const box = el('div', 'ver-banner ver-banner--' + v.status);
      box.append(icon(v.status === 'approved' ? 'i-verify' : v.status === 'rejected' ? 'i-xc' : 'i-ban'));
      const col = el('div', 'ver-banner-col');
      const who = v.reviewer ? v.reviewer.name : null;
      const when = v.reviewed_at ? fmt(v.reviewed_at) : '';
      col.append(el('p', 'ver-banner-h',
        v.status === 'approved' ? `Aprobada${who ? ' por ' + who : ''}${when ? ' el ' + when : ''}`
          : v.status === 'rejected' ? `Rechazada${who ? ' por ' + who : ''}${when ? ' el ' + when : ''}`
            : `Se canceló sola${when ? ' el ' + when : ''}`));
      if (v.reason) col.append(el('p', 'ver-banner-t', (v.status === 'rejected' ? 'Motivo que leyó el dueño: ' : '') + v.reason));
      box.append(col);
      wrap.append(box);
    }

    // Las tres fotos.
    const photos = verSection('ver-photos-h', 'Fotos de la verificación', 'i-image',
      'Las tomó el dueño en la propiedad. Son privadas: el enlace vence a los 10 minutos.');
    const grid = el('ul', 'ver-photos');
    grid.id = 'ver-photos';
    const order = ['exterior', 'interior', 'detail'];
    const sorted = v.photos.slice().sort((a, b) => order.indexOf(a.photo_type) - order.indexOf(b.photo_type));
    sorted.forEach((p, i) => grid.append(photoButton(p, owner, i)));
    if (!sorted.length) grid.append(el('li', 'ver-none', 'Esta verificación no tiene fotos.'));
    const expired = el('div', 'ver-expired');
    expired.id = 'ver-photos-expired';
    expired.hidden = true;
    expired.setAttribute('role', 'status');
    const reload = el('button', 'go go--ghost go--sm', 'Volver a cargar las fotos');
    reload.type = 'button';
    reload.addEventListener('click', async () => {
      busy(reload, true);
      await refreshVer();
      busy(reload, false);
    });
    expired.append(el('p', '', 'Los enlaces de las fotos vencieron.'), reload);
    photos.append(grid, expired);
    wrap.append(photos);

    // El punto del teléfono, y el pin de hoy.
    const loc = verSection('ver-loc-h', 'Dónde estaba el teléfono', 'i-pin');
    const point = el('div', 'ver-point');
    const coords = el('p', 'ver-coords', `${coord(v.latitude)}, ${coord(v.longitude)}`);
    point.append(coords, extLink(mapsUrl(v.latitude, v.longitude), 'Abrir en Google Maps'));
    loc.append(point);
    if (v.current_pin) {
      const far = v.current_pin.distance_m >= 1000;
      const d = el('div', 'ver-dist' + (far ? ' ver-dist--far' : ''));
      d.append(el('p', '', `A ${distText(v.current_pin.distance_m)} del pin vigente del anuncio.`),
        extLink(mapsUrl(v.current_pin.latitude, v.current_pin.longitude), 'Ver el pin vigente'));
      loc.append(d);
    } else {
      loc.append(el('p', 'ver-sub', 'El anuncio todavía no tiene pin. Si la aprobás, este punto es adonde llega "Ir con Google Maps" para quien tiene una visita confirmada.'));
    }
    wrap.append(loc);

    // Lo que dice el anuncio.
    const decl = verSection('ver-decl-h', 'Lo que dice el anuncio', 'i-tag');
    const dl = el('dl', 'ver-dl');
    const d = v.declared || {};
    dl.append(
      row('Ubicación', [d.district, d.canton, d.province].filter(Boolean).join(', ') || 'Sin ubicación'),
      row('Referencia del barrio', d.neighborhood_reference || 'No puso ninguna'),
      row('Señas exactas', d.address_description || 'Sin señas', el('dd', 'ver-private', 'Privadas: en la app solo las ven el dueño y quien tiene una visita confirmada.')),
    );
    decl.append(dl);
    const images = (d.images || []).filter(validShot);
    if (images.length) {
      decl.append(el('p', 'ver-subh', 'Fotos del anuncio'));
      const thumbs = el('ul', 'ver-thumbs');
      images.forEach((url, i) => {
        const li = el('li');
        const b = el('button', 'ver-thumb');
        b.type = 'button';
        b.setAttribute('aria-label', `Ver la foto ${i + 1} del anuncio en grande`);
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => b.classList.add('is-broken'));
        img.src = url;
        b.append(img);
        b.addEventListener('click', () => openAdPhoto(url, i, v.ad.title));
        li.append(b);
        thumbs.append(li);
      });
      decl.append(thumbs);
    } else decl.append(el('p', 'ver-sub', 'El anuncio no tiene fotos para comparar.'));
    wrap.append(decl);

    // Los datos.
    const data = verSection('ver-data-h', 'Datos', 'i-user');
    const dl2 = el('dl', 'ver-dl');
    dl2.append(
      row('Dueño', owner),
      row('Anuncio', `#${v.ad.id_ad} · ${LISTING[v.ad.listing_type] || v.ad.listing_type} · ${AD_STATUS[v.ad.status] || v.ad.status}`),
      row('Recibida', fmt(v.created_at), agoLong(v.created_at)),
    );
    data.append(dl2);
    wrap.append(data);

    // Las demás verificaciones del anuncio.
    const hist = verSection('ver-hist-h', 'Historial del anuncio', 'i-history');
    if (v.history && v.history.length) {
      const ol = el('ol', 'ver-hist');
      v.history.forEach((h) => {
        const li = el('li', 'ver-hist-i');
        const top = el('p', 'ver-hist-top');
        top.append(el('span', 'item-st item-st--' + VBADGE[h.status], VSTATUS[h.status] || h.status),
          el('span', '', ` #${h.id_verification} · `), timeEl(h.created_at, '', fmt(h.created_at)));
        li.append(top);
        if (h.reason) li.append(el('p', 'ver-hist-t', h.reason));
        ol.append(li);
      });
      hist.append(ol);
    } else hist.append(el('p', 'ver-sub', 'Es la primera verificación de este anuncio.'));
    wrap.append(hist);

    scroll.replaceChildren(wrap);
    scroll.scrollTop = keep;
    armPhotoExpiry(v);

    // Las acciones: solo en una pendiente, y no la del anuncio propio.
    const pending = v.status === 'pending';
    const own = !!(v._own || (session && session.agentId && v.owner.id_user === session.agentId));
    $('#ver-actions').hidden = !pending || own;
    $('#ver-actions-t').textContent = v.reverification
      ? 'Si la aprobás, el pin del anuncio pasa a este punto y al dueño le llega el aviso.'
      : 'Si la aprobás, el anuncio queda verificado con este punto y al dueño le llega el aviso.';
    const closed = $('#ver-closed');
    closed.hidden = pending && !own;
    closed.classList.toggle('is-own', pending && own);
    $('#ver-closed-t').textContent = pending && own ? OWN_VER
      : v.status === 'approved' ? 'Aprobada: el anuncio muestra la insignia con este punto.'
        : v.status === 'rejected' ? 'Rechazada: el dueño puede mandar otra cuando corrija lo que le dijiste.'
          : 'Cancelada: el dueño tiene que volver a mandarla desde la propiedad.';
  }

  /* ---------- Aprobar y rechazar ---------- */
  function verBusy(on, which) {
    busy(verApprove, on && which === 'approve', on && which === 'approve' ? 'Aprobando…' : 'Aprobar');
    verApprove.disabled = on;
    verRejectOpen.disabled = on;
  }

  /** Lo que pasa cuando aprobar o rechazar no sale. */
  async function verFailed(r, id) {
    if (!session) return; // la sesión terminó: call() ya lo mostró
    if (r.code === CODE_VER_RESOLVED) {
      // El panel la pide de nuevo solo: el "Actualizá la lista" de la API sobra.
      const now = r.data && r.data.status;
      toast(now === 'cancelled'
        ? 'Se canceló mientras la mirabas: el dueño cambió la ubicación o eliminó el anuncio.'
        : `Otra persona del equipo ya la ${now === 'rejected' ? 'rechazó' : 'aprobó'}: te mostramos cómo quedó.`);
      if (verCurrent && verCurrent.id_verification === id) await refreshVer();
      loadVerList(true);
      refreshVerCounts();
      return;
    }
    if (r.code === CODE_VER_OWN) {
      if (verCurrent && verCurrent.id_verification === id) { verCurrent._own = true; renderVer({ keepScroll: true }); }
      return toast(r.message || OWN_VER, true);
    }
    if (r.status === 404 || r.code === CODE_VER_NOT_FOUND) {
      verBody.hidden = true;
      verCurrent = null;
      showVerEmpty('No encontramos esa verificación', 'Puede que el anuncio se haya borrado. Elegí otra de la lista.');
      loadVerList(true);
      refreshVerCounts();
      return;
    }
    setError(verErr, r.message || 'No pudimos resolverla. Probá de nuevo.');
  }

  verApprove.addEventListener('click', async () => {
    if (!verCurrent || verApprove.disabled) return;
    const id = verCurrent.id_verification;
    const moved = verCurrent.reverification;
    setError(verErr, '');
    verBusy(true, 'approve');
    const r = await call('POST', `/support/admin/verifications/${id}/approve`);
    verBusy(false);
    if (!r.ok) return verFailed(r, id);
    if (verCurrent && verCurrent.id_verification === id) {
      verCurrent = r.data;
      renderVer();
      $('#ver-title').focus({ preventScroll: true });
    }
    toast(moved ? 'Aprobada: el pin del anuncio pasó al punto nuevo.' : 'Aprobada: el anuncio ya muestra la insignia de verificado.');
    loadVerList(true);
    refreshVerCounts();
  });

  const rejectDlg = $('#ver-reject');
  const reason = $('#ver-reason');
  const rejectErr = $('#ver-reject-error');
  const rejectGo = $('#ver-reject-go');
  const cleanReason = (t) => t.trim().replace(/\s+/g, ' ');
  function paintReason() {
    const n = reason.value.length;
    $('#ver-reason-count').textContent = String(n);
    $('.counter', rejectDlg).classList.toggle('is-near', n > 270);
  }
  verRejectOpen.addEventListener('click', () => {
    if (!verCurrent || verRejectOpen.disabled) return;
    $('#ver-reject-h').textContent = `Rechazar la verificación #${verCurrent.id_verification}`;
    $('#ver-reject-t').textContent = verCurrent.reverification
      ? 'El anuncio sigue verificado con el pin de antes. El dueño lee el motivo en su anuncio y en el aviso: escribilo para que sepa qué corregir.'
      : 'El dueño lee el motivo en su anuncio y en el aviso: escribilo para que sepa qué corregir.';
    reason.value = verDrafts.get(verCurrent.id_verification) || '';
    paintReason();
    setError(rejectErr, '');
    reason.closest('form').classList.remove('is-bad');
    rejectDlg.showModal();
    reason.focus();
  });
  $$('#ver-quick .chip').forEach((chip) => chip.addEventListener('click', () => {
    reason.value = chip.textContent;
    paintReason();
    setError(rejectErr, '');
    if (verCurrent) verDrafts.set(verCurrent.id_verification, reason.value);
    reason.focus();
    reason.setSelectionRange(reason.value.length, reason.value.length);
  }));
  reason.addEventListener('input', () => {
    paintReason();
    setError(rejectErr, '');
    if (verCurrent) verDrafts.set(verCurrent.id_verification, reason.value);
  });
  reason.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#ver-reject-form').requestSubmit();
    }
  });
  $('#ver-reject-cancel').addEventListener('click', () => rejectDlg.close());
  $('#ver-reject-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!verCurrent || rejectGo.disabled) return;
    const text = cleanReason(reason.value);
    if (text.length < 10) {
      reason.focus();
      return setError(rejectErr, text ? 'Escribí el motivo con un poco más de detalle: el dueño lo va a leer.'
        : 'Escribí el motivo: el dueño lo va a leer.');
    }
    const id = verCurrent.id_verification;
    setError(rejectErr, '');
    busy(rejectGo, true, 'Rechazando…');
    $('#ver-reject-cancel').disabled = true;
    const r = await call('POST', `/support/admin/verifications/${id}/reject`, { reason: text });
    busy(rejectGo, false, 'Rechazar');
    $('#ver-reject-cancel').disabled = false;
    if (!r.ok) {
      // Lo que no le gustó del motivo se dice en el diálogo; lo demás, afuera.
      if (r.status === 400 && !r.code) return setError(rejectErr, r.message || 'Revisá el motivo.');
      if (!session) return;
      rejectDlg.close();
      return verFailed(r, id);
    }
    verDrafts.delete(id);
    rejectDlg.close();
    if (verCurrent && verCurrent.id_verification === id) {
      verCurrent = r.data;
      renderVer();
      $('#ver-title').focus({ preventScroll: true });
    }
    toast('Rechazada: al dueño le llega el aviso con el motivo.');
    loadVerList(true);
    refreshVerCounts();
  });

  /* ---------- Volver a la lista (teléfono) ---------- */
  function backToVerList() {
    panel.dataset.view = 'list';
    const item = verCurrent && $(`#ver-items .sop-item[data-id="${verCurrent.id_verification}"]`);
    if (item) item.focus(); else verRefreshBtn.focus();
  }
  $('#ver-back').addEventListener('click', backToVerList);

  // Un enlace del correo pegado con el panel ya abierto.
  window.addEventListener('hashchange', () => {
    if (panel.hidden || !session) return;
    const m = /^#caso-(\d{1,10})$/.exec(location.hash);
    const v = /^#verificacion-(\d{1,10})$/.exec(location.hash);
    const rp = /^#reporte-(\d{1,10})$/.exec(location.hash);
    if (v && !(verCurrent && verCurrent.id_verification === Number(v[1]))) {
      if (section !== 'verifs') { paintSection('verifs'); loadVerList(true); }
      openVer(Number(v[1]));
    } else if (rp && !(repCurrent && repCurrent.id_report === Number(rp[1]))) {
      if (section !== 'reports') { paintSection('reports'); loadRepList(true); }
      openRep(Number(rp[1]));
    } else if (m && !(current && current.id_support_case === Number(m[1]))) {
      if (section !== 'cases') { paintSection('cases'); loadList(true); }
      openCase(Number(m[1]));
    }
  });

  /* =====================================================================
     REPORTES (decisión 52)
     Cualquiera reporta a una persona, un anuncio, una foto, un mensaje,
     una calificación o una respuesta. Lo de una misma cosa llega junto: un
     grupo por cosa reportada, con todos sus reportes, y resolverlo los
     cierra a todos. Soporte lo descarta (a quien reportó le llega que no
     infringe las reglas) o lo oculta con el motivo que lee el autor. Lo
     oculto se puede volver a mostrar, salvo las fotos que se borraron.
     Todo lo que escribieron las personas entra como texto.
     ===================================================================== */
  const RTYPE = {
    user: { label: 'Persona', icon: 'i-user', hide: 'Quitar la foto de perfil', what: 'la foto de perfil' },
    ad: { label: 'Anuncio', icon: 'i-tag', hide: 'Ocultar el anuncio', what: 'el anuncio' },
    ad_image: { label: 'Foto', icon: 'i-image', hide: 'Quitar la foto', what: 'la foto' },
    message: { label: 'Mensaje', icon: 'i-msg', hide: 'Ocultar el mensaje', what: 'el mensaje' },
    rating: { label: 'Calificación', icon: 'i-star', hide: 'Ocultar la calificación', what: 'la calificación' },
    rating_response: { label: 'Respuesta', icon: 'i-reply', hide: 'Ocultar la respuesta', what: 'la respuesta' },
  };
  const RREASON = {
    scam: 'Estafa o plata por fuera',
    harassment: 'Acoso o insultos',
    inappropriate: 'Contenido inapropiado',
    fake: 'Falso o engañoso',
    discrimination: 'Discriminación',
    other: 'Otro motivo',
  };
  const ROUTCOME = { dismissed: 'Descartado', content_hidden: 'Oculto', account_suspended: 'Cuenta suspendida' };
  const RCONTEXT = {
    visit_host: 'Como quien mostró la visita',
    visit_guest: 'Como quien visitó',
    landlord: 'Como propietario',
    tenant: 'Como inquilino',
    host: 'Como anfitrión',
    roommate: 'Como roomie',
  };
  /** Los motivos rápidos al ocultar, según lo que se oculta. */
  const RQUICK = {
    message: ['Pide plata por fuera de ImHomi.', 'Tiene insultos o amenazas.', 'Muestra contenido sexual o violento.', 'Discrimina a una persona o a un grupo.'],
    ad: ['Las fotos no son de la propiedad.', 'El anuncio es falso o engañoso.', 'Pide plata por fuera de ImHomi.', 'Discrimina a una persona o a un grupo.'],
    ad_image: ['La foto no es de la propiedad.', 'Muestra contenido sexual o violento.', 'Muestra datos personales de otra persona.'],
    user: ['La foto de perfil es ofensiva.', 'La foto de perfil muestra contenido sexual o violento.', 'La foto de perfil es de otra persona.'],
    rating: ['Tiene insultos o amenazas.', 'Da datos personales de otra persona.', 'Discrimina a una persona o a un grupo.', 'No habla de la visita ni del acuerdo.'],
    rating_response: ['Tiene insultos o amenazas.', 'Da datos personales de otra persona.', 'Discrimina a una persona o a un grupo.'],
  };
  const RTITLES = { open: 'Abiertos', resolved: 'Resueltos' };
  const REMPTY = {
    open: ['Nada para revisar', 'No hay reportes abiertos. Cuando alguien reporte algo, aparece acá y te llega un correo.'],
    resolved: ['Ninguno resuelto todavía', 'Los que resuelvas quedan acá, con qué se hizo, quién y cuándo.'],
  };
  const CODE_REP_RESOLVED = 'REPORTE_RESUELTO';
  const CODE_REP_PART = 'REPORTE_PARTE';
  const CODE_REP_NOT_FOUND = 'REPORTE_NO_ENCONTRADO';
  const CODE_NOTHING = 'MODERACION_NADA_QUE_OCULTAR';
  const CODE_NO_UNDO = 'MODERACION_NO_SE_DESHACE';
  const PART_REP = 'Sos parte de este reporte: lo resuelve otra persona del equipo.';

  let repFilter = 'open';
  let repItems = [];
  let repCursor = null;
  let repCurrent = null;
  let repCounts = {}; // { open: { n, more } }
  let repSeq = 0;
  let repListSeq = 0;
  const repDrafts = new Map(); // el motivo a medio escribir de cada grupo

  const repEmpty = $('#rep-empty');
  const repBody = $('#rep-body');
  const repSkel = $('#rep-skel');
  const repErr = $('#rep-error');
  const repHideOpen = $('#rep-hide-open');
  const repDismissOpen = $('#rep-dismiss-open');
  const repRestore = $('#rep-restore');

  const typeOf = (g) => RTYPE[g.target_type] || { label: g.target_type, icon: 'i-flag', hide: 'Ocultar', what: 'lo reportado' };
  const nameOf = (p) => (p && p.name) || 'Cuenta eliminada';
  /** Ocultar la única foto de un anuncio publicado oculta el anuncio entero. */
  const onlyPhoto = (g) => g.target_type === 'ad_image' && !!(g.current && g.current.only_photo_of_published);
  const hideLabel = (g) => (onlyPhoto(g) ? 'Ocultar el anuncio (es su única foto)' : typeOf(g).hide);

  function resetReports() {
    repItems = [];
    repCursor = null;
    repCurrent = null;
    repCounts = {};
    repDrafts.clear();
    $('#rep-items').replaceChildren();
    repBody.hidden = true;
    showRepEmpty();
    paintRepCounts();
  }

  /* ---------- La lista ---------- */
  function skeletonRepList() {
    const list = $('#rep-items');
    list.replaceChildren();
    for (let i = 0; i < 6; i++) {
      const li = el('li', 'skel');
      li.setAttribute('aria-hidden', 'true');
      li.append(el('span', 'sk'), el('span', 'sk'), el('span', 'sk'), el('span', 'sk'));
      list.append(li);
    }
    $('#rep-list-msg').hidden = true;
    $('#rep-more').hidden = true;
  }

  async function loadRepList(reset) {
    const seq = ++repListSeq;
    const state = $('#rep-list-state');
    const more = $('#rep-more');
    if (reset) {
      repItems = [];
      repCursor = null;
      skeletonRepList();
    } else busy(more, true);
    state.textContent = 'Cargando reportes…';
    const q = new URLSearchParams({ status: repFilter });
    if (repCursor) q.set('cursor', repCursor);
    const r = await call('GET', '/support/admin/reports?' + q);
    busy(more, false);
    if (!session) return 'ended';
    if (seq !== repListSeq) return 'stale';
    if (noRole(r)) { deny(); return 'ended'; }
    if (!r.ok) {
      repListMessage('error', r.message || 'No pudimos cargar los reportes.');
      state.textContent = r.message || 'No pudimos cargar los reportes.';
      return 'error';
    }
    repItems = repItems.concat((r.data && r.data.data) || []);
    repCursor = (r.data && r.data.next_cursor) || null;
    if (repFilter === 'open' && !repCursor) { repCounts.open = { n: repItems.length, more: false }; paintRepCounts(); }
    renderRepList();
    return 'ok';
  }

  /** Cuántas cosas reportadas esperan: la primera tanda (de a 20). */
  async function refreshRepCounts() {
    const r = await call('GET', '/support/admin/reports?status=open');
    if (!session) return;
    if (r.ok && r.data && Array.isArray(r.data.data)) {
      repCounts.open = { n: r.data.data.length, more: !!r.data.next_cursor };
    }
    paintRepCounts();
  }
  function paintRepCounts() {
    const c = repCounts.open;
    const text = c && c.n ? c.n + (c.more ? '+' : '') : '';
    [$('[data-rcount="open"]'), $('[data-sect-count="reports"]')].forEach((n) => {
      n.textContent = text;
      n.classList.toggle('has', !!text);
    });
  }

  function repListMessage(kind, text, title) {
    const box = $('#rep-list-msg');
    box.replaceChildren();
    $('#rep-items').replaceChildren();
    box.append(illo(kind === 'error' ? 'error' : (repFilter === 'open' ? 'done' : 'empty')));
    box.append(el('p', 'empty-h', title || (kind === 'error' ? 'No pudimos cargar los reportes' : '')));
    box.append(el('p', 'empty-t', text));
    if (kind === 'error') {
      $('#rep-list-n').textContent = '';
      const retry = el('button', 'go go--ghost go--sm', 'Reintentar');
      retry.type = 'button';
      retry.addEventListener('click', () => { loadRepList(true); refreshRepCounts(); });
      box.append(retry);
    }
    box.hidden = false;
    $('#rep-more').hidden = kind === 'error' || !repCursor;
  }

  /** El resultado de un grupo resuelto, en pocas palabras. */
  function outcomeTag(g) {
    if (g.outcome === 'content_hidden' && g.restored_at) return el('span', 'tagc tagc--restored', 'Vuelto a mostrar');
    if (g.outcome === 'content_hidden') return el('span', 'tagc tagc--hidden', 'Oculto');
    if (g.outcome === 'account_suspended') return el('span', 'tagc tagc--hidden', 'Cuenta suspendida');
    return el('span', 'tagc tagc--dismissed', 'Descartado');
  }

  function repItemFor(g) {
    const li = el('li');
    const b = el('button', 'sop-item rep-item');
    b.type = 'button';
    b.dataset.id = String(g.id_report);
    if (repCurrent && repCurrent.id_report === g.id_report) {
      b.classList.add('is-current');
      b.setAttribute('aria-current', 'true');
    }
    const t = typeOf(g);
    const who = nameOf(g.reported_user);

    const top = el('span', 'item-top');
    const kind = el('span', 'rep-kind');
    kind.append(icon(t.icon), document.createTextNode(t.label));
    top.append(kind, el('span', 'item-name', who));
    if (g.status === 'open') top.append(dueChip(g.first_reported_at));
    else if (g.resolved_at) {
      const when = timeEl(g.resolved_at, 'item-when', ago(g.resolved_at));
      when.dataset.ago = 'short';
      top.append(when);
    }

    const meta = el('span', 'item-meta');
    meta.append(el('span', '', `#${g.id_report} · ${g.reports_count} ${g.reports_count === 1 ? 'reporte' : 'reportes'}`));

    const tags = el('span', 'item-tags');
    if (g.status === 'open') {
      (g.reasons || []).forEach((r) => tags.append(el('span', 'tagc tagc--reason', RREASON[r] || r)));
    } else {
      tags.append(outcomeTag(g));
      if (g.resolver) tags.append(el('span', 'tagc tagc--who', 'Resolvió ' + g.resolver.name));
    }

    b.append(avatar(who, g.reported_user && g.reported_user.id_user), top, meta, tags);
    // La vista previa sin direcciones de fotos (no le dicen nada a quien lee
    // la lista); de una persona, su nombre ya está arriba.
    const clean = (g.preview || '').replace(/https?:\/\/\S+/g, '').replace(/Foto de perfil:\s*/g, '').replace(/\s+/g, ' ').trim();
    const prev = g.status !== 'open' && g.outcome_reason ? g.outcome_reason
      : g.target_type === 'user' ? '' : clean;
    if (prev) b.append(el('span', 'item-prev', prev));
    b.setAttribute('aria-label', `${t.label} de ${who}, ${g.reports_count} ${g.reports_count === 1 ? 'reporte' : 'reportes'}`
      + (g.status === 'open' ? '' : `, ${(ROUTCOME[g.outcome] || '').toLowerCase()}`));
    b.addEventListener('click', () => openRep(g.id_report));
    li.append(b);
    return li;
  }

  function renderRepList() {
    const list = $('#rep-items');
    list.replaceChildren(...repItems.map(repItemFor));
    $('#rep-list-msg').hidden = true;
    $('#rep-more').hidden = !repCursor;
    $('#rep-list-title').textContent = RTITLES[repFilter];
    $('#rep-list-n').textContent = repItems.length ? repItems.length + (repCursor ? '+' : '') : '';
    $('#rep-list-state').textContent = repItems.length
      ? `${repItems.length} ${repItems.length === 1 ? 'cosa reportada' : 'cosas reportadas'}, ${RTITLES[repFilter].toLowerCase()}`
      : 'No hay reportes en este estado.';
    if (!repItems.length) repListMessage('empty', REMPTY[repFilter][1], REMPTY[repFilter][0]);
  }

  function selectRepTab(tab) {
    repFilter = tab.dataset.status;
    $$('.rep-tab').forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    $('#rep-list-title').textContent = RTITLES[repFilter];
    $('#rep-list-scroll').scrollTop = 0;
    loadRepList(true);
  }
  $$('.rep-tab').forEach((tab) => tab.addEventListener('click', () => selectRepTab(tab)));
  $('#rep-tabs').addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const tabs = $$('.rep-tab');
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
    next.focus();
    selectRepTab(next);
  });
  $('#rep-more').addEventListener('click', () => loadRepList(false));

  const repRefreshBtn = $('#rep-refresh');
  async function refreshReports() {
    repRefreshBtn.classList.add('is-spin');
    const jobs = [loadRepList(true), refreshRepCounts()];
    if (repCurrent) jobs.push(openRep(repCurrent.id_report, { focus: false, quiet: true }));
    await Promise.all(jobs);
    repRefreshBtn.classList.remove('is-spin');
  }
  repRefreshBtn.addEventListener('click', refreshReports);
  $('#rep-keys-open').addEventListener('click', () => $('#sop-keys').showModal());

  /* ---------- Una cosa reportada ---------- */
  function showRepEmpty(title, text, retryId) {
    repEmpty.hidden = false;
    repEmpty.classList.toggle('is-error', !!title);
    repSkel.hidden = true;
    $('#rep-empty-h').textContent = title || 'Elegí un reporte de la lista';
    $('#rep-empty-t').textContent = text || 'Se abre acá con lo reportado como está hoy, cada reporte y el historial de la persona.';
    const retry = $('#rep-retry');
    retry.hidden = !retryId;
    retry.dataset.id = retryId ? String(retryId) : '';
    $('.illo', repEmpty).replaceWith(illo(title ? 'error' : 'empty'));
  }
  $('#rep-retry').addEventListener('click', (e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (id) openRep(id);
  });

  function markRepCurrent() {
    $$('#rep-items .sop-item').forEach((b) => {
      const on = !!repCurrent && Number(b.dataset.id) === repCurrent.id_report;
      b.classList.toggle('is-current', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  async function openRep(id, { focus = true, quiet = false } = {}) {
    const seq = ++repSeq;
    if (section !== 'reports') paintSection('reports');
    setError(repErr, '');
    if (!quiet) panel.dataset.view = 'case';
    const skelTimer = quiet ? null : setTimeout(() => {
      if (seq !== repSeq) return;
      repBody.hidden = true;
      repEmpty.hidden = true;
      repSkel.hidden = false;
    }, 140);
    const r = await call('GET', '/support/admin/reports/' + id);
    clearTimeout(skelTimer);
    if (seq !== repSeq) return;
    repSkel.hidden = true;
    if (!r.ok) {
      if (!session || quiet) return;
      repBody.hidden = true;
      repCurrent = null;
      markRepCurrent();
      const notFound = r.status === 404 || r.code === CODE_REP_NOT_FOUND;
      showRepEmpty(notFound ? 'No encontramos ese reporte' : 'No pudimos abrir el reporte',
        notFound ? 'Revisá el número o elegí otro de la lista.' : (r.message || 'Probá de nuevo en un momento.'),
        notFound ? null : id);
      return;
    }
    const same = repCurrent && repCurrent.id_report === r.data.id_report;
    repCurrent = r.data;
    if (history.replaceState) history.replaceState(null, '', '#reporte-' + repCurrent.id_report);
    renderRep({ keepScroll: quiet && same });
    markRepCurrent();
    if (focus) $('#rep-title').focus({ preventScroll: true });
  }
  const refreshRep = () => (repCurrent ? openRep(repCurrent.id_report, { focus: false, quiet: true }) : null);

  /** Una foto que se agranda en el visor compartido. */
  function bigPhotoButton(url, cls, label, alt) {
    const b = el('button', cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => b.classList.add('is-broken'));
    img.src = url;
    b.append(img);
    b.addEventListener('click', () => showLightbox(url, alt, {
      label: 'Foto reportada', closeLabel: 'Cerrar la foto', key: 'rep-' + url, fresh: async () => null,
    }));
    return b;
  }
  function photoThumbs(urls, what) {
    const thumbs = el('ul', 'ver-thumbs');
    urls.filter(validShot).forEach((url, i) => {
      const li = el('li');
      li.append(bigPhotoButton(url, 'ver-thumb', `Ver la foto ${i + 1} ${what} en grande`, `Foto ${i + 1} ${what}`));
      thumbs.append(li);
    });
    return thumbs;
  }
  function flag(text, tone) {
    const f = el('span', 'rep-flag rep-flag--' + tone);
    f.append(icon(tone === 'hidden' ? 'i-eye-off' : 'i-alert'), document.createTextNode(text));
    return f;
  }
  function stars(score) {
    const s = el('span', 'rep-stars');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', `${score} de 5 estrellas`);
    for (let i = 1; i <= 5; i++) s.append(icon('i-star', i <= score ? '' : 'is-off'));
    return s;
  }

  /** Lo reportado, como está hoy, según qué es. */
  function renderCurrent(g, sec) {
    const c = g.current;
    if (!c || c.gone) {
      const box = el('p', 'rep-gone');
      box.append(icon('i-ban'), document.createTextNode(
        g.target_type === 'user' ? 'La cuenta ya no existe: se eliminó.' : 'Ya no existe: se borró. Abajo está cómo era cuando lo reportaron.'));
      sec.append(box);
      return;
    }
    switch (g.target_type) {
      case 'user': {
        const p = el('div', 'rep-person');
        if (c.has_own_photo && validShot(c.avatar_url)) {
          p.append(bigPhotoButton(c.avatar_url, 'rep-avatar', 'Ver la foto de perfil en grande', `Foto de perfil de ${c.name}`));
        } else p.append(avatar(c.name, g.reported_user && g.reported_user.id_user, 'av--lg'));
        const col = el('div');
        col.append(el('p', 'ver-banner-h', c.name));
        col.append(el('p', 'ver-sub', c.has_own_photo ? 'Tiene una foto de perfil propia.' : 'Usa la foto por defecto: no hay foto propia para quitar.'));
        p.append(col);
        sec.append(p);
        break;
      }
      case 'ad': {
        const dl = el('dl', 'ver-dl');
        dl.append(row('Título', c.title), row('Estado', `${AD_STATUS[c.status] || c.status} · ${LISTING[c.listing_type] || c.listing_type || ''}`.replace(/ · $/, '')));
        sec.append(dl);
        if (c.moderation) sec.append(flag(`Ya está oculto: ${c.moderation.reason}`, 'hidden'));
        if (c.description) sec.append(el('p', 'rep-text', c.description));
        if (c.images && c.images.length) {
          sec.append(el('p', 'ver-subh', 'Fotos del anuncio'));
          sec.append(photoThumbs(c.images, 'del anuncio'));
        } else sec.append(el('p', 'ver-sub', 'El anuncio no tiene fotos.'));
        break;
      }
      case 'ad_image': {
        if (validShot(c.url)) sec.append(bigPhotoButton(c.url, 'rep-photo', 'Ver la foto reportada en grande', `Foto reportada del anuncio «${c.ad.title}»`));
        const dl = el('dl', 'ver-dl');
        dl.append(row('Del anuncio', c.ad.title, `#${c.ad.id_ad} · ${AD_STATUS[c.ad.status] || c.ad.status} · ${c.ad.images_count} ${c.ad.images_count === 1 ? 'foto' : 'fotos'}`));
        sec.append(dl);
        if (c.only_photo_of_published) {
          sec.append(flag('Es la única foto de un anuncio publicado: ocultarla oculta el anuncio entero y la foto queda.', 'warn'));
        }
        break;
      }
      case 'message': {
        sec.append(el('p', 'ver-sub', `En la conversación sobre «${c.conversation.ad_title}». Los mensajes de alrededor, para entender el tono.`));
        const ol = el('ol', 'rep-thread');
        (c.context || []).forEach((m) => {
          const li = el('li', 'rep-msg' + (m.is_reported ? ' is-reported' : '') + (m.moderated ? ' is-hidden' : ''));
          const top = el('p', 'rep-msg-top');
          top.append(el('span', 'rep-msg-who', m.sender_name || 'Cuenta eliminada'), timeEl(m.created_at, '', fmt(m.created_at)));
          if (m.is_reported) top.append(el('span', 'rep-msg-mark', 'El reportado'));
          if (m.moderated) top.append(el('span', 'tagc tagc--hidden', 'Oculto'));
          li.append(top, el('p', 'rep-msg-t', m.content));
          if (m.is_reported) li.setAttribute('aria-label', 'Mensaje reportado');
          ol.append(li);
        });
        sec.append(ol);
        if (c.moderated) sec.append(flag('Ya está oculto: en la app los dos ven «Mensaje oculto por ImHomi».', 'hidden'));
        break;
      }
      case 'rating': {
        const dl = el('dl', 'ver-dl');
        const score = el('dd');
        score.append(stars(c.score));
        dl.append(row('Calificación', score), row('A quién', c.reviewed ? c.reviewed.name : '—', RCONTEXT[c.context] || c.context));
        sec.append(dl);
        sec.append(c.comment ? el('p', 'rep-text rep-text--quote', c.comment) : el('p', 'ver-sub', 'No dejó comentario.'));
        if (c.moderated) sec.append(flag('Ya está oculta: no se lista ni suma al promedio.', 'hidden'));
        if (c.response) {
          sec.append(el('p', 'ver-subh', 'Su respuesta'));
          sec.append(el('p', 'rep-text', c.response.comment));
          if (c.response.moderated) sec.append(flag('La respuesta está oculta.', 'hidden'));
        }
        break;
      }
      case 'rating_response': {
        sec.append(el('p', 'rep-text rep-text--quote', c.comment));
        if (c.moderated) sec.append(flag('Ya está oculta.', 'hidden'));
        sec.append(el('p', 'ver-subh', 'Responde a esta calificación'));
        const p = el('div', 'rep-text');
        p.append(stars(c.rating.score));
        if (c.rating.comment) p.append(el('p', '', c.rating.comment));
        sec.append(p);
        break;
      }
      default:
        sec.append(el('p', 'ver-sub', 'No sabemos mostrar este tipo todavía.'));
    }
  }

  function renderRep({ keepScroll = false } = {}) {
    const g = repCurrent;
    repEmpty.hidden = true;
    repSkel.hidden = true;
    repBody.hidden = false;
    const t = typeOf(g);
    const who = nameOf(g.reported_user);
    const open = g.status === 'open';

    $('#rep-title').replaceChildren(
      el('span', 'ct-id', `#${g.id_report} · ${t.label} · ${g.reports_count} ${g.reports_count === 1 ? 'reporte' : 'reportes'}`),
      el('span', 'sr', ' — '),
      el('span', 'ct-name', who),
    );
    $('#rep-av').replaceWith(Object.assign(avatar(who, g.reported_user && g.reported_user.id_user, 'av--lg'), { id: 'rep-av' }));
    $('#rep-av').setAttribute('aria-hidden', 'true');
    const badge = $('#rep-status');
    badge.className = 'badge badge--' + (open ? 'open' : g.outcome === 'content_hidden' && !g.restored_at ? 'rejected' : 'resolved');
    badge.textContent = open ? 'Abierto' : (g.outcome === 'content_hidden' && g.restored_at ? 'Vuelto a mostrar' : ROUTCOME[g.outcome] || 'Resuelto');

    const scroll = $('#rep-scroll');
    const keep = keepScroll ? scroll.scrollTop : 0;
    const wrap = el('div', 'ver-wrap');

    // El plazo, o cómo se resolvió.
    if (open) {
      const due = g.due_at ? new Date(g.due_at) : dueOf(g.first_reported_at);
      const late = due.getTime() <= Date.now();
      const box = el('div', 'ver-banner' + (late ? ' ver-banner--late' : ''));
      box.append(icon('i-clock'));
      const tm = el('time', '', dueLongRep(due));
      tm.dateTime = due.toISOString();
      tm.dataset.due = 'long-rep';
      box.append(tm);
      wrap.append(box);
    } else {
      const hidden = g.outcome !== 'dismissed';
      const box = el('div', 'ver-banner ver-banner--' + (g.restored_at ? 'approved' : hidden ? 'rejected' : 'cancelled'));
      box.append(icon(g.restored_at ? 'i-eye' : hidden ? 'i-eye-off' : 'i-check'));
      const col = el('div', 'ver-banner-col');
      const by = g.resolver ? ' por ' + g.resolver.name : '';
      const when = g.resolved_at ? ' el ' + fmt(g.resolved_at) : '';
      col.append(el('p', 'ver-banner-h', `${ROUTCOME[g.outcome] || 'Resuelto'}${by}${when}`));
      if (g.outcome_reason) col.append(el('p', 'ver-banner-t', 'Motivo que leyó el autor: ' + g.outcome_reason));
      if (g.restored_at) col.append(el('p', 'ver-banner-t', 'Se volvió a mostrar el ' + fmt(g.restored_at) + '.'));
      if (g.outcome === 'dismissed') col.append(el('p', 'ver-banner-t', 'A quien reportó le llegó que no infringe las reglas.'));
      box.append(col);
      wrap.append(box);
    }

    // Lo reportado, hoy.
    const now = verSection('rep-now-h', `${t.label === 'Persona' ? 'La persona' : 'Lo reportado'}, como está hoy`, t.icon);
    renderCurrent(g, now);
    wrap.append(now);

    // Cada reporte.
    const list = verSection('rep-list-h', g.reports_count === 1 ? 'El reporte' : `Los ${g.reports_count} reportes`, 'i-flag',
      'Con lo que había en el momento de reportarlo: puede haber cambiado.');
    const ol = el('ol', 'rep-list');
    (g.reports || []).forEach((r) => {
      const li = el('li', 'rep-r');
      const top = el('p', 'rep-r-top');
      top.append(el('span', 'tagc tagc--reason', RREASON[r.reason] || r.reason),
        el('span', 'rep-r-who', nameOf(r.reporter)), timeEl(r.created_at, '', agoLong(r.created_at)));
      li.append(top);
      if (r.details) li.append(el('p', 'rep-r-details', r.details));
      li.append(el('p', 'rep-r-snap-h', 'Lo que había en ese momento'));
      li.append(el('p', 'rep-r-snap', r.snapshot));
      ol.append(li);
    });
    list.append(ol);
    wrap.append(list);

    // La persona reportada.
    const p = g.person || {};
    const ps = verSection('rep-person-h', 'La persona reportada', 'i-user');
    ps.append(el('p', 'ver-sub', `${nameOf(p)}${p.deleted ? ' · cuenta eliminada' : ''}${p.created_at ? ' · en ImHomi desde ' + fmt(p.created_at) : ''}`));
    const stats = el('div', 'rep-stats');
    const stat = (n, label, warn) => {
      const d = el('div', 'rep-stat' + (warn ? ' is-warn' : ''));
      d.append(el('b', '', String(n ?? 0)), el('span', '', label));
      return d;
    };
    stats.append(
      stat(p.reports_against, p.reports_against === 1 ? 'reporte en contra' : 'reportes en contra', p.reports_against > 3),
      stat(p.distinct_reporters, p.distinct_reporters === 1 ? 'persona la reportó' : 'personas la reportaron', p.distinct_reporters > 2),
      stat(p.hidden_before, p.hidden_before === 1 ? 'vez se le ocultó algo' : 'veces se le ocultó algo', p.hidden_before > 0),
      // Decisión 72: cuántas personas la bloquearon, sin decir quiénes.
      stat(p.blocked_by, p.blocked_by === 1 ? 'persona la bloqueó' : 'personas la bloquearon', p.blocked_by > 2),
    );
    ps.append(stats);
    if (p.recent && p.recent.length) {
      ps.append(el('p', 'ver-subh', 'Los últimos'));
      const hist = el('ol', 'ver-hist');
      p.recent.forEach((h) => {
        const li = el('li', 'ver-hist-i');
        const top = el('p', 'ver-hist-top');
        const st = h.outcome ? (h.outcome === 'dismissed' ? 'closed' : 'rejected') : 'open';
        top.append(el('span', 'item-st item-st--' + st, h.outcome ? ROUTCOME[h.outcome] : 'Abierto'),
          el('span', '', ` #${h.id_report} · ${(RTYPE[h.target_type] || {}).label || h.target_type} · `),
          timeEl(h.created_at, '', fmt(h.created_at)));
        li.append(top);
        hist.append(li);
      });
      ps.append(hist);
    }
    wrap.append(ps);

    scroll.replaceChildren(wrap);
    scroll.scrollTop = keep;
    paintRepActions();
  }

  /** Qué se puede hacer, según el estado y `actions` de la API. */
  function paintRepActions() {
    const g = repCurrent;
    const open = g.status === 'open';
    const me = session && session.agentId;
    const part = !!(g._part || (me && ((g.reported_user && g.reported_user.id_user === me)
      || (g.reports || []).some((r) => r.reporter && r.reporter.id_user === me))));
    const a = g.actions || {};
    const noOwnPhoto = g.target_type === 'user' && g.current && !g.current.gone && !g.current.has_own_photo;

    $('#rep-actions').hidden = !open || part;
    $('.go-t', repHideOpen).textContent = hideLabel(g);
    repHideOpen.hidden = !a.can_hide || noOwnPhoto;
    const why = !a.can_hide ? (a.hide_blocked || 'Ya no hay nada que ocultar.')
      : noOwnPhoto ? 'No tiene una foto de perfil propia para quitar: si es por su conducta, descartalo.' : null;
    $('#rep-actions-t').textContent = why
      || (onlyPhoto(g)
        ? 'Si la ocultás, el anuncio entero sale de la búsqueda con el motivo; la foto queda y se puede volver a mostrar.'
        : `Si lo ocultás, a quien lo publicó le llega el motivo y a quien reportó, que tomamos medidas.`);

    const closed = $('#rep-closed');
    closed.hidden = open && !part;
    closed.classList.toggle('is-own', open && part);
    repRestore.hidden = open || !a.can_restore;
    $('#rep-closed-t').textContent = open && part ? PART_REP
      : g.outcome === 'dismissed' ? 'Descartado: no se ocultó nada.'
        : g.restored_at ? 'Se volvió a mostrar.'
          : a.can_restore ? 'Oculto. Si te equivocaste, lo podés volver a mostrar.'
            : (a.restore_blocked || 'Resuelto.');
  }

  /* ---------- Descartar, ocultar y volver a mostrar ---------- */
  function repBusy(on) {
    repHideOpen.disabled = on;
    repDismissOpen.disabled = on;
  }

  /** Lo que pasa cuando resolver o volver a mostrar no sale. */
  async function repFailed(r, id) {
    if (!session) return;
    const mine = () => repCurrent && repCurrent.id_report === id;
    if (r.code === CODE_REP_RESOLVED) {
      toast(r.message && /nada oculto/i.test(r.message)
        ? 'Ya no hay nada oculto que volver a mostrar: te mostramos cómo quedó.'
        : 'Otra persona del equipo ya lo resolvió: te mostramos cómo quedó.');
      if (mine()) await refreshRep();
      loadRepList(true);
      refreshRepCounts();
      return;
    }
    if (r.code === CODE_REP_PART) {
      if (mine()) { repCurrent._part = true; paintRepActions(); }
      return toast(r.message || PART_REP, true);
    }
    if (r.code === CODE_NOTHING || r.code === CODE_NO_UNDO) {
      toast(r.message || 'No se pudo: ya cambió. Te mostramos cómo está.', true);
      if (mine()) await refreshRep();
      return;
    }
    if (r.status === 404 || r.code === CODE_REP_NOT_FOUND) {
      repBody.hidden = true;
      repCurrent = null;
      showRepEmpty('No encontramos ese reporte', 'Elegí otro de la lista.');
      loadRepList(true);
      refreshRepCounts();
      return;
    }
    setError(repErr, r.message || 'No pudimos resolverlo. Probá de nuevo.');
  }

  /** Después de resolver: el grupo nuevo, la lista y el aviso. */
  function repDone(data, text) {
    repCurrent = data;
    renderRep();
    markRepCurrent();
    if (history.replaceState) history.replaceState(null, '', '#reporte-' + data.id_report);
    $('#rep-title').focus({ preventScroll: true });
    toast(text);
    loadRepList(true);
    refreshRepCounts();
  }

  // Descartar, con su confirmación.
  const dismissDlg = $('#rep-dismiss');
  const dismissOk = $('#rep-dismiss-ok');
  repDismissOpen.addEventListener('click', () => {
    if (!repCurrent || repDismissOpen.disabled) return;
    const n = repCurrent.reports_count;
    $('#rep-dismiss-h').textContent = n === 1 ? '¿Descartar el reporte?' : `¿Descartar los ${n} reportes?`;
    setError($('#rep-dismiss-error'), '');
    dismissDlg.showModal();
    dismissOk.focus();
  });
  $('#rep-dismiss-cancel').addEventListener('click', () => dismissDlg.close());
  dismissOk.addEventListener('click', async () => {
    if (!repCurrent || dismissOk.disabled) return;
    const id = repCurrent.id_report;
    busy(dismissOk, true, 'Descartando…');
    $('#rep-dismiss-cancel').disabled = true;
    repBusy(true);
    const r = await call('POST', `/support/admin/reports/${id}/resolve`, { outcome: 'dismissed' });
    busy(dismissOk, false, 'Descartar');
    $('#rep-dismiss-cancel').disabled = false;
    repBusy(false);
    dismissDlg.close();
    if (!r.ok) return repFailed(r, id);
    repDone(r.data, 'Descartado: a quien reportó le avisamos que lo revisamos.');
  });

  // Ocultar, con el motivo.
  const hideDlg = $('#rep-hide');
  const repReason = $('#rep-reason');
  const hideErr = $('#rep-hide-error');
  const hideGo = $('#rep-hide-go');
  function paintRepReason() {
    const n = repReason.value.length;
    $('#rep-reason-count').textContent = String(n);
    $('.counter', hideDlg).classList.toggle('is-near', n > 270);
  }
  repHideOpen.addEventListener('click', () => {
    if (!repCurrent || repHideOpen.disabled) return;
    const g = repCurrent;
    const label = hideLabel(g);
    $('#rep-hide-h').textContent = label;
    $('.go-t', hideGo).textContent = onlyPhoto(g) ? 'Ocultar el anuncio' : typeOf(g).hide;
    $('#rep-hide-t').textContent = onlyPhoto(g)
      ? 'Es la única foto de un anuncio publicado: se oculta el anuncio entero y la foto queda. Su dueño lee el motivo en el aviso.'
      : g.target_type === 'message'
        ? 'Los dos lados van a ver «Mensaje oculto por ImHomi». Quien lo mandó lee el motivo en el aviso.'
        : `Quien lo publicó lee el motivo en el aviso: escribilo para que entienda qué regla rompió.`;
    const quick = $('#rep-quick');
    quick.replaceChildren(...(RQUICK[onlyPhoto(g) ? 'ad' : g.target_type] || []).map((text) => {
      const chip = el('button', 'chip', text);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        repReason.value = text;
        paintRepReason();
        setError(hideErr, '');
        if (repCurrent) repDrafts.set(repCurrent.id_report, repReason.value);
        repReason.focus();
        repReason.setSelectionRange(repReason.value.length, repReason.value.length);
      });
      return chip;
    }));
    repReason.value = repDrafts.get(g.id_report) || '';
    paintRepReason();
    setError(hideErr, '');
    hideDlg.showModal();
    repReason.focus();
  });
  repReason.addEventListener('input', () => {
    paintRepReason();
    setError(hideErr, '');
    if (repCurrent) repDrafts.set(repCurrent.id_report, repReason.value);
  });
  repReason.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#rep-hide-form').requestSubmit();
    }
  });
  $('#rep-hide-cancel').addEventListener('click', () => hideDlg.close());
  $('#rep-hide-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!repCurrent || hideGo.disabled) return;
    const text = cleanReason(repReason.value);
    if (text.length < 10) {
      repReason.focus();
      return setError(hideErr, text ? 'Escribí el motivo con un poco más de detalle: lo va a leer quien lo publicó.'
        : 'Escribí el motivo: lo va a leer quien lo publicó.');
    }
    const g = repCurrent;
    const id = g.id_report;
    const was = onlyPhoto(g) ? 'ad' : g.target_type;
    const label = $('.go-t', hideGo).textContent;
    setError(hideErr, '');
    busy(hideGo, true, 'Ocultando…');
    $('#rep-hide-cancel').disabled = true;
    repBusy(true);
    const r = await call('POST', `/support/admin/reports/${id}/resolve`, { outcome: 'content_hidden', reason: text });
    busy(hideGo, false, label);
    $('#rep-hide-cancel').disabled = false;
    repBusy(false);
    if (!r.ok) {
      if (r.status === 400 && !r.code) return setError(hideErr, r.message || 'Revisá el motivo.');
      if (!session) return;
      hideDlg.close();
      return repFailed(r, id);
    }
    repDrafts.delete(id);
    hideDlg.close();
    const DONE = {
      user: 'Listo: se quitó la foto de perfil y le llega el motivo.',
      ad: 'Listo: el anuncio salió de la búsqueda y a su dueño le llega el motivo.',
      ad_image: 'Listo: la foto salió del anuncio y a su dueño le llega el motivo.',
      message: 'Listo: el mensaje ya no se ve en el chat y a quien lo mandó le llega el motivo.',
      rating: 'Listo: la calificación ya no se lista ni suma, y a quien la dejó le llega el motivo.',
      rating_response: 'Listo: la respuesta ya no se ve y a quien la escribió le llega el motivo.',
    };
    repDone(r.data, DONE[was] || 'Listo: quedó oculto.');
  });

  // Volver a mostrar.
  repRestore.addEventListener('click', async () => {
    if (!repCurrent || repRestore.disabled) return;
    const g = repCurrent;
    const id = g.id_report;
    const wasAd = g.target_type === 'ad' || g.target_type === 'ad_image';
    busy(repRestore, true, 'Volviendo a mostrar…');
    const r = await call('POST', `/support/admin/reports/${id}/restore`);
    busy(repRestore, false, 'Volver a mostrar');
    if (!r.ok) return repFailed(r, id);
    repDone(r.data, wasAd
      ? 'Listo: el anuncio quedó pausado para que su dueño lo vuelva a publicar.'
      : 'Listo: se volvió a mostrar y a su autor le llega el aviso.');
  });

  /* ---------- Volver a la lista (teléfono) ---------- */
  function backToRepList() {
    panel.dataset.view = 'list';
    const item = repCurrent && $(`#rep-items .sop-item[data-id="${repCurrent.id_report}"]`);
    if (item) item.focus(); else repRefreshBtn.focus();
  }
  $('#rep-back').addEventListener('click', backToRepList);

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
    const verifs = section === 'verifs';
    const reps = section === 'reports';
    const items = $$(verifs ? '#ver-items .sop-item' : reps ? '#rep-items .sop-item' : '#sop-cases .sop-item');
    if (!items.length) return;
    // En reportes, la fila lleva el primer reporte de su grupo.
    const openId = verifs ? (verCurrent && verCurrent.id_verification)
      : reps ? (repCurrent && repCurrent.id_report) : (current && current.id_support_case);
    const at = openId ? items.findIndex((b) => Number(b.dataset.id) === openId) : -1;
    const next = items[Math.max(0, Math.min(items.length - 1, at === -1 ? 0 : at + step))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    if (Number(next.dataset.id) !== openId) {
      if (verifs) openVer(Number(next.dataset.id), { focus: false });
      else if (reps) openRep(Number(next.dataset.id), { focus: false });
      else openCase(Number(next.dataset.id), { focus: false });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (panel.hidden || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const verifs = section === 'verifs';
    const reps = section === 'reports';
    const tabs = $$(verifs ? '.ver-tab' : reps ? '.rep-tab' : '.sop-tab');
    switch (e.key) {
      case 'j': move(1); break;
      case 'k': move(-1); break;
      case 'r':
        if (section !== 'cases' || !current || current.status === 'closed' || caseBody.hidden) return;
        panel.dataset.view = 'case';
        reply.focus();
        break;
      case 'c': if (section !== 'cases') setSection('cases'); else return; break;
      case 'v': if (!verifs) setSection('verifs'); else return; break;
      case 'p': if (!reps) setSection('reports'); else return; break;
      case '1': case '2': case '3': case '4': {
        const tab = tabs[Number(e.key) - 1];
        if (!tab) return;
        (verifs ? selectVerTab : reps ? selectRepTab : selectTab)(tab);
        tab.focus();
        break;
      }
      case 'u': if (verifs) refreshVerifs(); else if (reps) refreshReports(); else refreshAll(); break;
      case '?': keysDlg.showModal(); break;
      case 'Escape':
        if (panel.dataset.view === 'case' && matchMedia('(max-width: 759.98px)').matches) {
          if (verifs) backToVerList(); else if (reps) backToRepList(); else backToList();
        } else return;
        break;
      default: return;
    }
    e.preventDefault();
  });

  show('login', emailIn);
})();
