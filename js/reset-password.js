/* =====================================================================
   ImHomi · elegir una contraseña nueva con el enlace del correo
   El correo de recuperación trae este enlace, en lugar de un código,
   cuando hubo demasiados intentos con códigos equivocados. Lee el token
   del enlace (va después del #, así no llega a ningún servidor ni queda
   en sus registros), pide la contraseña nueva y recién ahí manda las dos
   cosas a la API. Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s) => document.querySelector(s);
  const ask = $('#reset-ask');
  const done = $('#reset-done');
  const invalid = $('#reset-invalid');
  if (!ask || !done || !invalid) return;

  const api = (document.body.dataset.api || '').replace(/\/+$/, '');
  const form = $('#reset-form');
  const button = $('#reset-go');
  const fieldNew = $('#reset-new');
  const fieldAgain = $('#reset-again');
  const errorNew = $('#reset-new-error');
  const errorAgain = $('#reset-again-error');
  const error = $('#reset-error');

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
    // El foco va a lo que cambió: quien usa lector de pantalla se entera sin
    // tener que buscarlo.
    if (focus) focus.focus();
  };
  // `lead` es cómo empieza el párrafo de abajo. Cuando el título ya dice qué
  // abrir (un enlace reemplazado o incompleto), pedir otro es el plan B.
  const showInvalid = (title, text, lead) => {
    if (title) $('#reset-invalid-title').textContent = title;
    if (text) $('#reset-invalid-text').textContent = text;
    if (lead) $('#reset-invalid-lead').textContent = lead;
    show(invalid, $('#reset-invalid-title'));
  };
  const PLAN_B = 'Si no lo encontrás, pedí otro desde la app:';

  if (!token) {
    showInvalid(
      'Este enlace está incompleto',
      'Abrilo de nuevo desde el correo, tocando el botón "Elegir mi contraseña nueva".',
      PLAN_B
    );
    return;
  }
  show(ask);

  /* ---------- Ver lo que se escribe ---------- */
  $('#reset-show').addEventListener('change', (e) => {
    const type = e.target.checked ? 'text' : 'password';
    fieldNew.type = type;
    fieldAgain.type = type;
  });

  /* ---------- La regla de la contraseña ---------- */
  // La misma que aplica el servidor, que es quien decide: esto es para
  // decirlo antes de mandar. Con las mismas palabras que la app y el servidor
  // (`Validators.password`, `IsNewPassword`): decía lo mismo de cuatro formas.
  // La contraseña no se recorta: un espacio en las puntas se rechaza
  // diciéndolo, igual que en la app.
  const rule = (value) => {
    if (!value) return 'Ingresá tu contraseña nueva.';
    if (value !== value.trim()) return 'La contraseña no puede empezar ni terminar con un espacio.';
    if (value.length < 8) return 'Usá al menos 8 caracteres.';
    if (!/[A-Z]/.test(value)) return 'Agregá al menos una mayúscula.';
    if (!/[a-z]/.test(value)) return 'Agregá al menos una minúscula.';
    if (!/\d/.test(value)) return 'Agregá al menos un número.';
    return '';
  };
  const mark = (field, box, text) => {
    box.textContent = text;
    box.hidden = !text;
    field.setAttribute('aria-invalid', text ? 'true' : 'false');
  };
  const validate = () => {
    const first = rule(fieldNew.value);
    const second = first
      ? ''
      : fieldAgain.value !== fieldNew.value
        ? 'Las dos contraseñas no coinciden.'
        : '';
    mark(fieldNew, errorNew, first);
    mark(fieldAgain, errorAgain, second);
    if (first) fieldNew.focus();
    else if (second) fieldAgain.focus();
    return !first && !second;
  };
  // Al corregir, el error de ese campo se va.
  fieldNew.addEventListener('input', () => mark(fieldNew, errorNew, ''));
  fieldAgain.addEventListener('input', () => mark(fieldAgain, errorAgain, ''));

  /* ---------- Mandar ---------- */
  const label = button.textContent;
  const setBusy = (on) => {
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.textContent = on ? 'Cambiando…' : label;
  };
  const fail = (text) => {
    error.textContent = text;
    error.hidden = false;
    setBusy(false);
  };

  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    error.hidden = true;
    if (!validate()) return;
    sending = true;
    setBusy(true);

    let response;
    let body = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      response = await fetch(api + '/auth/reset-password-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: fieldNew.value }),
        signal: controller.signal,
        // Sin cookies ni cabeceras de origen de más: alcanza con el token.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      clearTimeout(timer);
      body = await response.json().catch(() => null);
    } catch (err) {
      // No se llegó a la API, o no contestó: el enlace sigue sin usar.
      sending = false;
      fail('No pudimos conectar. Revisá tu internet y tocá el botón de nuevo.');
      return;
    }

    // La API envuelve lo que devuelve: { success, data } o { success, message, code }.
    const data = body && body.data ? body.data : body || {};
    const message = body && typeof body.message === 'string' ? body.message : '';
    const code = body && body.code;

    if (response.ok) {
      // La contraseña no queda en la página.
      fieldNew.value = '';
      fieldAgain.value = '';
      $('#reset-email').textContent = data.masked_email || 'tu correo';
      show(done, $('#reset-done-title'));
      return;
    }
    if (response.status === 400 && code === 'ENLACE_REEMPLAZADO') {
      // Después de este enlace se pidió otro. El que sirve es el del último
      // correo: decirlo así, y no "ya no sirve", que no dice qué hacer.
      showInvalid(
        'Pediste un enlace más nuevo',
        'Este dejó de valer cuando pediste otro. Abrí el del último correo que te mandamos: ese sí sirve.',
        PLAN_B
      );
      return;
    }
    if (response.status === 400 && code === 'ENLACE_INVALIDO') {
      showInvalid('Este enlace ya no sirve', 'Venció o ya se usó.');
      return;
    }
    sending = false;
    if (response.status === 400) {
      // La contraseña no pasó la regla del servidor: el enlace sigue sin
      // usar y se puede corregir.
      setBusy(false);
      mark(fieldNew, errorNew, message || 'Esa contraseña no se puede usar. Probá con otra.');
      fieldNew.focus();
      return;
    }
    // Demasiados intentos, o un problema nuestro: el enlace sigue sin usar.
    fail(
      // El servidor manda la espera exacta en el mensaje; "un minuto" no
      // siempre era cierto.
      response.status === 429
        ? message || 'Hiciste varios intentos seguidos. Esperá un momento y tocá el botón de nuevo.'
        : 'Tuvimos un problema de nuestro lado. Probá de nuevo en un momento.'
    );
  });
})();
