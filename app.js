const $ = id => document.getElementById(id);
const COLORS = { pm1_ugm3: '#3f8f8b', pm25_ugm3: '#087d83', pm10_ugm3: '#ef8d43' };
let manifest, stations = [], selected = 0, cache = {}, latest = {}, chart, map, sharedMarker, renderSequence = 0;

function number(value) {
  const parsed = Number(value);
  return value === '' || value == null || !Number.isFinite(parsed) ? null : parsed;
}
function csv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const heads = lines.shift().split(',');
  return lines.filter(Boolean).map(line => {
    const values = line.split(','), row = {};
    heads.forEach((head, index) => { row[head] = values[index] ?? ''; });
    return row;
  });
}
function safeCsv(rows) {
  const keys = Object.keys(rows[0] || {});
  const quote = value => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${keys.join(',')}\n${rows.map(row => keys.map(key => quote(row[key])).join(',')).join('\n')}`;
}
function save(name, blob) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
function parseDateTime(value) { return new Date(value.replace(' ', 'T')); }
function localDate(value) { return parseDateTime(value).toLocaleString('es-CL'); }
function isActive(station) { return parseDateTime(manifest.updated_at) - parseDateTime(station.last_at) < 48 * 3600e3; }
function formatReading(row, key) {
  const value = number(row?.[key]);
  return value === null ? '—' : value.toLocaleString('es-CL', { maximumFractionDigits: 1 });
}

function mapPopupContent() {
  const cards = [31, 39].map(sensorId => {
    const station = stations.find(item => item.sensor_id === sensorId), row = latest[sensorId];
    const environment = station?.environment === 'INDOOR' ? 'Interior' : 'Exterior';
    return `<section class="map-reading"><b>Sensor ${sensorId} · ${environment}</b><span>MP1 ${formatReading(row, 'pm1_ugm3')} · MP2,5 ${formatReading(row, 'pm25_ugm3')} · MP10 ${formatReading(row, 'pm10_ugm3')} µg/m³</span><small>${row ? `Última lectura: ${localDate(row.fecha)}` : 'Sin lectura disponible'}</small><button type="button" data-open-sensor="${sensorId}">Ver histórico</button></section>`;
  }).join('');
  return `${cards}<small class="map-coordinates">278 m s. n. m. · −45.61444, −72.10975</small>`;
}
function bindMapButtons() {
  const popup = sharedMarker?.getPopup()?.getElement();
  popup?.querySelectorAll('[data-open-sensor]').forEach(button => {
    button.onclick = () => selectSensor(Number(button.dataset.openSensor));
  });
}
function updateMapPopup() {
  if (!sharedMarker) return;
  sharedMarker.setPopupContent(mapPopupContent());
  if (sharedMarker.isPopupOpen()) bindMapButtons();
}
function setupMap() {
  map = L.map('map', { scrollWheelZoom: false }).setView([-45.585, -72.09], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  L.circle([-45.5712, -72.0683], { radius: 6500, color: '#6ba8a4', weight: 2, dashArray: '7 7', fillColor: '#82dfd1', fillOpacity: 0.12 })
    .addTo(map).bindPopup('<b>Área general de Coyhaique</b><br>Ubicación individual no disponible para 13 sensores');
  const icon = L.divIcon({ className: '', html: '<div class="shared-sensor-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  sharedMarker = L.marker([-45.61444, -72.10975], { icon }).addTo(map).bindPopup(mapPopupContent(), { minWidth: 310 });
  sharedMarker.on('popupopen', bindMapButtons);
  sharedMarker.openPopup();
}
function selectSensor(sensorId) {
  $('environment').value = 'all';
  selected = stations.findIndex(station => station.sensor_id === sensorId);
  fillSensors();
  updateDateControls(true);
  render();
  $('datos').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectedRange(station, period) {
  if (period === 'all') return null;
  if (period === 'custom') {
    const from = $('date-from').value, to = $('date-to').value;
    if (!from || !to) return null;
    return { start: new Date(`${from}T00:00:00`), end: new Date(`${to}T23:59:59.999`) };
  }
  const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;
  const end = parseDateTime(station.last_at);
  return { start: new Date(end.getTime() - days * 864e5), end };
}
function filesFor(station, period) {
  const range = selectedRange(station, period);
  if (!range) return station.files;
  return station.files.filter(path => {
    const match = path.match(/(\d{4})-(\d{2})\.csv$/);
    if (!match) return false;
    const monthStart = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    const monthEnd = new Date(Number(match[1]), Number(match[2]), 1);
    return monthEnd >= range.start && monthStart <= range.end;
  });
}
async function rowsFor(station, period) {
  const range = selectedRange(station, period);
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : 'all';
  const cacheKey = `${station.sensor_id}|${period}|${rangeKey}`;
  if (cache[cacheKey]) return cache[cacheKey];
  const texts = await Promise.all(filesFor(station, period).map(path => fetch(`${path}?v=${encodeURIComponent(manifest.updated_at)}`).then(response => {
    if (!response.ok) throw Error(`${response.status} ${path}`);
    return response.text();
  })));
  let rows = texts.flatMap(csv).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (range) rows = rows.filter(row => {
    const time = parseDateTime(row.fecha).getTime();
    return time >= range.start.getTime() && time <= range.end.getTime();
  });
  cache[cacheKey] = rows;
  return rows;
}

function daily(points) {
  const groups = {};
  points.forEach(point => { (groups[point.x.slice(0, 10)] ??= []).push(point.y); });
  const labels = Object.keys(groups).sort();
  return {
    labels,
    avg: labels.map(key => groups[key].reduce((a, b) => a + b, 0) / groups[key].length),
    min: labels.map(key => Math.min(...groups[key])),
    max: labels.map(key => Math.max(...groups[key])),
    count: labels.map(key => groups[key].length)
  };
}
function chartData(points, period, color) {
  if (period === '24h' || period === '7d') return {
    labels: points.map(point => point.x), daily: false,
    datasets: [{ label: 'Lectura horaria', data: points.map(point => point.y), borderColor: color, backgroundColor: `${color}18`, fill: true, pointRadius: points.length > 170 ? 0 : 2, tension: 0.18 }]
  };
  const grouped = daily(points);
  return {
    labels: grouped.labels, daily: true,
    datasets: [
      { label: 'Mínimo diario', data: grouped.min, borderColor: 'transparent', pointRadius: 0 },
      { label: 'Rango diario', data: grouped.max, borderColor: 'transparent', backgroundColor: `${color}2d`, pointRadius: 0, fill: '-1' },
      { label: 'Promedio diario', data: grouped.avg, borderColor: color, backgroundColor: 'transparent', borderWidth: 2, pointRadius: grouped.avg.length > 100 ? 0 : 2, tension: 0.18 }
    ]
  };
}
function normFor(allRows, key) {
  const card = $('norm-card');
  card.className = '';
  if (key === 'pm1_ugm3') return ['Sin norma general', 'MP1 · valor observado sin clasificación'];
  const points = allRows.map(row => ({ x: row.fecha, y: number(row[key]) })).filter(point => point.y !== null);
  const grouped = daily(points), today = manifest.updated_at.slice(0, 10);
  const eligible = grouped.labels.map((day, index) => ({ day, value: grouped.avg[index], count: grouped.count[index] })).filter(item => item.day < today && item.count >= 18);
  const last = eligible.at(-1);
  if (!last) return ['Datos insuficientes', 'Se requieren al menos 18 horas en un día'];
  const limit = key === 'pm25_ugm3' ? 50 : 130;
  const reference = key === 'pm25_ugm3' ? 'DS 12/2011' : 'DS 12/2021';
  const below = last.value <= limit;
  card.className = below ? 'good' : 'bad';
  return [below ? 'Bajo referencia' : 'Sobre referencia', `${last.value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} µg/m³ · ${last.day} · ${reference}`];
}

function fillSensors() {
  const environment = $('environment').value, current = stations[selected]?.sensor_id;
  const list = stations.filter(station => environment === 'all' || station.environment === environment);
  $('sensor').innerHTML = list.map(station => `<option value="${station.sensor_id}">${isActive(station) ? '●' : '○'} Sensor ${station.sensor_id} · ${station.environment === 'INDOOR' ? 'Interior' : 'Exterior'}</option>`).join('');
  const chosen = list.find(station => station.sensor_id === current) || list.find(station => station.sensor_id === (environment === 'OUTDOOR' ? 39 : 31)) || list[0];
  selected = stations.indexOf(chosen);
  $('sensor').value = chosen.sensor_id;
}
function updateDateControls(forceValues = false) {
  const station = stations[selected], custom = $('period').value === 'custom';
  document.querySelectorAll('.date-control').forEach(control => { control.hidden = !custom; });
  if (!station) return;
  const first = station.first_at.slice(0, 10), last = station.last_at.slice(0, 10);
  for (const input of [$('date-from'), $('date-to')]) { input.min = first; input.max = last; }
  if (forceValues || !$('date-from').value || $('date-from').value < first || $('date-from').value > last) $('date-from').value = first;
  if (forceValues || !$('date-to').value || $('date-to').value < first || $('date-to').value > last) $('date-to').value = last;
}

async function render() {
  const sequence = ++renderSequence, station = stations[selected], key = $('variable').value, period = $('period').value;
  const variable = manifest.variables[key], color = COLORS[key];
  $('sensor-title').textContent = `Sensor ${station.sensor_id} · ${station.environment === 'INDOOR' ? 'Interior' : 'Exterior'}`;
  $('sensor-context').textContent = station.location_precision === 'exacta' ? `${station.location} · ${station.altitude_m} m s. n. m.` : station.location;
  try {
    const rows = await rowsFor(station, period);
    if (sequence !== renderSequence) return;
    const normRows = period === '24h' ? await rowsFor(station, '7d') : rows;
    if (sequence !== renderSequence) return;
    const points = rows.map(row => ({ x: row.fecha, y: number(row[key]) })).filter(point => point.y !== null);
    const last = latest[station.sensor_id], lastValue = number(last?.[key]), norm = normFor(normRows, key), display = chartData(points, period, color);
    $('last-value').textContent = lastValue === null ? '—' : `${lastValue.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${variable.unit}`;
    $('last-time').textContent = last ? localDate(last.fecha) : 'Sin lectura';
    $('norm-state').textContent = norm[0];
    $('norm-detail').textContent = norm[1];
    $('availability').textContent = points.length ? (isActive(station) ? 'Con datos' : 'Con histórico') : 'Sin datos en el período';
    $('record-count').textContent = `${points.length.toLocaleString('es-CL')} observaciones válidas`;
    $('chart-empty').hidden = points.length > 0;
    $('chart-empty').textContent = 'No hay mediciones en este período.';
    const relativeNote = !isActive(station) && period !== 'all' && period !== 'custom' ? ` La ventana termina en la última lectura del sensor (${localDate(station.last_at)}).` : '';
    $('chart-note').textContent = `${display.daily ? 'La línea muestra el promedio diario y la banda el mínimo–máximo de cada día.' : 'Se muestran las lecturas horarias individuales.'}${relativeNote}`;
    if (chart) chart.destroy();
    chart = new Chart($('chart'), {
      type: 'line', data: { labels: display.labels, datasets: display.datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { maxTicksLimit: 9, callback(value) { const raw = display.labels[value]; return raw ? new Date(raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T')).toLocaleDateString('es-CL') : ''; } }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: variable.unit } }
        },
        plugins: {
          legend: { display: display.daily, labels: { filter: item => item.text !== 'Mínimo diario' } },
          tooltip: { callbacks: { title(items) { const raw = items[0].label; return raw.length === 10 ? new Date(`${raw}T00:00:00`).toLocaleDateString('es-CL') : localDate(raw); } } }
        }
      }
    });
  } catch (error) {
    console.error(error);
    $('chart-empty').hidden = false;
    $('chart-empty').textContent = 'No fue posible cargar los datos.';
  }
}

async function downloadSelection() {
  const station = stations[selected], period = $('period').value;
  if (!confirm('Los datos son experimentales y no constituyen una medición regulatoria oficial. ¿Deseas descargarlos?')) return;
  const rows = await rowsFor(station, period);
  if (!rows.length) return;
  const suffix = period === 'custom' ? `${$('date-from').value}_${$('date-to').value}` : period;
  save(`sensor-${station.sensor_id}-${station.environment}-${suffix}.csv`, new Blob(['\ufeff' + safeCsv(rows)], { type: 'text/csv' }));
}
async function downloadAll() {
  if (!confirm('Se generará un ZIP con un CSV independiente por sensor. Los datos son experimentales. ¿Deseas continuar?')) return;
  const button = $('download-all');
  button.disabled = true;
  try {
    const zip = new JSZip();
    for (const [index, station] of stations.entries()) {
      button.textContent = `Preparando ${index + 1}/${stations.length}…`;
      const rows = await rowsFor(station, 'all');
      zip.file(`sensor-${station.sensor_id}-${station.environment}.csv`, '\ufeff' + safeCsv(rows));
    }
    save('aire_aysen_por_sensor.zip', await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
  } finally {
    button.disabled = false;
    button.textContent = 'Descargar todos por sensor (.zip)';
  }
}
async function loadLatest() {
  latest = {};
  const text = await fetch(`data/latest.csv?v=${Date.now()}`, { cache: 'no-store' }).then(response => response.text());
  csv(text).forEach(row => { latest[row.sensor_id] = row; });
}
async function checkUpdates() {
  try {
    const fresh = await fetch(`data/manifest.json?v=${Date.now()}`, { cache: 'no-store' }).then(response => response.json());
    $('live-dot').style.background = '#3bd2a2';
    $('live-label').textContent = 'Datos disponibles';
    if (fresh.updated_at !== manifest.updated_at) {
      manifest = fresh; stations = fresh.stations; cache = {};
      await loadLatest();
      fillSensors(); updateDateControls(); updateMapPopup(); render();
    }
    $('updated').textContent = localDate(manifest.updated_at);
  } catch (error) {
    $('live-dot').style.background = '#e7b94d';
    $('live-label').textContent = 'Última copia publicada';
  }
}
async function init() {
  manifest = await fetch(`data/manifest.json?v=${Date.now()}`).then(response => response.json());
  stations = manifest.stations;
  await loadLatest();
  setupMap();
  selected = Math.max(0, stations.findIndex(station => station.sensor_id === 31));
  fillSensors(); updateDateControls();
  $('updated').textContent = localDate(manifest.updated_at);
  $('live-dot').style.background = '#3bd2a2';
  $('live-label').textContent = 'Datos disponibles';
  render();
  setInterval(checkUpdates, 600000);
}

$('environment').onchange = () => { fillSensors(); updateDateControls(true); render(); };
$('sensor').onchange = event => { selected = stations.findIndex(station => station.sensor_id === Number(event.target.value)); updateDateControls(true); render(); };
$('variable').onchange = render;
$('period').onchange = () => { updateDateControls($('period').value === 'custom'); render(); };
$('date-from').onchange = render;
$('date-to').onchange = render;
$('download-selection').onclick = downloadSelection;
$('download-all').onclick = downloadAll;
init().catch(error => { $('live-label').textContent = 'Datos no disponibles'; console.error(error); });
