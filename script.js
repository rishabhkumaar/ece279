/**
 * EnviroSense Dashboard · script.js
 * ─────────────────────────────────────────────────────────────────
 * Handles: Supabase REST fetching, Chart.js rendering,
 *          auto-refresh, offline detection, alert system,
 *          AOS animations, nav, docs panel, PDF viewer.
 */

/* ════════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════════ */
const SUPABASE_URL    = 'https://eyfhlcmdhpewovrbixdh.supabase.co';
const SUPABASE_KEY    = 'sb_publishable_JXV4aeRf6k51VyrfMPwNvA_SqibyY3n';
const REFRESH_MS      = 3_000;
const OFFLINE_MS      = 30_000;
const CHART_POINTS    = 20;
const GAS_ALERT_LIMIT = 150;

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
  // Header — FIX: was $('device-status'), index.html uses id="nav-device-status"
  deviceStatus:   $('nav-device-status'),
  lastUpdateTime: $('last-update-time'),
  refreshCounter: $('refresh-counter'),
};

/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */
let gasChart       = null;
let tempChart      = null;
let humidChart     = null;
let refreshTimer   = null;
let countdownTimer = null;
let countdownSec   = REFRESH_MS / 1000;
let isFirstLoad    = true;
let currentChartMode = 'live';   // 'live' | 'hist'
let pdfZoom        = 1;
let pdfOpen        = false;

/* ════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════ */
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function setLoading(active) {
  ['loadGas', 'loadTemp', 'loadHumid'].forEach(key => {
    el[key].classList.toggle('active', active);
  });
}

function showError(msg) {
  el.errorBanner.classList.remove('hidden');
  el.errorMsg.textContent = msg;
}

function clearError() {
  el.errorBanner.classList.add('hidden');
  el.errorMsg.textContent = '';
}

/* ════════════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════════════ */

/** Smooth-scroll to any section by its id. */
function smoothTo(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: 'smooth' });
}

/** Toggle the mobile hamburger menu. */
function toggleMobileNav() {
  const menu = document.getElementById('mobile-menu');
  if (menu) menu.classList.toggle('open');
}

/** Add .scrolled class to nav when page is scrolled. */
function initNavScroll() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
}

/* ════════════════════════════════════════════════════════════════
   ANIMATE ON SCROLL (AOS)
   ════════════════════════════════════════════════════════════════ */
function initAOS() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('[data-aos]').forEach(el => observer.observe(el));
}

/* ════════════════════════════════════════════════════════════════
   PARTICLE CANVAS
   ════════════════════════════════════════════════════════════════ */
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function spawn() {
    particles = [];
    const count = Math.max(40, Math.floor((W * H) / 18000));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.1 + 0.2,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        alpha: Math.random() * 0.45 + 0.08
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,200,240,${p.alpha})`;
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); spawn(); }, { passive: true });
  resize();
  spawn();
  draw();
}

/* ════════════════════════════════════════════════════════════════
   DEVICE STATUS
   ════════════════════════════════════════════════════════════════ */
function updateDeviceStatus(latestRow) {
  const statusEl = el.deviceStatus;
  if (!statusEl) return;
  const labelEl  = statusEl.querySelector('.status-label');

  if (!latestRow) {
    statusEl.className = 'status-pill status-offline';
    if (labelEl) labelEl.textContent = 'OFFLINE';
    return;
  }

  const ageMs = Date.now() - new Date(latestRow.created_at).getTime();
  if (ageMs > OFFLINE_MS) {
    statusEl.className = 'status-pill status-offline';
    if (labelEl) labelEl.textContent = 'OFFLINE';
  } else {
    statusEl.className = 'status-pill status-online';
    if (labelEl) labelEl.textContent = 'ONLINE';
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
Chart.defaults.color       = '#567090';
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size   = 10;

const chartGridColor = 'rgba(0,212,255,0.06)';
const chartTickColor = '#2a4060';

function buildChartOptions(yLabel, lineColor) {
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
  const ctxGas   = document.getElementById('chart-gas').getContext('2d');
  const ctxTemp  = document.getElementById('chart-temp').getContext('2d');
  const ctxHumid = document.getElementById('chart-humid').getContext('2d');

  // Gas gradient
  const gasGrad = ctxGas.createLinearGradient(0, 0, 0, 220);
  gasGrad.addColorStop(0, 'rgba(0,200,240,0.22)');
  gasGrad.addColorStop(1, 'rgba(0,200,240,0.00)');

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

  // ── Gas chart (FIX: was missing entirely) ──
  gasChart = new Chart(ctxGas, {
    type: 'line',
    data: {
      labels: [...emptyLabels],
      datasets: [{
        label: 'Gas (ppm)',
        data: [...emptyData],
        borderColor: '#00c8f0',
        backgroundColor: gasGrad,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#00c8f0',
        pointBorderColor: 'transparent',
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4,
      }]
    },
    options: buildChartOptions('ppm', '#00c8f0')
  });

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
   CHART MODE TOGGLE  (live = 20 pts | hist = 50 pts)
   ════════════════════════════════════════════════════════════════ */
async function setChartMode(mode) {
  currentChartMode = mode;

  const btnLive = $('btn-live');
  const btnHist = $('btn-hist');
  if (btnLive) btnLive.classList.toggle('active', mode === 'live');
  if (btnHist) btnHist.classList.toggle('active', mode === 'hist');

  const sub = $('chart-gas-mode');
  if (sub) sub.textContent = mode === 'live'
    ? 'LAST 20 READINGS · MQ135 PPM'
    : 'LAST 50 READINGS · MQ135 PPM (HISTORICAL)';

  // Immediate refresh with new limit
  await tick();
}

/* ════════════════════════════════════════════════════════════════
   UPDATE CHARTS
   ════════════════════════════════════════════════════════════════ */
function updateCharts(rows) {
  const ordered = [...rows].reverse();

  const labels = ordered.map(r => fmtTime(r.created_at));
  const gases  = ordered.map(r => r.mq135       != null ? r.mq135                            : null);
  const temps  = ordered.map(r => r.temperature != null ? +Number(r.temperature).toFixed(1)  : null);
  const humids = ordered.map(r => r.humidity    != null ? +Number(r.humidity).toFixed(1)     : null);

  // Gas chart (FIX: was not being updated)
  gasChart.data.labels             = labels;
  gasChart.data.datasets[0].data   = gases;

  tempChart.data.labels            = labels;
  tempChart.data.datasets[0].data  = temps;

  humidChart.data.labels           = labels;
  humidChart.data.datasets[0].data = humids;

  gasChart.update('none');
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

  // ── Hero stat pills (FIX: were never updated from live data) ──
  const heroGas   = $('hero-gas');
  const heroTemp  = $('hero-temp');
  const heroHumid = $('hero-humid');
  if (heroGas)   heroGas.textContent   = gas   ?? '—';
  if (heroTemp)  heroTemp.textContent  = temp  != null ? Number(temp).toFixed(1)  : '—';
  if (heroHumid) heroHumid.textContent = humid != null ? Number(humid).toFixed(1) : '—';

  // ── Header timestamp ──
  if (el.lastUpdateTime) el.lastUpdateTime.textContent = fmtTime(latest.created_at);
}

/* ════════════════════════════════════════════════════════════════
   UPDATE MINI STATS
   ════════════════════════════════════════════════════════════════ */
function updateMiniStats(rows) {
  const gasVals   = rows.map(r => r.mq135).filter(v => v != null);
  const tempVals  = rows.map(r => r.temperature).filter(v => v != null);
  const humidVals = rows.map(r => r.humidity).filter(v => v != null);

  el.statGasMin.textContent  = gasVals.length   ? Math.min(...gasVals) : '—';
  el.statGasMax.textContent  = gasVals.length   ? Math.max(...gasVals) : '—';
  el.statTempAvg.textContent = tempVals.length
    ? (tempVals.reduce((a, b) => a + b, 0) / tempVals.length).toFixed(1) + '°' : '—';
  el.statHumidAvg.textContent = humidVals.length
    ? (humidVals.reduce((a, b) => a + b, 0) / humidVals.length).toFixed(1) + '%' : '—';
}

/* ════════════════════════════════════════════════════════════════
   FETCH — LATEST (1 row)
   ════════════════════════════════════════════════════════════════ */
async function fetchLatest() {
  const url = `${SUPABASE_URL}/rest/v1/sensor_data?select=*&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  const data = await res.json();
  return data[0] ?? null;
}

/* ════════════════════════════════════════════════════════════════
   FETCH — CHART DATA  (respects live/hist mode)
   ════════════════════════════════════════════════════════════════ */
async function fetchChartData() {
  const limit = currentChartMode === 'hist' ? 50 : CHART_POINTS;
  const url = `${SUPABASE_URL}/rest/v1/sensor_data?select=*&order=created_at.desc&limit=${limit}`;
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
    const [latest, chartRows] = await Promise.all([fetchLatest(), fetchChartData()]);

    clearError();
    updateCards(latest);
    updateDeviceStatus(latest);

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
   DOCUMENTATION PANEL
   ════════════════════════════════════════════════════════════════ */

/** Switch the visible doc article and highlight the active nav item. */
function showDoc(id) {
  // Hide all articles
  document.querySelectorAll('.doc-article').forEach(a => a.classList.remove('active-doc'));
  // Show target
  const target = $('doc-' + id);
  if (target) target.classList.add('active-doc');
  // Sync sidebar highlight
  document.querySelectorAll('.dn-item').forEach(btn => btn.classList.remove('active'));
  const active = [...document.querySelectorAll('.dn-item')]
    .find(b => (b.getAttribute('onclick') || '').includes(`'${id}'`));
  if (active) active.classList.add('active');
}

/* ════════════════════════════════════════════════════════════════
   PDF VIEWER
   ════════════════════════════════════════════════════════════════ */

/** Toggle the PDF panel open/closed. */
function togglePdf() {
  pdfOpen = !pdfOpen;
  const panel = $('pdf-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !pdfOpen);
  if (pdfOpen) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Zoom the PDF iframe in or out. */
function zoomPdf(delta) {
  pdfZoom = Math.min(3, Math.max(0.5, pdfZoom + delta));
  const iframe = $('pdf-iframe');
  const label  = $('pdf-zoom-val');
  if (iframe) {
    iframe.style.transformOrigin = 'top left';
    iframe.style.transform       = `scale(${pdfZoom})`;
    iframe.style.width           = `${100 / pdfZoom}%`;
  }
  if (label) label.textContent = Math.round(pdfZoom * 100) + '%';
}

/** Handle file dropped onto the drop zone. */
function handlePdfDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') _loadPdfBlob(file);
}

/** Handle file chosen via <input type="file">. */
function handlePdfFile(event) {
  const file = event.target.files[0];
  if (file) _loadPdfBlob(file);
}

/** Internal: create an object URL and show the iframe. */
function _loadPdfBlob(file) {
  const url         = URL.createObjectURL(file);
  const iframe      = $('pdf-iframe');
  const placeholder = document.querySelector('.pdf-placeholder');
  if (!iframe) return;
  iframe.src = url;
  iframe.classList.remove('hidden');
  if (placeholder) placeholder.style.display = 'none';
}

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initNavScroll();
  initAOS();
  initCharts();
  tick();
  refreshTimer = setInterval(tick, REFRESH_MS);
});