// LANGUAGE: swaps the text of every [data-fr] element between English and French
const html = document.documentElement;
const button = document.getElementById("lang-toggle");

function setLang(lang) {
  html.lang = lang;
  document.querySelectorAll("[data-fr]").forEach((el) => {
    el.dataset.en ??= el.textContent.trim().replace(/\s+/g, " ");
    el.textContent = lang === "fr" ? el.dataset.fr : el.dataset.en;
  });
  button.textContent = lang === "fr" ? "EN" : "FR";
  button.lang = lang === "fr" ? "en" : "fr";
  button.setAttribute("aria-label", lang === "fr" ? "Switch to English" : "Passer en français");
  try { localStorage.setItem("lang", lang); } catch {}
}

button.addEventListener("click", () => setLang(html.lang === "fr" ? "en" : "fr"));

let saved = null;
try { saved = localStorage.getItem("lang"); } catch {}
setLang(saved || (navigator.language.startsWith("fr") ? "fr" : "en"));

// MAP: draws the world from map.js and fills the countries listed in #map's data-visited
const map = document.getElementById("map");
const visited = map.dataset.visited.split(/\s+/);
map.innerHTML =
  `<svg viewBox="${MAP_VIEWBOX}" role="img" aria-labelledby="map-caption">` +
  Object.entries(MAP_PATHS)
    .map(([code, d]) => `<path d="${d}"${visited.includes(code) ? ' class="visited"' : ""}/>`)
    .join("") +
  "</svg>";

// SECTORS: panels stick to the top and stack. A panel taller than the screen must stick
// higher (negative top) so that its bottom can be reached before the next panel covers it.
const panels = [...document.querySelectorAll(".sector")];

function setStick() {
  panels.forEach((p) => p.style.setProperty("--stick", Math.min(0, innerHeight - p.offsetHeight) + "px"));
}
new ResizeObserver(setStick).observe(document.body); // also runs once at start
addEventListener("resize", setStick);

// TABS: scroll to a sector, and highlight the tab of the sector being viewed
const tabs = [...document.querySelectorAll(".tab-list a")];

tabs.forEach((tab, i) => {
  tab.addEventListener("click", (e) => {
    e.preventDefault();
    // stacked panels sit at the top already, so scroll to where each one starts in the page flow
    const top = panels.slice(0, i).reduce((y, p) => y + p.offsetHeight, 0);
    scrollTo({ top, behavior: "smooth" });
  });
});

function markActiveTab() {
  let current = panels[0].id;
  panels.forEach((p) => { if (p.getBoundingClientRect().top <= innerHeight / 2) current = p.id; });
  tabs.forEach((tab) => tab.classList.toggle("active", tab.hash === "#" + current));
}
addEventListener("scroll", markActiveTab, { passive: true });
markActiveTab();

// CAROUSEL: photos drawn on a canvas along a curved band that grows toward the screen edges.
// The band is a parabola: some height at the center, EDGE at the screen edges (all as shares of the screen height).
// Photos grow with it equally in width and height, so they are never stretched.
// On large screens the center is MIDDLE. On small screens (few photos fit across) the center
// grows toward MIDDLE_SMALL, so the band is barely curved. In between, it blends smoothly.
const MIDDLE = 1 / 3;       // center height on large screens
const MIDDLE_SMALL = 3 / 7; // center height when only about one photo fits
const EDGE = 1 / 2;         // height at the screen edges (all screens)
const FIT_FEW = 2;          // photos fitting across the screen: at or below this, use MIDDLE_SMALL
const FIT_MANY = 4;         // at or above this, use MIDDLE
const GAP = 0.06;           // space between photos, as a share of a photo's width
const DURATION = 1200;      // milliseconds to slide from one photo to the next

const carousel = document.getElementById("carousel");
const photos = [...carousel.querySelectorAll("img")];
const canvas = document.createElement("canvas");
canvas.setAttribute("aria-hidden", "true");
carousel.append(canvas);
const ctx = canvas.getContext("2d");

// each photo is cropped to a centered square once it has loaded (SVG photos need a width and height)
const squares = [];
photos.forEach((img, i) => {
  img.decode().then(() => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const side = Math.min(iw, ih), size = Math.min(side, 1200);
    const square = document.createElement("canvas");
    square.width = square.height = size;
    square.getContext("2d").drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, size, size);
    squares[i] = square;
    draw();
  }, () => console.warn("Carousel: could not load", img.src)); // shows up in the browser console
});

// measurements of the band for the current screen
function geometry() {
  const W = carousel.clientWidth;
  const fit = W / (MIDDLE * innerHeight);              // how many large-screen photos would fit across
  const t = Math.min(1, Math.max(0, (fit - FIT_FEW) / (FIT_MANY - FIT_FEW)));
  const blend = t * t * (3 - 2 * t);                   // smooth 0 (small screen) to 1 (large screen)
  const hCenter = (MIDDLE_SMALL + (MIDDLE - MIDDLE_SMALL) * blend) * innerHeight;
  const hEdge = EDGE * innerHeight;
  const g = GAP / (1 + GAP);                     // share of a photo slot taken by the gap
  const slot = hCenter / (1 - g);                // slot width at the center (photo + gap)
  const beta = (hEdge / hCenter - 1) / (W / 2) ** 2; // band height at distance x from the center = hCenter * (1 + beta * x²)
  const root = Math.sqrt(beta) || 1e-9;
  return { W, hCenter, g, slot, beta, root, height: Math.ceil(hEdge) + 24 };
}

// where the point at distance x from the center falls along the photo strip (1 = one photo)
const stripAt = (x, G) => pos + Math.atan(G.root * x) / (G.slot * G.root);

function resize() {
  const G = geometry(), dpr = devicePixelRatio || 1;
  canvas.width = G.W * dpr;
  canvas.height = G.height * dpr;
  canvas.style.width = G.W + "px";
  canvas.style.height = G.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// draws the band one thin vertical slice at a time, each slice as tall as the band at that point
function draw() {
  const G = geometry(), n = photos.length, slice = 2 / (devicePixelRatio || 1);
  ctx.clearRect(0, 0, G.W, G.height);
  ctx.imageSmoothingQuality = "high";
  for (let px = 0; px < G.W; px += slice) {
    const x = px + slice / 2 - G.W / 2;
    const strip = stripAt(x, G);
    const index = Math.floor(strip + 0.5);          // which photo this slice belongs to
    const along = strip - (index - 0.5);            // 0 to 1 across that photo's slot
    if (along < G.g / 2 || along > 1 - G.g / 2) continue; // gap between photos
    const square = squares[((index % n) + n) % n];
    if (!square) continue;
    const scale = 1 + G.beta * x * x;
    const u = (along - G.g / 2) / (1 - G.g);        // 0 to 1 across the photo
    const srcW = (slice / (G.slot * scale * (1 - G.g))) * square.width;
    const sx = Math.min(Math.max(u * square.width - srcW / 2, 0), square.width - srcW);
    const h = G.hCenter * scale;
    ctx.drawImage(square, sx, 0, srcW, square.height, px, (G.height - h) / 2, slice, h);
  }
}

// slide smoothly (slow start, slow end) toward the target photo
let pos = 0;      // current position, counted in photos
let from = 0, target = 0, startTime = 0, running = false;

function frame(now) {
  const k = Math.min(1, Math.max(0, (now - startTime) / DURATION));
  const ease = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
  pos = from + (target - from) * ease;
  draw();
  if (k < 1) requestAnimationFrame(frame);
  else running = false;
}
function moveTo(t) {
  from = pos;
  target = t;
  startTime = performance.now();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { pos = target; draw(); return; }
  if (!running) { running = true; requestAnimationFrame(frame); }
}

const go = (step) => moveTo(target + step);
document.getElementById("prev").addEventListener("click", () => go(-1));
document.getElementById("next").addEventListener("click", () => go(1));
carousel.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "ArrowRight") go(1);
});

// swipe, or click a photo to bring it to the center
let startX = 0;
carousel.addEventListener("pointerdown", (e) => { startX = e.clientX; });
carousel.addEventListener("pointerup", (e) => {
  const dx = e.clientX - startX;
  if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  else if (e.target === canvas) {
    const x = e.clientX - canvas.getBoundingClientRect().left - canvas.clientWidth / 2;
    moveTo(Math.round(stripAt(x, geometry())));
  }
});

addEventListener("resize", resize);
resize();