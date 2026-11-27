/* =====================================================================
   ImHomi · cambiar de paso en las páginas de un trámite
   Descargar mis datos, eliminar la cuenta, nueva contraseña, revertir el
   correo y la entrada al panel de soporte muestran una sección por vez.
   Sin librerías.
   ===================================================================== */
(() => {
  /* Lo que tapa la cabecera fija arriba (scroll-padding-top de site.css). */
  const TOPE = 84;

  /**
   * Lleva a la vista la sección que acaba de aparecer y le da el foco a
   * [focus].
   *
   * Cada página enfocaba el título y daba por hecho que el navegador lo
   * traía a la vista. Safari de iPhone no se mueve al enfocar un título: en
   * "Descargar mis datos", al tocar el botón de abajo la sección de arriba
   * se ocultaba, la página quedaba en el pie y "Listo: tu copia se
   * descargó" no se veía. Lo mismo con "Este enlace ya no sirve" y con
   * cada paso de las otras páginas.
   *
   * Solo se mueve si la sección quedó fuera de la vista: al cargar, o
   * cuando ya se ve, la página se queda donde está.
   */
  window.imhomiPaso = (section, focus) => {
    if (section && !section.hidden) {
      const top = section.getBoundingClientRect().top;
      if (top < TOPE || top > innerHeight - TOPE) {
        section.scrollIntoView({ block: 'start' });
      }
    }
    if (focus) focus.focus({ preventScroll: true });
  };
})();
