/**
 * UI de la lista de pedidos (tabs, rango de fechas, modales de estado admin/comercial).
 * Config JSON en #pedidos-page-config: { periodoBase, revisandoEstadoId }.
 */
(function () {
  function readConfig() {
    var el = document.getElementById('pedidos-page-config');
    if (!el || !el.textContent) return { periodoBase: '', revisandoEstadoId: null };
    try {
      return JSON.parse(el.textContent);
    } catch (_) {
      return { periodoBase: '', revisandoEstadoId: null };
    }
  }

  function initDateRange(cfg) {
    var btnApply = document.getElementById('gv-fecha-apply');
    var inputDesde = document.getElementById('gv-fecha-desde');
    var inputHasta = document.getElementById('gv-fecha-hasta');
    if (!btnApply || !inputDesde || !inputHasta) return;
    var base = cfg.periodoBase || '';
    function applyDateRange() {
      var d = inputDesde.value || '';
      var h = inputHasta.value || '';
      if (!d && !h) return;
      var url = base;
      if (d) url += '&desde=' + encodeURIComponent(d);
      if (h) url += '&hasta=' + encodeURIComponent(h);
      window.location.href = url;
    }
    btnApply.addEventListener('click', applyDateRange);
    inputDesde.addEventListener('change', function () {
      if (inputHasta.value) applyDateRange();
    });
    inputHasta.addEventListener('change', function () {
      if (inputDesde.value) applyDateRange();
    });
  }

  function initPedidosTabs() {
    var root = document.getElementById('gvPedidosTabs');
    if (!root) return;
    var tabButtons = Array.prototype.slice.call(root.querySelectorAll('.gv-vista-tab[data-tab]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('.gv-tabpanel[data-tabpanel]'));
    if (!tabButtons.length || !panels.length) return;
    function setTab(id) {
      tabButtons.forEach(function (b) {
        var active = b.getAttribute('data-tab') === id;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(function (p) {
        var active = p.getAttribute('data-tabpanel') === id;
        p.classList.toggle('is-active', active);
      });
    }
    tabButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        setTab(b.getAttribute('data-tab'));
      });
    });
    var hash = String(window.location.hash || '')
      .replace('#', '')
      .trim()
      .toLowerCase();
    if (hash === 'resumen') hash = 'listado';
    if (hash === 'listado' || hash === 'seguimiento') setTab(hash);
  }

  function initAdminEstadoModal() {
    var root = document.getElementById('gvPedidosTabs');
    if (!root) return;

    var modal = document.getElementById('gv-estado-modal');
    var backdrop = document.getElementById('gv-estado-backdrop');
    var select = document.getElementById('gv-estado-select');
    var errBox = document.getElementById('gv-estado-error');
    var pedidoNumSpan = document.getElementById('gv-estado-pedido-num');
    var btnCancel = document.getElementById('gv-estado-cancel');
    var btnNext = document.getElementById('gv-estado-next');

    var cModal = document.getElementById('gv-estado-confirm-modal');
    var cBackdrop = document.getElementById('gv-estado-confirm-backdrop');
    var cPedidoNum = document.getElementById('gv-estado-confirm-pedido-num');
    var cNombre = document.getElementById('gv-estado-confirm-nombre');
    var cCancel = document.getElementById('gv-estado-confirm-cancel');
    var cAccept = document.getElementById('gv-estado-confirm-accept');
    var cSpinner = document.getElementById('gv-estado-spinner');
    var cAcceptLabel = document.getElementById('gv-estado-accept-label');

    if (!modal || !backdrop || !select || !btnCancel || !btnNext || !cModal || !cBackdrop || !cCancel || !cAccept) return;

    var currentPid = null;
    var currentPedidoNum = '';
    var currentBadge = null;
    var isSaving = false;

    function setSaving(on) {
      isSaving = !!on;
      cAccept.disabled = isSaving;
      cCancel.disabled = isSaving;
      if (cSpinner) cSpinner.style.display = isSaving ? 'inline-block' : 'none';
      if (cAcceptLabel) cAcceptLabel.textContent = isSaving ? 'Guardando...' : 'Aceptar';
    }

    function openSelectModal(pid, pedidoNum, curEstadoId) {
      currentPid = pid;
      currentPedidoNum = pedidoNum || String(pid);
      pedidoNumSpan.textContent = currentPedidoNum;
      if (errBox) {
        errBox.style.display = 'none';
        errBox.textContent = '';
      }
      if (curEstadoId) {
        select.value = String(curEstadoId);
      } else if (select.options && select.options.length) {
        select.selectedIndex = 0;
      }
      backdrop.hidden = false;
      modal.hidden = false;
    }
    function closeSelectModal(resetState) {
      modal.hidden = true;
      backdrop.hidden = true;
      if (resetState) {
        currentPid = null;
        currentPedidoNum = '';
        currentBadge = null;
      }
    }

    function openConfirmModal(pedidoNum, estadoNombre) {
      cPedidoNum.textContent = pedidoNum || '—';
      cNombre.textContent = estadoNombre || '—';
      cBackdrop.hidden = false;
      cModal.hidden = false;
    }
    function closeConfirmModal() {
      cModal.hidden = true;
      cBackdrop.hidden = true;
    }

    btnCancel.addEventListener('click', function () {
      closeSelectModal(true);
    });
    backdrop.addEventListener('click', function () {
      closeSelectModal(true);
    });
    btnNext.addEventListener('click', function () {
      if (!currentPid) return;
      var opt = select.options[select.selectedIndex];
      var estadoNombre = opt ? (opt.textContent || '').trim() : '';
      var pedidoNum = currentPedidoNum || (pedidoNumSpan ? pedidoNumSpan.textContent : String(currentPid));
      closeSelectModal(false);
      openConfirmModal(pedidoNum, estadoNombre);
    });

    cCancel.addEventListener('click', function () {
      if (isSaving) return;
      closeConfirmModal();
      currentPid = null;
      currentPedidoNum = '';
      currentBadge = null;
    });
    cBackdrop.addEventListener('click', function () {
      if (isSaving) return;
      closeConfirmModal();
      currentPid = null;
      currentPedidoNum = '';
      currentBadge = null;
    });

    cAccept.addEventListener('click', function () {
      if (!currentBadge) {
        closeConfirmModal();
        return;
      }
      var pid = currentBadge.getAttribute('data-pid');
      var estadoId = select.value;
      var opt = select.options[select.selectedIndex];
      var estadoNombre = opt ? (opt.textContent || '').trim() : '';

      setSaving(true);
      fetch('/pedidos/' + encodeURIComponent(pid) + '/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ estadoId: estadoId })
      })
        .then(function (r) {
          return r.json().then(function (json) {
            return { r: r, json: json };
          });
        })
        .then(function (_ref) {
          var r = _ref.r;
          var json = _ref.json;
          if (!r.ok || !json || !json.ok) {
            throw new Error((json && json.error) ? json.error : 'HTTP ' + r.status);
          }
          var colorRaw = json.estado && json.estado.color ? String(json.estado.color).trim().toLowerCase() : '';
          var color = ['ok', 'danger', 'warn', 'info'].indexOf(colorRaw) >= 0 ? colorRaw : 'info';
          var nombre = json.estado && json.estado.nombre ? String(json.estado.nombre) : estadoNombre || '—';

          currentBadge.textContent = nombre;
          currentBadge.setAttribute(
            'data-estado-id',
            String(
              (json.estado && (json.estado.id != null ? json.estado.id : json.estado.estped_id)) || estadoId || ''
            )
          );
          currentBadge.setAttribute('data-estado-label', nombre);
          currentBadge.classList.remove('ok', 'info', 'warn', 'danger');
          currentBadge.classList.add(color);

          closeConfirmModal();
          currentPid = null;
          currentPedidoNum = '';
          currentBadge = null;
        })
        .catch(function (e) {
          closeConfirmModal();
          if (errBox) {
            errBox.textContent = 'No se pudo cambiar el estado. ' + (e && e.message ? e.message : '');
            errBox.style.display = 'block';
          }
          backdrop.hidden = false;
          modal.hidden = false;
          if (pedidoNumSpan) pedidoNumSpan.textContent = currentPedidoNum || pid || '—';
        })
        .finally(function () {
          setSaving(false);
        });
    });

    root.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button.gv-pedido-estado-badge[data-pid]') : null;
      if (!btn) return;
      currentBadge = btn;
      var pid = btn.getAttribute('data-pid');
      var pedidoNum = btn.getAttribute('data-num') || '';
      var curEstadoId = Number(btn.getAttribute('data-estado-id') || 0) || 0;
      openSelectModal(pid, pedidoNum, curEstadoId);
    });
  }

  function initComercialRevisando(revisandoEstadoId) {
    var idNum = Number(revisandoEstadoId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;

    var root = document.getElementById('gvPedidosTabs');
    if (!root) return;
    var cModal = document.getElementById('gv-comercial-confirm-modal');
    var cBackdrop = document.getElementById('gv-comercial-confirm-backdrop');
    var cNum = document.getElementById('gv-comercial-confirm-num');
    var cCancel = document.getElementById('gv-comercial-cancel');
    var cAccept = document.getElementById('gv-comercial-accept');
    var cSpinner = document.getElementById('gv-comercial-spinner');
    var cLabel = document.getElementById('gv-comercial-accept-label');
    if (!cModal || !cBackdrop || !cCancel || !cAccept) return;

    var activeBadge = null;
    var saving = false;

    function setSaving(on) {
      saving = !!on;
      cAccept.disabled = saving;
      cCancel.disabled = saving;
      if (cSpinner) cSpinner.style.display = saving ? 'inline-block' : 'none';
      if (cLabel) cLabel.textContent = saving ? 'Enviando...' : 'Sí, enviar a revisión';
    }

    cCancel.addEventListener('click', function () {
      if (!saving) {
        cModal.hidden = true;
        cBackdrop.hidden = true;
        activeBadge = null;
      }
    });
    cBackdrop.addEventListener('click', function () {
      if (!saving) {
        cModal.hidden = true;
        cBackdrop.hidden = true;
        activeBadge = null;
      }
    });

    cAccept.addEventListener('click', function () {
      if (!activeBadge || saving) return;
      var pid = activeBadge.getAttribute('data-pid');
      setSaving(true);
      fetch('/pedidos/' + encodeURIComponent(pid) + '/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ estadoId: String(idNum) })
      })
        .then(function (r) {
          return r.json().then(function (json) {
            return { r: r, json: json };
          });
        })
        .then(function (_ref2) {
          var r = _ref2.r;
          var json = _ref2.json;
          if (!r.ok || !json || !json.ok) {
            throw new Error((json && json.error) ? json.error : 'HTTP ' + r.status);
          }
          var color = json.estado && json.estado.color ? String(json.estado.color) : 'info';
          var nombre = json.estado && json.estado.nombre ? String(json.estado.nombre) : 'Revisando';
          activeBadge.textContent = nombre;
          activeBadge.classList.remove('ok', 'info', 'warn', 'danger');
          activeBadge.classList.add(color || 'info');
          activeBadge.disabled = true;
          activeBadge.style.cursor = 'default';
          activeBadge.title = '';

          var tr = activeBadge.closest('tr');
          if (tr) {
            var editBtn = tr.querySelector('a[href*="/edit"]');
            if (editBtn) editBtn.remove();
          }

          cModal.hidden = true;
          cBackdrop.hidden = true;
          activeBadge = null;

          var wh = json.webhook;
          if (wh && !wh.ok) {
            window.alert(
              'Estado actualizado, pero hubo un error al notificar (webhook): ' + (wh.error || 'HTTP ' + wh.status)
            );
          }
        })
        .catch(function (e) {
          cModal.hidden = true;
          cBackdrop.hidden = true;
          window.alert('No se pudo cambiar el estado: ' + (e && e.message ? e.message : 'Error desconocido'));
        })
        .finally(function () {
          setSaving(false);
        });
    });

    root.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button.gv-pedido-estado-comercial[data-pid]') : null;
      if (!btn) return;
      activeBadge = btn;
      var num = btn.getAttribute('data-num') || btn.getAttribute('data-pid') || '—';
      if (cNum) cNum.textContent = num;
      cBackdrop.hidden = false;
      cModal.hidden = false;
    });
  }

  var cfg = readConfig();
  initDateRange(cfg);
  initPedidosTabs();
  initAdminEstadoModal();
  initComercialRevisando(cfg.revisandoEstadoId);
})();
