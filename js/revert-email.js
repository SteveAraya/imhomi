/* =====================================================================
   ImHomi · deshacer un cambio de correo
   Lee el token del enlace (va después del #, así no llega a ningún
   servidor ni queda en sus registros), espera a que la persona confirme
   y recién ahí se lo manda a la API. Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s) => document.querySelector(s);
  const ask = $('#revert-ask');
  const done = $('#revert-done');
  const invalid = $('#revert-invalid');
  if (!ask || !done || !invalid) return;

  const api = (document.body.dataset.api || '').replace(/\/+$/, '');
  const button = $('#revert-go');
  const error = $('#revert-error');

  /* ---------- El token ---------- */
  // `#t=<token>`. Solo letras, números, guion y guion bajo: lo que emite el
  // servidor. Cualquier otra cosa no es un enlace nuestro.
  const match = /^#t=([A-Za-z0-9_-]{20,200})$/.exec(location.hash);
  const token = match ? match[1] : null;
  // Se saca de la barra de direcciones: queda en la memoria de esta página y
  // no en el historial ni en una captura de pantalla.
  if (token && history.replaceState) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  /* ---------- Qué sección se ve ---------- */
  const show = (section, focus) => {
    [ask, done, invalid].forEach((s) => { s.hidden = s !== section; });
    // El foco va al título de lo que cambió: quien usa lector de pantalla se
    // entera sin tener que buscarlo.
    if (focus) focus.focus();
  };
  const showInvalid = (title, text) => {
    if (title) $('#revert-invalid-title').textContent = title;
    if (text) $('#revert-invalid-text').textContent = text;
    show(invalid, $('#revert-invalid-title'));
  };

  if (!token) {
    showInvalid(
      'Este enlace está incompleto',
      'Abrilo de nuevo desde el correo, tocando el botón "Deshacer el cambio".'
    );
    return;
  }
  show(ask);

  /* ---------- Confirmar ---------- */
  // No se deshace al abrir la página: hay programas de correo que abren los
  // enlaces por su cuenta para revisarlos. Lo hace la persona, con el botón.
  const label = button.textContent;
  const setBusy = (on) => {
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.textContent = on ? 'Deshaciendo…' : label;
  };
  const fail = (text) => {
    error.textContent = text;
    error.hidden = false;
    setBusy(false);
  };

  let sent = false;
  button.addEventListener('click', async () => {
    if (sent) return;
    sent = true;
    error.hidden = true;
    setBusy(true);

    let response;
    let body = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      response = await fetch(api + '/users/email-change/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
        // Sin cookies ni cabeceras de origen de más: alcanza con el token.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      clearTimeout(timer);
      body = await response.json().catch(() => null);
    } catch (e) {
      // No se llegó a la API, o no contestó: el enlace sigue sin usar.
      sent = false;
      fail('No pudimos conectar. Revisá tu internet y tocá el botón de nuevo.');
      return;
    }

    // La API envuelve lo que devuelve: { success, data } o { success, message, code }.
    const data = body && body.data ? body.data : body || {};
    const message = body && typeof body.message === 'string' ? body.message : '';
    const code = body && body.code;

    if (response.ok) {
      $('#revert-email').textContent = data.masked_email || 'tu correo anterior';
      show(done, $('#revert-done-title'));
      return;
    }
    if (response.status === 400 && code === 'ENLACE_INVALIDO') {
      showInvalid('Este enlace ya no sirve', 'Venció o ya se usó.');
      return;
    }
    if (response.status === 409) {
      // El correo anterior ya lo tiene otra cuenta: lo resuelve una persona.
      showInvalid('No pudimos deshacerlo desde acá', message || 'Ese correo ya lo usa otra cuenta.');
      return;
    }
    // Demasiados intentos, o un problema nuestro: el enlace sigue sin usar.
    sent = false;
    fail(
      // El servidor manda la espera exacta en el mensaje.
      response.status === 429
        ? message || 'Hiciste varios intentos seguidos. Esperá un momento y tocá el botón de nuevo.'
        : 'Tuvimos un problema de nuestro lado. Probá de nuevo en un momento.'
    );
  });
})();
