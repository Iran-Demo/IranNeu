const mapEl = document.getElementById("map");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const loadingEl = document.getElementById("loading");
const errEl = document.getElementById("err");

/**
 * SVG URL (portable):
 * چون فایل‌ها داخل /docs هستند، بهترین حالت اینه که مسیر رو نسبت به همین فایل بسازیم.
 * این باعث میشه هم روی GitHub Pages کار کنه هم لوکال.
 */
const SVG_URL = new URL("./assets/ir.svg", window.location.href).href;

/**
 * WebSocket:
 * GitHub Pages سرور WS نداره. پس باید آدرس WS واقعی رو اینجا بذاری.
 * اگر خالی/null باشه => وارد حالت demo میشه (نقطه‌ها تستی نمایش داده میشن)
 *
 * مثال بعداً:
 * const WS_URL = "wss://your-backend.onrender.com";
 */
const WS_URL = ""; // فعلاً خالی بذار تا Demo فعال بشه

/** تنظیمات */
const DOT_R = 6;
const SAFE_INSET = 0.04;   // از لبه‌های viewBox فاصله
const MASK_W = 900;        // ماسک سبک/سریع
const MAX_PICK_TRIES = 5000;

/** RNG ثابت: باعث میشه نقاط بعد از refresh هم تقریباً ثابت بمونن */
function mulberry32(a){
  return function(){
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

const dots = new Map(); // id -> circle

function setStatus(txt){ statusEl.textContent = txt; }
function showLoading(on){ loadingEl.style.display = on ? "flex" : "none"; }

function showError(msg){
  errEl.style.display = "block";
  errEl.textContent = msg;
}

function randXY(){
  const mx = vb.width * SAFE_INSET;
  const my = vb.height * SAFE_INSET;

  const x = vb.x + mx + rand() * (vb.width  - 2 * mx);
  const y = vb.y + my + rand() * (vb.height - 2 * my);
  return { x, y };
}

function isInsideByMask(x, y){
  if (!maskData) return true;

  const u = (x - vb.x) / vb.width;
  const v = (y - vb.y) / vb.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;

  const px = Math.min(maskW - 1, Math.max(0, (u * maskW) | 0));
  const py = Math.min(maskH - 1, Math.max(0, (v * maskH) | 0));

  const idx = (py * maskW + px) * 4;
  return maskData[idx + 3] > 0; // alpha
}

function pickPointInsideIran(){
  for (let t = 0; t < MAX_PICK_TRIES; t++){
    const p = randXY();
    if (isInsideByMask(p.x, p.y)) return p;
  }
  return randXY(); // خیلی نادر
}

async function buildMaskFromSvg(){
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

  // union mask = همه pathها
  for (const p of paths){
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
    img.src = u
