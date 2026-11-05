/**
 * aplikatorzy.pl — Camera timeline / storyboard
 * ---------------------------------------------------------------------------
 * Deterministic, dependency-free scroll cinematography.
 *
 * Every keyframe is a MANUALLY COMPOSED SHOT expressed in the car's LOCAL
 * frame (metres). The car model uses the following local axes:
 *
 *      +Z  = front of the car (nose)          -Z = rear / diffuser
 *      +X  = driver's side (left of the car)  -X = passenger side
 *      +Y  = up, y = 0 is the asphalt
 *
 * Useful landmarks measured directly from lamborghini_revuelto.glb
 * (after re-centring the model so its bounding box centre is at x=0, z=0):
 *
 *      overall            x +/-1.136   y 0 -> 1.129   z -2.474 -> +2.474
 *      front wheels       (+/-0.852, 0.341, +1.288)   radius 0.341
 *      rear wheels        (+/-0.852, 0.341, -1.493)
 *      headlight (L / R)  (+/-0.700, 0.550, +1.895)
 *      hood badge         ( 0.000,   0.440, +2.385)
 *      windscreen         ( 0.000,   0.910, +0.925)
 *      steering wheel     (+0.360,   0.680, +0.335)
 *      cabin volume       x +/-0.865  y 0.127 -> 1.114  z -0.643 -> +1.372
 *      tail light block   ( 0.000,   0.730, -1.565)
 *      rear badge         (+0.010,   0.560, -2.415)
 *
 * Because the shots are authored in the car's local frame the framing can
 * never break: the camera is rigidly related to the body work. The world
 * position of the camera is obtained by rotating the local position by the
 * car's yaw, so the camera physically travels around the garden while the
 * car turns on the asphalt — both move, exactly as a real commercial.
 *
 * Interpolation: monotone cubic Hermite through the keyframes on their real
 * times, then a pacing map that spends scroll on visible motion, so the camera
 * glides and settles INTO each composed frame at an even pace. It is a pure
 * function of scroll progress => scrolling up replays the film in perfect
 * reverse, frame for frame.
 */

/* -------------------------------------------------------------------------
 * Storyboard
 * ---------------------------------------------------------------------- */

/**
 * pos     camera position, car-local metres
 * target  look-at point, car-local metres
 * fov     vertical field of view (deg) at 16:9 — widened automatically on
 *         narrow viewports so the car keeps its share of the frame
 * yaw     car rotation around Y in the WORLD (deg) — the garden sweeps by
 * roll    camera roll (deg), a whisper of it only
 * shift   subject offset in screen space, fractions of the viewport.
 *         +x pushes the CAR to the right (leaving the left third for type)
 * focus   DOF focal distance (m). 0 => auto (distance to target)
 * bokeh   DOF strength 0..1
 * glass   0..1 — how much of the glazing is dissolved (cabin fly-through)
 * cabin   0..1 — interior practical light
 * name    shot label, printed by the debug HUD (?debug)
 */
export const SHOTS = [
  // -- SHOT 1 — HERO FRONT 3/4 -------------------------------------------
  { t: 0.000, name: 'HERO 3/4', settle: 1,
    pos: [-5.15, 1.14, 6.55], target: [0.00, 0.60, 0.25],
    fov: 33, yaw: -18, roll: 0.0, shift: [0.13, 0.02], bokeh: 0.10 },

  { t: 0.085, name: 'HERO push-in', settle: 1,
    pos: [-4.45, 0.96, 5.75], target: [0.00, 0.58, 0.30],
    fov: 33, yaw: -11, roll: 0.4, shift: [0.13, 0.02], bokeh: 0.10 },

  // -- SHOT 2 — HEADLIGHT -------------------------------------------------
  { t: 0.145, name: 'nose approach',
    pos: [-2.95, 0.82, 4.35], target: [-0.38, 0.56, 1.62],
    fov: 30, yaw: -4, roll: 0.6, shift: [-0.04, 0.00], bokeh: 0.25 },

  { t: 0.205, name: 'HEADLIGHT', settle: 1,
    pos: [-1.72, 0.74, 3.02], target: [-0.70, 0.53, 1.90],
    fov: 27, yaw: 4, roll: 0.8, shift: [-0.14, -0.02], focus: 1.55, bokeh: 0.85 },

  // -- SHOT 3 — WHEEL -----------------------------------------------------
  { t: 0.270, name: 'along the nose',
    pos: [-2.35, 0.62, 2.50], target: [-0.84, 0.44, 1.52],
    fov: 28, yaw: 12, roll: 0.5, shift: [-0.10, 0.00], bokeh: 0.55 },

  { t: 0.330, name: 'WHEEL / CALIPER', settle: 1,
    pos: [-2.66, 0.54, 1.68], target: [-0.86, 0.36, 1.27],
    fov: 28, yaw: 20, roll: 0.0, shift: [0.12, -0.04], focus: 1.90, bokeh: 0.80 },

  // -- SHOT 4 — FRONT -----------------------------------------------------
  { t: 0.400, name: 'swing to nose',
    pos: [-2.10, 0.46, 4.60], target: [-0.20, 0.56, 1.45],
    fov: 30, yaw: 30, roll: -0.4, shift: [0.05, -0.02], bokeh: 0.30 },

  { t: 0.455, name: 'FRONT — low & centred', settle: 1,
    pos: [0.00, 0.44, 6.05], target: [0.00, 0.58, 1.35],
    fov: 30, yaw: 40, roll: 0.0, shift: [0.00, -0.06], bokeh: 0.20 },

  // -- SHOT 4b — PLAN VIEW ------------------------------------------------
  // A crane straight up off the nose into a plan view, held long enough to
  // read the whole car at once. This sits deliberately under the light
  // switch (0.404–0.512): from directly above, throwing the
  // switch strikes the front and the rear signature in the same frame.
  // A true nadir has no defined camera up-vector, so the rig stops a few
  // degrees short of vertical and leans the frame instead.
  { t: 0.470, name: 'crane up',
    pos: [-0.95, 2.85, 4.60], target: [0.00, 0.55, 0.80],
    fov: 37, yaw: 43, roll: 1.4, shift: [0.00, -0.03], bokeh: 0.14 },

  { t: 0.492, name: 'PLAN — z góry', settle: 1,
    pos: [0.46, 6.45, 1.15], target: [0.00, 0.48, 0.05],
    fov: 46, yaw: 47, roll: 6.5, shift: [0.00, 0.00], focus: 6.2, bokeh: 0.08 },

  { t: 0.508, name: 'descend off the plan',
    pos: [-2.30, 3.05, 4.25], target: [-0.10, 0.58, 0.72],
    fov: 36, yaw: 50, roll: 2.0, shift: [0.08, 0.00], bokeh: 0.16 },

  // -- SHOT 5 — FRONT 3/4 / BODY -----------------------------------------
  { t: 0.520, name: 'WRAP 3/4', settle: 1,
    pos: [-4.51, 0.96, 5.05], target: [-0.25, 0.60, 0.85],
    fov: 33, yaw: 52, roll: 0.5, shift: [0.14, 0.01], bokeh: 0.18 },

  { t: 0.580, name: 'flank glide', doorR: 0.06, settle: 1,
    pos: [-4.03, 1.12, 1.27], target: [-0.38, 0.68, 0.30],
    fov: 35, yaw: 63, roll: 0.8, shift: [0.10, 0.00], bokeh: 0.30 },

  // -- SHOT 6 — INTERIOR --------------------------------------------------
  { t: 0.635, name: 'to the glasshouse', doorR: 0.78,
    pos: [-2.75, 1.12, 0.95], target: [-0.30, 0.82, 0.40],
    fov: 40, yaw: 73, roll: 0.6, shift: [0.04, 0.00], bokeh: 0.40, glass: 0.15 },

  // The open scissor door stands up over the front half of the opening
  // (z ≈ 0.4 → 1.0). Entering at z 0.95 flew straight through its skin and
  // filled the frame with paint; this line goes in behind it, under the roof.
  { t: 0.678, name: 'through the window', doorR: 1,
    pos: [-1.40, 0.86, 0.22], target: [0.12, 0.74, 0.40],
    fov: 52, yaw: 80, roll: -0.4, shift: [-0.04, 0.00], bokeh: 0.55, glass: 0.9, cabin: 0.5 },

  { t: 0.720, name: 'COCKPIT', doorR: 1, settle: 1,
    pos: [-0.28, 0.87, -0.05], target: [0.36, 0.66, 0.45],
    fov: 60, yaw: 88, roll: -1.2, shift: [-0.10, 0.00], focus: 0.82, bokeh: 0.70,
    glass: 1, cabin: 1 },

  // -- SHOT 7 — EXIT INTERIOR --------------------------------------------
  { t: 0.762, name: 'out through the door', doorR: 1,
    pos: [1.50, 0.92, 0.30], target: [0.26, 0.76, 0.36],
    fov: 52, yaw: 98, roll: -0.6, shift: [-0.06, 0.00], bokeh: 0.55,
    glass: 1, cabin: 0.6 },

  { t: 0.808, name: 'swing to the rear', doorR: 0.18, wing: 0.55,
    pos: [3.55, 1.12, -2.15], target: [0.10, 0.70, -0.62],
    fov: 38, yaw: 112, roll: 0.4, shift: [0.02, 0.00], bokeh: 0.30, glass: 0.25 },

  // -- SHOT 8 — REAR ------------------------------------------------------
  { t: 0.855, name: 'REAR 3/4', wing: 1, settle: 1,
    pos: [3.62, 0.84, -5.35], target: [0.00, 0.66, -0.95],
    fov: 32, yaw: 132, roll: 0.0, shift: [0.13, 0.01], bokeh: 0.15 },

  // -- SHOT 9 — BADGE / MACRO --------------------------------------------
  { t: 0.898, name: 'BADGE macro', wing: 1, settle: 1,
    pos: [0.52, 0.76, -3.58], target: [0.03, 0.60, -2.40],
    fov: 25, yaw: 150, roll: -0.8, shift: [-0.13, -0.03], focus: 1.26, bokeh: 1.0 },

  { t: 0.928, name: 'pull back', wing: 1,
    pos: [2.35, 1.30, -5.10], target: [0.00, 0.64, -1.35],
    fov: 30, yaw: 166, roll: -0.3, shift: [-0.04, 0.00], bokeh: 0.35 },

  { t: 0.955, name: 'around the flank', wing: 1, doorL: 0.15, doorR: 0.15,
    pos: [6.90, 1.68, -0.85], target: [0.00, 0.62, -0.10],
    fov: 32, yaw: 180, roll: 0.2, shift: [0.04, 0.00], bokeh: 0.20 },

  { t: 0.976, name: 'towards the nose', wing: 1, doorL: 0.75, doorR: 0.75,
    pos: [6.55, 1.52, 2.60], target: [0.00, 0.62, 0.10],
    fov: 33, yaw: 192, roll: 0.1, shift: [0.02, 0.02], bokeh: 0.14 },

  // -- SHOT 10 — FINAL HERO ----------------------------------------------
  { t: 0.992, name: 'FINAL HERO', wing: 1, doorL: 1, doorR: 1, settle: 1,
    pos: [5.20, 1.30, 5.10], target: [0.00, 0.62, 0.20],
    fov: 33, yaw: 203, roll: 0.0, shift: [0.00, 0.06], bokeh: 0.10 },

  { t: 1.000, name: 'FINAL HERO hold', wing: 1, doorL: 1, doorR: 1, settle: 1,
    pos: [5.05, 1.26, 4.95], target: [0.00, 0.62, 0.20],
    fov: 33, yaw: 205, roll: 0.0, shift: [0.00, 0.06], bokeh: 0.10 },
];

/* -------------------------------------------------------------------------
 * Text beats — HTML overlays, driven by the very same progress value
 * ---------------------------------------------------------------------- */

export const BEATS = [
  { id: 'b-hero',      in: 0.000, out: 0.112 },
  { id: 'b-spec',      in: 0.122, out: 0.166 },
  { id: 'b-headlight', in: 0.176, out: 0.256 },
  { id: 'b-wheel',     in: 0.292, out: 0.374 },
  { id: 'b-front',     in: 0.408, out: 0.470 },
  { id: 'b-selection', in: 0.505, out: 0.584 },
  { id: 'b-numbers',   in: 0.590, out: 0.640 },
  { id: 'b-doors',     in: 0.646, out: 0.694 },
  { id: 'b-interior',  in: 0.700, out: 0.770 },
  { id: 'b-materials', in: 0.774, out: 0.812 },
  { id: 'b-wing',      in: 0.816, out: 0.850 },
  { id: 'b-rear',      in: 0.856, out: 0.892 },
  { id: 'b-badge',     in: 0.896, out: 0.930 },
  { id: 'b-trust',     in: 0.934, out: 0.966 },
  { id: 'b-final',     in: 0.972, out: 1.001 },
];

/** Shot titles for the film rail down the side of the screen. */
export const RAIL = [
  { t: 0.000, label: 'PRZYJAZD' },
  { t: 0.120, label: 'SYLWETKA' },
  { t: 0.205, label: 'REFLEKTOR' },
  { t: 0.330, label: 'KOŁO' },
  { t: 0.455, label: 'PRZÓD' },
  { t: 0.520, label: 'NADWOZIE' },
  { t: 0.660, label: 'DRZWI' },
  { t: 0.720, label: 'KOKPIT' },
  { t: 0.820, label: 'SKRZYDŁO' },
  { t: 0.870, label: 'TYŁ' },
  { t: 0.940, label: 'FINAŁ' },
];

/* -------------------------------------------------------------------------
 * Maths — small, allocation free, no dependencies
 * ---------------------------------------------------------------------- */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smootherstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const lerp = (a, b, k) => a + (b - a) * k;

/* ---------------------------------------------------------------------------
 * Spline — monotone cubic Hermite on the real keyframe times.
 *
 * The old uniform Catmull-Rom treated every segment as if it lasted the same
 * time. The keyframes do not: 0.455 -> 0.470 is a crane of six metres in a
 * sliver of scroll, 0.335 -> 0.400 a slow glide. With uniform tangents the
 * camera's speed changed abruptly at every keyframe — that is the "jump".
 *
 * Here each tangent is the derivative in story time (weighted three-point
 * difference), clamped so a channel never overshoots its keyframes
 * (Fritsch-Carlson). Velocity is continuous through every key, and the camera
 * can no longer swing wide and clip the bodywork between two shots.
 * ------------------------------------------------------------------------ */

const KEY_T = SHOTS.map((s) => s.t);
const NK = SHOTS.length;

/** Value of a channel at keyframe i, resolving defaults once. */
const CHANNELS = (() => {
  const val = (s, key, def) => (s[key] === undefined ? def : s[key]);
  const ch = {};
  const add = (name, get) => { ch[name] = SHOTS.map(get); };
  for (let k = 0; k < 3; k++) {
    add(`pos${k}`, (s) => s.pos[k]);
    add(`target${k}`, (s) => s.target[k]);
  }
  add('fov', (s) => val(s, 'fov', 33));
  add('yaw', (s) => val(s, 'yaw', 0));
  add('roll', (s) => val(s, 'roll', 0));
  add('shift0', (s) => (s.shift || [0, 0])[0]);
  add('shift1', (s) => (s.shift || [0, 0])[1]);
  add('bokeh', (s) => val(s, 'bokeh', 0));
  add('doorL', (s) => val(s, 'doorL', 0));
  add('doorR', (s) => val(s, 'doorR', 0));
  add('wing', (s) => val(s, 'wing', 0));
  add('glass', (s) => val(s, 'glass', 0));
  add('cabin', (s) => val(s, 'cabin', 0));
  add('focus', (s) => s.focus || dist(s.pos, s.target));
  return ch;
})();

/** Monotone tangents (per unit of story time) for every channel. */
const TANGENTS = (() => {
  const out = {};
  for (const name of Object.keys(CHANNELS)) {
    const v = CHANNELS[name];
    const m = new Float64Array(NK);
    for (let i = 1; i < NK - 1; i++) {
      const h0 = Math.max(1e-6, KEY_T[i] - KEY_T[i - 1]);
      const h1 = Math.max(1e-6, KEY_T[i + 1] - KEY_T[i]);
      const d0 = (v[i] - v[i - 1]) / h0;
      const d1 = (v[i + 1] - v[i]) / h1;
      if (d0 * d1 <= 0) { m[i] = 0; continue; }       // local extreme: stop there, no overshoot
      let t = (d0 * h1 + d1 * h0) / (h0 + h1);
      const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
      if (Math.abs(t) > lim) t = Math.sign(t) * lim;
      m[i] = t;
    }
    // first and last frame ease in / out of rest
    m[0] = 0;
    m[NK - 1] = 0;
    out[name] = m;
  }
  return out;
})();

function hermite(name, i, s, span) {
  const v = CHANNELS[name];
  const m = TANGENTS[name];
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i]
    + (s3 - 2 * s2 + s) * m[i] * span
    + (-2 * s3 + 3 * s2) * v[i + 1]
    + (s3 - s2) * m[i + 1] * span;
}

/** Evaluate the storyboard at a STORY time (not scroll). */
function sampleStory(t, o) {
  let i = 0;
  while (i < NK - 2 && t > KEY_T[i + 1]) i++;
  const span = Math.max(1e-6, KEY_T[i + 1] - KEY_T[i]);
  const s = clamp((t - KEY_T[i]) / span, 0, 1);

  for (let k = 0; k < 3; k++) {
    o.pos[k] = hermite(`pos${k}`, i, s, span);
    o.target[k] = hermite(`target${k}`, i, s, span);
  }
  o.fov = hermite('fov', i, s, span);
  o.yaw = hermite('yaw', i, s, span);
  o.roll = hermite('roll', i, s, span);
  o.shift[0] = hermite('shift0', i, s, span);
  o.shift[1] = hermite('shift1', i, s, span);
  o.bokeh = clamp(hermite('bokeh', i, s, span), 0, 1);
  o.doorL = clamp(hermite('doorL', i, s, span), 0, 1);
  o.doorR = clamp(hermite('doorR', i, s, span), 0, 1);
  o.wing = clamp(hermite('wing', i, s, span), 0, 1);
  o.glass = clamp(hermite('glass', i, s, span), 0, 1);
  o.cabin = clamp(hermite('cabin', i, s, span), 0, 1);
  o.focus = Math.max(0.2, hermite('focus', i, s, span));
  o.index = i;
  o.name = s < 0.5 ? SHOTS[i].name : SHOTS[i + 1].name;
  o.story = t;
  return o;
}

const newState = () => ({
  pos: [0, 0, 0], target: [0, 0, 0], shift: [0, 0],
  fov: 35, yaw: 0, roll: 0, focus: 5, bokeh: 0, glass: 0, cabin: 0,
  doorL: 0, doorR: 0, wing: 0,
  index: 0, name: '', story: 0,
});

/* ---------------------------------------------------------------------------
 * Pacing — scroll is spent on what the eye actually sees move.
 *
 * Equal scroll used to buy wildly unequal motion: 4 m of travel per 1 % of
 * scroll round the rear flank, 0.2 m at the 3/4 shot, and a 90° swing of the
 * view inside the cockpit. A wheel notch therefore threw the camera across
 * the set in one shot and barely moved it in the next.
 *
 * The camera's world path is sampled once at start-up; the visible effort of
 * every slice (metres travelled + how far the view turns + zoom) decides how
 * much scroll it gets. On top of that each `settle` shot gets a soft hold,
 * so the camera eases into the composed frame, lets it breathe and eases out
 * — no stop, no lurch. The map is monotone and built once, so scrolling up
 * still replays the film exactly in reverse.
 * ------------------------------------------------------------------------ */
const LUT_N = 2048;
const TURN_WEIGHT = 2.2;   // metres of travel that "feel" like one radian of turn
const ZOOM_WEIGHT = 0.06;  // per degree of fov
const HOLD_SIGMA = 0.013;
const HOLD_GAIN = 0.85;    // x mean effort, at the heart of a settle shot
const FLOOR = 0.18;        // x mean effort, so a still frame never costs zero scroll
const MOTION_SHARE = 0.5;    // how much of the pacing follows the motion (rest: the story)
const STORY_SIGMA = 0.020;
const STORY_DEPTH = 0.72;
const STORY_FLOOR = 0.22;

const PACE_LUT = (() => {
  const N = LUT_N;
  const o = newState();
  const P = new Float64Array((N + 1) * 3);
  const D = new Float64Array((N + 1) * 3);
  const F = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    sampleStory(i / N, o);
    const y = (o.yaw * Math.PI) / 180;
    const c = Math.cos(y);
    const s = Math.sin(y);
    const px = o.pos[0] * c + o.pos[2] * s;
    const pz = -o.pos[0] * s + o.pos[2] * c;
    const tx = o.target[0] * c + o.target[2] * s;
    const tz = -o.target[0] * s + o.target[2] * c;
    const dx = tx - px, dy = o.target[1] - o.pos[1], dz = tz - pz;
    const L = Math.hypot(dx, dy, dz) || 1;
    P[i * 3] = px; P[i * 3 + 1] = o.pos[1]; P[i * 3 + 2] = pz;
    D[i * 3] = dx / L; D[i * 3 + 1] = dy / L; D[i * 3 + 2] = dz / L;
    F[i] = o.fov;
  }

  // effort of each slice
  const e = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    const a = i * 3, b = a + 3;
    const move = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
    const dot = clamp(D[a] * D[b] + D[a + 1] * D[b + 1] + D[a + 2] * D[b + 2], -1, 1);
    const turn = Math.acos(dot);
    e[i] = move + TURN_WEIGHT * turn + ZOOM_WEIGHT * Math.abs(F[i + 1] - F[i]);
    mean += e[i];
  }
  mean /= N;

  // soften it, so the pace itself changes gradually
  const R = Math.round(N * 0.012);
  const es = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0, wsum = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= N) continue;
      const w = Math.exp(-((k / R) ** 2) * 2.5);
      sum += e[j] * w; wsum += w;
    }
    es[i] = sum / wsum;
  }

  // Two budgets, blended: what the camera does (effort + holds) and what the
  // story needs read (the original dwell, which gives the text beats their
  // time). Effort alone would rush the slow opening shots past their copy.
  const anchors = SHOTS.filter((s) => s.settle).map((s) => s.t);
  const motion = new Float64Array(N);
  const story = new Float64Array(N);
  let mMean = 0, sMean = 0;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    let hold = 0, d = 0;
    for (const a of anchors) {
      const k = (u - a) / HOLD_SIGMA;
      if (k > -5 && k < 5) hold = Math.max(hold, Math.exp(-k * k));
      const q = (u - a) / STORY_SIGMA;
      if (q > -6 && q < 6) d += Math.exp(-q * q);
    }
    motion[i] = es[i] + mean * (HOLD_GAIN * hold + FLOOR) / N;
    story[i] = 1 / Math.max(STORY_FLOOR, 1 - STORY_DEPTH * Math.min(1, d));
    mMean += motion[i]; sMean += story[i];
  }
  mMean /= N; sMean /= N;
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    cum[i + 1] = cum[i] + MOTION_SHARE * motion[i] / mMean + (1 - MOTION_SHARE) * story[i] / sMean;
  }
  const total = cum[N] || 1;
  for (let i = 0; i <= N; i++) cum[i] /= total;

  // invert onto a uniform table: per frame it is one lookup
  const inv = new Float32Array(N + 1);
  let j = 0;
  for (let i = 0; i <= N; i++) {
    const target = i / N;
    while (j < N - 1 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j] || 1e-9;
    inv[i] = clamp((j + (target - cum[j]) / span) / N, 0, 1);
  }
  inv[0] = 0;
  inv[N] = 1;
  return inv;
})();

/** Raw scroll progress -> story time. Monotone, perfectly reversible. */
export function dwell(p) {
  const t = clamp(p, 0, 1) * LUT_N;
  const i = Math.min(LUT_N - 1, Math.floor(t));
  const f = t - i;
  return PACE_LUT[i] * (1 - f) + PACE_LUT[i + 1] * f;
}

/** Fade a beat in and out with soft shoulders. Pure function of story time. */
export function beatOpacity(beat, p) {
  const span = beat.out - beat.in;
  const shoulder = Math.min(0.030, span * 0.40);
  if (p <= beat.in - shoulder || p >= beat.out + shoulder) return 0;
  const rise = smootherstep((p - (beat.in - shoulder)) / shoulder);
  const fall = 1 - smootherstep((p - (beat.out - shoulder * 0.2)) / shoulder);
  return clamp(Math.min(rise, fall), 0, 1);
}

/**
 * Evaluate the storyboard.
 *
 * @param {number} p   raw scroll progress, 0..1
 * @param {object} [out] optional target object (keeps the frame allocation free)
 */
export function evaluate(p, out) {
  return sampleStory(dwell(p), out || newState());
}

export function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Vertical FOV compensation. The storyboard is composed for a 16:9 stage;
 * on a narrower stage we open the vertical angle so the car keeps the same
 * width on screen instead of being cropped.
 */
export function fovForAspect(fovDeg, aspect) {
  const REF = 16 / 9;
  if (aspect >= REF) return fovDeg;
  const half = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(half) * REF / Math.max(0.4, aspect));
  return clamp((halfH * 360) / Math.PI, fovDeg, 74);
}

/**
 * Portrait / narrow-viewport adaptation.
 *
 * The brief is explicit: mobile must not be a shrunken desktop. Instead of
 * cropping the composition we (a) widen the vertical angle, (b) ease the
 * camera back along its own axis so the car keeps breathing room, and
 * (c) drop the editorial subject-shift so the Lamborghini stays centred.
 * Mutates and returns the evaluated state.
 */
export function adaptToAspect(o, aspect) {
  if (aspect >= 1.35) {
    o.fov = fovForAspect(o.fov, aspect);
    return o;
  }

  // Portrait: open the lens up to a sane limit, then recover whatever width
  // the cap could not give us by easing the camera back along its own axis.
  // Every shot therefore keeps its share of the frame — a macro of the badge
  // stays a macro, a hero 3/4 stays a hero 3/4 — instead of being cropped.
  const d = dist(o.pos, o.target);
  const v0 = (o.fov * Math.PI) / 360;
  // Portrait compositions fill more of the width, leaving less ceiling.
  const widthRef = 2 * d * Math.tan(v0) * (16 / 9) * 0.82;

  o.fov = Math.min(fovForAspect(o.fov, aspect), 62);
  const widthNow = 2 * d * Math.tan((o.fov * Math.PI) / 360) * aspect;
  // telefon pionowo (~0.46): auto musi zmieścić się w całości, więc pozwalamy odjechać dalej
  const pull = clamp(widthRef / Math.max(1e-4, widthNow), 0.82, 1.8);

  if (Math.abs(pull - 1) > 0.0001) {
    for (let k = 0; k < 3; k++) o.pos[k] = o.target[k] + (o.pos[k] - o.target[k]) * pull;
    o.focus *= pull;
  }
  o.pos[1] = Math.max(o.pos[1], 0.22);

  const blend = clamp((aspect - 0.5) / 0.85, 0, 1);
  o.shift[0] *= blend * 0.5;
  o.shift[1] *= blend * 0.5;
  return o;
}

export default { SHOTS, BEATS, adaptToAspect, evaluate, beatOpacity, fovForAspect, clamp, lerp, smootherstep, dist };
