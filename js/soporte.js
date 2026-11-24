/* =====================================================================
   ImHomi · panel de soporte (decisión 51)
   Entra con el ingreso de la API (con el código si la cuenta tiene
   verificación en dos pasos), lista los casos por estado, muestra el hilo,
   responde y cierra. Solo lo abre una cuenta con users.role = 'support':
   la API contesta 403 SIN_PERMISO a cualquier otra.

   La sesión vive solo en la memoria de esta pestaña: nada en localStorage
   ni en sessionStorage. Recargar o cerrar la pestaña pide entrar de nuevo.

   Todo lo que escribió una persona entra con textContent, nunca como HTML.
   Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s) => document.querySelector(s);
  const api = (document.body.dataset.api || '').replace(/\/+$/, '');

  const views = {
    login: $('#sop-login'),
    otp: $('#sop-otp'),
    denied: $('#sop-denied'),
    panel: $('#sop-panel'),
  };
  if (Object.values(views).some((v) => !v)) return;

  /* ---------- La sesión, en memoria ---------- */
  let session = null; // { access, refresh, name }
  let tempToken = null;

  const show = (name, focus) => {
    Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
    const logged = name === 'panel';
    $('#sop-logout').hidden = !logged;
    $('#sop-who').hidden = !logged;
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
      logout('Tu sesión terminó. Entrá de nuevo.');
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

  async function renew() {
    const r = await call('POST', '/auth/refresh', { refresh_token: session.refresh }, { auth: false });
    if (!r.ok || !r.data || !r.data.access_token) return false;
    session.access = r.data.access_token;
    session.refresh = r.data.refresh_token || session.refresh;
    return true;
  }

  function startSession(data) {
    const user = data.user || {};
    session = {
      access: data.access_token,
      refresh: data.refresh_token,
      name: [user.user_name, user.last_name].filter(Boolean).join(' ') || user.email || '',
    };
    tempToken = null;
    $('#sop-password').value = '';
    $('#sop-code').value = '';
    openPanel();
  }

  async function logout(message) {
    const refresh = session && session.refresh;
    session = null;
    if (refresh) call('POST', '/auth/logout', { refresh_token: refresh }, { auth: false });
    cases = [];
    current = null;
    $('#sop-cases').replaceChildren();
    show('login', $('#sop-email'));
    setError($('#sop-login-error'), message || '');
  }

  /* ---------- Entrar ---------- */
  const busy = (btn, on, label) => {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (label) btn.textContent = label;
  };

  $('#sop-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#sop-email').value.trim().toLowerCase();
    const password = $('#sop-password').value;
    const err = $('#sop-login-error');
    if (!email || !password) return setError(err, 'Escribí tu correo y tu contraseña.');
    setError(err, '');
    const go = $('#sop-login-go');
    busy(go, true, 'Entrando…');
    const r = await call('POST', '/auth/login', { email, password }, { auth: false });
    busy(go, false, 'Entrar');
    if (!r.ok) {
      return setError(err, r.status === 429
        ? (r.message || 'Hiciste varios intentos seguidos. Esperá un momento.')
        : (r.message || 'No pudimos entrar. Probá de nuevo.'));
    }
    if (r.data && r.data.status === 'otp_required') {
      tempToken = r.data.temp_token;
      $('#sop-otp-email').textContent = r.data.masked_email || 'tu correo';
      show('otp', $('#sop-code'));
      return;
    }
    startSession(r.data);
  });

  $('#sop-otp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#sop-code').value.trim();
    const err = $('#sop-otp-error');
    if (!/^\d{6}$/.test(code)) return setError(err, 'El código tiene 6 dígitos.');
    setError(err, '');
    const go = $('#sop-otp-go');
    busy(go, true, 'Confirmando…');
    const r = await call('POST', '/auth/verify-otp', { temp_token: tempToken, code }, { auth: false });
    busy(go, false, 'Confirmar');
    if (!r.ok) {
      if (r.status === 401) {
        show('login', $('#sop-email'));
        return setError($('#sop-login-error'), r.message || 'El ingreso venció. Entrá de nuevo.');
      }
      return setError(err, r.message || 'Ese código no sirve. Probá de nuevo.');
    }
    startSession(r.data);
  });

  $('#sop-otp-resend').addEventListener('click', async () => {
    const r = await call('POST', '/auth/resend-otp', { temp_token: tempToken }, { auth: false });
    setError($('#sop-otp-error'), r.ok ? '' : (r.message || 'No pudimos reenviarlo.'));
    if (r.ok) $('#sop-otp-error').hidden = true;
  });

  $('#sop-logout').addEventListener('click', () => logout());
  $('#sop-denied-back').addEventListener('click', () => show('login', $('#sop-email')));

  /* ---------- La lista ---------- */
  const STATUS = { open: 'Abierta', answered: 'Respondida', closed: 'Cerrada' };
  let filter = 'open';
  let cases = [];
  let cursor = null;
  let current = null;

  const fmt = (iso) => new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica', dateStyle: 'medium', timeStyle: 'short',
  });

  async function openPanel() {
    const r = await loadList(true);
    if (r === 'denied') return;
    $('#sop-who').textContent = session ? session.name : '';
    show('panel');
    const m = /^#caso-(\d{1,10})$/.exec(location.hash);
    if (m) openCase(Number(m[1]));
  }

  async function loadList(reset) {
    const state = $('#sop-list-state');
    if (reset) { cases = []; cursor = null; }
    state.textContent = 'Cargando…';
    const q = new URLSearchParams();
    if (filter) q.set('status', filter);
    if (cursor) q.set('cursor', cursor);
    const r = await call('GET', '/support/admin/cases' + (q.toString() ? '?' + q : ''));
    if (r.status === 403) {
      // La cuenta entró, pero no es de soporte: se cierra su sesión.
      const refresh = session && session.refresh;
      session = null;
      if (refresh) call('POST', '/auth/logout', { refresh_token: refresh }, { auth: false });
      show('denied', $('#sop-denied-title'));
      return 'denied';
    }
    if (!r.ok) {
      state.textContent = r.message || 'No pudimos cargar los casos.';
      return 'error';
    }
    cases = cases.concat(r.data.data || []);
    cursor = r.data.next_cursor || null;
    renderList();
    return 'ok';
  }

  function renderList() {
    const list = $('#sop-cases');
    list.replaceChildren();
    $('#sop-list-state').textContent = cases.length ? '' : 'No hay casos en este estado.';
    for (const c of cases) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sop-item' + (current && current.id_support_case === c.id_support_case ? ' is-current' : '');
      const top = document.createElement('span');
      top.className = 'sop-item-top';
      const badge = document.createElement('span');
      badge.className = 'sop-badge sop-badge--' + c.status;
      badge.textContent = STATUS[c.status] || c.status;
      const when = document.createElement('span');
      when.textContent = '#' + c.id_support_case + ' · ' + fmt(c.last_message_at);
      top.append(badge, when);
      const who = document.createElement('strong');
      who.textContent = (c.topic ? c.topic.title : 'Otro tema') + ' — ' + (c.person.name || 'Cuenta eliminada');
      const prev = document.createElement('span');
      prev.className = 'sop-item-prev';
      prev.textContent = (c.last_message.sender === 'support' ? 'Soporte: ' : '') + c.last_message.preview;
      b.append(top, who, prev);
      b.addEventListener('click', () => openCase(c.id_support_case));
      li.append(b);
      list.append(li);
    }
    $('#sop-more').hidden = !cursor;
  }

  document.querySelectorAll('.sop-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      filter = tab.dataset.status;
      document.querySelectorAll('.sop-tab').forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
      loadList(true);
    });
  });
  $('#sop-more').addEventListener('click', () => loadList(false));

  /* ---------- El caso ---------- */
  async function openCase(id) {
    const err = $('#sop-case-error');
    setError(err, '');
    const r = await call('GET', '/support/admin/cases/' + id);
    if (!r.ok) {
      $('#sop-case-empty').hidden = false;
      $('#sop-case-body').hidden = true;
      $('#sop-case-empty').textContent = r.message || 'No pudimos abrir el caso.';
      return;
    }
    current = r.data;
    if (history.replaceState) history.replaceState(null, '', '#caso-' + id);
    renderCase();
    renderList();
    $('#sop-case-title').focus();
  }

  function renderCase() {
    const c = current;
    $('#sop-case-empty').hidden = true;
    $('#sop-case-body').hidden = false;
    $('#sop-case-title').textContent = '#' + c.id_support_case + ' · ' + (c.topic ? c.topic.title : 'Otro tema');
    const badge = $('#sop-case-status');
    badge.className = 'sop-badge sop-badge--' + c.status;
    badge.textContent = STATUS[c.status] || c.status;

    const meta = $('#sop-case-meta');
    meta.replaceChildren();
    const row = (k, v) => {
      if (!v) return;
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      meta.append(dt, dd);
    };
    row('Persona', (c.person.name || 'Cuenta eliminada') + (c.person.email ? ' · ' + c.person.email : ''));
    row('App', c.app_version);
    row('Teléfono', [c.platform, c.os_version, c.device_model].filter(Boolean).join(' · '));
    row('Abierta', fmt(c.created_at));
    if (c.closed_at) row('Cerrada', fmt(c.closed_at));

    const thread = $('#sop-thread');
    thread.replaceChildren();
    for (const m of c.messages) {
      const li = document.createElement('li');
      li.className = 'sop-msg sop-msg--' + m.sender;
      const head = document.createElement('span');
      head.className = 'sop-msg-head';
      head.textContent = (m.sender === 'support' ? 'Soporte · ' : '') + m.author_name + ' · ' + fmt(m.created_at);
      const body = document.createElement('p');
      body.textContent = m.body;
      li.append(head, body);
      if (m.attachment_url && /^https:\/\/res\.cloudinary\.com\//.test(m.attachment_url)) {
        const a = document.createElement('a');
        a.href = m.attachment_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Ver la captura';
        li.append(a);
      }
      thread.append(li);
    }

    const closed = c.status === 'closed';
    $('#sop-reply-form').hidden = closed;
    $('#sop-closed').hidden = !closed;
  }

  const reply = $('#sop-reply');
  reply.addEventListener('input', () => { $('#sop-reply-count').textContent = String(reply.value.length); });

  $('#sop-reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = reply.value.trim();
    const err = $('#sop-case-error');
    if (!text) return setError(err, 'Escribí la respuesta.');
    setError(err, '');
    const go = $('#sop-reply-go');
    busy(go, true, 'Respondiendo…');
    const r = await call('POST', '/support/admin/cases/' + current.id_support_case + '/messages', { body: text });
    busy(go, false, 'Responder');
    if (!r.ok) return setError(err, r.message || 'No pudimos mandar la respuesta.');
    reply.value = '';
    $('#sop-reply-count').textContent = '0';
    current = r.data;
    renderCase();
    loadList(true);
  });

  $('#sop-close').addEventListener('click', async () => {
    if (!confirm('¿Cerrar el caso? Ya no va a recibir mensajes, ni de la persona ni de soporte.')) return;
    const r = await call('POST', '/support/admin/cases/' + current.id_support_case + '/close');
    if (!r.ok) return setError($('#sop-case-error'), r.message || 'No pudimos cerrarlo.');
    current = r.data;
    renderCase();
    loadList(true);
  });

  show('login', $('#sop-email'));
})();
