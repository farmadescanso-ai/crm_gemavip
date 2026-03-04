;(function() {
  'use strict';

  const dataEl = document.getElementById('ventas-page-data');
  const pageData = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
  const initialData = pageData.initialData || null;
  const savedFiles = pageData.savedFiles || [];
  let catalogos = pageData.catalogos || { años: [], meses: [], provincias: [], materiales: [] };
  const queryParams = pageData.queryParams || { view: 'evolucion-mes' };

  const GV_COLORS = {
    primary: '#008bd2',
    primary2: '#17428b',
    yellow: '#ffba00',
    green: '#8fae1b',
    palette: ['#008bd2', '#17428b', '#ffba00', '#8fae1b', '#2ea3f2', '#5b667a', '#0c143a', '#7ad03a', '#e85d04', '#9d4edd']
  };

  let charts = {};
  let rawData = null;
  const MESES_NOMBRES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const anioActual = new Date().getFullYear();

  function filterData(data, anio, mes, provinciaCodigo, materialCodigo) {
    if (!data) return data;
    let ventasF = data.ventas || [];
    if (anio !== 'all') {
      const suf = '.' + anio;
      ventasF = ventasF.filter(v => (v.mesKey || '').endsWith(suf));
    }
    if (mes !== 'all') {
      const m = Number(mes);
      ventasF = ventasF.filter(v => Number(v.mes) === m);
    }
    if (provinciaCodigo !== 'all') {
      ventasF = ventasF.filter(v => v.provinciaCodigo === provinciaCodigo);
    }
    if (materialCodigo !== 'all') {
      ventasF = ventasF.filter(v => v.materialCodigo === materialCodigo);
    }
    const mesesF = anio === 'all'
      ? [...new Set(ventasF.map(v => v.mesKey).filter(Boolean))].sort((a, b) => {
          const [ma, aa] = a.split('.').map(Number);
          const [mb, ab] = b.split('.').map(Number);
          return aa !== ab ? aa - ab : ma - mb;
        })
      : (data.meses || []).filter(m => m.endsWith('.' + anio)).sort();
    const byMes = {};
    const byMaterial = {};
    const byProvincia = {};
    const byMaterialMes = {};
    const byProvinciaMes = {};
    const matSet = new Set();
    const provSet = new Set();
    ventasF.forEach(v => {
      byMes[v.mesKey] = (byMes[v.mesKey] || 0) + v.cantidad;
      byMaterial[v.materialCodigo] = (byMaterial[v.materialCodigo] || 0) + v.cantidad;
      byProvincia[v.provinciaCodigo] = (byProvincia[v.provinciaCodigo] || 0) + v.cantidad;
      byMaterialMes[v.materialCodigo + '|' + v.mesKey] = (byMaterialMes[v.materialCodigo + '|' + v.mesKey] || 0) + v.cantidad;
      if (!byProvinciaMes[v.provinciaCodigo]) byProvinciaMes[v.provinciaCodigo] = {};
      byProvinciaMes[v.provinciaCodigo][v.mesKey] = (byProvinciaMes[v.provinciaCodigo][v.mesKey] || 0) + v.cantidad;
      matSet.add(v.materialCodigo);
      provSet.add(v.provinciaCodigo);
    });
    const materialesF = (data.materiales || []).filter(m => matSet.has(m.codigo));
    const provinciasF = (data.provincias || []).filter(p => provSet.has(p.codigo));
    const topMateriales = materialesF.map(m => ({ ...m, total: byMaterial[m.codigo] || 0 })).sort((a,b) => (b.total||0)-(a.total||0)).slice(0, 15);
    const topProvincias = provinciasF.map(p => ({ ...p, total: byProvincia[p.codigo] || 0 })).sort((a,b) => (b.total||0)-(a.total||0)).slice(0, 12);
    const topProvEvol = topProvincias.slice(0, 10);
    return {
      ...data,
      ventas: ventasF,
      materiales: materialesF,
      provincias: provinciasF,
      meses: mesesF,
      evolucionMeses: mesesF.map(m => ({ mes: m, total: byMes[m] || 0 })),
      topMateriales,
      topProvincias,
      evolucionMaterialMes: mesesF.map(mesKey => {
        const row = { mes: mesKey };
        topMateriales.slice(0, 8).forEach(m => { row[m.codigo] = byMaterialMes[m.codigo + '|' + mesKey] || 0; });
        return row;
      }),
      evolucionProvinciaMes: topProvEvol.map(p => ({
        codigo: p.codigo,
        nombre: p.nombre,
        totales: mesesF.map(m => byProvinciaMes[p.codigo]?.[m] || 0)
      })),
      totalUnidades: ventasF.reduce((s,v) => s + (v.cantidad||0), 0),
      materialLabels: topMateriales.slice(0, 8).map(m => (m.descripcion||m.codigo).slice(0, 25))
    };
  }

  function showChartPanel(id) {
    document.querySelectorAll('.ventas-chart-panel').forEach(p => { p.hidden = p.dataset.chartPanel !== id; });
    document.querySelectorAll('.ventas-chart-nav__item').forEach(b => { b.classList.toggle('active', b.dataset.chart === id); });
  }

  function buildFilterParams() {
    const anio = document.getElementById('ventas-filter-anio')?.value || 'all';
    const mes = document.getElementById('ventas-filter-mes')?.value || 'all';
    const prov = document.getElementById('ventas-filter-provincia')?.value || 'all';
    const art = document.getElementById('ventas-filter-articulo')?.value || 'all';
    return { anio, mes, prov, art };
  }

  function updateUrlFromFiltersAndView() {
    const { anio, mes, prov, art } = buildFilterParams();
    const view = document.querySelector('.ventas-chart-nav__item.active')?.dataset?.chart || 'evolucion-mes';
    const params = new URLSearchParams();
    if (view && view !== 'evolucion-mes') params.set('view', view);
    if (anio && anio !== 'all') params.set('anio', anio);
    if (mes && mes !== 'all') params.set('mes', mes);
    if (prov && prov !== 'all') params.set('provincia', prov);
    if (art && art !== 'all') params.set('articulo', art);
    const qs = params.toString();
    const url = '/ventas-gemavip/informes' + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', url);
  }

  async function fetchDataWithFilters() {
    const { anio, mes, prov, art } = buildFilterParams();
    const params = new URLSearchParams();
    if (anio && anio !== 'all') params.set('anio', anio);
    if (mes && mes !== 'all') params.set('mes', mes);
    if (prov && prov !== 'all') params.set('provincia', prov);
    if (art && art !== 'all') params.set('articulo', art);
    try {
      const res = await fetch('/ventas-gemavip/api/data' + (params.toString() ? '?' + params.toString() : ''));
      const json = await res.json();
      if (json.ok && json.data) {
        if (json.catalogos) Object.assign(catalogos, json.catalogos);
        renderDashboard(json.data);
      }
    } catch (_) {}
  }

  function destroyCharts() {
    Object.values(charts).forEach(c => { if (c) c.destroy(); });
    charts = {};
    const provMesEl = document.getElementById('chart-provincia-mes');
    if (provMesEl) provMesEl.innerHTML = '';
  }

  function renderCharts(data) {
    destroyCharts();

    const tbody = document.querySelector('#ventas-detail-table tbody');
    if (tbody) {
      tbody.innerHTML = '';
      (data.ventas || []).slice(0, 200).forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (v.materialDescripcion || v.materialCodigo) + '</td>' +
          '<td>' + (v.provinciaNombre || v.provinciaCodigo) + '</td>' +
          '<td>' + (v.mesKey || '') + '</td>' +
          '<td>' + (v.cantidad || 0) + '</td>';
        tbody.appendChild(tr);
      });
      if ((data.ventas || []).length > 200) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" style="color:var(--gv-muted);">Mostrando 200 de ' + data.ventas.length + ' registros</td>';
        tbody.appendChild(tr);
      }
    }

    const evolucion = data.evolucionMeses || [];
    if (evolucion.length) {
      const el = document.getElementById('chart-evolucion-mes');
      if (el) charts.evolucion = new Chart(el, {
        type: 'line',
        data: {
          labels: evolucion.map(x => x.mes),
          datasets: [{
            label: 'Unidades',
            data: evolucion.map(x => x.total),
            borderColor: GV_COLORS.primary,
            backgroundColor: GV_COLORS.primary + '33',
            fill: true,
            tension: 0.3
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }

    const topMat = data.topMateriales || [];
    if (topMat.length) {
      const el = document.getElementById('chart-top-materiales');
      if (el) charts.materiales = new Chart(el, {
        type: 'bar',
        data: {
          labels: topMat.map(m => (m.descripcion || m.codigo).slice(0, 22) + (m.descripcion && m.descripcion.length > 22 ? '…' : '')),
          datasets: [{ label: 'Unidades', data: topMat.map(m => m.total), backgroundColor: GV_COLORS.palette }]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
      });
    }

    const evProvMes = data.evolucionProvinciaMes || [];
    const mesesLabels = data.meses || [];
    if (evProvMes.length && mesesLabels.length) {
      const el = document.getElementById('chart-provincia-mes');
      if (el) {
        const maxVal = Math.max(...evProvMes.flatMap(p => p.totales || []), 1);
        const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const table = document.createElement('table');
        table.className = 'ventas-heatmap';
        const thead = document.createElement('thead');
        const thr = document.createElement('tr');
        thr.innerHTML = '<th>Provincia</th>' + mesesLabels.map(m => {
          const parts = m.split('.');
          const label = parts.length === 2 ? (MESES_CORTOS[parseInt(parts[0],10)-1] || parts[0]) + ' ' + parts[1] : m;
          return '<th>' + label + '</th>';
        }).join('') + '<th>Total</th>';
        thead.appendChild(thr);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        evProvMes.forEach(p => {
          const totales = p.totales || [];
          const total = totales.reduce((s, v) => s + (v || 0), 0);
          const tr = document.createElement('tr');
          let cells = '<td class="ventas-heatmap__prov">' + (p.nombre || p.codigo) + '</td>';
          totales.forEach((v) => {
            const pct = maxVal > 0 ? (v || 0) / maxVal : 0;
            const opacity = 0.12 + pct * 0.78;
            cells += '<td class="ventas-heatmap__cell" style="background:rgba(0,139,210,' + opacity.toFixed(2) + ');color:' + (opacity > 0.5 ? '#fff' : 'inherit') + ';" title="' + (v || 0) + '">' + (v || 0).toLocaleString('es-ES') + '</td>';
          });
          cells += '<td class="ventas-heatmap__total"><strong>' + total.toLocaleString('es-ES') + '</strong></td>';
          tr.innerHTML = cells;
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        el.innerHTML = '';
        el.appendChild(table);
      }
    }

    const topProv = data.topProvincias || [];
    if (topProv.length) {
      const el = document.getElementById('chart-provincias');
      if (el) charts.provincias = new Chart(el, {
        type: 'doughnut',
        data: {
          labels: topProv.map(p => p.nombre || p.codigo),
          datasets: [{ data: topProv.map(p => p.total), backgroundColor: GV_COLORS.palette }]
        },
        options: { responsive: true, plugins: { legend: { position: 'right' } } }
      });
    }

    const evMatMes = data.evolucionMaterialMes || [];
    const topMat8 = (data.topMateriales || []).slice(0, 8);
    const matLabels = data.materialLabels || topMat8.map(m => (m.descripcion || m.codigo).slice(0, 20));
    if (evMatMes.length && topMat8.length) {
      const codigos = topMat8.map(m => m.codigo);
      const ds = codigos.map((cod, i) => ({
        label: matLabels[i] || cod,
        data: evMatMes.map(row => row[cod] || 0),
        backgroundColor: GV_COLORS.palette[i % GV_COLORS.palette.length]
      }));
      const el = document.getElementById('chart-material-mes');
      if (el) charts.materialMes = new Chart(el, {
        type: 'bar',
        data: { labels: evMatMes.map(r => r.mes), datasets: ds },
        options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
      });
    }

    const compAnio = rawData?.comparacionAnioAnterior;
    const mesesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    if (compAnio && compAnio.mesesComunes?.length) {
      const el = document.getElementById('chart-anio-vs-anio');
      if (el) charts.anioVsAnio = new Chart(el, {
        type: 'bar',
        data: {
          labels: compAnio.mesesComunes.map(r => mesesNombres[parseInt(r.mes,10)-1] || r.mes),
          datasets: [
            { label: '' + compAnio.anioActual, data: compAnio.mesesComunes.map(r => r.totalActual), backgroundColor: GV_COLORS.primary },
            { label: '' + compAnio.anioAnterior, data: compAnio.mesesComunes.map(r => r.totalAnterior), backgroundColor: GV_COLORS.primary2 + '99' }
          ]
        },
        options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('es-ES') } } } }
      });
    }

    const compMes = rawData?.comparacionMes;
    if (compMes) {
      const el = document.getElementById('chart-mes-vs-mes');
      if (el) charts.mesVsMes = new Chart(el, {
        type: 'bar',
        data: {
          labels: [compMes.mesAnterior, compMes.mesActual],
          datasets: [{ label: 'Unidades', data: [compMes.totalAnterior, compMes.totalActual], backgroundColor: [GV_COLORS.primary2 + '99', GV_COLORS.primary] }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('es-ES') } } } }
      });
    }

    showChartPanel('evolucion-mes');
  }

  function renderDashboard(data) {
    rawData = data;

    const anioSelect = document.getElementById('ventas-filter-anio');
    const mesSelect = document.getElementById('ventas-filter-mes');
    const provSelect = document.getElementById('ventas-filter-provincia');
    const artSelect = document.getElementById('ventas-filter-articulo');

    const años = catalogos?.años?.length ? catalogos.años : (data.años || []);
    const meses = catalogos?.meses?.length ? catalogos.meses : [...new Set((data.ventas || []).map(v => v.mes).filter(Boolean))].sort((a,b) => a - b);
    const provincias = catalogos?.provincias?.length ? catalogos.provincias : (data.provincias || []);
    const materiales = catalogos?.materiales?.length ? catalogos.materiales : (data.materiales || []);

    if (anioSelect) {
      anioSelect.innerHTML = '<option value="all">Todos</option>' + años.map(a => '<option value="' + a + '">' + a + '</option>').join('');
      if (queryParams?.anio && años.includes(Number(queryParams.anio))) anioSelect.value = String(queryParams.anio);
      else if (años.includes(anioActual)) anioSelect.value = String(anioActual);
    }
    if (mesSelect) {
      mesSelect.innerHTML = '<option value="all">Todos</option>' + meses.map(m => '<option value="' + m + '">' + (MESES_NOMBRES[m-1] || m) + '</option>').join('');
      if (queryParams?.mes) mesSelect.value = String(queryParams.mes);
    }
    if (provSelect) {
      const provs = provincias.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      provSelect.innerHTML = '<option value="all">Todas</option>' + provs.map(p => '<option value="' + (p.codigo || '') + '">' + (p.nombre || p.codigo || '') + '</option>').join('');
      if (queryParams?.provincia) provSelect.value = String(queryParams.provincia);
    }
    if (artSelect) {
      const arts = materiales.slice().sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''));
      artSelect.innerHTML = '<option value="all">Todos</option>' + arts.map(m => '<option value="' + (m.codigo || '') + '">' + ((m.descripcion || m.codigo || '').slice(0, 50) + (m.descripcion && m.descripcion.length > 50 ? '…' : '')) + '</option>').join('');
      if (queryParams?.articulo) artSelect.value = String(queryParams.articulo);
    }

    function applyFilters() {
      const { anio, mes, prov, art } = buildFilterParams();
      const filtered = filterData(rawData, anio, mes, prov, art);
      const statTotal = document.getElementById('stat-total');
      const statMat = document.getElementById('stat-materiales');
      const statProv = document.getElementById('stat-provincias');
      const statMeses = document.getElementById('stat-meses');
      if (statTotal) statTotal.textContent = (filtered.totalUnidades || 0).toLocaleString('es-ES');
      if (statMat) statMat.textContent = (filtered.materiales || []).length;
      if (statProv) statProv.textContent = (filtered.provincias || []).length;
      if (statMeses) statMeses.textContent = (filtered.meses || []).length;

      const compMes = filtered.comparacionMes || rawData?.comparacionMes;
      const compMesEl = document.getElementById('ventas-comp-mes-value');
      if (compMesEl) compMesEl.textContent = compMes
        ? compMes.mesActual + ': ' + (compMes.totalActual||0).toLocaleString('es-ES') + ' | ' +
          compMes.mesAnterior + ': ' + (compMes.totalAnterior||0).toLocaleString('es-ES') +
          (compMes.variacion != null ? ' (' + (parseFloat(compMes.variacion) >= 0 ? '+' : '') + compMes.variacion + '%)' : '')
        : '—';

      const compAnio = filtered.comparacionAnioAnterior || rawData?.comparacionAnioAnterior;
      const compAnioEl = document.getElementById('ventas-comp-anio-value');
      if (compAnioEl) compAnioEl.textContent = compAnio
        ? compAnio.anioActual + ': ' + (compAnio.totalActual||0).toLocaleString('es-ES') + ' | ' +
          compAnio.anioAnterior + ': ' + (compAnio.totalAnterior||0).toLocaleString('es-ES') +
          (compAnio.variacionPct != null ? ' (' + (parseFloat(compAnio.variacionPct) >= 0 ? '+' : '') + compAnio.variacionPct + '%)' : '')
        : '—';

      const tbodyFilter = document.querySelector('#ventas-detail-table tbody');
      if (tbodyFilter) {
        tbodyFilter.innerHTML = '';
        (filtered.ventas || []).slice(0, 200).forEach(v => {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + (v.materialDescripcion || v.materialCodigo) + '</td><td>' + (v.provinciaNombre || v.provinciaCodigo) + '</td><td>' + (v.mesKey || '') + '</td><td>' + (v.cantidad || 0) + '</td>';
          tbodyFilter.appendChild(tr);
        });
        if ((filtered.ventas || []).length > 200) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="4" style="color:var(--gv-muted);">Mostrando 200 de ' + filtered.ventas.length + ' registros</td>';
          tbodyFilter.appendChild(tr);
        }
      }
      renderCharts(filtered);
      updateUrlFromFiltersAndView();
    }

    const onFilterChange = () => { fetchDataWithFilters(); };
    if (anioSelect) anioSelect.onchange = onFilterChange;
    if (mesSelect) mesSelect.onchange = onFilterChange;
    if (provSelect) provSelect.onchange = onFilterChange;
    if (artSelect) artSelect.onchange = onFilterChange;
    applyFilters();
  }

  const hasData = initialData || (savedFiles && savedFiles.length > 0);
  if (hasData) {
    rawData = initialData || { ventas: [], materiales: [], provincias: [], meses: [], años: [], files: savedFiles || [] };
    renderDashboard(rawData);
    const viewFromUrl = queryParams?.view || 'evolucion-mes';
    if (viewFromUrl && document.querySelector('.ventas-chart-nav__item[data-chart="' + viewFromUrl + '"]')) {
      showChartPanel(viewFromUrl);
    }
  } else {
    rawData = { ventas: [], materiales: [], provincias: [], meses: [], años: [], files: [] };
    renderDashboard(rawData);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ventas-chart-nav__item');
    if (btn) {
      showChartPanel(btn.dataset.chart);
      updateUrlFromFiltersAndView();
    }
  });

  const refreshBtn = document.getElementById('ventas-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      const icon = refreshBtn.querySelector('.ventas-btn-refresh__icon');
      if (icon) icon.classList.add('ventas-spin');
      await fetchDataWithFilters();
      if (icon) icon.classList.remove('ventas-spin');
      refreshBtn.disabled = false;
    });
  }
})();
