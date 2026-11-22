/* =====================================================================
   ImHomi · landing
   Sin librerías. El scroll pasa por un solo bucle (site.js) y cada escena
   trabaja solo mientras está cerca de la pantalla.
   ===================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const site = window.ImHomi;
  const isPaused = () => site.isPaused();
  // Sin animar: movimiento reducido o pausa puesta. Las demos muestran su resultado de una.
  const instant = () => reduce || isPaused();
  /* Avisa cuando un elemento entra o sale de la zona visible (con margen). */
  const watch = (el, cb, margin = '0px') => new IntersectionObserver(([e]) => cb(e.isIntersecting), { rootMargin: margin }).observe(el);

  /* ---------- Titulares que suben palabra por palabra ---------- */
  $$('[data-split]').forEach(el => {
    let i = 0;
    const wrapWord = (node) => {
      const w = document.createElement('span'); w.className = 'w';
      const wi = document.createElement('span'); wi.className = 'wi'; wi.style.setProperty('--i', i++);
      wi.append(node); w.append(wi); return w;
    };
    [...el.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.append(' ');
          else frag.append(wrapWord(document.createTextNode(part)));
        });
        n.replaceWith(frag);
      } else {
        // Un elemento (la parte en serif) sube entero: así el brillo no se corta por palabra.
        const clone = n.cloneNode(true); n.replaceWith(wrapWord(clone));
      }
    });
  });

  /* ---------- Revelado al entrar ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  // Umbral 0 con margen: un bloque alto (la tarjeta de calificaciones, texto agrandado) se
  // revela cuando su borde entra, no cuando ya se ve una fracción de su alto.
  }), { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  $$('[data-reveal],[data-split],#ruta,.tcard,.mark').forEach(el => io.observe(el));

  /* ---------- Barra de avance de lectura ---------- */
  const prog = $('#progress');
  site.onScroll(() => {
    const max = root.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  });

  /* ---------- Hero: luz que sigue, teléfono que se inclina, fichas con profundidad ---------- */
  const hero = $('.hero'), spot = $('.spot'), phone = $('#phone'), floats = $$('.float');
  if (fine && !reduce) {
    // Las variables van en el elemento que las usa: puestas en el hero, recalculaban
    // los estilos de todo lo que tiene adentro (cientos de nodos del teléfono) en cada movimiento.
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      spot.style.setProperty('--mx', (x * 100) + '%'); spot.style.setProperty('--my', (y * 100) + '%');
      phone.style.transform = `rotateY(${(x - .5) * 18 - 4}deg) rotateX(${(.5 - y) * 12 + 3}deg)`;
      floats.forEach(f => { const d = +f.dataset.depth; f.style.setProperty('--px', ((x - .5) * d) + 'px'); f.style.setProperty('--py', ((y - .5) * d) + 'px'); });
    });
    hero.addEventListener('pointerleave', () => { phone.style.transform = ''; });
  }

  /* Una ficha que pisaría el texto del hero o se saldría de la pantalla (texto agrandado,
     anchos intermedios) no se muestra: son decorativas y no pueden tapar contenido. */
  // Lo que no se puede tapar: cada palabra del titular y cada bloque de texto (no la columna entera).
  const heroText = () => $$('.hero .tag, .hero h1 .w, .hero .lead, .hero-cta > *, .claim > *').map(e => e.getBoundingClientRect());
  const fitFloats = () => {
    const ts = heroText(), W = root.clientWidth;
    const bad = (f) => {
      const r = f.getBoundingClientRect();
      if (!r.width) return false;
      return ts.some(t => r.left < t.right + 8 && r.right > t.left - 8 && r.top < t.bottom + 8 && r.bottom > t.top - 8) || r.right > W - 4 || r.left < 4;
    };
    floats.forEach(f => {
      f.classList.remove('off', 'alt');
      if (bad(f)) f.classList.add('alt');
      if (bad(f)) { f.classList.remove('alt'); f.classList.add('off'); }
    });
  };

  /* ---------- Hero: la app recorre el alquiler entero ---------- */
  // Lo que pasa alrededor del teléfono, según el momento que muestra.
  const CHIPS = [
    [['bell', 'g', 'Alerta guardada', '3 cuartos nuevos en San Pedro'], ['shield', 't', 'Anuncio verificado', 'Lo ves antes de escribir']],
    [['chat', 't', 'Ana respondió', 'El chat queda con el anuncio'], ['star', 'g', 'Ana · ★ 4,9', '23 calificaciones']],
    [['calendar', 't', 'Visita confirmada', '29/11 · 10:00'], ['pin', 'g', 'Dirección exacta', 'Se comparte al confirmar']],
    [['doc', 'c', 'Propuesta de contrato', 'Ana definió los términos'], ['check', 't', 'Contrato activo', 'Lo aceptaste desde la app']],
    [['ticket', 'g', 'Mari se unió', 'Con un código de invitación'], ['users', 't', 'Convivencia activa', 'Cuarto 3 · San Pedro']],
    [['coins', 'c', 'Contrapropuesta', 'Deducciones: ₡12.000'], ['check', 't', 'Acuerdo alcanzado', 'Devolución: ₡228.000']],
  ];
  const chipEls = $$('.chipc');
  const chipHTML = ([ic, tone, t, sub]) => `<span class="ic ${tone}"><svg viewBox="0 0 24 24"><use href="#i-${ic}"/></svg></span><span><b>${t}</b><small>${sub}</small></span>`;
  let chipT = [];
  function setChips(n) {
    chipT.forEach(clearTimeout); chipT = [];
    chipEls.forEach((el, k) => {
      // Cada momento trae otro texto (y otro ancho): se vuelve a medir si la ficha entra.
      if (!el.innerHTML || instant()) { el.innerHTML = chipHTML(CHIPS[n][k]); el.classList.remove('swap'); fitFloats(); return; }
      el.classList.add('swap');
      chipT.push(setTimeout(() => { el.innerHTML = chipHTML(CHIPS[n][k]); el.classList.remove('swap'); fitFloats(); }, 260 + k * 380));
    });
  }

  const scrs = $$('#phone .scr'), stepsEl = $('#steps'), steps = $$('#steps li'), stage = $('.stage');
  const DUR = [6800, 5400, 6400, 5000, 4400, 7600];
  let cur = 0, timer = null, negTimers = [], phoneSeen = false, phoneVisible = false;
  const autoplay = () => phoneVisible && !isPaused() && !reduce && !document.hidden;
  // Quieto: cada pantalla aparece resuelta y la barra del paso queda llena.
  const setStill = (on) => { phone.classList.toggle('still', on); stepsEl.classList.toggle('still', on); };

  function countTo(el, from, to, ms) {
    const fmt = v => '₡' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (instant()) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (t) => { const p = clamp((t - t0) / ms); el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  // La liquidación como en la app: propuesta del dueño → contrapropuesta → aceptada.
  const playSettle = () => {
    negTimers.forEach(clearTimeout); negTimers = [];
    const sv = $('#svSettle'), pill = $('#sPill'), ded = $('#sDed'), ret = $('#sRet');
    const setPill = (t, c) => { pill.textContent = t; pill.style.setProperty('--c', c); };
    sv.classList.remove('st1', 'st2');
    setPill('Pendiente de aprobación del inquilino', '#58A6FF'); ded.textContent = '₡30.000'; ret.textContent = '₡210.000';
    const at = (fn, ms) => instant() ? fn() : negTimers.push(setTimeout(fn, ms));
    at(() => { sv.classList.add('st1'); setPill('Contra-propuesta enviada', '#D29922'); countTo(ded, 30000, 12000, 900); countTo(ret, 210000, 228000, 900); }, 2500);
    at(() => { sv.classList.add('st2'); setPill('Aceptada', '#3FB950'); }, 4900);
  };
  const show = (n) => {
    const prev = scrs.findIndex(s => s.classList.contains('on'));
    scrs.forEach(s => s.classList.remove('out'));
    if (prev > -1 && prev !== n) { scrs[prev].classList.remove('on'); scrs[prev].classList.add('out'); }
    // Rearma las animaciones de la que entra
    const s = scrs[n]; s.classList.remove('on'); void s.offsetWidth; s.classList.add('on');
    steps.forEach((li, i) => {
      li.classList.toggle('done', i < n); li.classList.remove('now');
      li.querySelector('button').removeAttribute('aria-current');
    });
    const li = steps[n]; void li.offsetWidth; li.classList.add('now'); li.style.setProperty('--dur', DUR[n] + 'ms');
    li.querySelector('button').setAttribute('aria-current', 'step');
    negTimers.forEach(clearTimeout);
    if (n === 5) playSettle();
    setChips(n);
    cur = n;
    clearTimeout(timer);
    if (autoplay()) timer = setTimeout(() => show((cur + 1) % scrs.length), DUR[n]);
  };
  steps.forEach((li, i) => li.querySelector('button').addEventListener('click', () => {
    setStill(reduce || isPaused());
    show(i);
  }));
  setStill(reduce || isPaused());
  setChips(0);
  const fitSteps = () => {
    stepsEl.classList.remove('steps--wrap');
    stepsEl.classList.toggle('steps--wrap', steps.some(li => li.scrollWidth > li.clientWidth + 1));
  };
  const fitHero = () => { fitSteps(); fitFloats(); };
  fitHero();
  let flT; addEventListener('resize', () => { clearTimeout(flT); flT = setTimeout(fitHero, 150); });
  document.fonts?.ready.then(fitHero);
  // El recorrido arranca cuando el teléfono se ve (en el celular queda más abajo) y se
  // detiene fuera de pantalla; al volver, retoma el momento en que estaba desde su inicio.
  watch(stage, (vis) => {
    phoneVisible = vis;
    if (vis) { if (!phoneSeen || autoplay()) { phoneSeen = true; show(cur); } }
    else clearTimeout(timer);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else if (autoplay()) show(cur);
  });
  addEventListener('imhomi:pause', ({ detail: on }) => {
    if (reduce) return;
    if (on) { clearTimeout(timer); chipT.forEach(clearTimeout); }
    else { setStill(false); if (phoneVisible) show(cur); }
  });

  /* ---------- Botones magnéticos ---------- */
  if (fine && !reduce) $$('.magnet').forEach(b => {
    b.addEventListener('pointermove', e => {
      // Acotado: se acerca al cursor sin llegar nunca al botón de al lado.
      const r = b.getBoundingClientRect();
      const dx = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1) * 5;
      const dy = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1) * 4;
      b.style.transform = `translate(${dx}px,${dy}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });

  /* ---------- Cintas ---------- */
  const proof = ['Contratos con enmiendas y renovaciones', 'Inventario con disputas y plazos', 'Calificación doble ciega', 'Liquidación con contrapropuesta', 'Incidencias con seguimiento', 'Acuerdos de convivencia', 'Vinculación por código', 'Alertas de búsqueda', 'Tipo de cambio oficial diario'];
  const moods = ['Buscar', 'Conversar', 'Visitar', 'Acordar', 'Convivir', 'Salir', 'y quedarse tranquilo'];
  const fillTrack = (el, arr) => { const html = arr.map(t => `<span>${t}</span>`).join(''); el.innerHTML = html + html + html + html; };
  fillTrack($('#trackA'), proof); fillTrack($('#trackB'), moods);

  /* ---------- La diferencia: escena que arma el scroll ---------- */
  const gap = $('#diferencia'), gapPin = $('.gap-pin', gap), gapWrap = $('.wrap', gap), gapTitle = $('#gapTitle');
  // Palabras del titular, cada una con su luz
  (() => {
    const walk = (node) => [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(p => { if (!p) return; if (/^\s+$/.test(p)) frag.append(' '); else { const s = document.createElement('span'); s.className = 'sw'; s.textContent = p; frag.append(s); } });
        n.replaceWith(frag);
      } else walk(n);
    });
    walk(gapTitle);
  })();
  const words = $$('.sw', gapTitle), race = $('#race'), stEls = $$('#race .st');
  const laneThem = $('#laneThem'), laneUs = $('#laneUs'), gapFoot = $('#gapFoot');
  let lastP = -1;
  const renderGap = (p) => {
    if (Math.abs(p - lastP) < .0005) return; lastP = p;
    const tp = clamp(p / .22);
    words.forEach((w, i) => w.classList.toggle('lit', tp * words.length > i + .2));
    const f = clamp((p - .24) / .56);
    laneUs.style.setProperty('--f', f.toFixed(4));
    laneThem.style.setProperty('--f', Math.min(f, 1 / 6).toFixed(4));
    race.classList.toggle('broken', f > 1 / 6 + .03);
    stEls.forEach((s, i) => s.classList.toggle('on', f >= (i + .55) / 6));
    gapFoot.classList.toggle('on', p > .84);
  };
  // ¿Entra la escena entera debajo de la cabecera? Si no (pantalla baja, texto agrandado),
  // deja de fijarse y se arma mientras se lee de corrido: nada queda recortado.
  const themLabel = $('.lane-label', laneThem);
  const fitGap = () => {
    // "Anuncio y contacto" entero solo si entra en el pedazo de barra que le toca (1/6 menos el quiebre).
    themLabel.classList.remove('short');
    themLabel.classList.toggle('short', themLabel.scrollWidth > laneThem.clientWidth / 6 - 22);
    if (reduce) return;
    gap.classList.remove('loose');
    const cs = getComputedStyle(gapPin);
    const room = innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    gap.classList.toggle('loose', gapWrap.offsetHeight > room);
    lastP = -1;
  };
  const gapProgress = () => {
    const r = gap.getBoundingClientRect(), vh = innerHeight;
    if (gap.classList.contains('loose')) return clamp((vh * .9 - r.top) / (r.height + vh * .05));
    const total = r.height - vh;
    return total > 0 ? clamp(-r.top / total) : 1;
  };
  if (reduce) { fitGap(); renderGap(1); }
  else {
    let near = false;
    watch(gap, (v) => { near = v; renderGap(gapProgress()); }, '200px 0px');
    site.onScroll(() => { if (near) renderGap(gapProgress()); });
    fitGap();
    let fitT; addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { fitGap(); renderGap(gapProgress()); }, 150); });
    document.fonts?.ready.then(fitGap);
  }

  /* ---------- Pestañas con píldora y transición de vista ---------- */
  const tabs = $$('#tabs .tab'), tabInd = $('.tab-ind');
  // La píldora sigue a la pestaña en las dos direcciones: en el celular van en 2 × 2.
  const moveInd = (t) => {
    tabInd.style.left = t.offsetLeft + 'px'; tabInd.style.width = t.offsetWidth + 'px';
    tabInd.style.top = t.offsetTop + 'px'; tabInd.style.height = t.offsetHeight + 'px';
  };
  const select = (t, focus) => {
    if (t.getAttribute('aria-selected') === 'true') { if (focus) t.focus(); return; }
    const swap = () => {
      tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; });
    };
    moveInd(t);
    if (document.startViewTransition && !reduce && !isPaused()) { $('#panels').style.viewTransitionName = 'caps'; document.startViewTransition(swap); }
    else swap();
    if (focus) t.focus({ preventScroll: true });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const k = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
      if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
      if (e.key === 'End') { e.preventDefault(); select(tabs.at(-1), true); }
    });
  });
  const tabsEl = $('#tabs');
  // Si las cuatro no entran en una fila (texto agrandado), pasan a 2 × 2 en vez de esconderse de lado.
  const fitTabs = () => {
    tabsEl.classList.remove('tabs--grid', 'tabs--stack');
    tabsEl.classList.toggle('tabs--grid', tabsEl.scrollWidth > tabsEl.clientWidth + 1);
    // Y si en dos columnas tampoco entran, una debajo de la otra.
    if (tabs.some(t => t.scrollWidth > t.clientWidth + 1)) tabsEl.classList.add('tabs--grid', 'tabs--stack');
  };
  const placeInd = () => { fitTabs(); moveInd(tabs.find(t => t.getAttribute('aria-selected') === 'true')); };
  addEventListener('resize', placeInd); document.fonts?.ready.then(placeInd); placeInd();

  $$('.cap .ico').forEach(i => { i.dataset.ic = i.querySelector('use').getAttribute('href').replace('#i-', ''); });
  /* Borde de luz que sigue al cursor */
  if (fine) $('#capacidades').addEventListener('pointermove', e => {
    const c = e.target.closest?.('.cap'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  /* ---------- Tarjetas que se apilan ---------- */
  const stack = $('#stack'), cards = $$('#stack .sc');
  const stackMQ = matchMedia('(min-width: 56.3125em)');
  // Si una tarjeta es más alta que lo que queda debajo de la cabecera, no se apilan:
  // la siguiente taparía su parte de abajo antes de que se pudiera leer.
  const fitStack = () => {
    stack.classList.remove('loose');
    if (!stackMQ.matches) return;
    const room = innerHeight - 92 - (cards.length - 1) * 22 - 16;
    stack.classList.toggle('loose', cards.some(c => c.offsetHeight > room));
    if (stack.classList.contains('loose')) cards.forEach(c => { c.style.removeProperty('--s'); c.style.removeProperty('--b'); });
  };
  if (!reduce) {
    let near = false;
    watch(stack, (v) => { near = v; }, '100px 0px');
    site.onScroll(() => {
      if (!near || !stackMQ.matches || stack.classList.contains('loose')) return;
      // Primero se mide todo y después se escribe: intercalar lecturas y escrituras
      // forzaba un cálculo de layout por tarjeta en cada cuadro.
      const rects = cards.map(c => c.getBoundingClientRect());
      const vals = rects.slice(0, -1).map((a, i) => clamp(1 - (rects[i + 1].top - a.top) / a.height));
      vals.forEach((t, i) => {
        cards[i].style.setProperty('--s', (1 - t * .06).toFixed(4));
        cards[i].style.setProperty('--b', (1 - t * .35).toFixed(3));
      });
    });
    fitStack();
    let stT; addEventListener('resize', () => { clearTimeout(stT); stT = setTimeout(fitStack, 150); });
    document.fonts?.ready.then(fitStack);
  }

  /* ---------- Demos que se juegan solas ---------- */
  const demos = {};
  const later = (key) => { const list = []; demos[key + 'T']?.forEach(clearTimeout); demos[key + 'T'] = list; return (fn, ms) => instant() ? fn() : list.push(setTimeout(fn, ms)); };

  demos.cuarto = () => {
    const d = $('#demo-cuarto'), at = later('cuarto'), lis = $$('.flow li', d), ad = $('.mini-ad', d);
    d.classList.remove('play'); lis.forEach(l => l.classList.remove('done')); ad.classList.remove('show'); void d.offsetWidth;
    d.classList.add('play');
    at(() => lis[0].classList.add('done'), 400);
    at(() => lis[1].classList.add('done'), 1300);
    at(() => { lis[2].classList.add('done'); ad.classList.add('show'); }, 2300);
  };

  // Como en la app: seis dígitos, mostrados como 123-456.
  const rnd = () => String(Math.floor(Math.random() * 10));
  const people = [['Ana', 'tu arrendadora'], ['Luis', 'tu inquilino'], ['Mari', 'tu roomie'], ['Dani', 'quien te sucede']];
  let pIdx = 0;
  demos.codigo = () => {
    const d = $('#demo-codigo'), box = $('#code'), at = later('codigo');
    const code = Array.from({ length: 6 }, rnd).join('');
    d.classList.remove('linked');
    box.innerHTML = '';
    [...code].forEach((ch, i) => {
      if (i === 3) { const dash = document.createElement('span'); dash.className = 'cell dash'; dash.textContent = '-'; box.append(dash); }
      const cell = document.createElement('span'); cell.className = 'cell';
      const reel = document.createElement('span'); reel.className = 'reel'; reel.style.setProperty('--i', i);
      const n = instant() ? 0 : 12 + i * 2;
      reel.innerHTML = Array.from({ length: n }, rnd).map(c => `<span>${c}</span>`).join('') + `<span>${ch}</span>`;
      cell.append(reel); box.append(cell);
      if (n) requestAnimationFrame(() => requestAnimationFrame(() => { reel.style.transform = `translateY(-${n * 100 / (n + 1)}%)`; }));
    });
    box.setAttribute('aria-label', 'Código ' + code.slice(0, 3) + '-' + code.slice(3));
    const [name, role] = people[pIdx++ % people.length];
    $('#whoName').textContent = name; $('#role').textContent = role;
    $('.person:last-child .av', d).textContent = '?';
    at(() => $$('.cell:not(.dash)', box).forEach(c => c.classList.add('hit')), 2100);
    at(() => { d.classList.add('linked'); $('.person:last-child .av', d).textContent = name[0]; }, 2400);
  };

  demos.deposito = () => {
    const d = $('#demo-deposito'), at = later('deposito'), lis = $$('.inv li', d);
    const A = $('#mkA'), B = $('#mkB'), zone = $('#zone'), tug = $('#tug'), deal = $('#deal');
    const pos = v => (v / 240000 * 100) + '%';
    lis.forEach(l => l.classList.remove('seen')); deal.classList.remove('on'); tug.classList.remove('met');
    A.style.left = pos(180000); B.style.left = pos(240000);
    A.querySelector('span').textContent = 'Ana propone ₡180.000';
    B.querySelector('span').textContent = 'Vos: ₡240.000';
    zone.style.left = pos(180000); zone.style.right = '0%';
    lis.forEach((l, i) => at(() => l.classList.add('seen'), 300 + i * 450));
    at(() => { A.style.left = pos(210000); A.querySelector('span').textContent = 'Ana propone ₡210.000'; zone.style.left = pos(210000); }, 1800);
    at(() => { B.style.left = pos(228000); B.querySelector('span').textContent = 'Vos: ₡228.000'; zone.style.right = (100 - 228000 / 2400) + '%'; }, 2700);
    at(() => { A.style.left = pos(228000); zone.style.left = pos(228000); A.querySelector('span').textContent = 'Ana acepta'; }, 3700);
    at(() => { tug.classList.add('met'); B.querySelector('span').textContent = 'Acordado ₡228.000'; deal.classList.add('on'); }, 4600);
  };

  const demoIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const k = e.target.id.replace('demo-', ''); demos[k]?.(); demoIO.unobserve(e.target);
  }), { threshold: .45 });
  ['#demo-cuarto', '#demo-codigo', '#demo-deposito'].forEach(s => demoIO.observe($(s)));
  $$('[data-replay]').forEach(b => b.addEventListener('click', () => demos[b.dataset.replay]()));

  /* Destellos que salen del centro */
  function burst(el) {
    for (let i = 0; i < 16; i++) {
      const sp = document.createElement('span'); sp.className = 'spark';
      const a = (i / 16) * Math.PI * 2 + Math.random() * .4, d = 90 + Math.random() * 110;
      sp.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d * .7}px;--sz:${10 + Math.random() * 14}px;animation-delay:${Math.random() * 120}ms;color:${['#E6B840', '#4ECDC4', '#FF8A6B'][i % 3]}`;
      el.append(sp); setTimeout(() => sp.remove(), 1400);
    }
  }

  /* ---------- Calificación doble ciega, jugable ---------- */
  const stars = $$('#stars button'), you = $('#flipYou'), her = $('#flipHer');
  const msg = $('#blindMsg'), herState = $('#herState'), youState = $('#youState'), again = $('#blindAgain');
  let herDone = false, herStarted = false, blindT = [];
  const herRates = () => {
    blindT.forEach(clearTimeout); herDone = false; herStarted = true;
    herState.className = 'st8 wait'; herState.innerHTML = '<i></i>Calificando…';
    blindT.push(setTimeout(() => { herDone = true; herState.className = 'st8 done'; herState.innerHTML = '<i></i>Ya calificó · oculta hasta que califiques'; }, reduce ? 0 : 2200));
  };
  const paintStars = (n) => stars.forEach((s, i) => { s.classList.toggle('on', i < n); s.setAttribute('aria-checked', i === n - 1); });
  stars.forEach((s, i) => {
    s.addEventListener('mouseenter', () => { if (!you.classList.contains('turned')) paintStars(i + 1); });
    s.addEventListener('click', () => {
      const n = i + 1; paintStars(n);
      // Si se calificó antes de que la tarjeta entrara del todo en pantalla, Ana arranca ahora.
      if (!herStarted) herRates();
      stars.forEach(b => b.disabled = true);
      youState.className = 'st8 done'; youState.innerHTML = '<i></i>Enviada · oculta hasta el cierre';
      $('#youShown').textContent = '★'.repeat(n) + '☆'.repeat(5 - n);
      $('#youShown').setAttribute('aria-label', n + (n === 1 ? ' estrella' : ' estrellas'));
      const reveal = () => {
        msg.innerHTML = '<b>Las dos partes calificaron.</b> Se revelan juntas, nadie respondió viendo la otra nota.';
        blindT.push(setTimeout(() => {
          you.classList.add('turned'); her.classList.add('turned'); again.hidden = false;
          if (!instant()) burst($('.blind'));
        }, reduce ? 0 : 900));
      };
      if (herDone) reveal();
      else { msg.textContent = 'Tu nota quedó guardada. Falta Ana…'; const wait = setInterval(() => { if (herDone) { clearInterval(wait); reveal(); } }, 200); blindT.push(wait); }
    });
  });
  $('#stars').addEventListener('mouseleave', () => { if (!stars[0].disabled) paintStars(0); });
  again.addEventListener('click', () => {
    blindT.forEach(t => { clearTimeout(t); clearInterval(t); });
    you.classList.remove('turned'); her.classList.remove('turned'); again.hidden = true;
    stars.forEach(b => b.disabled = false); paintStars(0);
    youState.className = 'st8'; youState.innerHTML = '<i></i>Todavía no calificaste';
    msg.textContent = 'Tocá una estrella para calificar a Ana.';
    stars[0].focus();
    blindT.push(setTimeout(herRates, 600));
  });
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { if (!herStarted) herRates(); o.disconnect(); } }), { threshold: .25 }).observe($('.blind'));

  /* La ilustración con profundidad */
  const ruta = $('#ruta');
  if (fine && !reduce) {
    ruta.addEventListener('pointermove', e => { const r = ruta.getBoundingClientRect(); ruta.style.setProperty('--rx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3)); ruta.style.setProperty('--ry', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3)); });
    ruta.addEventListener('pointerleave', () => { ruta.style.setProperty('--rx', 0); ruta.style.setProperty('--ry', 0); });
  }

  /* ---------- El camino: se dibuja con el scroll por los márgenes ---------- */
  const cam = $('#camino'), road = $('#cRoad'), base = $('.c-base', cam), car = $('#cCar'), cEnd = $('#cEnd');
  // Muestras [largo, x, y] tomadas una sola vez al armar el camino: en cada cuadro solo se
  // busca y se interpola, sin getPointAtLength (que recorre la curva entera cada vez).
  let samples = [], total = 0;
  const docY = el => el.getBoundingClientRect().top + scrollY;
  const padTop = el => parseFloat(getComputedStyle(el).paddingTop) || 80;
  function buildCamino() {
    const W = root.clientWidth;
    const g = $('.hero .wrap').getBoundingClientRect().left / 2;
    // Va por el margen: si el margen no alcanza para el auto (30 px) sin rozar el texto,
    // no se dibuja. Pasa en celulares y en notebooks, donde el contenido llega casi al borde.
    cam.classList.toggle('off', g < 22);
    if (g < 22) { total = 0; return; }
    const H = root.scrollHeight;
    cam.setAttribute('viewBox', `0 0 ${W} ${H}`); cam.style.height = H + 'px';
    const L = g, R = W - g;
    // Cruza de lado a lado en diagonal, dentro del margen de arriba de cada sección: nunca sobre el texto.
    const cross = (sel, from, to) => { const el = $(sel), y = docY(el), pt = padTop(el); return [[from, y + 16], [to, y + Math.max(40, pt - 26)]]; };
    const hero = $('.hero'), hb = docY(hero) + hero.offsetHeight;
    const box = $('.cta-box'), bx = box.getBoundingClientRect(), endX = Math.min(R, bx.left + bx.width * .76);
    const pts = [[W / 2, hb - 30], [L, hb + 30],
      ...cross('#capacidades', L, R), ...cross('#solo-aca', R, L), ...cross('#confianza', L, R),
      ...cross('#descargar', R, endX), [endX, docY(box) - 2]];
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), r = Math.min(46, l1 / 2, l2 / 2);
      d += ` L${x - (x - px) / l1 * r} ${y - (y - py) / l1 * r} Q${x} ${y} ${x + (nx - x) / l2 * r} ${y + (ny - y) / l2 * r}`;
    }
    d += ` L${pts.at(-1)[0]} ${pts.at(-1)[1]}`;
    road.setAttribute('d', d); base.setAttribute('d', d);
    total = road.getTotalLength(); road.style.strokeDasharray = total;
    samples = [];
    for (let l = 0; l < total; l += 6) { const p = road.getPointAtLength(l); samples.push([l, p.x, p.y]); }
    const end = road.getPointAtLength(total); samples.push([total, end.x, end.y]);
    cEnd.setAttribute('transform', `translate(${end.x} ${end.y})`);
    renderCamino();
  }
  function renderCamino() {
    if (!total) return;
    let l = total, x = samples.at(-1)[1], y = samples.at(-1)[2];
    if (!reduce) {
      const target = scrollY + innerHeight * .62;
      let lo = 0, hi = samples.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (samples[m][2] <= target) lo = m; else hi = m - 1; }
      if (samples[lo][2] > target) { l = 0; [, x, y] = samples[0]; }
      else {
        const a = samples[lo], b = samples[lo + 1] || a;
        const t = b[2] > a[2] ? clamp((target - a[2]) / (b[2] - a[2])) : 0;
        l = a[0] + (b[0] - a[0]) * t; x = a[1] + (b[1] - a[1]) * t; y = a[2] + (b[2] - a[2]) * t;
      }
    }
    road.style.strokeDashoffset = total - l;
    car.setAttribute('transform', `translate(${x} ${y})`);
    cam.classList.toggle('go', l > 4 && !reduce);
    cam.classList.toggle('arrived', l >= total - 1);
  }
  site.onScroll(renderCamino);
  let campT;
  const rebuild = () => { clearTimeout(campT); campT = setTimeout(buildCamino, 120); };
  new ResizeObserver(rebuild).observe(document.body);
  addEventListener('load', rebuild);
  document.fonts?.ready.then(rebuild);

  site.tick();
})();
