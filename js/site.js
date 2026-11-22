/* =====================================================================
   ImHomi · comportamiento compartido (landing y páginas legales)
   Cabecera, pausa de animaciones y el nombre gigante del pie.
   ===================================================================== */
(() => {
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* ---------- Un solo bucle de scroll, a lo sumo una vez por cuadro ---------- */
  const fns = [];
  let ticking = false;
  const run = () => { ticking = false; fns.forEach(f => f()); };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  /* ---------- Pausa (WCAG 2.2.2): detiene todo lo que se mueve solo y se recuerda ---------- */
  const KEY = 'imhomi:pausa';
  const btn = $('#pause');
  const label = btn && $('.pause-t', btn);
  let paused = false;
  const setPaused = (on, save) => {
    paused = on;
    root.classList.toggle('paused', on);
    if (btn) {
      btn.classList.toggle('is-paused', on);
      label.textContent = on ? 'Reanudar animaciones' : 'Pausar animaciones';
    }
    if (save) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* modo privado */ } }
    dispatchEvent(new CustomEvent('imhomi:pause', { detail: on }));
  };
  if (btn && !reduce) {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* modo privado */ }
    if (saved === '1') setPaused(true);
    btn.addEventListener('click', () => setPaused(!paused, true));
  }

  /* ---------- Cabecera ---------- */
  const hdr = $('#hdr');
  if (hdr && !hdr.classList.contains('hdr--solid')) fns.push(() => hdr.classList.toggle('scrolled', scrollY > 30));

  /* Si no entra todo en la cabecera (texto agrandado), se va el menú; si aún no entra, el botón. */
  const fitHdr = () => {
    if (!hdr) return;
    hdr.classList.remove('compact', 'tight');
    // El menú se encoge (min-width:0) y el resto no: alcanza con mirar el menú y la cabecera.
    const nav = $('.nav', hdr);
    const over = () => hdr.scrollWidth > hdr.clientWidth + 1 || (nav && nav.offsetWidth > 0 && nav.scrollWidth > nav.clientWidth + 1);
    if (over()) hdr.classList.add('compact');
    if (over()) hdr.classList.add('tight');
  };
  fitHdr();
  let hdrT; addEventListener('resize', () => { clearTimeout(hdrT); hdrT = setTimeout(fitHdr, 120); });
  document.fonts?.ready.then(fitHdr);

  /* Indicador del menú que se desliza */
  const ind = $('#nav .nav-ind');
  if (ind) document.querySelectorAll('#nav a').forEach(a => a.addEventListener('mouseenter', () => {
    ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px';
  }));

  /* ---------- Pie: el nombre gigante se llena al llegar al final ---------- */
  const giant = $('#giant'), gFill = $('#gFill');
  if (giant && gFill && !giant.classList.contains('giant--full')) {
    let visible = false, h = 0;
    const measure = () => { h = gFill.offsetHeight; };
    const render = () => {
      if (!visible) return;
      const left = root.scrollHeight - innerHeight - scrollY;
      const p = reduce ? 1 : clamp(1 - left / (innerHeight * .5));
      // Lleno del todo, la ola se va por arriba y no deja ningún borde sin pintar.
      gFill.style.setProperty('--top', (p >= .999 ? -40 : h * (1 - p)) + 'px');
      gFill.classList.toggle('waving', !reduce && p > .001 && p < .999);
    };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { measure(); render(); } else gFill.classList.remove('waving');
    }).observe(giant);
    addEventListener('resize', measure);
    fns.push(render);
  }

  window.ImHomi = { onScroll: (f) => fns.push(f), isPaused: () => paused, tick: onScroll };
  onScroll();
})();
