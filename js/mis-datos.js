/* =====================================================================
   ImHomi · descargar una copia de los datos
   La app pide un enlace de 10 minutos y lo abre acá: el token va después
   del #, así no llega a ningún servidor ni queda en sus registros. Esta
   página se lo manda a la API, recibe la copia y la baja como archivo.
   La app sola no tiene cómo guardar un archivo; el navegador sí.
   Sin librerías.
   ===================================================================== */
(() => {
  const $ = (s) => document.querySelector(s);
  const ask = $('#datos-ask');
  const done = $('#datos-done');
  const invalid = $('#datos-invalid');
  if (!ask || !done || !invalid) return;

  const api = (document.body.dataset.api || '').replace(/\/+$/, '');
  const button = $('#datos-go');
  const error = $('#datos-error');

  /* ---------- El token ---------- */
  // `#t=<jwt>`: tres partes en base64url separadas por punto. Cualquier
  // otra cosa no es un enlace nuestro.
  const match = /^#t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(location.hash);
  const token = match ? match[1] : null;
  // Se saca de la barra de direcciones: queda en la memoria de esta página y
  // no en el historial ni en una captura de pantalla.
  if (token && history.replaceState) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  const show = (section, focus) => {
    [ask, done, invalid].forEach((s) => { s.hidden = s !== section; });
    if (focus) focus.focus();
  };
  const showInvalid = (text) => {
    if (text) $('#datos-invalid-text').textContent = text;
    show(invalid, $('#datos-invalid-title'));
  };

  if (!token) {
    showInvalid('El enlace está incompleto. Pedilo de nuevo desde la app.');
    return;
  }
  show(ask);

  const fileName = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `imhomi-mis-datos-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  };

  button.addEventListener('click', async () => {
    error.hidden = true;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Preparando tu copia…';
    let response;
    let json = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      response = await fetch(api + '/legal/data-export', {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      clearTimeout(timer);
      json = await response.json().catch(() => null);
    } catch (err) {
      button.disabled = false;
      button.textContent = label;
      error.textContent = 'No pudimos conectar. Revisá tu internet y probá de nuevo.';
      error.hidden = false;
      return;
    }

    if (response.status === 401 || response.status === 404) {
      showInvalid(response.status === 401
        ? 'Vale 10 minutos desde que lo pediste, y ya venció.'
        : 'No encontramos la cuenta de este enlace.');
      return;
    }
    if (!response.ok) {
      button.disabled = false;
      button.textContent = label;
      const msg = json && typeof json.message === 'string' ? json.message : '';
      error.textContent = response.status === 429
        ? (msg || 'Pediste la copia muchas veces seguidas. Esperá un minuto y probá de nuevo.')
        : (msg || 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.');
      error.hidden = false;
      return;
    }

    // La API envuelve lo que devuelve: { success, data }.
    const data = json && json.data !== undefined ? json.data : json;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    $('#datos-file').textContent = a.download;
    show(done, $('#datos-done-title'));
  });
})();
