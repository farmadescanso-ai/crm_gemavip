(() => {
  function $(sel) {
    return document.querySelector(sel);
  }

  function init() {
    const el = $('#gv-visitas-calendar');
    if (!el) return;

    const initialDate = el.getAttribute('data-initial-date') || undefined;

    // FullCalendar (global build via CDN)
    // eslint-disable-next-line no-undef
    const Calendar = window.FullCalendar?.Calendar;
    if (!Calendar) {
      el.innerHTML = '<div class="badge warn" style="border-radius:14px; display:inline-flex;">No se pudo cargar el calendario</div>';
      return;
    }

    const cal = new Calendar(el, {
      initialView: 'dayGridMonth',
      initialDate,
      locale: 'es',
      firstDay: 1,
      height: 'auto',
      nowIndicator: true,
      navLinks: true,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
      },
      buttonText: {
        today: 'Hoy',
        month: 'Mes',
        week: 'Semana',
        day: 'Día',
        list: 'Lista'
      },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      events: async (info, success, failure) => {
        try {
          const url = `/api/visitas/events?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`;
          const r = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();
          if (!json || json.ok !== true) throw new Error('Respuesta no válida');
          success(Array.isArray(json.items) ? json.items : []);
        } catch (e) {
          failure(e);
        }
      }
    });

    cal.render();
  }

  window.addEventListener('DOMContentLoaded', init);
})();

