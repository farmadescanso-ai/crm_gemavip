(() => {
  function debounce(fn, waitMs) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightHtml(text, query) {
    const src = String(text ?? '');
    const q = String(query ?? '').trim();
    if (!src || q.length < 3) return escapeHtml(src);

    const terms = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 5);

    if (!terms.length) return escapeHtml(src);

    const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig');
    const parts = src.split(re);
    return parts
      .map((p) => {
        if (!p) return '';
        return re.test(p) ? `<span class="gv-hl">${escapeHtml(p)}</span>` : escapeHtml(p);
      })
      .join('');
  }

  async function suggestClientes(q, limit = 20) {
    const url = `/api/clientes/suggest?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    if (!json || json.ok !== true) throw new Error('Respuesta no válida');
    return Array.isArray(json.items) ? json.items : [];
  }

  async function getClienteById(id) {
    const url = `/api/clientes/${encodeURIComponent(String(id))}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    if (!json || json.ok !== true) throw new Error('Respuesta no válida');
    return json.item || null;
  }

  function getLabel(it) {
    const id = it?.cli_id ?? it?.Id ?? it?.id ?? '';
    const rs = it?.cli_nombre_razon_social ?? it?.Nombre_Razon_Social ?? it?.Nombre ?? '';
    const nc = it?.cli_nombre_cial ?? it?.Nombre_Cial ?? '';
    const cif = it?.cli_dni_cif ?? it?.DNI_CIF ?? it?.DniCif ?? '';
    const pob = it?.cli_poblacion ?? it?.Poblacion ?? '';
    const cp = it?.cli_codigo_postal ?? it?.CodigoPostal ?? '';
    const parts = [];
    if (rs) parts.push(rs);
    if (nc) parts.push(nc);
    const extra = [cp, pob].filter(Boolean).join(' ');
    return `${id} · ${parts.filter(Boolean).join(' / ')}${cif ? ` · ${cif}` : ''}${extra ? ` · ${extra}` : ''}`.trim();
  }

  function getDisplayHtml(it, query) {
    const id = it?.cli_id ?? it?.Id ?? it?.id ?? '';
    const rs = it?.cli_nombre_razon_social ?? it?.Nombre_Razon_Social ?? it?.Nombre ?? '';
    const nc = it?.cli_nombre_cial ?? it?.Nombre_Cial ?? '';
    const cif = it?.cli_dni_cif ?? it?.DNI_CIF ?? it?.DniCif ?? '';
    const pob = it?.cli_poblacion ?? it?.Poblacion ?? '';
    const cp = it?.cli_codigo_postal ?? it?.CodigoPostal ?? '';

    const name = [rs, nc].filter(Boolean).join(' / ');
    const extra = [cif, [cp, pob].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

    const left = `<span style="font-weight:900">${escapeHtml(id)}</span>`;
    const main = name ? highlightHtml(name, query) : '<span style="color:var(--gv-muted)">Sin nombre</span>';
    const tail = extra ? `<span style="color:var(--gv-muted); font-weight:700"> · ${highlightHtml(extra, query)}</span>` : '';
    return `${left} · ${main}${tail}`;
  }

  function initPicker(root) {
    const qInput = root.querySelector('.gv-client-picker__q');
    const idInput = root.querySelector('.gv-client-picker__id');
    const results = root.querySelector('.gv-client-picker__results');
    const recent = root.querySelector('.gv-client-picker__recent');

    if (!qInput || !idInput || !results) return;

    const isDigitsOnly = (s) => /^\d+$/.test(String(s || '').trim());

    const hideResults = () => {
      results.hidden = true;
      results.innerHTML = '';
    };

    const selectItem = (id, label) => {
      if (id !== undefined && id !== null && String(id).trim() !== '') idInput.value = String(id).trim();
      if (label) qInput.value = String(label);
      // Notificar a formularios (p.ej. pedidos) que el cliente ha cambiado
      try { idInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      hideResults();
    };

    const showRecent = (on) => {
      if (!recent) return;
      const toggle = document.getElementById('showRecentToggle');
      const show = on && (!toggle || toggle.checked);
      recent.style.display = show ? '' : 'none';
    };

    // Recientes (botones)
    root.querySelectorAll('[data-client-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-client-pick');
        const label = btn.getAttribute('data-client-label') || '';
        selectItem(id, label);
      });
    });

    const run = debounce(async () => {
      const q = qInput.value.trim();
      if (q.length < 3 && !isDigitsOnly(q)) {
        hideResults();
        showRecent(true);
        return;
      }

      showRecent(false);
      results.hidden = false;
      results.innerHTML = `<div class="gv-client-picker__loading">Buscando…</div>`;

      try {
        const items = await suggestClientes(q, 20);
        if (!items.length) {
          results.innerHTML = `<div class="gv-client-picker__empty">Sin resultados</div>`;
          return;
        }

        results.innerHTML = items
          .slice(0, 20)
          .map((it) => {
            const id = it?.cli_id ?? it?.Id ?? it?.id ?? '';
            const label = getLabel(it);
            const html = getDisplayHtml(it, q);
            return `<button type="button" class="gv-client-picker__item" data-id="${escapeHtml(id)}" data-label="${escapeHtml(
              label
            )}">${html}</button>`;
          })
          .join('');

        results.querySelectorAll('.gv-client-picker__item').forEach((b) => {
          const handler = (e) => {
            // Importante: seleccionar antes de que el input pierda el foco (blur),
            // y evitar que el botón "robe" el foco si no queremos.
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            const id = b.getAttribute('data-id');
            const label = b.getAttribute('data-label');
            selectItem(id, label);
          };
          b.addEventListener('pointerdown', handler);
          b.addEventListener('mousedown', handler);
          b.addEventListener('click', handler);
        });
      } catch (_e) {
        results.innerHTML = `<div class="gv-client-picker__empty">No se pudo buscar (reintenta)</div>`;
      }
    }, 180);

    qInput.addEventListener('input', run);
    qInput.addEventListener('focus', () => {
      const q = qInput.value.trim();
      if (q.length < 3 && !isDigitsOnly(q)) showRecent(true);
    });
    qInput.addEventListener('blur', () => {
      // Si el foco pasa a un elemento dentro del componente (p.ej. botón resultado),
      // no ocultar aún (permite seleccionar).
      setTimeout(() => {
        if (root.contains(document.activeElement)) return;
        hideResults();
      }, 120);
    });
    qInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !results.hidden) {
        const first = results.querySelector('.gv-client-picker__item');
        if (first) {
          e.preventDefault();
          first.click();
        }
      } else if (e.key === 'Escape') {
        hideResults();
      }
    });

    showRecent(true);
    const toggle = document.getElementById('showRecentToggle');
    if (toggle) toggle.addEventListener('change', () => showRecent(true));

    // Si venimos con un ClienteId ya guardado (editar), intentar cargar etiqueta
    const existingId = String(idInput.value || '').trim();
    if (existingId) {
      getClienteById(existingId)
        .then((it) => {
          if (!it) return;
          // Solo rellenar si el usuario no ha empezado a escribir
          if (!qInput.value) qInput.value = getLabel(it);
        })
        .catch(() => {});
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-client-picker]').forEach(initPicker);
  });
})();

