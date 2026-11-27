/* =====================================================================
   ImHomi · eliminar la cuenta desde la web
   Google Play pide un enlace donde se pueda pedir la baja sin la app. Es
   el mismo camino que la app: entrar (con el código si la cuenta tiene la
   verificación en dos pasos), ver si se puede, y confirmar con la
   contraseña (y otro código). Con un contrato o una convivencia en curso
   no se puede, pero se puede pedir "Cerrar mi cuenta cuando termine"
   (decisión 55), o cancelarlo.

   La sesión vive solo en la memoria de esta página: nada en el
   almacenamiento del navegador. Al terminar cada camino se cierra, y si se
   cierra la pestaña a mitad también. Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s) => document.querySelector(s);
  const root = $('#baja');
  if (!root) return;
  root.hidden = false;

  const api = (document.body.dataset.api || '').replace(/\/+$/, '');

  const sections = {
    login: $('#baja-login'),
    otp: $('#baja-otp'),
    check: $('#baja-check'),
    done: $('#baja-done'),
  };

  /* ---------- Estado ---------- */
  let session = null; // { access, refresh }
  let tempToken = null;
  let email = '';
  let state = null; // lo que devuelve GET /users/me/deletion
  let mode = 'delete'; // o 'schedule'
  let codeSentFor = null; // para qué se pidió el código: 'delete' | 'schedule'

  /* ---------- Hablar con la API ---------- */
  // Devuelve { ok, status, data, message, code, details } o { network: true }.
  // La API envuelve lo que devuelve: { success, data } o
  // { success: false, message, code, details }.
  const call = async (path, { method = 'POST', body, auth = false, keepalive = false } = {}) => {
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
        keepalive,
      });
      clearTimeout(timer);
      json = await response.json().catch(() => null);
    } catch (err) {
      return { ok: false, network: true };
    }
    const data = json && json.data !== undefined ? json.data : json || {};
    let message = json && json.message;
    if (Array.isArray(message)) message = message.join(' ');
    return {
      ok: response.ok,
      status: response.status,
      data,
      message: typeof message === 'string' ? message : '',
      code: json && json.code,
      details: json && json.details,
    };
  };

  /** Lo que lee la persona cuando algo no salió. */
  const why = (r, fallback) => {
    if (r.network) return 'No pudimos conectar. Revisá tu internet y probá de nuevo.';
    if (r.status >= 500 && !r.message) return 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.';
    return r.message || fallback;
  };

  /* ---------- Piezas de la pantalla ---------- */
  const show = (name, focus) => {
    Object.entries(sections).forEach(([key, el]) => { el.hidden = key !== name; });
    window.imhomiPaso(sections[name], focus);
  };
  const say = (box, text) => {
    box.textContent = text || '';
    box.hidden = !text;
  };
  const mark = (field, box, text) => {
    say(box, text);
    field.setAttribute('aria-invalid', text ? 'true' : 'false');
  };
  /** Un botón que muestra que está trabajando y no se puede volver a tocar. */
  const busy = (button, on, text) => {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.textContent = on ? text : button.dataset.label;
  };
  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };
  // Como la app (`price_format.dart`): miles con punto, «₡500.000».
  const money = (currency, amount) => {
    const symbol = currency === 'USD' ? '$' : currency === 'CRC' ? '₡' : currency + ' ';
    const [ent, dec] = Math.abs(Number(amount)).toFixed(2).split('.');
    const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return symbol + miles + (dec === '00' ? '' : ',' + dec);
  };

  /* ---------- Cerrar la sesión ---------- */
  const logout = async ({ keepalive = false } = {}) => {
    const s = session;
    session = null;
    if (!s) return;
    // Si ya no vale (se eliminó la cuenta, o venció), da igual: la sesión
    // ya no sirve para nada.
    await call('/auth/logout', { body: { refresh_token: s.refresh }, keepalive });
  };
  // Cerrar la pestaña a mitad no deja una sesión abierta.
  window.addEventListener('pagehide', () => { if (session) logout({ keepalive: true }); });

  /** La sesión venció o se cortó: de vuelta a entrar, diciéndolo. */
  const sessionLost = (r) => {
    session = null;
    resetLogin();
    say($('#baja-login-error'), r && r.message ? r.message : 'Tu sesión en esta página terminó. Entrá de nuevo.');
    show('login', $('#baja-login-h'));
  };

  /* ---------- 1. Entrar ---------- */
  const loginForm = $('#baja-login-form');
  const loginGo = $('#baja-login-go');
  const fEmail = $('#baja-email');
  const fPassword = $('#baja-password');
  const resetLogin = () => {
    fPassword.value = '';
    mark(fEmail, $('#baja-email-error'), '');
    mark(fPassword, $('#baja-password-error'), '');
    say($('#baja-login-error'), '');
  };
  $('#baja-show').addEventListener('change', (e) => {
    fPassword.type = e.target.checked ? 'text' : 'password';
  });
  fEmail.addEventListener('input', () => mark(fEmail, $('#baja-email-error'), ''));
  fPassword.addEventListener('input', () => mark(fPassword, $('#baja-password-error'), ''));

  let sending = false;
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    say($('#baja-login-error'), '');
    const value = fEmail.value.trim().toLowerCase();
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    mark(fEmail, $('#baja-email-error'), value ? (okEmail ? '' : 'Ese correo no tiene un formato válido.') : 'Escribí tu correo.');
    mark(fPassword, $('#baja-password-error'), fPassword.value ? '' : 'Escribí tu contraseña.');
    if (!okEmail) { fEmail.focus(); return; }
    if (!fPassword.value) { fPassword.focus(); return; }

    sending = true;
    busy(loginGo, true, 'Entrando…');
    const r = await call('/auth/login', { body: { email: value, password: fPassword.value } });
    sending = false;
    busy(loginGo, false);
    if (!r.ok) {
      say($('#baja-login-error'), why(r, 'No pudimos entrar. Probá de nuevo.'));
      return;
    }
    email = value;
    fPassword.value = '';
    if (r.data && r.data.status === 'otp_required') {
      tempToken = r.data.temp_token;
      $('#baja-otp-email').textContent = r.data.masked_email || 'tu correo';
      $('#baja-otp-code').value = '';
      say($('#baja-otp-error'), '');
      say($('#baja-otp-ok'), '');
      show('otp', $('#baja-otp-h'));
      return;
    }
    session = { access: r.data.access_token, refresh: r.data.refresh_token };
    await loadCheck();
  });

  /* ---------- 1b. El código del ingreso ---------- */
  const otpForm = $('#baja-otp-form');
  const otpGo = $('#baja-otp-go');
  const fOtp = $('#baja-otp-code');
  fOtp.addEventListener('input', () => {
    fOtp.value = fOtp.value.replace(/\D/g, '').slice(0, 6);
    mark(fOtp, $('#baja-otp-code-error'), '');
  });
  otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    say($('#baja-otp-error'), '');
    say($('#baja-otp-ok'), '');
    if (!/^\d{6}$/.test(fOtp.value)) {
      mark(fOtp, $('#baja-otp-code-error'), 'El código tiene 6 números.');
      fOtp.focus();
      return;
    }
    sending = true;
    busy(otpGo, true, 'Confirmando…');
    const r = await call('/auth/verify-otp', { body: { temp_token: tempToken, code: fOtp.value } });
    sending = false;
    busy(otpGo, false);
    if (!r.ok) {
      if (r.code === 'PERMISO_VENCIDO' || r.status === 401) {
        tempToken = null;
        resetLogin();
        fEmail.value = email;
        say($('#baja-login-error'), r.message || 'Pasó demasiado tiempo. Entrá de nuevo.');
        show('login', $('#baja-login-h'));
        return;
      }
      say($('#baja-otp-error'), why(r, 'Ese código no sirve. Revisalo y probá de nuevo.'));
      fOtp.focus();
      return;
    }
    tempToken = null;
    session = { access: r.data.access_token, refresh: r.data.refresh_token };
    await loadCheck();
  });
  const resend = $('#baja-otp-resend');
  resend.addEventListener('click', async () => {
    if (sending) return;
    sending = true;
    busy(resend, true, 'Mandando…');
    const r = await call('/auth/resend-otp', { body: { temp_token: tempToken } });
    sending = false;
    busy(resend, false);
    if (!r.ok) {
      say($('#baja-otp-error'), why(r, 'No pudimos mandarte otro código. Probá de nuevo en un rato.'));
      return;
    }
    if (r.data && r.data.temp_token) tempToken = r.data.temp_token;
    say($('#baja-otp-error'), '');
    say($('#baja-otp-ok'), 'Te mandamos otro código. El anterior ya no sirve.');
  });
  $('#baja-otp-back').addEventListener('click', () => {
    tempToken = null;
    resetLogin();
    show('login', $('#baja-login-h'));
  });

  /* ---------- 2. Qué se puede hacer ---------- */
  const confirmForm = $('#baja-confirm-form');
  const confirmGo = $('#baja-confirm-go');
  const fConfirm = $('#baja-confirm-password');
  const fCode = $('#baja-confirm-code');
  const sure = $('#baja-sure');

  const TIPO = { lease: 'Contrato', roommate: 'Convivencia' };
  const ROL = {
    lease: { provider: 'como propietario', occupant: 'como inquilino' },
    roommate: { provider: 'como anfitrión', occupant: 'como roomie' },
  };
  const ESTADO = { active: 'vigente', grace_period: 'en preaviso', settling: 'liquidando el depósito' };

  const loadCheck = async () => {
    const r = await call('/users/me/deletion', { method: 'GET', auth: true });
    if (!r.ok) {
      if (r.status === 401) return sessionLost(r);
      session && (await logout());
      resetLogin();
      say($('#baja-login-error'), why(r, 'No pudimos leer tu cuenta. Probá de nuevo.'));
      show('login', $('#baja-login-h'));
      return;
    }
    state = r.data || {};
    render();
  };

  const render = () => {
    $('#baja-who').textContent = email;
    say($('#baja-check-msg'), '');
    const scheduled = !!state.scheduled_at;
    const blockers = Array.isArray(state.blockers) ? state.blockers : [];
    const emailUntil = state.email_change_until;
    const owed = Array.isArray(state.owed_to_you) ? state.owed_to_you.filter((o) => Number(o.amount) > 0) : [];

    $('#baja-scheduled').hidden = !scheduled;
    if (scheduled) $('#baja-scheduled-at').textContent = formatDate(state.scheduled_at);

    const blocked = !scheduled && !state.can_delete;
    $('#baja-blocked').hidden = !blocked;
    const list = $('#baja-blockers');
    list.replaceChildren();
    if (blocked) {
      const partes = [];
      if (blockers.length) {
        partes.push(blockers.length === 1
          ? 'Tenés un acuerdo en curso. Cuando termine y se cierre su liquidación, vas a poder eliminarla.'
          : `Tenés ${blockers.length} acuerdos en curso. Cuando terminen y se cierren sus liquidaciones, vas a poder eliminarla.`);
      }
      if (emailUntil) {
        partes.push(`Cambiaste el correo hace poco y ese cambio todavía se puede deshacer desde el correo anterior: vas a poder eliminarla a partir del ${formatDate(emailUntil)}.`);
      }
      $('#baja-blocked-text').textContent = partes.join(' ');
      blockers.forEach((b) => {
        const li = document.createElement('li');
        const t = document.createElement('strong');
        t.textContent = `${TIPO[b.type] || 'Acuerdo'} ${ESTADO[b.status] || ''}`.trim();
        const d = document.createElement('span');
        d.textContent = ` · ${(ROL[b.type] || {})[b.role] || ''} · «${b.ad_title || 'la propiedad'}»`.replace(' ·  · ', ' · ');
        li.append(t, d);
        list.append(li);
      });
    }

    $('#baja-owed').hidden = scheduled || !owed.length;
    if (owed.length) $('#baja-owed-amount').textContent = owed.map((o) => money(o.currency, o.amount)).join(' y ');

    // El formulario: eliminar ahora, o programarlo. Ya programada, ninguno.
    confirmForm.hidden = scheduled;
    if (!scheduled) {
      mode = state.can_delete ? 'delete' : 'schedule';
      $('#baja-confirm-h').textContent = mode === 'delete' ? 'Eliminar mi cuenta' : 'Cerrar mi cuenta cuando termine';
      $('#baja-confirm-text').textContent = mode === 'delete'
        ? 'Se elimina ahora y no se puede deshacer. Te mandamos la constancia a tu correo.'
        : 'Tu cuenta sigue funcionando normal. Cuando se cierre lo que tenés en curso, la eliminamos y te mandamos la constancia por correo. Lo podés cancelar cuando quieras.';
      $('#baja-sure-text').textContent = mode === 'delete'
        ? 'Entiendo que eliminar mi cuenta es definitivo.'
        : 'Entiendo que mi cuenta se va a eliminar sola cuando termine lo que tengo en curso.';
      confirmGo.dataset.label = mode === 'delete' ? 'Eliminar mi cuenta' : 'Cerrar mi cuenta cuando termine';
      confirmGo.textContent = confirmGo.dataset.label;
      fConfirm.value = '';
      fCode.value = '';
      sure.checked = false;
      codeSentFor = null;
      $('#baja-code-box').hidden = !state.requires_code;
      $('#baja-code-field').hidden = true;
      mark(fConfirm, $('#baja-confirm-password-error'), '');
      mark(fCode, $('#baja-confirm-code-error'), '');
      say($('#baja-confirm-error'), '');
    }
    show('check', $('#baja-check-h'));
  };

  fConfirm.addEventListener('input', () => mark(fConfirm, $('#baja-confirm-password-error'), ''));
  fCode.addEventListener('input', () => {
    fCode.value = fCode.value.replace(/\D/g, '').slice(0, 6);
    mark(fCode, $('#baja-confirm-code-error'), '');
  });

  // Pedir el código: pide la contraseña antes, como la app.
  const codeSend = $('#baja-code-send');
  codeSend.addEventListener('click', async () => {
    if (sending) return;
    say($('#baja-confirm-error'), '');
    if (!fConfirm.value) {
      mark(fConfirm, $('#baja-confirm-password-error'), 'Escribí tu contraseña: la pedimos antes de mandarte el código.');
      fConfirm.focus();
      return;
    }
    sending = true;
    busy(codeSend, true, 'Mandando…');
    const r = await call('/users/me/deletion/code', {
      auth: true,
      body: { password: fConfirm.value, for_schedule: mode === 'schedule' },
    });
    sending = false;
    busy(codeSend, false);
    if (!r.ok) {
      if (r.status === 401) return sessionLost(r);
      if (r.code === 'PASSWORD_INCORRECTA') {
        mark(fConfirm, $('#baja-confirm-password-error'), r.message || 'La contraseña no es correcta.');
        fConfirm.focus();
        return;
      }
      say($('#baja-confirm-error'), why(r, 'No pudimos mandarte el código. Probá de nuevo.'));
      return;
    }
    codeSentFor = mode;
    codeSend.dataset.label = 'Mandarme otro código';
    codeSend.textContent = codeSend.dataset.label;
    $('#baja-code-field').hidden = false;
    $('#baja-confirm-code-hint').textContent = `Te lo mandamos a ${(r.data && r.data.masked_email) || 'tu correo'}. Vale 10 minutos.`;
    fCode.focus();
  });

  confirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    say($('#baja-confirm-error'), '');
    if (!fConfirm.value) {
      mark(fConfirm, $('#baja-confirm-password-error'), 'Escribí tu contraseña.');
      fConfirm.focus();
      return;
    }
    if (state.requires_code) {
      if (codeSentFor !== mode) {
        say($('#baja-confirm-error'), 'Primero pedí el código con «Mandarme el código».');
        codeSend.focus();
        return;
      }
      if (!/^\d{6}$/.test(fCode.value)) {
        mark(fCode, $('#baja-confirm-code-error'), 'El código tiene 6 números.');
        fCode.focus();
        return;
      }
    }
    if (!sure.checked) {
      say($('#baja-confirm-error'), 'Marcá la casilla para confirmar.');
      sure.focus();
      return;
    }

    sending = true;
    busy(confirmGo, true, mode === 'delete' ? 'Eliminando…' : 'Guardando…');
    const body = { password: fConfirm.value };
    if (state.requires_code) body.code = fCode.value;
    const r = await call(mode === 'delete' ? '/users/me/deletion' : '/users/me/deletion/schedule', { auth: true, body });
    sending = false;
    busy(confirmGo, false);

    if (!r.ok) {
      if (r.status === 401) return sessionLost(r);
      if (r.code === 'PASSWORD_INCORRECTA') {
        mark(fConfirm, $('#baja-confirm-password-error'), r.message || 'La contraseña no es correcta.');
        fConfirm.focus();
        return;
      }
      if (typeof r.code === 'string' && r.code.indexOf('OTP_') === 0) {
        mark(fCode, $('#baja-confirm-code-error'), r.message || 'Ese código no sirve.');
        fCode.focus();
        return;
      }
      // Cambió algo en el medio (un acuerdo que empezó o terminó, un cambio
      // de correo, ya programada): se vuelve a mirar y se dice.
      if (['CUENTA_CON_ACUERDOS', 'CAMBIO_DE_CORREO_RECIENTE', 'BAJA_NO_HACE_FALTA', 'BAJA_YA_PROGRAMADA'].includes(r.code)) {
        await loadCheck();
        // Arriba, a la vista: el formulario puede haber cambiado o quedado oculto.
        say($('#baja-check-msg'), r.message);
        return;
      }
      say($('#baja-confirm-error'), why(r, 'No pudimos hacerlo. Probá de nuevo.'));
      return;
    }

    if (mode === 'delete') {
      // La baja ya cortó todas las sesiones: no hay nada que cerrar.
      session = null;
      finish('Tu cuenta fue eliminada', `Borramos tus datos personales. Te mandamos la constancia a ${email}. Si querés volver, podés registrarte de nuevo con este correo.`);
    } else {
      await logout();
      finish('Listo: vamos a cerrar tu cuenta cuando termine', 'Tu cuenta sigue funcionando normal. Cuando se cierre lo que tenés en curso la eliminamos y te mandamos la constancia por correo. Lo podés cancelar desde esta página o desde la app. Cerramos tu sesión en esta página.');
    }
  });

  // Cancelar el cierre programado.
  const cancelSchedule = $('#baja-cancel-schedule');
  cancelSchedule.addEventListener('click', async () => {
    if (sending) return;
    sending = true;
    busy(cancelSchedule, true, 'Cancelando…');
    const r = await call('/users/me/deletion/schedule', { method: 'DELETE', auth: true });
    sending = false;
    busy(cancelSchedule, false);
    if (!r.ok) {
      if (r.status === 401) return sessionLost(r);
      say($('#baja-check-msg'), why(r, 'No pudimos cancelarlo. Probá de nuevo.'));
      return;
    }
    await logout();
    finish('Cancelaste el cierre de tu cuenta', 'Tu cuenta sigue y no se va a cerrar sola. Cerramos tu sesión en esta página.');
  });

  // Salir sin hacer nada.
  root.querySelectorAll('[data-salir]').forEach((b) => b.addEventListener('click', async () => {
    if (sending) return;
    sending = true;
    await logout();
    sending = false;
    finish('No hiciste ningún cambio', 'Tu cuenta sigue como estaba. Cerramos tu sesión en esta página.');
  }));

  /* ---------- 3. Resultado ---------- */
  const finish = (title, text) => {
    state = null;
    $('#baja-done-h').textContent = title;
    $('#baja-done-text').textContent = text;
    show('done', $('#baja-done-h'));
  };

  show('login');
})();
