// The logo cat. It traces its route (dotted around it, ending at a target)
// and follows it with its eyes, smiles when it gets there, blinks now and then,
// glances around and looks at the mouse when it comes close. It replays the
// route on load, on hover or tap, and when a route has been calculated.
// Purely decorative: with "reduce motion" the logo stays still.

const EYES = { x: 32, y: 37 }; // midpoint between the eyes, in logo units
const TRACE_MS = 1700; // the route being traced
const FADE_AT = 2700; // the traced route fades back into the dotted one
const RUN_MS = 3000;
const LOOK_RADIUS = 200; // px: how close the mouse must be for the cat to look
// Where the cat glances when idle: the route, its target, the title, the form.
const GLANCES = [
  { x: -11, y: 37 },
  { x: 32, y: -6 },
  { x: 90, y: 30 },
  { x: 40, y: 90 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;

export function initMascot(svg) {
  if (!svg) return { play() {} };
  const q = (sel) => svg.querySelector(sel);
  const head = q('.mascot-head');
  const gaze = q('.mascot-gaze');
  const eyes = q('.mascot-eyes');
  const route = q('.mascot-route');
  const reveal = q('.mascot-reveal');
  const tip = q('.mascot-tip');
  const nodes = [...svg.querySelectorAll('.mascot-node')].map((el) => ({ el, at: Number(el.dataset.at) }));
  const length = route.getTotalLength();
  const end = 1 - 5 / length; // the tip stops at the target's edge, not on top of it
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || document.hidden;

  let run = null; // start time of the route animation
  let blink = null; // start time of a blink
  let pointer = null; // the mouse, when close (logo units)
  let glance = null; // { x, y, until }
  let pending = false; // a play waiting for the logo to be on screen
  let visible = true;
  let look = { x: 0, y: 0, tilt: 0 }; // current pupil offset and head tilt
  let frame = 0;
  let last = 0;

  svg.classList.add('mascot');

  const request = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // Pupil offset and head tilt to look at point p (null: straight ahead).
  function aim(p) {
    if (!p) return { x: 0, y: 0, tilt: 0 };
    const dx = p.x - EYES.x;
    const dy = p.y - EYES.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, d / 16);
    return { x: (dx / d) * reach * 1.8, y: (dy / d) * reach * 1.5, tilt: clamp(dx / 45, -1, 1) * 4 };
  }

  function tick(now) {
    frame = 0;
    const dt = last ? Math.min(now - last, 64) : 16;
    last = now;
    let target = null;

    if (run !== null) {
      const t = Math.max(0, now - run);
      const p = end * ease(Math.min(1, t / TRACE_MS));
      const running = t < FADE_AT;
      svg.classList.toggle('is-running', running);
      svg.classList.toggle('is-arrived', t >= TRACE_MS && t < RUN_MS);
      svg.classList.toggle('is-happy', t >= TRACE_MS + 150 && t < TRACE_MS + 1150);
      for (const n of nodes) n.el.classList.toggle('is-lit', running && p >= n.at);
      reveal.style.strokeDashoffset = 100 * (1 - p);
      route.style.strokeDashoffset = 0.8 - t * 0.009; // the dashes keep moving forward
      const at = route.getPointAtLength(p * length);
      tip.setAttribute('transform', `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)})`);
      if (running) target = at;
      if (t >= RUN_MS) run = null;
    }
    if (glance && now > glance.until) glance = null;
    if (!target) target = pointer || glance;

    const want = aim(target);
    const k = 1 - Math.exp(-dt / (run !== null ? 60 : 110));
    look = {
      x: look.x + (want.x - look.x) * k,
      y: look.y + (want.y - look.y) * k,
      tilt: look.tilt + (want.tilt - look.tilt) * k,
    };
    const settling = Math.abs(want.x - look.x) + Math.abs(want.y - look.y) + Math.abs(want.tilt - look.tilt) > 0.01;
    if (!settling) look = want;
    gaze.setAttribute('transform', `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})`);
    head.setAttribute('transform', `rotate(${look.tilt.toFixed(2)} 32 58)`);

    let lid = 1;
    if (blink !== null) {
      const b = (now - blink) / 160;
      if (b >= 1 || b < 0) blink = null;
      else lid = 1 - 0.92 * Math.sin(Math.PI * b);
    }
    if (lid === 1) eyes.removeAttribute('transform');
    else eyes.setAttribute('transform', `translate(0 ${EYES.y}) scale(1 ${lid.toFixed(3)}) translate(0 ${-EYES.y})`);

    if (run !== null || blink !== null || glance || settling) request();
    else last = 0;
  }

  function play() {
    if (reduce.matches || run !== null) return;
    if (!visible) {
      pending = true;
      return;
    }
    pending = false;
    run = performance.now();
    request();
  }

  function startBlink() {
    blink = performance.now();
    request();
  }

  // Idle life: a blink every few seconds (sometimes a double one) and, less
  // often, a glance somewhere.
  (function blinkLater() {
    setTimeout(() => {
      if (!still() && visible) {
        startBlink();
        if (Math.random() < 0.2) setTimeout(startBlink, 260);
      }
      blinkLater();
    }, 2600 + Math.random() * 4200);
  })();
  (function glanceLater() {
    setTimeout(() => {
      if (!still() && visible && run === null && !pointer) {
        const g = GLANCES[Math.floor(Math.random() * GLANCES.length)];
        glance = { ...g, until: performance.now() + 1200 };
        request();
      }
      glanceLater();
    }, 8000 + Math.random() * 7000);
  })();

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || reduce.matches || !visible) return;
      const r = svg.getBoundingClientRect();
      const near = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < LOOK_RADIUS;
      const m = near && svg.getScreenCTM();
      const next = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
      if (!next && !pointer) return;
      pointer = next;
      request();
    },
    { passive: true }
  );
  document.documentElement.addEventListener('pointerleave', () => {
    pointer = null;
    request();
  });

  svg.addEventListener('click', play);
  svg.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') play();
  });

  // Nothing runs while the logo is scrolled away; a play asked for meanwhile
  // (a route calculated with the logo off screen, on phones) waits for it.
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && pending) play();
  }).observe(svg);

  setTimeout(play, 600);
  return { play };
}
