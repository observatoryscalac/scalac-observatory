/* SCALAC HPC Observatory – front-end logic (no build step required). */
(() => {
  "use strict";

  const DATA = (window.SCALAC_DATA && window.SCALAC_DATA.machines) || [];
  const params = new URLSearchParams(location.search);
  if (params.has("embed")) document.body.classList.add("embed");

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const flag = (iso) => iso && iso.length === 2 ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const nfc = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const fmtTF = (v) => !isNum(v) || v === 0 ? "—" : v >= 1000 ? `${nf1.format(v / 1000)} PF` : `${nf1.format(v)} TF`;
  const fmtPct = (v) => isNum(v) ? `${nf1.format(v)}%` : "n/a";
  const hasGpu = (m) => m.gpuCount > 0 || m.rpeakGpuFp16 > 0;
  const staff = (p) => p.full + p.half + p.simple;

  const COLORS = { gpu: "#f2a612", cpu: "#6fa0ff", gold: "#e6b25c", blue: "#0345bf" };

  // ---------- metrics ----------
  // agg: how to combine several machines (sum or utilization weighted by core-hours)
  const utilAgg = (ms) => {
    let a = 0, d = 0;
    ms.forEach((m) => { const u = m.usage; if (isNum(u.allocated) && isNum(u.reported)) { a += u.allocated; d += u.reported - (u.down || 0); } });
    return d > 0 ? (100 * a) / d : null;
  };
  const sum = (key) => (ms) => ms.reduce((s, m) => s + (isNum(key(m)) ? key(m) : 0), 0);
  const METRICS = {
    rpeakTotal: { label: "Peak performance (CPU FP64 + GPU FP16)", short: "Rpeak total", get: (m) => m.rpeakCpuFp64 + m.rpeakGpuFp16, fmt: fmtTF },
    rpeakCpuFp64: { label: "Rpeak CPU FP64 (TFlop/s)", short: "CPU FP64", get: (m) => m.rpeakCpuFp64, fmt: fmtTF },
    rpeakGpuFp16: { label: "Rpeak GPU FP16 (TFlop/s)", short: "GPU FP16", get: (m) => m.rpeakGpuFp16, fmt: fmtTF },
    activeUsers: { label: "Active users", short: "Users", get: (m) => m.activeUsers, fmt: (v) => isNum(v) ? nf0.format(v) : "n/a" },
    pctUse: { label: "Utilization (% use over available)", short: "Utilization", get: (m) => m.usage.pctUse, fmt: fmtPct, agg: utilAgg, max: 100 },
    reported: { label: "Capacity (core-hours / year)", short: "Core-hours", get: (m) => m.usage.reported, fmt: (v) => isNum(v) && v ? nfc.format(v) : "n/a" },
    gpuCount: { label: "Number of GPUs / accelerators", short: "GPUs", get: (m) => m.gpuCount, fmt: (v) => nf0.format(v || 0) },
    nodeCount: { label: "Number of nodes", short: "Nodes", get: (m) => m.nodeCount, fmt: (v) => nf0.format(v || 0) },
    staff: { label: "Operating personnel", short: "Staff", get: (m) => staff(m.personnel), fmt: (v) => nf0.format(v || 0) },
  };
  const aggOf = (key, ms) => (METRICS[key].agg || sum(METRICS[key].get))(ms);

  // ---------- state ----------
  const state = {
    metric: "rpeakTotal",
    countryMetric: "rpeakTotal",
    countries: new Set(),
    accel: "all",
    q: "",
    selected: null,
    sort: { key: "rpeakTotal", dir: "desc" },
  };

  const countryList = [...new Map(DATA.map((m) => [m.country, m.countryName])).entries()]
    .map(([iso, name]) => ({ iso, name, n: DATA.filter((m) => m.country === iso).length }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    return DATA.filter((m) =>
      (!state.countries.size || state.countries.has(m.country)) &&
      (state.accel === "all" || (state.accel === "gpu" ? hasGpu(m) : !hasGpu(m))) &&
      (!q || [m.name, m.shortName, m.institution, m.institutionFull, m.city, m.countryName, ...m.gpus.map((g) => g.name), ...m.cpus.map((c) => c.name)]
        .some((s) => s && s.toLowerCase().includes(q)))
    );
  };

  // ---------- spread co-located machines (same city) ----------
  (() => {
    const groups = new Map();
    DATA.forEach((m) => {
      const k = `${Math.round(m.lat * 4)}:${Math.round(m.lon * 4)}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(m);
    });
    groups.forEach((g) => {
      g.forEach((m, i) => {
        if (g.length === 1) { m.plat = m.lat; m.plon = m.lon; return; }
        const a = (2 * Math.PI * i) / g.length, r = 0.28 + 0.04 * g.length;
        m.plat = m.lat + r * Math.sin(a);
        m.plon = m.lon + (r * Math.cos(a)) / Math.cos((m.lat * Math.PI) / 180);
      });
    });
  })();

  // ---------- KPIs ----------
  function renderKpis() {
    const insts = new Set(DATA.map((m) => m.institution)).size;
    const cpu = sum((m) => m.rpeakCpuFp64)(DATA), gpu = sum((m) => m.rpeakGpuFp16)(DATA);
    const items = [
      [DATA.length, "", "HPC systems"],
      [insts, "", "Institutions"],
      [countryList.length, "", "Countries"],
      [nf1.format(cpu / 1000), "PFlop/s", "Rpeak CPU FP64"],
      [nf0.format(gpu / 1000), "PFlop/s", "Rpeak GPU FP16"],
      [nf0.format(sum((m) => m.gpuCount)(DATA)), "", "GPUs / accelerators"],
      [nf0.format(sum((m) => m.activeUsers)(DATA)), "", "Active users"],
      [nf0.format(utilAgg(DATA)), "%", "Avg. utilization"],
    ];
    $("#kpis").innerHTML = items.map(([v, u, l]) => `<div class="kpi"><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div><div class="l">${l}</div></div>`).join("");
  }

  // ---------- controls ----------
  function setupControls() {
    const opts = Object.entries(METRICS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("");
    $("#metric").innerHTML = opts;
    $("#countryMetric").innerHTML = opts;
    $("#metric").value = state.metric;
    $("#countryMetric").value = state.countryMetric;
    $("#metric").addEventListener("change", (e) => { state.metric = e.target.value; update(); });
    $("#countryMetric").addEventListener("change", (e) => { state.countryMetric = e.target.value; renderCountryChart(); });
    $("#search").addEventListener("input", (e) => { state.q = e.target.value; update(); });
    $("#accel").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.accel = b.dataset.v;
      [...$("#accel").children].forEach((x) => x.classList.toggle("on", x === b));
      update();
    });
    $("#countryChips").innerHTML = countryList.map((c) => `<button class="chip" data-iso="${c.iso}" title="${esc(c.name)}">${flag(c.iso)} ${esc(c.name)}<span class="n">${c.n}</span></button>`).join("");
    $("#countryChips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) toggleCountry(b.dataset.iso); });
  }

  function toggleCountry(iso) {
    state.countries.has(iso) ? state.countries.delete(iso) : state.countries.add(iso);
    update();
    if (state.countries.size === 1 && globe) {
      const ms = DATA.filter((m) => m.country === iso);
      const lat = ms.reduce((s, m) => s + m.lat, 0) / ms.length, lng = ms.reduce((s, m) => s + m.lon, 0) / ms.length;
      globe.pointOfView({ lat, lng, altitude: 1.1 }, 1200);
    }
  }

  // ---------- globe ----------
  let globe = null, countriesGeo = [], autoRotate = false;
  const LATAM = new Set(["Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Costa Rica", "Cuba", "Dominican Rep.", "Ecuador", "El Salvador", "Guatemala", "Haiti", "Honduras", "Mexico", "Nicaragua", "Panama", "Paraguay", "Peru", "Puerto Rico", "Uruguay", "Venezuela", "Jamaica", "Trinidad and Tobago", "Belize", "Guyana", "Suriname", "Bahamas"]);
  const DEFAULT_POV = { lat: -14, lng: -66, altitude: window.innerWidth < 860 ? 2.3 : 1.75 };

  function maxOf(key) { return Math.max(1, ...DATA.map((m) => METRICS[key].get(m)).filter(isNum)); }

  function tipHtml(m) {
    const M = METRICS[state.metric];
    return `<div class="globe-tip"><b>${esc(m.name)}</b><div class="s">${flag(m.country)} ${esc(m.institution)} · ${esc(m.city)}</div><div class="m">${M.short}: ${M.fmt(M.get(m))}</div></div>`;
  }

  function initGlobe() {
    const el = $("#globeViz");
    if (typeof Globe !== "function") { $("#globeLoading").textContent = "The 3D globe could not be loaded (check your connection). The tables below still work."; return; }
    globe = Globe()(el)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true).atmosphereColor("#4d7cff").atmosphereAltitude(0.2)
      .pointLat("plat").pointLng("plon")
      .pointRadius(0.42)
      .pointsMerge(false)
      .pointsTransitionDuration(700)
      .pointColor((m) => (state.selected === m ? "#ffffff" : hasGpu(m) ? COLORS.gpu : COLORS.cpu))
      .pointLabel(tipHtml)
      .onPointClick((m) => select(m, true))
      .onPointHover((m) => { el.style.cursor = m ? "pointer" : ""; })
      .ringLat("plat").ringLng("plon")
      .ringColor(() => (t) => `rgba(242,166,18,${1 - t})`)
      .ringMaxRadius(3.2).ringPropagationSpeed(2.2).ringRepeatPeriod(1000)
      .polygonAltitude(0.008)
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => "rgba(186,208,255,0.28)")
      .polygonCapColor(capColor)
      .polygonLabel((f) => {
        const ms = DATA.filter((m) => m.countryName === f.properties.name);
        if (!ms.length) return "";
        return `<div class="globe-tip"><b>${esc(f.properties.name)}</b><div class="s">${ms.length} system${ms.length > 1 ? "s" : ""}</div><div class="m">${METRICS[state.metric].short}: ${METRICS[state.metric].fmt(aggOf(state.metric, ms))}</div></div>`;
      })
      .onPolygonClick((f) => { const c = countryList.find((x) => x.name === f.properties.name); if (c) toggleCountry(c.iso); });

    const mat = globe.globeMaterial();
    mat.color.set("#0b1250");
    if (mat.emissive) mat.emissive.set("#060a35");
    mat.shininess = 8;

    const controls = globe.controls();
    controls.autoRotate = false; controls.autoRotateSpeed = 0.5;
    controls.minDistance = 130; controls.maxDistance = 700;

    const resize = () => { const w = el.parentElement; globe.width(w.clientWidth).height(w.clientHeight); };
    new ResizeObserver(resize).observe(el.parentElement);
    resize();
    const intro = () => { if (!state.selected) globe.pointOfView(DEFAULT_POV, 1200); };
    globe.pointOfView(DEFAULT_POV);
    globe.onGlobeReady(intro);
    setTimeout(intro, 400);

    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json")
      .then((r) => r.json())
      .then((topo) => { countriesGeo = topojson.feature(topo, topo.objects.countries).features; globe.polygonsData(countriesGeo); })
      .catch(() => {})
      .finally(() => { $("#globeLoading").remove(); });

    $("#btnReset").addEventListener("click", () => { globe.pointOfView(DEFAULT_POV, 1000); select(null); });
    $("#btnRotate").addEventListener("click", (e) => { autoRotate = !autoRotate; controls.autoRotate = autoRotate; e.currentTarget.classList.toggle("on", autoRotate); });
  }

  function capColor(f) {
    const n = f.properties.name;
    const iso = countryList.find((c) => c.name === n)?.iso;
    if (iso) {
      if (state.countries.size && !state.countries.has(iso)) return "rgba(3,69,191,0.22)";
      return state.countries.has(iso) ? "rgba(230,178,92,0.45)" : "rgba(3,69,191,0.62)";
    }
    return LATAM.has(n) ? "rgba(90,115,215,0.32)" : "rgba(160,175,230,0.13)";
  }

  function updateGlobe(list) {
    if (!globe) return;
    const key = state.metric, max = METRICS[key].max || maxOf(key);
    globe
      .pointAltitude((m) => { const v = METRICS[key].get(m); return isNum(v) && v > 0 ? 0.015 + 0.42 * Math.sqrt(v / max) : 0.006; })
      .pointColor(globe.pointColor())
      .pointsData(list)
      .ringsData(state.selected && list.includes(state.selected) ? [state.selected] : [])
      .polygonCapColor(capColor);
  }

  // ---------- detail panel ----------
  function select(m, fly) {
    state.selected = m;
    renderDetail();
    updateGlobe(filtered());
    if (m && fly && globe) globe.pointOfView({ lat: m.plat, lng: m.plon, altitude: 0.9 }, 1100);
    if (m) history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), machine: m.name })}${location.hash}`);
  }

  function renderDetail() {
    const el = $("#detail"), m = state.selected;
    if (!m) {
      const list = filtered(), M = METRICS[state.metric];
      const top = list.filter((x) => isNum(M.get(x))).sort((a, b) => M.get(b) - M.get(a)).slice(0, 10);
      el.innerHTML = `<div class="detail-empty"><h2 class="panel-title">System details</h2>
        <p>Select a bar on the globe or a row in the table to see the indicators of a machine.</p>
        <div class="top-title">Top systems · ${esc(M.short)}</div>
        ${top.map((x, i) => `<div class="top-row" data-id="${x.id}"><span class="rk">${i + 1}</span><span>${esc(x.name)}<span class="sub">${flag(x.country)} ${esc(x.institution)}</span></span><span class="val">${M.fmt(M.get(x))}</span></div>`).join("")}</div>`;
      el.querySelectorAll(".top-row").forEach((r) => r.addEventListener("click", () => select(DATA.find((x) => x.id === +r.dataset.id), true)));
      return;
    }
    const u = m.usage, gpu = hasGpu(m);
    const stat = (v, l, unit = "") => `<div class="d-stat"><div class="v">${v}${unit ? `<small>${unit}</small>` : ""}</div><div class="l">${l}</div></div>`;
    const list = (arr) => arr.length ? `<ul class="d-list">${arr.map((x) => `<li><span>${esc(x.name)}</span><b>× ${nf0.format(x.count)}</b></li>`).join("")}</ul>` : `<p class="muted" style="color:#8f9bc6">—</p>`;
    let usage = `<p style="color:#8f9bc6;font-size:.85rem;margin:0">No accounting data reported.</p>`;
    if (isNum(u.reported) && u.reported > 0) {
      const segs = [["Allocated", u.allocated, COLORS.blue], ["Idle", u.idle, "#5d6aa8"], ["Planned", u.planned, COLORS.gold], ["Down", u.down, "#e05a5a"]].filter((s) => isNum(s[1]) && s[1] > 0);
      const tot = segs.reduce((s, x) => s + x[1], 0) || 1;
      usage = `<div class="stack">${segs.map(([l, v, c]) => `<span style="width:${(100 * v) / tot}%;background:${c}" title="${l}: ${nf0.format(v)} core-hours"></span>`).join("")}</div>
        <div class="stack-legend">${segs.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l} ${nf1.format((100 * v) / tot)}%</span>`).join("")}</div>
        <p style="color:#8f9bc6;font-size:.78rem;margin:8px 0 0">${nf0.format(u.reported)} core-hours reported in the period.</p>`;
    }
    el.innerHTML = `
      <div class="d-head"><div>
        <h2 class="d-name">${esc(m.name)}</h2>
        <p class="d-inst">${esc(m.institutionFull)}</p>
        <p class="d-loc">${flag(m.country)} ${esc(m.city)}, ${esc(m.countryName)}</p>
        <span class="tag ${gpu ? "gpu" : "cpu"}">${gpu ? "GPU-accelerated" : "CPU only"}</span>
      </div><button class="d-close" aria-label="Close details">×</button></div>
      <div class="d-grid">
        ${stat(fmtTF(m.rpeakCpuFp64), "Rpeak CPU FP64")}
        ${stat(fmtTF(m.rpeakGpuFp16), "Rpeak GPU FP16")}
        ${stat(fmtPct(u.pctUse), "Utilization")}
        ${stat(fmtPct(u.pctDown), "Downtime")}
        ${stat(isNum(m.activeUsers) ? nf0.format(m.activeUsers) : "n/a", "Active users")}
        ${stat(`${m.personnel.full}/${m.personnel.half}/${m.personnel.simple}`, "Staff (full/half/simple)")}
        ${stat(nf0.format(m.nodeCount), "Nodes")}
        ${stat(`${nf0.format(m.cpuCount)} / ${nf0.format(m.gpuCount)}`, "CPU / GPU packages")}
        ${stat(isNum(m.peakPowerKW) && m.peakPowerKW ? nf1.format(m.peakPowerKW) : "n/a", "Cluster peak power", isNum(m.peakPowerKW) && m.peakPowerKW ? "kW" : "")}
        ${stat(isNum(m.pue) ? m.pue : "n/a", `Data-center PUE${isNum(m.dcMaxPowerKW) ? ` · ${nf0.format(m.dcMaxPowerKW)} kW max` : ""}`)}
      </div>
      <div class="d-sec">Core-hours usage</div>${usage}
      <div class="d-sec">Node models</div>${list(m.nodes)}
      <div class="d-sec">CPUs</div>${list(m.cpus)}
      ${m.gpus.length ? `<div class="d-sec">GPUs / accelerators</div>${list(m.gpus)}` : ""}
      ${m.usageNote ? `<div class="d-note"><b>Note from the site:</b> ${esc(m.usageNote)}</div>` : ""}`;
    $(".d-close", el).addEventListener("click", () => select(null));
    el.scrollTop = 0;
  }

  // ---------- country chart & table ----------
  function renderCountryChart() {
    const key = state.countryMetric, M = METRICS[key];
    $("#countryChartTitle").textContent = M.short === "Rpeak total" ? "Peak performance" : M.short;
    const rows = countryList.map((c) => ({ ...c, v: aggOf(key, DATA.filter((m) => m.country === c.iso)) }))
      .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    const max = Math.max(1e-9, ...rows.map((r) => r.v || 0));
    $("#countryChart").innerHTML = rows.map((r) => `
      <div class="hbar ${state.countries.has(r.iso) ? "on" : ""}" data-iso="${r.iso}" title="Filter by ${esc(r.name)}">
        <span class="lab">${flag(r.iso)} ${esc(r.name)}</span>
        <span class="track"><span class="fill" style="width:${(100 * (r.v || 0)) / max}%"></span></span>
        <span class="num">${M.fmt(r.v)}</span>
      </div>`).join("");
    $("#countryChart").querySelectorAll(".hbar").forEach((b) => b.addEventListener("click", () => { toggleCountry(b.dataset.iso); document.getElementById("globe").scrollIntoView(); }));
  }

  function vendorOf(name) {
    const n = name.toLowerCase();
    if (/\bmi\d{3}|radeon|instinct/.test(n)) return "AMD";
    if (/gpu max|intel/.test(n)) return "Intel";
    return "NVIDIA";
  }

  function renderVendorChart() {
    const counts = { NVIDIA: 0, AMD: 0, Intel: 0 };
    DATA.forEach((m) => m.gpus.forEach((g) => { counts[vendorOf(g.name)] += g.count; }));
    const tot = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const col = { NVIDIA: "#0345bf", AMD: "#e6b25c", Intel: "#090573" };
    $("#vendorChart").innerHTML = `
      <div class="vendor-bar">${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `<span style="flex:${v};background:${col[k]}" title="${k}: ${nf0.format(v)}">${(100 * v) / tot > 8 ? `${nf0.format((100 * v) / tot)}%` : ""}</span>`).join("")}</div>
      <div class="vendor-legend">${Object.entries(counts).map(([k, v]) => `<span><i style="background:${col[k]}"></i>${k}: <b>${nf0.format(v)}</b></span>`).join("")}</div>`;
  }

  function renderCountryTable() {
    const rows = countryList.map((c) => {
      const ms = DATA.filter((m) => m.country === c.iso);
      return { ...c, cpu: sum((m) => m.rpeakCpuFp64)(ms), gpu: sum((m) => m.rpeakGpuFp16)(ms), gpus: sum((m) => m.gpuCount)(ms), users: sum((m) => m.activeUsers)(ms), util: utilAgg(ms) };
    }).sort((a, b) => b.cpu + b.gpu - (a.cpu + a.gpu));
    $("#countryTable").innerHTML = `<thead><tr><th>Country</th><th class="num">Systems</th><th class="num">CPU FP64</th><th class="num">GPU FP16</th><th class="num">GPUs</th><th class="num">Users</th><th class="num">Util.</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-iso="${r.iso}"><td>${flag(r.iso)} ${esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${fmtTF(r.cpu)}</td><td class="num">${fmtTF(r.gpu)}</td><td class="num">${nf0.format(r.gpus)}</td><td class="num">${nf0.format(r.users)}</td><td class="num">${fmtPct(r.util)}</td></tr>`).join("")}</tbody>`;
    $("#countryTable").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => { toggleCountry(tr.dataset.iso); document.getElementById("globe").scrollIntoView(); }));
  }

  // ---------- machine table ----------
  const COLS = [
    { k: "name", l: "Machine", get: (m) => m.name.toLowerCase(), html: (m) => `<span class="pill" style="background:${hasGpu(m) ? COLORS.gpu : COLORS.cpu}"></span><b>${esc(m.name)}</b>` },
    { k: "country", l: "Country", get: (m) => m.countryName, html: (m) => `${flag(m.country)} ${esc(m.countryName)}` },
    { k: "institution", l: "Institution", get: (m) => m.institution.toLowerCase(), html: (m) => `<span title="${esc(m.institutionFull)}">${esc(m.institution.length > 34 ? m.institution.slice(0, 32) + "…" : m.institution)}</span>` },
    { k: "city", l: "City", get: (m) => m.city, html: (m) => esc(m.city) },
    { k: "rpeakCpuFp64", l: "CPU FP64", num: true, get: (m) => m.rpeakCpuFp64, html: (m) => fmtTF(m.rpeakCpuFp64) },
    { k: "rpeakGpuFp16", l: "GPU FP16", num: true, get: (m) => m.rpeakGpuFp16, html: (m) => fmtTF(m.rpeakGpuFp16) },
    { k: "rpeakTotal", l: "Rpeak total", num: true, get: (m) => m.rpeakCpuFp64 + m.rpeakGpuFp16, html: (m) => fmtTF(m.rpeakCpuFp64 + m.rpeakGpuFp16) },
    { k: "nodeCount", l: "Nodes", num: true, get: (m) => m.nodeCount, html: (m) => nf0.format(m.nodeCount) },
    { k: "gpuCount", l: "GPUs", num: true, get: (m) => m.gpuCount, html: (m) => m.gpuCount ? nf0.format(m.gpuCount) : "—" },
    { k: "activeUsers", l: "Users", num: true, get: (m) => m.activeUsers ?? -1, html: (m) => isNum(m.activeUsers) ? nf0.format(m.activeUsers) : "n/a" },
    { k: "pctUse", l: "Utilization", num: true, get: (m) => m.usage.pctUse ?? -1, html: (m) => isNum(m.usage.pctUse) ? `<span class="util"><span class="b"><i style="width:${Math.min(100, m.usage.pctUse)}%"></i></span>${fmtPct(m.usage.pctUse)}</span>` : "n/a" },
    { k: "pctDown", l: "Downtime", num: true, get: (m) => m.usage.pctDown ?? -1, html: (m) => fmtPct(m.usage.pctDown) },
    { k: "staff", l: "Staff", num: true, get: (m) => staff(m.personnel), html: (m) => nf0.format(staff(m.personnel)) },
  ];

  function renderMachineTable(list) {
    const c = COLS.find((x) => x.k === state.sort.key) || COLS[0], dir = state.sort.dir === "asc" ? 1 : -1;
    const rows = [...list].sort((a, b) => { const x = c.get(a), y = c.get(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    $("#machineTable").innerHTML = `<thead><tr>${COLS.map((x) => `<th data-k="${x.k}" class="${x.num ? "num" : ""}" ${x.k === state.sort.key ? `data-dir="${state.sort.dir}"` : ""}>${x.l}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((m) => `<tr data-id="${m.id}">${COLS.map((x) => { const h = x.html(m); return `<td class="${x.num ? "num" : ""}${h === "n/a" || h === "—" ? " na" : ""}">${h}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
  }

  function setupTable() {
    $("#machineTable").addEventListener("click", (e) => {
      const th = e.target.closest("th");
      if (th) {
        const k = th.dataset.k, col = COLS.find((x) => x.k === k);
        state.sort = { key: k, dir: state.sort.key === k ? (state.sort.dir === "asc" ? "desc" : "asc") : col.num ? "desc" : "asc" };
        renderMachineTable(filtered());
        return;
      }
      const tr = e.target.closest("tbody tr");
      if (tr) { select(DATA.find((m) => m.id === +tr.dataset.id), true); document.getElementById("globe").scrollIntoView(); }
    });
  }

  // ---------- update all ----------
  function update() {
    const list = filtered();
    if (state.selected && !list.includes(state.selected)) state.selected = null;
    document.querySelectorAll("#countryChips .chip").forEach((b) => b.classList.toggle("on", state.countries.has(b.dataset.iso)));
    $("#resultCount").textContent = `${list.length} of ${DATA.length} systems shown`;
    updateGlobe(list);
    renderDetail();
    renderMachineTable(list);
    renderCountryChart();
  }

  // ---------- boot ----------
  renderKpis();
  setupControls();
  setupTable();
  renderVendorChart();
  renderCountryTable();
  initGlobe();
  update();

  const pre = params.get("machine");
  if (pre) { const m = DATA.find((x) => x.name.toLowerCase() === pre.toLowerCase()); if (m) setTimeout(() => select(m, true), 600); }
})();
