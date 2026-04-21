// public/master.js - Versión simplificada (sin editar deuda, sin gestión de propietarios/grupos)
console.log('🖥️ Master UI cargada');

const API_BASE = '/api';

let grupos = [];
let propietarios = [];
let deudasGlobal = [];
let recibos = [];
let grupoSeleccionado = null;
let propiedadSeleccionada = null;
let currentTasaBCV = null;
let currentFechaTasa = null;

// ---------- Función helper para formatear fechas ----------
function formatearFecha(fechaString) {
  if (!fechaString) return '—';
  const fecha = new Date(fechaString);
  return fecha.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

// ---------- Fetch con token y manejo de 403 ----------
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('rol');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada o no autorizado');
    }
    let errorMsg = `Error ${res.status}`;
    try { const errorData = await res.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
    throw new Error(errorMsg);
  }
  return await res.json();
}

// ---------- API ----------
const api = {
  getGrupos: () => fetchAPI('/grupos'),
  getPropietarios: () => fetchAPI('/propietarios'),
  getPropietariosConSaldo: () => fetchAPI('/propietarios/saldo'),
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),
  addRecibo: (recibo) => fetchAPI('/recibos', 'POST', recibo),
  getRecibos: (grupoId) => fetchAPI('/recibos' + (grupoId ? `?grupoId=${grupoId}` : '')),
  getReciboById: (id) => fetchAPI(`/recibos/${id}`),
  addDeuda: (deuda) => fetchAPI('/deudas', 'POST', deuda),
  getDeudasByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/deudas`),
  deleteDeuda: (id) => fetchAPI(`/deudas/${id}`, 'DELETE'),
  getPagosPendientes: () => fetchAPI('/pagos/pendientes'),
  verificarPago: (pagoId) => fetchAPI(`/pagos/${pagoId}/verificar`, 'POST'),
  getTasaBCV: () => fetchAPI('/tasa-bcv')
};

// ========== TASA Y GASTOS ==========
async function obtenerTasaBCV() {
  try {
    const data = await api.getTasaBCV();
    currentTasaBCV = data.tasa;
    currentFechaTasa = data.fecha;
    const tasaInput = document.getElementById('tasaBCV');
    if (tasaInput) {
      tasaInput.value = currentTasaBCV;
      const fechaSpan = document.getElementById('fechaTasa');
      if (fechaSpan) {
        const fecha = new Date(currentFechaTasa);
        fechaSpan.innerText = `Actualizada: ${fecha.toLocaleDateString('es-ES')}`;
      }
    }
    calcularTotalGastos();
    actualizarUSDEnGastosEspecificos();
    recalcularTodo();
    return currentTasaBCV;
  } catch (error) {
    console.error('Error obteniendo tasa BCV:', error);
    alert('No se pudo obtener la tasa BCV automáticamente. Puedes ingresarla manualmente.');
    return null;
  }
}

function actualizarUSDEnGastosEspecificos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) return;
  const rows = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
  rows.forEach(row => {
    const montoVESInput = row.querySelector('.gasto-especifico-monto-ves');
    const usdSpan = row.querySelector('.gasto-especifico-usd');
    if (montoVESInput && usdSpan) {
      const montoVES = parseFloat(montoVESInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
}

function agregarFilaGasto(descripcion = '', montoVES = 0) {
  const container = document.getElementById('gastosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-row';
  row.innerHTML = `
    <input type="text" class="gasto-desc" placeholder="Descripción" value="${escapeHtml(descripcion)}">
    <input type="number" class="gasto-monto" placeholder="Monto VES" step="any" value="${montoVES}">
    <span class="gasto-usd">0.00 USD</span>
    <button type="button" class="btn-eliminar-gasto">✖</button>
  `;
  const eliminarBtn = row.querySelector('.btn-eliminar-gasto');
  if (eliminarBtn) eliminarBtn.addEventListener('click', () => { row.remove(); calcularTotalGastos(); recalcularTodo(); });
  const montoInput = row.querySelector('.gasto-monto');
  if (montoInput) montoInput.addEventListener('input', () => { calcularTotalGastos(); recalcularTodo(); });
  container.appendChild(row);
  calcularTotalGastos();
}

function calcularTotalGastos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) {
    const totalSpan = document.getElementById('totalGastosUSD');
    if (totalSpan) totalSpan.innerText = '0.00';
    return 0;
  }
  let totalUSD = 0;
  const filas = document.querySelectorAll('#gastosContainer .gasto-row');
  filas.forEach(fila => {
    const montoInput = fila.querySelector('.gasto-monto');
    const usdSpan = fila.querySelector('.gasto-usd');
    if (montoInput && usdSpan) {
      const montoVES = parseFloat(montoInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        totalUSD += usd;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
  const totalSpan = document.getElementById('totalGastosUSD');
  if (totalSpan) totalSpan.innerText = totalUSD.toFixed(2);
  return totalUSD;
}

// ========== ALÍCUOTAS ==========
function agregarGrupoAlicuota(grupoId = '', porcentaje = '') {
  const container = document.getElementById('gruposAlicuotasContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'grupo-alicuota-row';
  const select = document.createElement('select');
  select.innerHTML = '<option value="">Seleccione grupo</option>' + grupos.map(g => `<option value="${g.id}" ${grupoId == g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
  select.addEventListener('change', () => { recalcularTodo(); validarSumaAlicuotas(); });
  const inputPorc = document.createElement('input');
  inputPorc.type = 'number';
  inputPorc.step = '0.001';
  inputPorc.placeholder = '%';
  inputPorc.value = porcentaje;
  inputPorc.addEventListener('input', () => { recalcularTodo(); validarSumaAlicuotas(); });
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); validarSumaAlicuotas(); });
  row.appendChild(select);
  row.appendChild(inputPorc);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

function validarSumaAlicuotas() {
  let suma = 0;
  const rows = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
  rows.forEach(row => {
    const input = row.querySelector('input[type="number"]');
    if (input && input.value) suma += parseFloat(input.value) || 0;
  });
  const msgDiv = document.getElementById('sumaAlicuotasMsg');
  if (!msgDiv) return false;
  if (Math.abs(suma - 100) > 0.001) {
    msgDiv.innerHTML = `⚠️ La suma de alícuotas es ${suma.toFixed(3)}%. Debe ser 100% para continuar.`;
    msgDiv.style.color = 'orange';
    return false;
  } else {
    msgDiv.innerHTML = `✅ Suma correcta: 100%`;
    msgDiv.style.color = 'green';
    return true;
  }
}

// ========== GASTOS ESPECÍFICOS ==========
function agregarGastoEspecifico() {
  const container = document.getElementById('gastosEspecificosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-especifico-row';
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.alignItems = 'center';
  row.style.marginBottom = '8px';
  row.style.backgroundColor = '#e9ecef';
  row.style.padding = '8px';
  row.style.borderRadius = '4px';
  row.style.flexWrap = 'wrap';

  const selectTipo = document.createElement('select');
  selectTipo.innerHTML = '<option value="grupo">Afecta a un grupo (reparto equitativo)</option><option value="propietario">Afecta a un propietario específico</option>';
  selectTipo.style.flex = '1';
  const selectDestino = document.createElement('select');
  selectDestino.innerHTML = '<option value="">Seleccione...</option>';
  selectDestino.style.flex = '1';
  const inputDescripcion = document.createElement('input');
  inputDescripcion.type = 'text';
  inputDescripcion.placeholder = 'Descripción del gasto';
  inputDescripcion.style.flex = '1.5';
  const inputMontoVES = document.createElement('input');
  inputMontoVES.type = 'number';
  inputMontoVES.step = 'any';
  inputMontoVES.placeholder = 'Monto VES';
  inputMontoVES.className = 'gasto-especifico-monto-ves';
  inputMontoVES.style.flex = '1';
  const usdSpan = document.createElement('span');
  usdSpan.className = 'gasto-especifico-usd';
  usdSpan.innerText = '0.00 USD';
  usdSpan.style.flex = '0.8';
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.style.padding = '5px 10px';

  async function cargarDestinos() {
    if (selectTipo.value === 'grupo') {
      const gruposList = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' + gruposList.map(g => `<option value="grupo_${g.id}">${g.nombre}</option>`).join('');
    } else {
      const props = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' + props.map(p => `<option value="prop_${p.id}">${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }

  function actualizarUSD() {
    if (!currentTasaBCV || currentTasaBCV <= 0) return;
    const montoVES = parseFloat(inputMontoVES.value);
    if (!isNaN(montoVES) && montoVES > 0) {
      const usd = montoVES / currentTasaBCV;
      usdSpan.innerText = usd.toFixed(2) + ' USD';
    } else {
      usdSpan.innerText = '0.00 USD';
    }
  }

  selectTipo.addEventListener('change', cargarDestinos);
  cargarDestinos();
  inputMontoVES.addEventListener('input', () => {
    actualizarUSD();
    recalcularTodo();
  });
  inputDescripcion.addEventListener('input', () => recalcularTodo());
  selectDestino.addEventListener('change', () => recalcularTodo());
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); });

  row.appendChild(selectTipo);
  row.appendChild(selectDestino);
  row.appendChild(inputDescripcion);
  row.appendChild(inputMontoVES);
  row.appendChild(usdSpan);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ========== CÁLCULO FINAL POR PROPIETARIO ==========
async function recalcularTodo() {
  const totalGastosGeneralesUSD = parseFloat(document.getElementById('totalGastosUSD')?.innerText) || 0;
  if (totalGastosGeneralesUSD === 0) return;

  const alicuotasGrupo = [];
  const rowsGrupo = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
  for (const row of rowsGrupo) {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select && select.value && input && input.value) {
      alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
    }
  }
  if (!validarSumaAlicuotas()) return;

  const gastosEsp = [];
  const rowsEsp = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
  for (const row of rowsEsp) {
    const tipo = row.querySelector('select:first-child')?.value;
    const destinoSelect = row.querySelector('select:nth-child(2)');
    const descripcion = row.querySelector('input[type="text"]')?.value;
    const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
    if (destinoSelect && destinoSelect.value && !isNaN(montoVES) && montoVES > 0 && currentTasaBCV > 0) {
      const [tipoDest, id] = destinoSelect.value.split('_');
      const montoUSD = montoVES / currentTasaBCV;
      gastosEsp.push({ tipo: tipoDest, id: parseInt(id), monto: montoUSD, descripcion: descripcion || 'Gasto específico' });
    }
  }

  const todosPropietarios = await api.getPropietarios();
  const propietariosPorGrupo = {};
  todosPropietarios.forEach(p => {
    if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
    propietariosPorGrupo[p.grupo_id].push(p);
  });

  const montoPorPropietario = new Map();
  for (const ag of alicuotasGrupo) {
    const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
    const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
    if (propietariosDelGrupo.length === 0) continue;
    const montoPorProp = montoGrupo / propietariosDelGrupo.length;
    propietariosDelGrupo.forEach(p => {
      if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(p.id).base += montoPorProp;
    });
  }
  for (const ge of gastosEsp) {
    if (ge.tipo === 'grupo') {
      const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
        montoPorPropietario.get(p.id).adicional += montoAdicionalPorProp;
      });
    } else if (ge.tipo === 'prop') {
      if (!montoPorPropietario.has(ge.id)) montoPorPropietario.set(ge.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(ge.id).adicional += ge.monto;
    }
  }

  const tbody = document.querySelector('#tablaResumenPropietarios tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const [propId, montos] of montoPorPropietario.entries()) {
    const prop = todosPropietarios.find(p => p.id === propId);
    if (!prop) continue;
    const grupoNombre = grupos.find(g => g.id === prop.grupo_id)?.nombre || 'Sin grupo';
    const total = montos.base + montos.adicional;
    const row = tbody.insertRow();
    row.insertCell(0).innerText = prop.nombre;
    row.insertCell(1).innerText = prop.apartamento;
    row.insertCell(2).innerText = grupoNombre;
    row.insertCell(3).innerText = montos.base.toFixed(2);
    row.insertCell(4).innerText = montos.adicional.toFixed(2);
    row.insertCell(5).innerText = total.toFixed(2);
  }
}

// ========== ENVÍO DEL RECIBO ==========
let isSubmitting = false;
document.getElementById('formRecibo')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (isSubmitting) {
    alert('Ya se está procesando el recibo. Por favor espera.');
    return;
  }

  const submitBtn = document.querySelector('#formRecibo button[type="submit"]');
  const originalText = submitBtn?.textContent || 'Crear Recibo y Deudas';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Procesando...';
  }
  isSubmitting = true;

  try {
    const periodo = document.getElementById('periodoRecibo')?.value;
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      alert('Período inválido (MM/AAAA)');
      return;
    }
    const tasaInput = document.getElementById('tasaBCV');
    if (tasaInput) {
      currentTasaBCV = parseFloat(tasaInput.value);
      if (isNaN(currentTasaBCV) || currentTasaBCV <= 0) {
        alert('Ingrese una tasa BCV válida (positiva)');
        return;
      }
    } else {
      if (!currentTasaBCV || currentTasaBCV <= 0) {
        alert('Obtenga o ingrese la tasa BCV primero');
        return;
      }
    }

    const gastos = [];
    const filasGastos = document.querySelectorAll('#gastosContainer .gasto-row');
    for (let f of filasGastos) {
      const desc = f.querySelector('.gasto-desc')?.value;
      const montoVES = parseFloat(f.querySelector('.gasto-monto')?.value);
      if (desc && !isNaN(montoVES) && montoVES > 0) {
        gastos.push({
          descripcion: desc,
          monto_ves: montoVES,
          monto_usd: montoVES / currentTasaBCV
        });
      }
    }
    if (gastos.length === 0) {
      alert('Agregue al menos un gasto general');
      return;
    }
    const totalGastosGeneralesUSD = gastos.reduce((s, g) => s + g.monto_usd, 0);

    const alicuotasGrupo = [];
    const rowsGrupo = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
    for (const row of rowsGrupo) {
      const select = row.querySelector('select');
      const input = row.querySelector('input[type="number"]');
      if (select?.value && input?.value) {
        alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
      }
    }
    if (!validarSumaAlicuotas()) {
      alert('La suma de alícuotas debe ser 100%');
      return;
    }

    const gastosEspecificos = [];
    const rowsEsp = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
    const gruposEnAlicuota = new Set(alicuotasGrupo.map(ag => ag.grupoId));
    for (const row of rowsEsp) {
      const tipo = row.querySelector('select:first-child')?.value;
      const destinoSelect = row.querySelector('select:nth-child(2)');
      const descripcion = row.querySelector('input[type="text"]')?.value;
      const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
      if (destinoSelect?.value && !isNaN(montoVES) && montoVES > 0) {
        const [tipoDest, id] = destinoSelect.value.split('_');
        if (tipoDest === 'grupo') {
          const grupoId = parseInt(id);
          if (!gruposEnAlicuota.has(grupoId)) {
            alert(`Error: El grupo "${destinoSelect.options[destinoSelect.selectedIndex]?.text}" no está en la lista de alícuotas.`);
            return;
          }
        }
        const montoUSD = montoVES / currentTasaBCV;
        gastosEspecificos.push({
          tipo: tipoDest,
          id: parseInt(id),
          monto: montoUSD,
          descripcion: descripcion || 'Gasto específico'
        });
      }
    }
    const totalGastosEspecificosUSD = gastosEspecificos.reduce((sum, ge) => sum + ge.monto, 0);
    const totalGastosUSD = totalGastosGeneralesUSD + totalGastosEspecificosUSD;

    const todosPropietarios = await api.getPropietarios();
    const propietariosPorGrupo = {};
    todosPropietarios.forEach(p => {
      if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
      propietariosPorGrupo[p.grupo_id].push(p);
    });
    const montoPorPropietario = new Map();

    for (const ag of alicuotasGrupo) {
      const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
      const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoPorProp = montoGrupo / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoPorProp);
      });
    }
    for (const ge of gastosEspecificos) {
      if (ge.tipo === 'grupo') {
        const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
        if (propietariosDelGrupo.length === 0) continue;
        const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
        propietariosDelGrupo.forEach(p => {
          montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoAdicionalPorProp);
        });
      } else if (ge.tipo === 'prop') {
        montoPorPropietario.set(ge.id, (montoPorPropietario.get(ge.id) || 0) + ge.monto);
      }
    }

    const propietariosList = Array.from(montoPorPropietario.entries());
    const umbral = 0.95;
    let error = false;
    for (let [propId, monto] of propietariosList) {
      if (propietariosList.length > 1 && monto >= totalGastosUSD * umbral) {
        const prop = todosPropietarios.find(p => p.id === propId);
        alert(`Error: El propietario ${prop?.nombre} (${prop?.apartamento}) recibiría ${(monto/totalGastosUSD*100).toFixed(1)}% del total. Revise gastos específicos.`);
        error = true;
      }
    }
    if (error) return;

    let reciboId = null;
    const reciboData = {
      periodo,
      monto_usd: totalGastosUSD,
      gastos_generales: JSON.stringify(gastos),
      alicuotas_grupo: JSON.stringify(alicuotasGrupo),
      gastos_especificos: JSON.stringify(gastosEspecificos),
      tasa_bcv: currentTasaBCV,
      fecha_tasa: currentFechaTasa || new Date().toISOString()
    };
    const reciboCreado = await api.addRecibo(reciboData);
    reciboId = reciboCreado.id;
    if (!reciboId) throw new Error('No se obtuvo ID del recibo');
    console.log('Recibo resumen creado con ID:', reciboId);

    let deudasCreadas = 0;
    for (let [propId, monto] of montoPorPropietario.entries()) {
      if (monto <= 0) continue;
      const montoRedondeado = Math.round(monto * 100) / 100;
      await api.addDeuda({
        propietario_id: propId,
        periodo,
        monto_usd: montoRedondeado,
        fecha_vencimiento: null,
        recibo_id: reciboId,
        porcentaje_alicuota: (montoRedondeado / totalGastosUSD) * 100
      });
      deudasCreadas++;
    }

    alert(`✅ Recibo creado. Se generaron ${deudasCreadas} deudas.`);
    const modal = document.getElementById('modalRecibo');
    if (modal) modal.style.display = 'none';
    cargarRecibos();
    if (propiedadSeleccionada) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
    cargarPagosPendientes();
  } catch (err) {
    console.error('Error al crear recibo:', err);
    alert('Error al crear el recibo: ' + err.message);
  } finally {
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
});

// ========== BOTÓN AGREGAR RECIBO Y CONFIGURACIÓN DEL MODAL ==========
const btnAgregarRecibo = document.getElementById('btnAgregarRecibo');
if (btnAgregarRecibo) {
  btnAgregarRecibo.addEventListener('click', async () => {
    console.log('Botón Agregar Recibo clickeado');
    const safeClear = (id) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.value = '';
        else el.innerHTML = '';
      }
    };
    safeClear('periodoRecibo');
    const gastosContainer = document.getElementById('gastosContainer');
    if (gastosContainer) gastosContainer.innerHTML = '';
    const gruposAlicContainer = document.getElementById('gruposAlicuotasContainer');
    if (gruposAlicContainer) gruposAlicContainer.innerHTML = '';
    const gastosEspContainer = document.getElementById('gastosEspecificosContainer');
    if (gastosEspContainer) gastosEspContainer.innerHTML = '';
    const resumenTbody = document.querySelector('#tablaResumenPropietarios tbody');
    if (resumenTbody) resumenTbody.innerHTML = '';
    agregarFilaGasto();
    try { grupos = await api.getGrupos(); } catch (err) { console.error(err); }
    try {
      if (!currentTasaBCV) await obtenerTasaBCV();
      else {
        const tasaInput = document.getElementById('tasaBCV');
        if (tasaInput) tasaInput.value = currentTasaBCV;
        const fechaSpan = document.getElementById('fechaTasa');
        if (fechaSpan && currentFechaTasa) {
          const fecha = new Date(currentFechaTasa);
          fechaSpan.innerText = `Actualizada: ${fecha.toLocaleDateString('es-ES')}`;
        }
      }
    } catch (err) { console.error(err); }
    const modal = document.getElementById('modalRecibo');
    if (modal) modal.style.display = 'block';
    else alert('Error: no se encontró el modal de recibo');
  });
} else {
  console.error('Botón btnAgregarRecibo no encontrado');
}

// ========== EVENTOS DEL MODAL RECIBO ==========
document.getElementById('btnActualizarTasa')?.addEventListener('click', () => obtenerTasaBCV());
document.getElementById('btnAgregarGasto')?.addEventListener('click', () => agregarFilaGasto());
document.getElementById('btnAgregarGrupoAlicuota')?.addEventListener('click', () => agregarGrupoAlicuota());
document.getElementById('btnAgregarGastoEspecifico')?.addEventListener('click', () => agregarGastoEspecifico());

const modalRecibo = document.getElementById('modalRecibo');
const closeBtn = modalRecibo?.querySelector('.close');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    modalRecibo.style.display = 'none';
  });
}
window.addEventListener('click', (e) => {
  if (e.target === modalRecibo) {
    modalRecibo.style.display = 'none';
  }
});

document.addEventListener('change', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer')) recalcularTodo();
});
document.addEventListener('input', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer')) recalcularTodo();
  if (e.target.id === 'tasaBCV') {
    const nuevaTasa = parseFloat(e.target.value);
    if (!isNaN(nuevaTasa) && nuevaTasa > 0) {
      currentTasaBCV = nuevaTasa;
      calcularTotalGastos();
      actualizarUSDEnGastosEspecificos();
      recalcularTodo();
    }
  }
});

// ========== MODAL VER RECIBO ==========
let modalVerRecibo = null;

function crearModalVerRecibo() {
  if (modalVerRecibo) return;
  modalVerRecibo = document.createElement('div');
  modalVerRecibo.id = 'modalVerRecibo';
  modalVerRecibo.className = 'modal';
  modalVerRecibo.innerHTML = `
    <div class="modal-content" style="width: 700px; max-width: 95%;">
      <span class="close">&times;</span>
      <h3>Detalles del Recibo</h3>
      <div id="verReciboContent" style="max-height: 70vh; overflow-y: auto;"></div>
      <div style="margin-top: 15px; text-align: center;">
        <button id="btnImprimirRecibo" style="background-color: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">🖨️ Imprimir / Guardar PDF</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalVerRecibo);

  const closeSpan = modalVerRecibo.querySelector('.close');
  closeSpan.addEventListener('click', () => modalVerRecibo.style.display = 'none');
  window.addEventListener('click', (e) => {
    if (e.target === modalVerRecibo) modalVerRecibo.style.display = 'none';
  });

  const btnImprimir = document.getElementById('btnImprimirRecibo');
  if (btnImprimir) {
    btnImprimir.addEventListener('click', () => {
      const contenido = document.getElementById('verReciboContent').innerHTML;
      const titulo = 'Detalles del Recibo';
      const ventana = window.open('', '_blank', 'width=800,height=600,toolbar=yes,scrollbars=yes');
      ventana.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${titulo}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
            .detalle-container { max-width: 800px; margin: auto; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            h4 { margin-top: 20px; }
            @media print {
              body { margin: 0; padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="detalle-container">
            <h3>${titulo}</h3>
            ${contenido}
            <p style="text-align: center; margin-top: 30px; font-size: 12px; color: gray;">Documento generado automáticamente - ${new Date().toLocaleString()}</p>
          </div>
          <script>
            window.onload = function() { window.print(); setTimeout(() => window.close(), 500); };
          <\/script>
        </body>
        </html>
      `);
      ventana.document.close();
    });
  }
}

async function verRecibo(reciboId) {
  try {
    crearModalVerRecibo();
    const recibo = await api.getReciboById(reciboId);
    if (!recibo) throw new Error('No se pudo obtener el recibo');

    let totalGastosGenerales = 0;
    if (recibo.gastos_generales && recibo.gastos_generales.length) {
      totalGastosGenerales = recibo.gastos_generales.reduce((sum, g) => sum + (g.monto_usd || 0), 0);
    }
    const totalConEspecificos = recibo.monto_usd || 0;

    const especificosPorGrupo = new Map();
    if (recibo.gastos_especificos && recibo.gastos_especificos.length) {
      recibo.gastos_especificos.forEach(ge => {
        if (ge.tipo === 'grupo') {
          const grupoId = ge.id;
          const monto = ge.monto || 0;
          especificosPorGrupo.set(grupoId, (especificosPorGrupo.get(grupoId) || 0) + monto);
        }
      });
    }

    let html = `<p><strong>Período:</strong> ${recibo.periodo}</p>`;
    html += `<p><strong>Total gastos generales del condominio:</strong> $${totalGastosGenerales.toFixed(2)}</p>`;
    if (totalConEspecificos > totalGastosGenerales) {
      html += `<p><strong>Total con gastos específicos adicionales:</strong> $${totalConEspecificos.toFixed(2)}</p>`;
    }

    html += `<h4>📋 Gastos generales del condominio:</h4>`;
    if (recibo.gastos_generales && recibo.gastos_generales.length) {
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;"><th>Descripción</th><th>Monto (Bs)</th><th>Monto (USD)</th></tr></thead>
        <tbody>`;
      recibo.gastos_generales.forEach(g => {
        html += `<tr>
          <td>${g.descripcion}</td>
          <td>${(g.monto_ves || 0).toFixed(2)} Bs</td>
          <td>$${(g.monto_usd || 0).toFixed(2)}</td>
        </tr>`;
      });
      html += `</tbody>}</table>`;
    } else {
      html += `<p>No hay desglose de gastos generales disponible.</p>`;
    }

    if (recibo.gastos_especificos && recibo.gastos_especificos.length) {
      html += `<h4>🎯 Gastos específicos adicionales:</h4>`;
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;">
          <th>Descripción</th>
          <th>Afecta a</th>
          <th>Monto (USD)</th>
          <th>Monto (Bs)*</th>
        </tr></thead>
        <tbody>`;
      recibo.gastos_especificos.forEach(ge => {
        let destino = '';
        if (ge.tipo === 'grupo') {
          const grupo = grupos.find(g => g.id === ge.id);
          destino = grupo ? `Grupo ${grupo.nombre}` : `Grupo ID ${ge.id}`;
        } else {
          destino = `Propietario ID ${ge.id}`;
        }
        const montoUSD = ge.monto || 0;
        const tasa = recibo.tasa_bcv || 1;
        const montoBs = montoUSD * tasa;
        const descripcion = ge.descripcion || '—';
        html += `<tr>
          <td>${descripcion}</td>
          <td>${destino}</td>
          <td>$${montoUSD.toFixed(2)}</td>
          <td>${montoBs.toFixed(2)} Bs</td>
        </tr>`;
      });
      html += `</tbody>}</table>`;
      html += `<p><small>* Monto en bolívares calculado usando la tasa BCV del momento del recibo (${recibo.tasa_bcv?.toFixed(2) || 'N/A'} Bs/USD).</small></p>`;
    }

    html += `<h4>🏢 Distribución por grupos (alícuotas):</h4>`;
    if (recibo.alicuotas_grupo && recibo.alicuotas_grupo.length) {
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;">
          <th>Grupo</th>
          <th>Porcentaje</th>
          <th>Monto base</th>
          <th>Gastos específicos</th>
          <th>Monto total del grupo</th>
        </tr></thead>
        <tbody>`;
      recibo.alicuotas_grupo.forEach(ag => {
        const grupo = grupos.find(g => g.id === ag.grupoId);
        const nombreGrupo = grupo ? grupo.nombre : `Grupo ${ag.grupoId}`;
        const montoBase = totalGastosGenerales * (ag.porcentaje / 100);
        const especificos = especificosPorGrupo.get(ag.grupoId) || 0;
        const totalGrupo = montoBase + especificos;
        html += `<tr>
          <td>${nombreGrupo}</td>
          <td>${ag.porcentaje.toFixed(3)}%</td>
          <td>$${montoBase.toFixed(2)}</td>
          <td>$${especificos.toFixed(2)}</td>
          <td><strong>$${totalGrupo.toFixed(2)}</strong></td>
        </tr>`;
      });
      html += `</tbody>}</table>`;
    } else {
      html += `<p>No hay distribución por grupos.</p>`;
    }

    const contentDiv = document.getElementById('verReciboContent');
    if (contentDiv) {
      contentDiv.innerHTML = html;
    } else {
      console.error('No se encontró el elemento verReciboContent');
      alert('Error al mostrar el detalle del recibo. Intente recargar la página.');
      return;
    }
    modalVerRecibo.style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('Error al cargar detalle del recibo: ' + err.message);
  }
}

async function cargarRecibos() {
  const tbody = document.querySelector('#tablaRecibos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="4">Cargando...</td>';
  try {
    recibos = await api.getRecibos();
    tbody.innerHTML = '';
    for (const r of recibos) {
      const grupo = grupos.find(g => g.id === r.grupo_id);
      const grupoNombre = grupo ? grupo.nombre : 'Todos';
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${r.periodo}</td>
          <td>$${r.monto_usd.toFixed(2)}</td>
          <td>${grupoNombre}</td>
          <td><button onclick="verRecibo(${r.id})" style="background-color:#17a2b8;">Ver Recibo</button></td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="4">Error: ${err.message}</td>`;
  }
}

window.verRecibo = verRecibo;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ========== DEUDAS POR PROPIEDAD ==========
async function cargarGruposParaDeudas() {
  const container = document.getElementById('gruposContainer');
  if (!container) return;
  try {
    const gruposList = await api.getGrupos();
    grupos = gruposList;
    container.innerHTML = '';

    const sinGrupoTab = document.createElement('div');
    sinGrupoTab.className = 'group-tab';
    sinGrupoTab.style.backgroundColor = (grupoSeleccionado === null) ? '#007bff' : '#6c757d';
    const sinGrupoBtn = document.createElement('button');
    sinGrupoBtn.textContent = 'Sin grupo';
    sinGrupoBtn.style.backgroundColor = 'transparent';
    sinGrupoBtn.addEventListener('click', () => seleccionarGrupoDeuda(null));
    sinGrupoTab.appendChild(sinGrupoBtn);
    container.appendChild(sinGrupoTab);

    for (const g of gruposList) {
      const tabDiv = document.createElement('div');
      tabDiv.className = 'group-tab';
      tabDiv.style.backgroundColor = (grupoSeleccionado === g.id) ? '#007bff' : '#6c757d';
      const btn = document.createElement('button');
      btn.textContent = g.nombre;
      btn.style.backgroundColor = 'transparent';
      btn.addEventListener('click', () => seleccionarGrupoDeuda(g.id));
      tabDiv.appendChild(btn);
      container.appendChild(tabDiv);
    }
    if (!grupoSeleccionado && (gruposList.length > 0 || true)) {
      seleccionarGrupoDeuda(null);
    }
  } catch (err) {
    console.error(err);
  }
}

async function seleccionarGrupoDeuda(grupoId) {
  grupoSeleccionado = grupoId;
  const tabs = document.querySelectorAll('#gruposContainer .group-tab');
  const gruposList = await api.getGrupos();
  tabs.forEach(tab => {
    const btn = tab.querySelector('button');
    const isSinGrupo = btn.textContent === 'Sin grupo';
    if (isSinGrupo && grupoId === null) {
      tab.style.backgroundColor = '#007bff';
    } else if (!isSinGrupo) {
      const g = gruposList.find(g => g.nombre === btn.textContent);
      if (g && g.id === grupoId) {
        tab.style.backgroundColor = '#007bff';
      } else {
        tab.style.backgroundColor = '#6c757d';
      }
    } else {
      tab.style.backgroundColor = '#6c757d';
    }
  });
  await cargarPropiedadesDeuda(grupoId);
}

async function cargarPropiedadesDeuda(grupoId) {
  const container = document.getElementById('propiedadesContainer');
  if (!container) return;
  container.innerHTML = '';
  try {
    const props = await api.getPropietarios();
    propietarios = props;
    let propsGrupo;
    if (grupoId === null) {
      propsGrupo = props.filter(p => p.grupo_id === null);
    } else {
      propsGrupo = props.filter(p => p.grupo_id === grupoId);
    }
    if (propsGrupo.length === 0) {
      container.innerHTML = '<p>No hay propiedades en este grupo.</p>';
      document.getElementById('deudasTableContainer').style.display = 'none';
      return;
    }
    for (let i = 0; i < propsGrupo.length; i += 4) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '5px';
      row.style.marginBottom = '5px';
      row.style.flexWrap = 'wrap';
      for (let j = i; j < Math.min(i+4, propsGrupo.length); j++) {
        const prop = propsGrupo[j];
        const btn = document.createElement('button');
        btn.textContent = prop.apartamento;
        btn.style.backgroundColor = '#6c757d';
        btn.style.padding = '5px 10px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => seleccionarPropiedadDeuda(prop.id));
        row.appendChild(btn);
      }
      container.appendChild(row);
    }
    if (propiedadSeleccionada && propsGrupo.some(p => p.id === propiedadSeleccionada)) {
      const selectedProp = propsGrupo.find(p => p.id === propiedadSeleccionada);
      document.querySelectorAll('#propiedadesContainer button').forEach(btn => {
        if (btn.textContent === selectedProp.apartamento) btn.style.backgroundColor = '#007bff';
      });
    } else if (propsGrupo.length > 0) {
      seleccionarPropiedadDeuda(propsGrupo[0].id);
    }
  } catch (err) {
    console.error(err);
  }
}

async function actualizarSaldoPropietario(propietarioId) {
  try {
    const prop = await api.getPropietarioById(propietarioId);
    if (!prop) return;
    const deudas = await api.getDeudasByPropietario(propietarioId);
    const totalDeudas = deudas.reduce((sum, d) => sum + (d.pagado ? 0 : d.monto_usd), 0);
    const saldoNeto = (prop.saldo_favor || 0) - totalDeudas;
    const esSaldoAFavor = saldoNeto >= 0;
    const saldoTexto = esSaldoAFavor ? `$${saldoNeto.toFixed(2)} (Saldo a favor)` : `-$${Math.abs(saldoNeto).toFixed(2)} (Deuda pendiente)`;
    const saldoElement = document.getElementById('saldoNetoPropiedad');
    if (saldoElement) {
      saldoElement.textContent = saldoTexto;
      saldoElement.style.color = esSaldoAFavor ? 'green' : 'red';
    }
  } catch (err) {
    console.error('Error al obtener saldo de la propiedad:', err);
  }
}

async function seleccionarPropiedadDeuda(propId) {
  propiedadSeleccionada = propId;
  const btns = document.querySelectorAll('#propiedadesContainer button');
  const prop = propietarios.find(p => p.id === propId);
  if (!prop) return;
  btns.forEach(btn => {
    if (btn.textContent === prop.apartamento) btn.style.backgroundColor = '#007bff';
    else btn.style.backgroundColor = '#6c757d';
  });
  await cargarDeudas(propId);
  await actualizarSaldoPropietario(propId);
  document.getElementById('deudasTableContainer').style.display = 'block';
}

async function cargarDeudas(propietarioId) {
  const tbody = document.querySelector('#tablaDeudas tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...</td>';
  try {
    const deudas = await api.getDeudasByPropietario(propietarioId);
    deudasGlobal = deudas;
    tbody.innerHTML = '';
    if (deudas.length === 0) {
      tbody.innerHTML = '<td colspan="6">No hay deudas registradas para esta propiedad.</td>';
      return;
    }
    for (const d of deudas) {
      const isPaid = d.pagado === 1;
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${d.periodo}</td>
          <td>$${d.monto_usd.toFixed(2)}</td>
          <td>${formatearFecha(d.fecha_vencimiento)}</td>
          <td class="${isPaid ? 'verificado' : 'pendiente'}">${isPaid ? 'Pagada' : 'Pendiente'}</td>
          <td>${formatearFecha(d.fecha_pago)}</td>
          <td>${d.referencia_pago || '—'}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="6">Error: ${err.message}</td>`;
  }
}

// Modal de deuda (solo agregar)
const modalDeuda = document.getElementById('modalDeuda');
const btnAgregarDeuda = document.getElementById('btnAgregarDeuda');
const spanCloseDeuda = document.querySelector('#modalDeuda .close');
const formDeuda = document.getElementById('formDeuda');
const propietarioSelect = document.getElementById('propietarioSelect');

btnAgregarDeuda.addEventListener('click', async () => {
  if (!propiedadSeleccionada) {
    alert('Primero selecciona una propiedad');
    return;
  }
  const props = await api.getPropietarios();
  propietarioSelect.innerHTML = '<option value="">Seleccionar</option>' +
    props.map(p => `<option value="${p.id}" ${p.id === propiedadSeleccionada ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');
  document.getElementById('periodo').value = '';
  document.getElementById('montoUSD').value = '';
  document.getElementById('fechaVencimiento').value = '';
  document.getElementById('modalDeudaTitulo').textContent = 'Agregar Deuda';
  modalDeuda.style.display = 'block';
});

spanCloseDeuda.addEventListener('click', () => modalDeuda.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalDeuda) modalDeuda.style.display = 'none';
});

formDeuda.addEventListener('submit', async (e) => {
  e.preventDefault();
  const propietario_id = parseInt(propietarioSelect.value);
  const periodo = document.getElementById('periodo').value;
  const monto_usd = parseFloat(document.getElementById('montoUSD').value);
  const fecha_vencimiento = document.getElementById('fechaVencimiento').value || null;

  if (!propietario_id || !periodo || isNaN(monto_usd) || monto_usd <= 0) {
    alert('Propietario, período y monto válido son obligatorios');
    return;
  }

  try {
    await api.addDeuda({ propietario_id, periodo, monto_usd, fecha_vencimiento });
    modalDeuda.style.display = 'none';
    if (propiedadSeleccionada === propietario_id) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
  } catch (err) {
    alert('Error al guardar deuda: ' + err.message);
  }
});

// Pagos pendientes
async function cargarPagosPendientes() {
  const tbody = document.querySelector('#tablaPagos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...</td>';
  try {
    const pagos = await api.getPagosPendientes();
    tbody.innerHTML = '';
    pagos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${p.propietario_nombre} (${p.apartamento})</td>
          <td>${formatearFecha(p.fecha_pago)}</td>
          <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
          <td>${p.referencia || '—'}</td>
          <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
          <td><button class="btn-verificar" onclick="verificarPago(${p.id})">Verificar</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="6">Error: ${err.message}</td>`;
  }
}

window.verificarPago = async (pagoId) => {
  try {
    await api.verificarPago(pagoId);
    alert('Pago verificado correctamente');
    cargarPagosPendientes();
    if (propiedadSeleccionada) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
  } catch (err) {
    alert('Error al verificar: ' + err.message);
  }
};

// Logout
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('rol');
  window.location.href = '/login.html';
});

// ---------- INICIALIZACIÓN ----------
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  const rol = localStorage.getItem('rol');

  if (!token || rol !== 'master') {
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    window.location.href = '/login.html';
    return;
  }

  try {
    await api.getGrupos(); // verifica autenticación
  } catch (err) {
    console.error('Error al verificar autenticación:', err);
    return;
  }

  await cargarGruposParaDeudas();
  await cargarRecibos();
  cargarPagosPendientes();
  obtenerTasaBCV();
});