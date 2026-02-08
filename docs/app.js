const mapEl = document.getElementById("map");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const loadingEl = document.getElementById("loading");
const errEl = document.getElementById("err");

// ✅ چون سایت از /IranNeu/ سرو میشه و فایل‌ها داخل docs هستند:
const BASE_PATH = location.pathname.includes("/IranNeu/") ? "/IranNeu/docs/" : "./";
const SVG_URL = BASE_PATH + "assets/ir.svg";

// اگر WS واقعی داری اینجا بذار (وگرنه خالی باشه تا Demo فعال شه)
const WS_URL = "";

/** تنظیمات */
const DOT_R = 6;
const SAFE_INSET = 0.04;
const MASK_W = 900;
const MAX_PICK_TRIES = 5000;

/** RNG ثابت */
function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(123456);

/** state */
let svg = null;
let vb = null;
let gDots = null;
let maskData = null;
let maskW = 0, maskH = 0;

const dots = new Map();

function setStatus(txt) { statusEl.textContent = txt; }
function showLoading(on) { loadingEl.style.display = on ? "flex" : "none"; }

function showError(msg) {
  errEl.style.display = "block";
  errEl.textContent = msg;
}

function randXY() {
  const mx = vb.width * SAFE_INSET;
  const my = vb.height * SAFE_INSET;

  const x = vb.x + mx + rand() * (vb.width - 2 * mx);
  const y = vb.y + my + rand() * (vb.height - 2 * my);
  return { x, y };
}

function isInsideByMask(x, y) {
  if (!maskData) return true;

  const u = (x - vb.x) / vb.width;
  const v = (y - vb.y) / vb.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;

  const px = Math.min(maskW - 1, Math.max(0, (u * maskW) | 0));
  const py = Math.min(maskH - 1, Math.max(0, (v * maskH) | 0));

  const idx = (py * maskW + px) * 4;
  return maskData[idx + 3] > 0; // alpha
}

function pickPointInsideIran() {
  for (let t = 0; t < MAX_PICK_TRIES; t++) {
    const p = randXY();
    if (isInsideByMask(p.x, p.y)) return p;
  }
  return randXY();
}

async function buildMaskFromSvg() {
  maskW = MASK_W;
  maskH = Math.max(300, Math.round(MASK_W * (vb.height / vb.width)));

  const NS = "http://www.w3.org/2000/svg";
  const doc = document.implementation.createDocument(NS, "svg", null);
  const msvg = doc.documentElement;

  msvg.setAttribute("xmlns", NS);
  msvg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  msvg.setAttribute("width", String(maskW));
  msvg.setAttribute("height", String(maskH));

  const paths = [...svg.querySelectorAll("path")].filter(p => (p.getAttribute("d") || "").trim());
  if (!paths.length) throw new Error("SVG has no <path>.");

  for (const p of paths) {
    const mp = doc.createElementNS(NS, "path");
    mp.setAttribute("d", p.getAttribute("d"));
    mp.setAttribute("fill", "black");
    mp.setAttribute("stroke", "none");
    msvg.appendChild(mp);
  }

  const txt = new XMLSerializer().serializeToString(msvg);
  const url = URL.createObjectURL(new Blob([txt], { type: "image/svg+xml" }));

  const img = new Image();
  img.decoding = "async";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Mask render failed"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = maskW;
  canvas.height = maskH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  ctx.clearRect(0, 0, maskW, maskH);
  ctx.drawImage(img, 0, 0, maskW, maskH);

  maskData = ctx.getImageData(0, 0, maskW, maskH).data;

  URL.revokeObjectURL(url);
}

function installClipPath() {
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "defs");
  const clip = document.createElementNS(NS, "clipPath");
  clip.setAttribute("id", "iranClip");

  const paths = [...svg.querySelectorAll("path")].filter(p => (p.getAttribute("d") || "").trim());
  for (const p of paths) {
    const cp = document.createElementNS(NS, "path");
    cp.setAttribute("d", p.getAttribute("d"));
    clip.appendChild(cp);
  }

  defs.appendChild(clip);
  svg.prepend(defs);

  gDots = document.createElementNS(NS, "g");
  gDots.setAttribute("id", "dots");
  gDots.setAttribute("clip-path", "url(#iranClip)");
  svg.appendChild(gDots);
}

function syncDots(n) {
  const cur = dots.size;

  if (n > cur) {
    for (let i = cur + 1; i <= n; i++) {
      const { x, y } = pickPointInsideIran();
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(y));
      c.setAttribute("r", String(DOT_R));
      c.setAttribute("class", "dot");
      c.setAttribute("data-id", String(i));

      gDots.appendChild(c);
      dots.set(String(i), c);
    }
  } else if (n < cur) {
    for (let i = cur; i > n; i--) {
      const id = String(i);
      const c = dots.get(id);
      if (c) c.remove();
      dots.delete(id);
    }
  }
}

async function initSvg() {
  showLoading(true);
  setStatus("لود SVG…");

  const res = await fetch(SVG_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`SVG not found: ${SVG_URL} (status ${res.status})`);
  const svgText = await res.text();

  mapEl.innerHTML = "";
  mapEl.insertAdjacentHTML("afterbegin", svgText);

  svg = mapEl.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG (no <svg>).");

  if (!svg.getAttribute("viewBox")) {
    const w = parseFloat(svg.getAttribute("width") || "1000");
    const h = parseFloat(svg.getAttribute("height") || "900");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  vb = svg.viewBox.baseVal;

  installClipPath();

  setStatus("ساخت ماسک…");
  await buildMaskFromSvg();

  showLoading(false);
  setStatus("آماده ✅");
}

function startDemo() {
  setStatus("حالت دمو (بدون WS) ✅");
  let n = 0;
  setInterval(() => {
    n = (n + 1) % 50;
    countEl.textContent = String(n);
    syncDots(n);
  }, 1000);
}

function initWS() {
  if (!WS_URL) {
    startDemo();
    return;
  }

  setStatus("در حال اتصال WS…");
  const ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => setStatus("وصل شد ✅"));
  ws.addEventListener("close", () => setStatus("قطع شد ❌"));
  ws.addEventListener("error", () => setStatus("خطای اتصال ❌"));

  ws.addEventListener("message", (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }

    if (data.type === "count") {
      const n = Number(data.online || 0);
      countEl.textContent = String(n);
      syncDots(n);
    }
  });
}

(async function main() {
  try {
    await initSvg();
    initWS();
  } catch (e) {
    showLoading(false);
    showError(String(e && e.message ? e.message : e));
    setStatus("خطا");
    console.error(e);
  }
})();
