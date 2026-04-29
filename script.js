/**
 * EnviroSense Dashboard · script.js
 * ─────────────────────────────────────────────────────────────────
 * Handles: Supabase REST fetching, Chart.js rendering,
 *          auto-refresh, offline detection, alert system.
 */

/* ════════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════════ */
const SUPABASE_URL    = 'https://eyfhlcmdhpewovrbixdh.supabase.co';
const SUPABASE_KEY    = 'sb_publishable_JXV4aeRf6k51VyrfMPwNvA_SqibyY3n';
const REFRESH_MS      = 3_000;   // dashboard refresh interval
const OFFLINE_MS      = 30_000;  // treat device as offline after 30 s of no new data
const CHART_POINTS    = 20;      // last N readings for charts
const GAS_ALERT_LIMIT = 150;     // MQ135 ppm threshold

const API_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
  'Accept':        'application/json'
};

/* ════════════════════════════════════════════════════════════════
   DOM REFS
   ════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const el = {
  // Cards
  valGas:      $('val-gas'),
  valTemp:     $('val-temp'),
  valHumid:    $('val-humid'),
  barGas:      $('bar-gas'),
  barTemp:     $('bar-temp'),
  barHumid:    $('bar-humid'),
  statusGas:   $('status-gas'),
  statusTemp:  $('status-temp'),
  statusHumid: $('status-humid'),
  cardGas:     $('card-gas'),
  loadGas:     $('loading-gas'),
  loadTemp:    $('loading-temp'),
  loadHumid:   $('loading-humid'),
  // Alerts
  alertBanner: $('alert-banner'),
  alertMq:     $('alert-mq135-val'),
  errorBanner: $('error-banner'),
  errorMsg:    $('error-message'),
  // Stats
  statGasMin:   $('stat-gas-min'),
  statGasMax:   $('stat-gas-max'),
  statTempAvg:  $('stat-temp-avg'),
  statHumidAvg: $('stat-humid-avg'),
  // Header
  deviceStatus:   $('device-status'),
  lastUpdateTime: $('last-update-time'),
  refreshCounter: $('refresh-counter'),
};

/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */
let tempChart  = null;
let humidChart = null;
let refreshTimer  = null;
let countdownTimer = null;
let countdownSec   = REFRESH_MS / 1000;
let isFirstLoad    = true;

/* ════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════ */

/**
 * Format a created_at ISO timestamp to HH:MM:SS label.
 */
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Clamp a number to [min, max].
 */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Show / hide the loading shimmer overlays.
 */
function setLoading(active) {
  ['loadGas', 'loadTemp', 'loadHumid'].forEach(key => {
    el[key].classList.toggle('active', active);
  });
}

/**
 * Show a UI error message.
 */
function showError(msg) {
  el.errorBanner.classList.remove('hidden');
  el.errorMsg.textContent = msg;
}

function clearError() {
  el.errorBanner.classList.add('hidden');
  el.errorMsg.textContent = '';
}

/* ════════════════════════════════════════════════════════════════
   DEVICE STATUS
   ════════════════════════════════════════════════════════════════ */
function updateDeviceStatus(latestRow) {
  const statusEl = el.deviceStatus;
  const dotEl    = statusEl.querySelector('.status-dot');
  const labelEl  = statusEl.querySelector('.status-label');

  if (!latestRow) {
    statusEl.className = 'status-pill status-offline';
    labelEl.textContent = 'OFFLINE';
    return;
  }

  const ageMs = Date.now() - new Date(latestRow.created_at).getTime();

  if (ageMs > OFFLINE_MS) {
    statusEl.className = 'status-pill status-offline';
    labelEl.textContent = 'OFFLINE';
  } else {
    statusEl.className = 'status-pill status-online';
    labelEl.textContent = 'ONLINE';
  }
}

/* ════════════════════════════════════════════════════════════════
   COUNTDOWN FOOTER
   ════════════════════════════════════════════════════════════════ */
function startCountdown() {
  countdownSec = REFRESH_MS / 1000;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownSec = Math.max(0, countdownSec - 1);
    if (el.refreshCounter) {
      el.refreshCounter.textContent = `NEXT REFRESH IN ${countdownSec}s`;
    }
  }, 1000);
}

/* ════════════════════════════════════════════════════════════════
   CHART SETUP
   ════════════════════════════════════════════════════════════════ */
Chart.defaults.color     = '#567090';
Chart.defaults.font.family = "'Space Mono', monospace";
Chart.defaults.font.size   = 10;

const chartGridColor  = 'rgba(0,212,255,0.06)';
const chartTickColor  = '#2a4060';

function buildChartOptions(yLabel, lineColor, gradientTopColor) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 400, easing: 'easeInOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(3,12,25,0.92)',
        borderColor: lineColor,
        borderWidth: 1,
        titleColor: lineColor,
        bodyColor: '#c8e8f8',
        padding: 10,
        displayColors: false,
      }
    },
    scales: {
      x: {
        grid: { color: chartGridColor, drawBorder: false },
        ticks: { color: chartTickColor, maxRotation: 45, minRotation: 0, maxTicksLimit: 8 },
        border: { display: false }
      },
      y: {
        grid: { color: chartGridColor, drawBorder: false },
        ticks: { color: chartTickColor },
        title: { display: false },
        border: { display: false }
      }
    }
  };
}

function initCharts() {
  const ctxTemp  = document.getElementById('chart-temp').getContext('2d');
  const ctxHumid = document.getElementById('chart-humid').getContext('2d');

  // Temperature gradient
  const tempGrad = ctxTemp.createLinearGradient(0, 0, 0, 220);
  tempGrad.addColorStop(0,   'rgba(255,179,64,0.22)');
  tempGrad.addColorStop(1,   'rgba(255,179,64,0.00)');

  // Humidity gradient
  const humidGrad = ctxHumid.createLinearGradient(0, 0, 0, 220);
  humidGrad.addColorStop(0, 'rgba(77,166,255,0.22)');
  humidGrad.addColorStop(1, 'rgba(77,166,255,0.00)');

  const emptyLabels = Array(CHART_POINTS).fill('');
  const emptyData   = Array(CHART_POINTS).fill(null);

  tempChart = new Chart(ctxTemp, {
    type: 'line',
    data: {
      labels: [...emptyLabels],
      datasets: [{
        label: 'Temperature (°C)',
        data: [...emptyData],
        borderColor: '#ffb340',
        backgroundColor: tempGrad,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#ffb340',
        pointBorderColor: 'transparent',
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4,
      }]
    },
    options: buildChartOptions('°C', '#ffb340')
  });

  humidChart = new Chart(ctxHumid, {
    type: 'line',
    data: {
      labels: [...emptyLabels],
      datasets: [{
        label: 'Humidity (%)',
        data: [...emptyData],
        borderColor: '#4da6ff',
        backgroundColor: humidGrad,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#4da6ff',
        pointBorderColor: 'transparent',
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4,
      }]
    },
    options: buildChartOptions('%RH', '#4da6ff')
  });
}

/* ════════════════════════════════════════════════════════════════
   UPDATE CHARTS
   ════════════════════════════════════════════════════════════════ */
function updateCharts(rows) {
  // rows is ordered desc; reverse for chronological order on chart
  const ordered = [...rows].reverse();

  const labels = ordered.map(r => fmtTime(r.created_at));
  const temps  = ordered.map(r => r.temperature != null ? +Number(r.temperature).toFixed(1) : null);
  const humids = ordered.map(r => r.humidity    != null ? +Number(r.humidity).toFixed(1)    : null);

  tempChart.data.labels              = labels;
  tempChart.data.datasets[0].data    = temps;
  humidChart.data.labels             = labels;
  humidChart.data.datasets[0].data   = humids;

  tempChart.update('none');
  humidChart.update('none');
}

/* ════════════════════════════════════════════════════════════════
   UPDATE METRIC CARDS
   ════════════════════════════════════════════════════════════════ */
function updateCards(latest) {
  if (!latest) return;

  const gas   = latest.mq135;
  const temp  = latest.temperature;
  const humid = latest.humidity;

  // ── Gas card ──
  el.valGas.textContent = gas ?? '—';
  el.barGas.style.width = gas != null ? `${clamp((gas / 300) * 100, 0, 100)}%` : '0%';
  el.statusGas.textContent = gas == null ? 'NO DATA'
    : gas > 200 ? 'DANGEROUS'
    : gas > 150 ? 'WARNING'
    : gas > 100 ? 'MODERATE'
    : 'GOOD';

  // Gas alert
  if (gas != null && gas > GAS_ALERT_LIMIT) {
    el.cardGas.classList.add('danger');
    el.alertBanner.classList.remove('hidden');
    el.alertMq.textContent = `[${gas} ppm]`;
  } else {
    el.cardGas.classList.remove('danger');
    el.alertBanner.classList.add('hidden');
  }

  // ── Temp card ──
  const tempDisplay = temp != null ? Number(temp).toFixed(1) : '—';
  el.valTemp.textContent = tempDisplay;
  el.barTemp.style.width = temp != null ? `${clamp(((temp - 0) / 60) * 100, 0, 100)}%` : '0%';
  el.statusTemp.textContent = temp == null ? 'NO DATA'
    : temp > 40 ? 'HOT'
    : temp > 28 ? 'WARM'
    : temp > 15 ? 'NORMAL'
    : 'COLD';

  // ── Humid card ──
  const humidDisplay = humid != null ? Number(humid).toFixed(1) : '—';
  el.valHumid.textContent = humidDisplay;
  el.barHumid.style.width = humid != null ? `${clamp(humid, 0, 100)}%` : '0%';
  el.statusHumid.textContent = humid == null ? 'NO DATA'
    : humid > 80 ? 'HIGH'
    : humid > 60 ? 'MODERATE'
    : humid > 30 ? 'OPTIMAL'
    : 'DRY';

  // Update header timestamp
  el.lastUpdateTime.textContent = fmtTime(latest.created_at);
}

/* ════════════════════════════════════════════════════════════════
   UPDATE MINI STATS
   ════════════════════════════════════════════════════════════════ */
function updateMiniStats(rows) {
  const gasVals   = rows.map(r => r.mq135).filter(v => v != null);
  const tempVals  = rows.map(r => r.temperature).filter(v => v != null);
  const humidVals = rows.map(r => r.humidity).filter(v => v != null);

  el.statGasMin.textContent  = gasVals.length   ? Math.min(...gasVals)                            : '—';
  el.statGasMax.textContent  = gasVals.length   ? Math.max(...gasVals)                            : '—';
  el.statTempAvg.textContent = tempVals.length  ? (tempVals.reduce((a,b)=>a+b,0)/tempVals.length).toFixed(1) + '°' : '—';
  el.statHumidAvg.textContent= humidVals.length ? (humidVals.reduce((a,b)=>a+b,0)/humidVals.length).toFixed(1) + '%': '—';
}

/* ════════════════════════════════════════════════════════════════
   FETCH — LATEST (1 row) for cards / status
   ════════════════════════════════════════════════════════════════ */
async function fetchLatest() {
  const url = `${SUPABASE_URL}/rest/v1/sensor_data?select=*&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  const data = await res.json();
  return data[0] ?? null;
}

/* ════════════════════════════════════════════════════════════════
   FETCH — CHART DATA (last N rows)
   ════════════════════════════════════════════════════════════════ */
async function fetchChartData() {
  const url = `${SUPABASE_URL}/rest/v1/sensor_data?select=*&order=created_at.desc&limit=${CHART_POINTS}`;
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.json();
}

/* ════════════════════════════════════════════════════════════════
   MAIN REFRESH TICK
   ════════════════════════════════════════════════════════════════ */
async function tick() {
  if (isFirstLoad) setLoading(true);

  try {
    // Run both fetches in parallel
    const [latest, chartRows] = await Promise.all([fetchLatest(), fetchChartData()]);

    clearError();

    // Cards
    updateCards(latest);
    updateDeviceStatus(latest);

    // Charts
    if (chartRows && chartRows.length > 0) {
      updateCharts(chartRows);
      updateMiniStats(chartRows);
    }

    if (isFirstLoad) {
      isFirstLoad = false;
      setLoading(false);
    }

  } catch (err) {
    console.error('[EnviroSense]', err);
    showError(`CONNECTION ERROR: ${err.message}`);
    if (isFirstLoad) setLoading(false);
  }

  startCountdown();
}

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  tick();
  refreshTimer = setInterval(tick, REFRESH_MS);
});
