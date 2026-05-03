// ================================================
// DROC VISITA — app.js v2
// Bloque 4a: lista + checklist + fotos + guardar
// ================================================

// ---- CONFIGURACIÓN ----
// IMPORTANTE: sustituye por tu URL de Apps Script al desplegar
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxLzzpp5K4FSS61fNveEFQURsp0_pcTwk4DMsVgXD3iVds2H8JLWwQsUp1hlUalMI-X/exec';

// Tamaño máximo del lado largo de las fotos (px) al redimensionar
const FOTO_MAX_LADO = 1600;
const FOTO_CALIDAD = 0.85;

// ---- ESTADO GLOBAL ----
let visitas = [];
let visitaActual = null;   // objeto con todos los datos del expediente
let checkItems = [];       // [{label, marcado: true|false}]
let fotosGeneral = [];     // [{dataUrl, nombre, mime}]
let planoFile = null;      // {dataUrl, nombre, mime, esPDF}
let alcantFotos = [];      // [{dataUrl, nombre, mime}]

// ======================================================
// LOGIN (simplificado: sin selección de técnico)
// ======================================================
function entrar() {
  mostrarScreen('screen-lista');
  cargarVisitas();
}

function cerrarSesion() {
  mostrarScreen('screen-login');
}

// ======================================================
// NAVEGACIÓN
// ======================================================
function mostrarScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  target.classList.add('active');
  setTimeout(() => { target.scrollTop = 0; }, 0);
}

function volverLista() {
  const hayDatos = fotosGeneral.length > 0 || alcantFotos.length > 0 || planoFile !== null
                   || (document.getElementById('txt-observaciones').value.trim() !== '')
                   || checkItems.some(c => c.marcado);
  if (hayDatos && !confirm('¿Volver a la lista? Los datos no guardados se perderán.')) return;
  resetVisita();
  mostrarScreen('screen-lista');
}

function resetVisita() {
  visitaActual = null;
  checkItems = [];
  fotosGeneral = [];
  planoFile = null;
  alcantFotos = [];
}

// ======================================================
// UTILIDAD: ESCAPAR HTML
// ======================================================
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ======================================================
// CARGAR VISITAS DESDE APPS SCRIPT
// ======================================================
async function cargarVisitas() {
  const cont = document.getElementById('lista-visitas');
  const sinVis = document.getElementById('sin-visitas');
  cont.innerHTML = '<div class="loading-msg">Cargando visitas...</div>';
  sinVis.style.display = 'none';

  try {
    // Usamos JSONP en lugar de fetch para evitar problemas CORS con Apps Script
    const data = await fetchJSONP(`${APPS_SCRIPT_URL}?action=getVisitas`, 20000);

    if (data.ok && data.visitas && data.visitas.length > 0) {
      visitas = data.visitas;
      renderLista();
    } else if (data.ok) {
      visitas = [];
      cont.innerHTML = '';
      sinVis.style.display = 'flex';
    } else {
      throw new Error(data.error || 'Respuesta inválida del servidor');
    }
  } catch (e) {
    cont.innerHTML = `<div class="loading-msg" style="color:var(--danger)">Error al cargar: ${esc(e.message)}<br><br><button class="btn-primary" onclick="cargarVisitas()" style="max-width:200px;margin:auto">Reintentar</button></div>`;
  }
}

function renderLista() {
  const cont = document.getElementById('lista-visitas');
  cont.innerHTML = '';
  visitas.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'card-visita';
    card.innerHTML = `
      <div class="card-vis-cliente">${esc(v.cliente) || '—'}</div>
      <div class="card-vis-dir">${esc(v.direccion) || '—'}</div>
      <div class="card-vis-meta">
        <span class="tag tag-mun">${esc(v.municipio) || '—'}</span>
        <span class="tag tag-exp">Exp. ${esc(v.numExp) || '—'}</span>
        ${v.refCatastral ? `<span class="tag">${esc(v.refCatastral)}</span>` : ''}
      </div>
    `;
    card.onclick = () => abrirVisita(i);
    cont.appendChild(card);
  });
}

// ======================================================
// ABRIR VISITA
// ======================================================
function abrirVisita(idx) {
  visitaActual = visitas[idx];
  resetDatosVisita();
  rellenarCabecera();
  construirChecklist();
  configurarFlags();
  mostrarScreen('screen-visita');
  // Inicializar canvas firma cuando ya está visible (necesita medir tamaño real)
  setTimeout(() => inicializarFirma(), 100);
}

function resetDatosVisita() {
  fotosGeneral = [];
  planoFile = null;
  alcantFotos = [];
  document.getElementById('grid-fotos').innerHTML = '';
  document.getElementById('count-fotos').textContent = '0/10';
  document.getElementById('plano-preview').innerHTML = '';
  document.getElementById('grid-alcant').innerHTML = '';
  document.getElementById('txt-observaciones').value = '';
  document.getElementById('msg-error').style.display = 'none';
  document.getElementById('btn-add-foto').style.display = '';
  // Reset dictado por voz si estaba activo
  if (isRecording) pararDictado();
  document.getElementById('mic-status').style.display = 'none';
  document.getElementById('btn-mic').classList.remove('recording');
  // Reset firma
  firmaTienenTrazo = false;
  const placeholder = document.getElementById('firma-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
  // El canvas se limpia al inicializar de nuevo
}

function rellenarCabecera() {
  const v = visitaActual;
  document.getElementById('vis-cliente').textContent = v.cliente || '—';
  document.getElementById('vis-direccion').textContent = v.direccion || '—';
  document.getElementById('vis-municipio').textContent = v.municipio || '—';
  document.getElementById('vis-catastral').textContent = v.refCatastral || '—';
  document.getElementById('vis-sup').textContent = v.supUtil ? `${v.supUtil} m²` : '—';
  document.getElementById('vis-anyo').textContent = v.anyoConstruccion || '—';
  document.getElementById('vis-exp').textContent = v.numExp || '—';
}

// ======================================================
// CHECKLIST (un solo estado: marcado/no marcado)
// ======================================================
function construirChecklist() {
  const raw = visitaActual.checklist || '';
  const items = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

  checkItems = items.map(label => ({ label, marcado: false }));

  const cont = document.getElementById('checklist-items');
  cont.innerHTML = '';

  if (checkItems.length === 0) {
    cont.innerHTML = '<p style="color:var(--text-sub);font-size:13px">Sin checklist configurado para este municipio.</p>';
    return;
  }

  checkItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'check-item';
    div.innerHTML = `
      <button class="btn-check" id="chk-${i}" onclick="toggleCheck(${i})" title="Marcar como correcto">✓</button>
      <span class="check-label">${esc(item.label)}</span>
    `;
    cont.appendChild(div);
  });

  const nota = document.createElement('p');
  nota.className = 'nota-checklist';
  nota.textContent = 'Marca solo los items correctos. Los no marcados se considerarán pendientes / con observaciones.';
  cont.appendChild(nota);
}

function toggleCheck(i) {
  checkItems[i].marcado = !checkItems[i].marcado;
  const btn = document.getElementById(`chk-${i}`);
  btn.classList.toggle('active-ok', checkItems[i].marcado);
}

// ======================================================
// FLAGS DE MUNICIPIO
// ======================================================
function configurarFlags() {
  const v = visitaActual;
  const flagAlcant = parseBool(v.flagAlcantarillado);
  const flagPlano  = parseBool(v.flagPlano);
  document.getElementById('sec-plano').style.display          = flagPlano   ? '' : 'none';
  document.getElementById('sec-alcantarillado').style.display = flagAlcant ? '' : 'none';
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toUpperCase() === 'TRUE' || v === '1';
  return false;
}

// ======================================================
// REDIMENSIONAR IMAGEN PARA REDUCIR PESO
// ======================================================
async function redimensionarImagen(file) {
  if (file.type === 'application/pdf') {
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mime: file.type };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.onload = () => {
      let { width, height } = img;
      if (width > FOTO_MAX_LADO || height > FOTO_MAX_LADO) {
        if (width > height) {
          height = Math.round(height * (FOTO_MAX_LADO / width));
          width = FOTO_MAX_LADO;
        } else {
          width = Math.round(width * (FOTO_MAX_LADO / height));
          height = FOTO_MAX_LADO;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', FOTO_CALIDAD);
      resolve({ dataUrl, mime: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Imagen no válida'));
    reader.readAsDataURL(file);
  });
}

// ======================================================
// FOTOS GENERALES
// ======================================================
function abrirCamara() {
  document.getElementById('input-foto').click();
}

async function procesarFotos(input) {
  const files = Array.from(input.files);
  const disponibles = 10 - fotosGeneral.length;
  const aProcesar = files.slice(0, disponibles);

  for (const file of aProcesar) {
    try {
      const { dataUrl, mime } = await redimensionarImagen(file);
      const idx = fotosGeneral.length + 1;
      const nombre = generarNombreArchivo(`foto_${String(idx).padStart(3, '0')}`, 'jpg');
      fotosGeneral.push({ dataUrl, nombre, mime });
    } catch (e) {
      alert('No se pudo procesar una foto: ' + e.message);
    }
  }

  renderGridFotos();
  actualizarCountFotos();
  input.value = '';
}

function renderGridFotos() {
  const grid = document.getElementById('grid-fotos');
  grid.innerHTML = '';
  fotosGeneral.forEach((f, i) => {
    crearThumb(f.dataUrl, grid, () => {
      fotosGeneral.splice(i, 1);
      renderGridFotos();
      actualizarCountFotos();
    });
  });
  document.getElementById('btn-add-foto').style.display = (fotosGeneral.length >= 10) ? 'none' : '';
}

function actualizarCountFotos() {
  document.getElementById('count-fotos').textContent = `${fotosGeneral.length}/10`;
}

// ======================================================
// PLANO / CROQUIS
// ======================================================
async function procesarPlano(input) {
  const file = input.files[0];
  if (!file) return;
  const esPDF = file.type === 'application/pdf';
  try {
    const { dataUrl, mime } = await redimensionarImagen(file);
    const ext = esPDF ? 'pdf' : 'jpg';
    const nombre = generarNombreArchivo('PLANO CROQUIS', ext);
    planoFile = { dataUrl, nombre, mime, esPDF };
    renderPlano(file.name);
  } catch (e) {
    alert('No se pudo procesar el plano: ' + e.message);
  }
  input.value = '';
}

function renderPlano(nombreOriginal) {
  const prev = document.getElementById('plano-preview');
  prev.innerHTML = '';
  if (!planoFile) return;
  if (planoFile.esPDF) {
    const div = document.createElement('div');
    div.className = 'foto-thumb foto-thumb-pdf';
    div.innerHTML = `<div class="pdf-info">📄 PDF<br><small>${esc((nombreOriginal || '').slice(0, 30))}</small></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn-del';
    btn.textContent = '✕';
    btn.onclick = () => { planoFile = null; prev.innerHTML = ''; };
    div.appendChild(btn);
    prev.appendChild(div);
  } else {
    crearThumb(planoFile.dataUrl, prev, () => { planoFile = null; prev.innerHTML = ''; });
  }
}

// ======================================================
// FOTOS ALCANTARILLADO
// ======================================================
async function procesarAlcant(input) {
  const files = Array.from(input.files);
  for (const file of files) {
    try {
      const { dataUrl, mime } = await redimensionarImagen(file);
      const idx = alcantFotos.length + 1;
      const nombre = generarNombreArchivo(`alcantarillado_${idx}`, 'jpg');
      alcantFotos.push({ dataUrl, nombre, mime });
    } catch (e) {
      alert('No se pudo procesar una foto: ' + e.message);
    }
  }
  renderGridAlcant();
  input.value = '';
}

function renderGridAlcant() {
  const grid = document.getElementById('grid-alcant');
  grid.innerHTML = '';
  alcantFotos.forEach((f, i) => {
    crearThumb(f.dataUrl, grid, () => {
      alcantFotos.splice(i, 1);
      renderGridAlcant();
    });
  });
}

// ======================================================
// HELPER THUMB
// ======================================================
function crearThumb(dataUrl, contenedor, onDelete) {
  const div = document.createElement('div');
  div.className = 'foto-thumb';
  const img = document.createElement('img');
  img.src = dataUrl;
  div.appendChild(img);
  const btn = document.createElement('button');
  btn.className = 'btn-del';
  btn.textContent = '✕';
  btn.onclick = (e) => { e.stopPropagation(); onDelete(); };
  div.appendChild(btn);
  contenedor.appendChild(div);
}

// ======================================================
// GENERAR NOMBRE DE ARCHIVO CON PREFIJO
// ======================================================
function generarNombreArchivo(sufijo, extension) {
  const v = visitaActual;
  const prefix = v.numExp || '000000';
  return `${prefix}_${sufijo}.${extension}`;
}

// ======================================================
// VALIDACIÓN
// ======================================================
function validar() {
  const errores = [];
  const flagAlcant = parseBool(visitaActual.flagAlcantarillado);
  const flagPlano  = parseBool(visitaActual.flagPlano);

  if (flagAlcant && alcantFotos.length < 2) {
    errores.push('Se necesitan mínimo 2 fotos del alcantarillado.');
  }
  if (flagPlano && !planoFile) {
    errores.push('Falta el plano/croquis del inmueble.');
  }
  return errores;
}

// ======================================================
// GUARDAR VISITA
// ======================================================
async function guardarVisita() {
  const errores = validar();
  const msgError = document.getElementById('msg-error');

  if (errores.length > 0) {
    msgError.textContent = errores.join(' · ');
    msgError.style.display = '';
    msgError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  msgError.style.display = 'none';

  const sinMarcar = checkItems.filter(c => !c.marcado).length;
  if (sinMarcar > 0) {
    const ok = confirm(`Hay ${sinMarcar} item(s) del checklist SIN marcar (se considerarán pendientes / con observaciones). ¿Confirmas guardar?`);
    if (!ok) return;
  }

  mostrarProgreso('Preparando datos...', 0);

  try {
    const checklistTexto = checkItems.map(c => {
      const simbolo = c.marcado ? '✓' : '⚠';
      return `${simbolo} ${c.label}`;
    }).join('\n');

    const payload = {
      action: 'guardarVisita',
      numExp: visitaActual.numExp,
      rowIndex: visitaActual.rowIndex,
      checklist: checklistTexto,
      observaciones: document.getElementById('txt-observaciones').value.trim(),
      folderId: visitaActual.folderId || '',
      flagAlcantarillado: parseBool(visitaActual.flagAlcantarillado),
      flagPlano: parseBool(visitaActual.flagPlano),
      fotos: [],
      plano: null,
      alcantFotos: [],
      firma: null
    };

    // Firma del cliente (opcional - PNG con fondo transparente)
    const firmaPNG = obtenerFirmaPNG();
    if (firmaPNG) {
      const dirSaneada = sanearNombreArchivo(visitaActual.direccion);
      const nombreFirma = `${visitaActual.numExp}_Firma titular ${dirSaneada}.png`;
      payload.firma = {
        nombre: nombreFirma,
        data: firmaPNG.split(',')[1],
        mime: 'image/png'
      };
    }

    for (let i = 0; i < fotosGeneral.length; i++) {
      const f = fotosGeneral[i];
      payload.fotos.push({ nombre: f.nombre, data: f.dataUrl.split(',')[1], mime: f.mime });
      actualizarProgreso(`Procesando fotos ${i + 1}/${fotosGeneral.length}...`, 5 + (i / Math.max(1, fotosGeneral.length)) * 30);
    }

    if (planoFile) {
      payload.plano = { nombre: planoFile.nombre, data: planoFile.dataUrl.split(',')[1], mime: planoFile.mime };
      actualizarProgreso('Procesando plano...', 40);
    }

    for (let i = 0; i < alcantFotos.length; i++) {
      const f = alcantFotos[i];
      payload.alcantFotos.push({ nombre: f.nombre, data: f.dataUrl.split(',')[1], mime: f.mime });
      actualizarProgreso(`Procesando alcantarillado ${i + 1}/${alcantFotos.length}...`, 45 + (i / Math.max(1, alcantFotos.length)) * 15);
    }

    actualizarProgreso('Subiendo a Drive (puede tardar)...', 65);

    const result = await fetchPOST(APPS_SCRIPT_URL, payload, 120000);

    actualizarProgreso('Finalizado', 100);

    if (result.ok) {
      ocultarProgreso();
      mostrarExito(result.mensaje || 'Visita guardada correctamente en Drive.');
    } else {
      throw new Error(result.error || 'Error desconocido en el servidor.');
    }

  } catch (e) {
    ocultarProgreso();
    msgError.textContent = 'Error al guardar: ' + e.message;
    msgError.style.display = '';
    msgError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ======================================================
// PROGRESO / ÉXITO
// ======================================================
function mostrarProgreso(msg, pct) {
  document.getElementById('progreso-msg').textContent = msg;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('overlay-progreso').style.display = 'flex';
  document.getElementById('btn-guardar').disabled = true;
}
function actualizarProgreso(msg, pct) {
  document.getElementById('progreso-msg').textContent = msg;
  document.getElementById('progress-bar').style.width = pct + '%';
}
function ocultarProgreso() {
  document.getElementById('overlay-progreso').style.display = 'none';
  document.getElementById('btn-guardar').disabled = false;
}
function mostrarExito(msg) {
  document.getElementById('exito-msg').textContent = msg;
  document.getElementById('overlay-exito').style.display = 'flex';
}
function finalizarYVolver() {
  document.getElementById('overlay-exito').style.display = 'none';
  resetVisita();
  mostrarScreen('screen-lista');
  cargarVisitas();
}

// ======================================================
// UTILIDADES DE RED
// ======================================================
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Error de lectura'));
    r.readAsDataURL(file);
  });
}

async function fetchConTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout (red lenta o sin respuesta)');
    throw e;
  }
}

// JSONP — evita problemas CORS con Apps Script en peticiones GET
function fetchJSONP(url, ms) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo conectar con el servidor (revisa el despliegue del Apps Script)'));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout (sin respuesta del servidor en ' + (ms/1000) + 's)'));
    }, ms);

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

// POST con text/plain para evitar preflight CORS de Apps Script
async function fetchPOST(url, body, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout al subir (los archivos son grandes o la red lenta)');
    throw e;
  }
}

// ======================================================
// DICTADO POR VOZ (Web Speech API)
// ======================================================
let recognizer = null;
let isRecording = false;

function tieneSpeechAPI() {
  return ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
}

function toggleDictado() {
  if (!tieneSpeechAPI()) {
    mostrarMicStatus('Tu navegador no soporta dictado por voz. Prueba en Chrome (Android) o escribe manualmente.', 'error');
    return;
  }

  if (isRecording) {
    pararDictado();
  } else {
    iniciarDictado();
  }
}

function iniciarDictado() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognizer = new SR();
  recognizer.lang = 'es-ES';
  recognizer.continuous = true;
  recognizer.interimResults = false;

  const textarea = document.getElementById('txt-observaciones');
  let textoBase = textarea.value;
  // Asegurar separación con texto previo
  if (textoBase.length > 0 && !textoBase.endsWith(' ') && !textoBase.endsWith('\n')) {
    textoBase += ' ';
  }

  recognizer.onresult = (event) => {
    let nuevoTexto = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        nuevoTexto += event.results[i][0].transcript;
      }
    }
    if (nuevoTexto) {
      // Capitalizar primera letra de cada frase nueva
      nuevoTexto = nuevoTexto.trim();
      if (nuevoTexto.length > 0) {
        nuevoTexto = nuevoTexto.charAt(0).toUpperCase() + nuevoTexto.slice(1);
      }
      textoBase += (textoBase.length > 0 && !textoBase.endsWith(' ') && !textoBase.endsWith('\n') ? ' ' : '') + nuevoTexto;
      textarea.value = textoBase;
      // Auto-scroll al final
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  recognizer.onerror = (e) => {
    let msg = 'Error: ' + e.error;
    if (e.error === 'not-allowed') msg = 'Permiso de micrófono denegado. Habilítalo en los ajustes del navegador.';
    if (e.error === 'no-speech')   msg = 'No se ha detectado voz. Inténtalo otra vez.';
    if (e.error === 'network')     msg = 'Sin conexión: el dictado por voz necesita internet.';
    mostrarMicStatus(msg, 'error');
    pararDictado();
  };

  recognizer.onend = () => {
    if (isRecording) {
      // Si el reconocedor para solo (timeout), reiniciamos para mantener escucha continua
      try { recognizer.start(); } catch (err) { pararDictado(); }
    }
  };

  try {
    recognizer.start();
    isRecording = true;
    document.getElementById('btn-mic').classList.add('recording');
    mostrarMicStatus('🔴 Grabando... Habla con claridad. Pulsa de nuevo el micrófono para parar.', 'recording');
  } catch (e) {
    mostrarMicStatus('No se pudo iniciar el micrófono: ' + e.message, 'error');
  }
}

function pararDictado() {
  isRecording = false;
  if (recognizer) {
    try { recognizer.stop(); } catch (e) {}
    recognizer = null;
  }
  document.getElementById('btn-mic').classList.remove('recording');
  // Ocultar status tras 3 segundos
  setTimeout(() => {
    const s = document.getElementById('mic-status');
    if (s && !s.classList.contains('error')) s.style.display = 'none';
  }, 3000);
}

function mostrarMicStatus(msg, tipo) {
  const s = document.getElementById('mic-status');
  s.textContent = msg;
  s.className = 'mic-status ' + (tipo || '');
  s.style.display = '';
}

// ======================================================
// FIRMA DEL CLIENTE (Canvas)
// ======================================================
let firmaCtx = null;
let firmaDibujando = false;
let firmaTienenTrazo = false;
let firmaUltimoX = 0;
let firmaUltimoY = 0;

function inicializarFirma() {
  const canvas = document.getElementById('canvas-firma');
  if (!canvas) return;

  // Ajustar resolución del canvas a su tamaño real (HiDPI)
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;

  firmaCtx = canvas.getContext('2d');
  firmaCtx.scale(dpr, dpr);
  firmaCtx.lineWidth = 2.2;
  firmaCtx.lineCap = 'round';
  firmaCtx.lineJoin = 'round';
  firmaCtx.strokeStyle = '#000000';

  // Eventos: pointer events cubren mouse, táctil y stylus a la vez
  canvas.addEventListener('pointerdown', firmaInicioTrazo);
  canvas.addEventListener('pointermove', firmaMoverTrazo);
  canvas.addEventListener('pointerup',   firmaFinTrazo);
  canvas.addEventListener('pointercancel', firmaFinTrazo);
  canvas.addEventListener('pointerleave',  firmaFinTrazo);
}

function firmaCoords(e) {
  const canvas = document.getElementById('canvas-firma');
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function firmaInicioTrazo(e) {
  e.preventDefault();
  firmaDibujando = true;
  const p = firmaCoords(e);
  firmaUltimoX = p.x;
  firmaUltimoY = p.y;
  // Ocultar el placeholder al primer trazo
  if (!firmaTienenTrazo) {
    document.getElementById('firma-placeholder').classList.add('hidden');
    firmaTienenTrazo = true;
  }
}

function firmaMoverTrazo(e) {
  if (!firmaDibujando) return;
  e.preventDefault();
  const p = firmaCoords(e);
  firmaCtx.beginPath();
  firmaCtx.moveTo(firmaUltimoX, firmaUltimoY);
  firmaCtx.lineTo(p.x, p.y);
  firmaCtx.stroke();
  firmaUltimoX = p.x;
  firmaUltimoY = p.y;
}

function firmaFinTrazo() {
  firmaDibujando = false;
}

function borrarFirma() {
  const canvas = document.getElementById('canvas-firma');
  if (!canvas || !firmaCtx) return;
  firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
  firmaTienenTrazo = false;
  document.getElementById('firma-placeholder').classList.remove('hidden');
}

// Devuelve PNG con fondo TRANSPARENTE (solo trazos), o null si no hay firma
function obtenerFirmaPNG() {
  if (!firmaTienenTrazo) return null;
  const canvas = document.getElementById('canvas-firma');
  return canvas.toDataURL('image/png');  // canvas ya es transparente por defecto
}

// Inicializar la firma cuando se abre una visita (canvas necesita estar visible primero)
// Llamamos también desde abrirVisita
window.addEventListener('load', () => {
  // Inicializar canvas cuando se muestra screen-visita por primera vez
  // (lo llamaremos desde abrirVisita por si acaso)
});

// ======================================================
// SANEAR NOMBRE DE ARCHIVO
// ======================================================
function sanearNombreArchivo(s) {
  return String(s || '')
    .replace(/[\/\\:*?"<>|]/g, '')   // caracteres no válidos en nombres de archivo
    .replace(/[,;]/g, '')             // comas y puntos y coma
    .replace(/\s+/g, ' ')             // espacios múltiples a uno
    .trim()
    .slice(0, 100);                   // máximo 100 caracteres
}

// ======================================================
// SERVICE WORKER (PWA)
// ======================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW error:', e));
  });
}
