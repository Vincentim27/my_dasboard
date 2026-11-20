/* ============================================================
   script.js  –  Sales Analytics Dashboard
   Alur:
     1. Muat dan parse CSV dengan PapaParse
     2. Isi dropdown filter dari data unik
     3. Render semua KPI & chart
     4. Setiap perubahan filter → filter data → update semua
   ============================================================ */

'use strict';

// ── Palet warna konsisten di seluruh dashboard ──────────────
const PALETTE = {
  blue:   '#3b82f6',
  violet: '#8b5cf6',
  emerald:'#10b981',
  amber:  '#f59e0b',
  rose:   '#f43f5e',
  sky:    '#0ea5e9',
  teal:   '#14b8a6',
  indigo: '#6366f1',
  orange: '#f97316',
  lime:   '#84cc16',
};

// Urutan warna untuk multi-series
const COLOR_LIST = Object.values(PALETTE);

// ── State global ────────────────────────────────────────────
let rawData   = [];      // semua baris CSV setelah parsing
let chartRefs = {};      // referensi Chart.js instance agar bisa di-destroy saat update

// ── Helpers ─────────────────────────────────────────────────

/**
 * Format angka ke format mata uang Rupiah (singkat: juta/miliar)
 * @param {number} val
 * @returns {string}
 */
function formatRupiah(val) {
  if (val >= 1e9)  return 'Rp ' + (val / 1e9).toFixed(2) + ' M';
  if (val >= 1e6)  return 'Rp ' + (val / 1e6).toFixed(2) + ' Jt';
  if (val >= 1e3)  return 'Rp ' + (val / 1e3).toFixed(1) + ' Rb';
  return 'Rp ' + val.toLocaleString('id-ID');
}

/**
 * Format angka biasa dengan pemisah ribuan
 * @param {number} val
 * @returns {string}
 */
function formatNumber(val) {
  return val.toLocaleString('id-ID');
}

/**
 * Kelompokkan array berdasarkan key dan akumulasi value
 * @param {Object[]} data
 * @param {string} key    - kolom yang dijadikan grup
 * @param {string} val    - kolom yang dijumlah
 * @returns {Object}      - { label: total, … }
 */
function groupSum(data, key, val) {
  return data.reduce((acc, row) => {
    const k = row[key] || 'Unknown';
    acc[k] = (acc[k] || 0) + Number(row[val]);
    return acc;
  }, {});
}

/**
 * Kelompokkan berdasarkan key, hitung jumlah baris
 * @param {Object[]} data
 * @param {string} key
 * @returns {Object}
 */
function groupCount(data, key) {
  return data.reduce((acc, row) => {
    const k = row[key] || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Destroy chart instance lama agar canvas bisa digunakan ulang
 * @param {string} id - key di chartRefs
 */
function destroyChart(id) {
  if (chartRefs[id]) {
    chartRefs[id].destroy();
    delete chartRefs[id];
  }
}

// Konfigurasi default tooltip Chart.js
function tooltipDefaults() {
  return {
    backgroundColor: '#1e293b',
    titleColor: '#f8fafc',
    bodyColor: '#cbd5e1',
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxWidth: 10,
    boxHeight: 10,
  };
}

// ── 1. MUAT CSV ──────────────────────────────────────────────
/**
 * Menggunakan PapaParse untuk parse file CSV lokal.
 * File CSV harus berada di folder yang sama dengan HTML.
 */
Papa.parse('data/sales_data.csv', {
  download: true,
  header: true,         // baris pertama = header
  skipEmptyLines: true,
  dynamicTyping: false, // kita konversi manual agar kontrol lebih
  complete: function (results) {
    rawData = results.data;

    // Sembunyikan loading overlay
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');

    // Isi dropdown filter
    populateFilters();

    // Render dashboard awal (tanpa filter)
    updateDashboard();
  },
  error: function (err) {
    console.error('Gagal memuat CSV:', err);
    document.getElementById('loadingOverlay').innerHTML =
      '<p class="text-red-500 font-medium">❌ Gagal memuat data. Pastikan file CSV tersedia.</p>';
  }
});

// ── 2. POPULATE FILTER DROPDOWNS ────────────────────────────
/**
 * Mengambil nilai unik dari data dan mengisi elemen <select>
 */
function populateFilters() {
  const fields = {
    filterRegion:   'region',
    filterCategory: 'category',
    filterCustomer: 'customer_type',
    filterChannel:  'channel',
  };

  for (const [selectId, field] of Object.entries(fields)) {
    const sel = document.getElementById(selectId);
    // Ambil nilai unik, urutkan
    const unique = [...new Set(rawData.map(r => r[field]))].sort();
    unique.forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    });

    // Pasang event listener — setiap perubahan trigger update
    sel.addEventListener('change', updateDashboard);
  }

  // Tombol reset
  document.getElementById('btnReset').addEventListener('click', resetFilters);
}

// ── 3. FILTER DATA ───────────────────────────────────────────
/**
 * Membaca nilai dari semua dropdown, lalu filter rawData
 * @returns {Object[]} filtered rows
 */
function getFilteredData() {
  const region   = document.getElementById('filterRegion').value;
  const category = document.getElementById('filterCategory').value;
  const customer = document.getElementById('filterCustomer').value;
  const channel  = document.getElementById('filterChannel').value;

  return rawData.filter(row => {
    if (region   && row.region        !== region)   return false;
    if (category && row.category      !== category) return false;
    if (customer && row.customer_type !== customer) return false;
    if (channel  && row.channel       !== channel)  return false;
    return true;
  });
}

/**
 * Reset semua filter ke nilai default
 */
function resetFilters() {
  ['filterRegion','filterCategory','filterCustomer','filterChannel'].forEach(id => {
    document.getElementById(id).value = '';
  });
  updateDashboard();
}

// ── 4. UPDATE DASHBOARD ──────────────────────────────────────
/**
 * Entry point utama: dipanggil saat halaman pertama load
 * atau ketika salah satu filter berubah.
 */
function updateDashboard() {
  const data = getFilteredData();

  // Update badge jumlah record
  document.getElementById('recordBadge').textContent =
    `${formatNumber(data.length)} dari ${formatNumber(rawData.length)} transaksi`;

  renderKPI(data);
  renderTrend(data);
  renderRegion(data);
  renderCategory(data);
  renderQtyCategory(data);
  renderSalesRep(data);
  renderCustomerType(data);
  renderPayment(data);
  renderChannel(data);
  renderScatter(data);
  renderTop10(data);
}

// ── 5. KPI CARDS ─────────────────────────────────────────────
function renderKPI(data) {
  const totalRevenue  = data.reduce((s, r) => s + Number(r.revenue),      0);
  const totalQty      = data.reduce((s, r) => s + Number(r.quantity),     0);
  const totalDiscount = data.reduce((s, r) => s + Number(r.discount_pct), 0);
  const avgDiscount   = data.length > 0 ? totalDiscount / data.length : 0;

  document.getElementById('valRevenue').textContent  = formatRupiah(totalRevenue);
  document.getElementById('valTx').textContent       = formatNumber(data.length);
  document.getElementById('valQty').textContent      = formatNumber(totalQty);
  document.getElementById('valDiscount').textContent = avgDiscount.toFixed(1) + '%';
}

// ── 6. SALES TREND (LINE CHART – BULANAN) ────────────────────
function renderTrend(data) {
  // Kelompokkan revenue per bulan (YYYY-MM)
  const monthly = {};
  data.forEach(row => {
    const month = row.date ? row.date.slice(0, 7) : 'Unknown';
    monthly[month] = (monthly[month] || 0) + Number(row.revenue);
  });

  // Urutkan bulan secara kronologis
  const labels  = Object.keys(monthly).sort();
  const values  = labels.map(m => monthly[m]);

  // Format label ke nama bulan Indonesia
  const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
  const shortLabels = labels.map(m => {
    const [year, mon] = m.split('-');
    return `${monthNames[parseInt(mon, 10) - 1]} '${year.slice(2)}`;
  });

  destroyChart('trend');
  const ctx = document.getElementById('chartTrend').getContext('2d');

  // Gradient fill di bawah garis
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(59,130,246,0.25)');
  gradient.addColorStop(1, 'rgba(59,130,246,0.01)');

  chartRefs.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: shortLabels,
      datasets: [{
        label: 'Revenue',
        data: values,
        borderColor: PALETTE.blue,
        backgroundColor: gradient,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: PALETTE.blue,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipDefaults(),
          callbacks: {
            label: ctx => ' ' + formatRupiah(ctx.raw),
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback: v => formatRupiah(v),
          }
        }
      }
    }
  });
}

// ── 7. REVENUE PER REGION (DOUGHNUT) ────────────────────────
function renderRegion(data) {
  const grouped = groupSum(data, 'region', 'revenue');
  const labels  = Object.keys(grouped);
  const values  = Object.values(grouped);

  destroyChart('region');
  chartRefs.region = new Chart(
    document.getElementById('chartRegion').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: COLOR_LIST.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: {
              label: ctx => ` ${ctx.label}: ${formatRupiah(ctx.raw)}`,
            }
          }
        }
      }
    }
  );
}

// ── 8. REVENUE PER CATEGORY (HORIZONTAL BAR) ────────────────
function renderCategory(data) {
  const grouped = groupSum(data, 'category', 'revenue');
  // Urutkan descending
  const sorted  = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const labels  = sorted.map(e => e[0]);
  const values  = sorted.map(e => e[1]);

  destroyChart('category');
  chartRefs.category = new Chart(
    document.getElementById('chartCategory').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: values,
          backgroundColor: COLOR_LIST.slice(0, labels.length).map(c => c + 'cc'),
          borderColor:     COLOR_LIST.slice(0, labels.length),
          borderWidth: 1.5,
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',      // horizontal bar
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: { label: ctx => ' ' + formatRupiah(ctx.raw) }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 10 }, callback: v => formatRupiah(v) }
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    }
  );
}

// ── 9. QUANTITY PER CATEGORY (BAR) ───────────────────────────
function renderQtyCategory(data) {
  const grouped = groupSum(data, 'category', 'quantity');
  const sorted  = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const labels  = sorted.map(e => e[0]);
  const values  = sorted.map(e => e[1]);

  destroyChart('qtyCategory');
  chartRefs.qtyCategory = new Chart(
    document.getElementById('chartQtyCategory').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Qty',
          data: values,
          backgroundColor: PALETTE.emerald + 'bb',
          borderColor: PALETTE.emerald,
          borderWidth: 1.5,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: { label: ctx => ' Qty: ' + formatNumber(ctx.raw) }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 11 }, callback: v => formatNumber(v) }
          }
        }
      }
    }
  );
}

// ── 10. REVENUE PER SALES REP (HORIZONTAL BAR) ───────────────
function renderSalesRep(data) {
  const grouped = groupSum(data, 'sales_rep', 'revenue');
  const sorted  = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const labels  = sorted.map(e => e[0]);
  const values  = sorted.map(e => e[1]);

  destroyChart('salesRep');
  chartRefs.salesRep = new Chart(
    document.getElementById('chartSalesRep').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: values,
          backgroundColor: PALETTE.indigo + 'bb',
          borderColor: PALETTE.indigo,
          borderWidth: 1.5,
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: { label: ctx => ' ' + formatRupiah(ctx.raw) }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 10 }, callback: v => formatRupiah(v) }
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    }
  );
}

// ── 11. CUSTOMER TYPE (PIE CHART) ────────────────────────────
function renderCustomerType(data) {
  const grouped = groupCount(data, 'customer_type');
  const labels  = Object.keys(grouped);
  const values  = Object.values(grouped);

  destroyChart('customer');
  chartRefs.customer = new Chart(
    document.getElementById('chartCustomer').getContext('2d'), {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: [PALETTE.blue, PALETTE.violet, PALETTE.emerald],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    }
  );
}

// ── 12. PAYMENT METHOD (DOUGHNUT) ────────────────────────────
function renderPayment(data) {
  const grouped = groupCount(data, 'payment_method');
  const sorted  = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const labels  = sorted.map(e => e[0]);
  const values  = sorted.map(e => e[1]);

  destroyChart('payment');
  chartRefs.payment = new Chart(
    document.getElementById('chartPayment').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: [PALETTE.amber, PALETTE.rose, PALETTE.sky, PALETTE.teal, PALETTE.orange],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    }
  );
}

// ── 13. SALES CHANNEL (PIE CHART) ────────────────────────────
function renderChannel(data) {
  const grouped = groupCount(data, 'channel');
  const labels  = Object.keys(grouped);
  const values  = Object.values(grouped);

  destroyChart('channel');
  chartRefs.channel = new Chart(
    document.getElementById('chartChannel').getContext('2d'), {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: [PALETTE.sky, PALETTE.orange, PALETTE.lime],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    }
  );
}

// ── 14. DISCOUNT vs REVENUE (SCATTER PLOT) ───────────────────
function renderScatter(data) {
  // Scatter: titik = satu transaksi, x = discount_pct, y = revenue
  // Batasi 300 titik untuk performa (ambil acak jika lebih)
  const sample = data.length > 300
    ? data.slice().sort(() => Math.random() - 0.5).slice(0, 300)
    : data;

  // Kelompokkan per kategori untuk warna berbeda
  const categories = [...new Set(data.map(r => r.category))].sort();
  const datasets = categories.map((cat, i) => {
    const pts = sample
      .filter(r => r.category === cat)
      .map(r => ({ x: Number(r.discount_pct), y: Number(r.revenue) }));
    return {
      label: cat,
      data: pts,
      backgroundColor: COLOR_LIST[i % COLOR_LIST.length] + '99',
      pointRadius: 4,
      pointHoverRadius: 6,
    };
  });

  destroyChart('scatter');
  chartRefs.scatter = new Chart(
    document.getElementById('chartScatter').getContext('2d'), {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: {
              label: ctx =>
                ` ${ctx.dataset.label}: Diskon ${ctx.raw.x}% | Rev ${formatRupiah(ctx.raw.y)}`,
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Diskon (%)', font: { size: 11 } },
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 10 } }
          },
          y: {
            title: { display: true, text: 'Revenue', font: { size: 11 } },
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 10 }, callback: v => formatRupiah(v) }
          }
        }
      }
    }
  );
}

// ── 15. TOP 10 PRODUK (HORIZONTAL BAR) ───────────────────────
function renderTop10(data) {
  // Jumlahkan revenue per produk, ambil top 10
  const grouped = groupSum(data, 'product', 'revenue');
  const sorted  = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);

  // Gradasi warna dari biru gelap ke biru muda
  const bgColors = labels.map((_, i) => {
    const alpha = 1 - (i * 0.07);
    return `rgba(59,130,246,${alpha.toFixed(2)})`;
  });

  destroyChart('top10');
  chartRefs.top10 = new Chart(
    document.getElementById('chartTop10').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: values,
          backgroundColor: bgColors,
          borderColor: PALETTE.blue,
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipDefaults(),
            callbacks: { label: ctx => ' ' + formatRupiah(ctx.raw) }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 10 }, callback: v => formatRupiah(v) }
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    }
  );
}
