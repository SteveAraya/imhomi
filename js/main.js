/* ========================================
   ImHomi Landing — main.js v2
   ======================================== */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Sticky header ---------- */
  const header = document.querySelector('.header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  /* ---------- Mobile menu ---------- */
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', (e) => {
      if (!navLinks.contains(e.target) && !hamburger.contains(e.target)) {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Fade-in on scroll ---------- */
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  } else {
    document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
  }

  /* ---------- Smooth scroll ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - header.offsetHeight;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ---------- Nav: resaltar la sección visible ---------- */
  const sections = document.querySelectorAll('section[id]');
  const navAnchors = navLinks ? navLinks.querySelectorAll('a[href^="#"]') : [];

  if ('IntersectionObserver' in window && sections.length && navAnchors.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navAnchors.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(s => spy.observe(s));
  }

  /* ---------- Situaciones (Qué podés hacer) ----------
     En escritorio son pestañas: patrón de la APG, una sola parada de
     tabulación y flechas para moverse entre opciones.

     En móvil NO hay pestañas. Esconder tres de cuatro paneles detrás de
     taps es esconder el contenido, así que se apilan y se leen de corrido.
     Acá se desmonta la semántica de tabs para que no queden roles ni
     referencias apuntando a controles que están ocultos. */
  const tabsWrap = document.querySelector('.caps-tabs');
  const tabs = Array.from(document.querySelectorAll('.caps-tab'));
  const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const labelledBy = panels.map(p => p && p.getAttribute('aria-labelledby'));

  if (tabsWrap && tabs.length) {
    const stacked = window.matchMedia('(max-width: 768px)');
    let current = 0;

    const select = (i, { focus = false } = {}) => {
      current = i;
      tabs.forEach((t, n) => {
        const active = n === i;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
        if (panels[n]) {
          panels[n].classList.toggle('is-active', active);
          panels[n].hidden = !active;
        }
      });
      if (focus) tabs[i].focus();
    };

    const applyMode = () => {
      if (stacked.matches) {
        tabsWrap.removeAttribute('role');
        tabs.forEach(t => {
          t.removeAttribute('role');
          t.removeAttribute('aria-selected');
          t.tabIndex = -1;
        });
        panels.forEach(p => {
          if (!p) return;
          p.removeAttribute('role');
          p.removeAttribute('aria-labelledby');   // apuntaría a una pestaña oculta
          p.hidden = false;
        });
      } else {
        tabsWrap.setAttribute('role', 'tablist');
        tabs.forEach(t => t.setAttribute('role', 'tab'));
        panels.forEach((p, n) => {
          if (!p) return;
          p.setAttribute('role', 'tabpanel');
          if (labelledBy[n]) p.setAttribute('aria-labelledby', labelledBy[n]);
        });
        select(current);
      }
    };

    tabs.forEach((tab, i) => tab.addEventListener('click', () => {
      if (!stacked.matches) select(i);
    }));

    tabsWrap.addEventListener('keydown', (e) => {
      if (stacked.matches) return;
      const i = tabs.indexOf(document.activeElement);
      if (i === -1) return;

      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        select((i + step + tabs.length) % tabs.length, { focus: true });
      } else if (e.key === 'Home') {
        e.preventDefault();
        select(0, { focus: true });
      } else if (e.key === 'End') {
        e.preventDefault();
        select(tabs.length - 1, { focus: true });
      }
    });

    stacked.addEventListener('change', applyMode);
    applyMode();
  }

  /* ---------- Current year ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
