/* ====================================================================
   BEADAZZLE — deck transition engine (home page)
   Adapted from the Aurélia demo engine: each page is a deck of
   full-viewport <section>s inside #stage; the page defines its seam
   chain before including this file:

     window.SEQUENCE = ["shape", "scroll", "fade", ...];

   One entry per seam; a section's data-fx attribute overrides its
   SEQUENCE entry. "random" picks a stable random effect.
   ==================================================================== */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = p => p * p * (3 - 2 * p);

/* A native scroll between two full-viewport panels and "push" render
   identically, so "scroll" is just an alias. */
const slideBoth = (out, inn, t) => {
  const y = t * 100;
  out.style.transform = `translateY(${-y}vh)`;
  inn.style.transform = `translateY(${100 - y}vh)`;
};

/* Rule: the incoming panel is never statically pre-revealed. Opacity-type
   effects ride ON TOP of slideBoth — both panels travel together, so the
   incoming only ever exists mid-transition, moving, perfectly aligned
   beneath the outgoing panel it replaces. Mask/clip effects consume the
   outgoing while the incoming arrives through the consumed region. */
const FX = {
  push:   { apply: slideBoth },
  scroll: { apply: slideBoth },
  wipe: {
    apply: (out, inn, t) => {
      // the seam descends: outgoing is clipped from the top while the
      // incoming page descends from above in lockstep — the cut and the
      // reveal are the same motion
      out.style.clipPath = `inset(${t * 100}% 0% 0% 0%)`;
      inn.style.transform = `translateY(${-(1 - t) * 100}vh)`;
      const e = out.querySelector(".edge");
      if (e) { e.style.display = "block"; e.style.top = `${t * 100}%`; }
    },
  },
  cover: {
    innOnTop: true,
    apply: (out, inn, t) => { inn.style.transform = `translateY(${(1 - t) * 100}vh)`; },
  },
  uncover: {
    apply: (out, inn, t) => { out.style.transform = `translateY(${-t * 100}vh)`; },
  },
  split: {
    apply: (out, inn, t) => {
      const g = (1 - t) * 50;
      out.style.clipPath = `polygon(${50 - g}% 0%, ${50 + g}% 0%, ${50 + g}% 100%, ${50 - g}% 100%)`;
    },
  },
  shape: {
    apply: (out, inn, t) => {
      const r = t * 125;
      const m = `radial-gradient(circle at 50% 45%, transparent 0%, transparent ${r}%, #000 ${r + 1.5}%)`;
      out.style.maskImage = m; out.style.webkitMaskImage = m;
      const e = out.querySelector(".edge");
      if (e) {
        const R = (r / 100) * Math.hypot(innerWidth / 2, innerHeight * 0.55);
        e.style.display = "block";
        e.style.right = "auto"; e.style.left = "50%"; e.style.top = "45%";
        e.style.width = e.style.height = `${2 * R}px`;
        e.style.borderRadius = "50%";
        e.style.background = "transparent";
        e.style.border = "2px solid #ff5c78";
        e.style.boxShadow = "0 0 18px #ff5c78, inset 0 0 14px rgba(255,92,120,.55)";
        e.style.transform = "translate(-50%, -50%)";
      }
    },
  },
  bars: {
    apply: (out, inn, t) => {
      const stops = [];
      for (let i = 0; i < 6; i++) {
        const a = i * (100 / 6), w = (100 / 6) * clamp(t * 1.4 - i * 0.07, 0, 1);
        stops.push(`transparent ${a}% ${a + w}%, #000 ${a + w}% ${a + 100 / 6}%`);
      }
      const m = `linear-gradient(90deg, ${stops.join(", ")})`;
      out.style.maskImage = m; out.style.webkitMaskImage = m;
    },
  },
  zoom: {
    apply: (out, inn, t) => {
      slideBoth(out, inn, t);
      out.style.transform += ` scale(${1 + t * 0.6})`;
      out.style.opacity = 1 - t;
    },
  },
  fade: {
    apply: (out, inn, t) => {
      slideBoth(out, inn, t);
      out.style.opacity = 1 - t;
    },
  },
  morph: {
    apply: (out, inn, t) => {
      slideBoth(out, inn, t);
      out.style.transform += ` scale(${1 + t * 0.05})`;
      out.style.opacity = 1 - t;
    },
  },
};

function fxForBoundary(boundary, sectionEl) {
  const explicit = sectionEl.dataset.fx;
  if (explicit && FX[explicit]) return explicit;
  const SEQUENCE = window.SEQUENCE || [];
  const entry = SEQUENCE[boundary % SEQUENCE.length];
  if (entry === "random") {
    const pool = Object.keys(FX).filter(n => n !== "scroll");
    return pool[Math.floor((boundary * 2654435761) % 4294967296) % pool.length];
  }
  return FX[entry] ? entry : "fade";
}

function resetFx(el) {
  el.style.clipPath = ""; el.style.transform = ""; el.style.opacity = "";
  el.style.maskImage = ""; el.style.webkitMaskImage = ""; el.style.filter = "";
  const e = el.querySelector(".edge");
  if (e) {
    e.style.display = ""; e.style.top = "0%"; e.style.left = ""; e.style.right = ""; e.style.width = "";
    e.style.height = ""; e.style.borderRadius = ""; e.style.background = "";
    e.style.border = ""; e.style.boxShadow = ""; e.style.transform = "";
  }
}

const slides = [...document.querySelectorAll("#stage section")];
const tag = document.getElementById("tag");
const knob = document.querySelector("#rail i");
const MAX = slides.length - 1;

let target = 0, v = 0;

/* users who prefer reduced motion get instant snapping, no glide */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLIDE = REDUCED ? 1 : 0.12;

const deltaPx = e => e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;

function update() {
  v += (target - v) * GLIDE;
  if (Math.abs(target - v) < 0.0004) v = target;
  render(v);
}
function kick(n = 8) { for (let i = 0; i < n; i++) update(); }

addEventListener("wheel", e => {
  e.preventDefault();
  target = clamp(target + deltaPx(e) / innerHeight, 0, MAX);
  kick();
}, { passive: false });

addEventListener("keydown", e => {
  if (["ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); target = clamp(Math.floor(v + 1.001), 0, MAX); kick(); }
  else if (["ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); target = clamp(Math.ceil(v - 1.001), 0, MAX); kick(); }
  else if (e.key === "Home") { target = 0; kick(); }
  else if (e.key === "End") { target = MAX; kick(); }
});

let ty = null;
addEventListener("touchstart", e => { ty = e.touches[0].clientY; }, { passive: true });
addEventListener("touchend", e => {
  if (ty !== null) { target = clamp(target + (ty - e.changedTouches[0].clientY) / innerHeight * 1.4, 0, MAX); kick(); }
  ty = null;
}, { passive: true });

function render(pos) {
  const zone = clamp(Math.floor(pos), 0, MAX - 1);
  const t = clamp(pos - zone, 0, 1);
  const out = slides[zone], inn = slides[zone + 1];
  const name = fxForBoundary(zone, inn);
  const fx = FX[name];

  slides.forEach((s, k) => {
    const active = k === zone || (k === zone + 1 && t > 0);
    s.style.visibility = active ? "visible" : "hidden";
    if (!active) resetFx(s);
  });

  if (t <= 0) {
    resetFx(out); resetFx(inn);
    tag.textContent = `${zone + 1} / ${slides.length}`;
  } else {
    resetFx(out); resetFx(inn);
    inn.style.zIndex = fx.innOnTop ? 2 : 0;
    out.style.zIndex = fx.innOnTop ? 1 : 2;
    fx.apply(out, inn, smooth(t));
    tag.textContent = `${out.id} → ${inn.id} · ${Math.round(t * 100)}%`;
  }

  knob.style.top = `${(pos / MAX) * 100}%`;
}

function frame() { update(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

/* in-page anchor buttons scroll the deck like the wheel does */
document.querySelectorAll("[data-goto]").forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();
    target = clamp(parseInt(a.dataset.goto, 10), 0, MAX);
    kick();
  });
});

/* soft fade when leaving the page through the site nav */
document.querySelectorAll("a[data-nav]").forEach(a => {
  a.addEventListener("click", e => {
    if (a.hasAttribute("data-goto")) return;
    e.preventDefault();
    document.body.style.transition = "opacity .3s ease";
    document.body.style.opacity = "0";
    setTimeout(() => { location.href = a.href; }, 300);
  });
});
