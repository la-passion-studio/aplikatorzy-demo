/**
 * aplikatorzy.pl — single place to tune the experience.
 */

/** Served from /public/assets — Vite copies it verbatim. */
export const MODEL_URL = 'assets/revuelto.glb';

/** The studio the car is filmed in. */
export const STUDIO_URL = 'studio/hangar.bin.wasm';

/** Bytes in the whole model, so the loading bar means something. */
export const MODEL_BYTES = 37_265_004;

/**
 * Optional: the same model split across several files. Useful when the host
 * caps single-file uploads (a 43 MB .glb is a lot to ask of a CDN). The parts
 * are fetched in order, joined back into one buffer and parsed in memory.
 * Leave empty to just use MODEL_URL.
 */
export const MODEL_PARTS = [
  'modelr/rev-00.bin.wasm',
  'modelr/rev-01.bin.wasm',
  'modelr/rev-02.bin.wasm',
  'modelr/rev-03.bin.wasm',
];

/**
 * The paint. Swap `body` for any of the presets below (or a client's own
 * colour) — clearcoat, sheen and the environment do the rest.
 *
 *   Nero Helene (graphite)  0x20242c   <- default, reads against dark asphalt
 *   Blu Astraeus            0x16294a
 *   Verde Mantis            0x5f7f14
 *   Arancio Xanto           0xc4500c
 *   Bianco Siderale         0xd9d9d6
 */
export const PAINT = {
  // Viola Notte — deep violet metallic under a glossy clearcoat. In shadow it
  // reads almost black; where the softboxes land it opens into violet, with a
  // faint blue flop from the iridescence at grazing angles.
  //
  // Albedo in LINEAR space (sRGB ≈ #30184f). Metallic paint takes its colour
  // from the reflection, so metalness and envMapIntensity carry the hue as
  // much as the albedo does.
  bodyLinear: [0.0300, 0.0105, 0.0880],
  body: 0x30184f,           // fallback if bodyLinear is ever removed
  metalness: 0.70,          // flake in the base coat
  roughness: 0.27,
  clearcoat: 1.0,           // full gloss lacquer on top
  clearcoatRoughness: 0.06,
  envMapIntensity: 1.35,
  sheen: 0x8566c8,
  sheenAmount: 0.38,
  iridescence: 0.10,        // a hint of colour shift on the flanks
  caliper: 0xb9c0c8,        // chrome callipers
};

/** How many viewport heights the cinematic sequence is stretched over. */
export const CINEMA_LENGTH_VH = 1250;

/** Arrival animation (seconds). */
export const ARRIVAL = {
  /** The hall powers up, then the car sweeps in. */
  ignition: 1.5,
  duration: 2.7,
  approach: 6.5,        // metres of run-up
  smokePuffs: 64,
};

const isMobileUA = () => /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : ''
);

/**
 * Quality tiers. Desktop is the priority, but the phone gets a real
 * adaptation — fewer petals, a smaller shadow map, lighter post — not a
 * shrunken desktop.
 */
export function detectQuality() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;

  const mobile = isMobileUA() || w < 820;
  const weak = mobile || cores <= 4 || mem <= 4;

  const h = typeof window !== 'undefined' ? window.innerHeight : 1080;

  /**
   * A pixel-ratio ceiling the GPU can actually survive.
   *
   * The post chain keeps roughly six full-resolution half-float buffers
   * (two composer ping-pongs, the scene target, bloom, SMAA, output) at
   * 8 bytes per pixel. At pixelRatio 3 on a 2560-wide window that is
   * 33 Mpx — about 1.6 GB of render targets, which crashes the tab on most
   * cards and leaves nothing but a blank white page. So the ratio is
   * capped by a pixel budget rather than by a number that sounds good:
   * The budget is also what keeps the film smooth: AO, DOF and bloom all run
   * per pixel, so 12 Mpx on a Retina 1440p window dropped frames on an M1.
   * 6 Mpx (≈1.3× on 2560×1440) holds 60 fps there and still reads sharp
   * on a screen recording.
   */
  const budget = mobile ? 3.0e6 : weak ? 4.0e6 : 7.5e6;   // start sharp; the frame guard steps resolution down when 60 fps is missed
  const cap = (max) => {
    const area = Math.max(1, w * h);
    return Math.max(1, Math.min(max, Math.sqrt(budget / area)));
  };

  if (mobile) {
    return {
      name: 'mobile',
      mobile: true,
      pixelRatio: Math.min(dpr, cap(2.0)),
      shadowMapSize: 1024,
      shadowRadius: 2,
      asphaltSize: 512,
      dust: 320,
      nearDust: 40,
      columns: 10,
      areaLights: false,
      post: { bloom: true, dof: false, ao: false, grade: true, smaa: false },
    };
  }

  if (weak) {
    return {
      name: 'balanced',
      mobile: false,
      pixelRatio: Math.min(dpr, cap(1.25)),
      shadowMapSize: 1024,
      shadowRadius: 3,
      asphaltSize: 768,
      dust: 620,
      nearDust: 70,
      columns: 14,
      areaLights: true,
      post: { bloom: true, dof: true, ao: true, grade: true, smaa: true },
    };
  }

  return {
    name: 'high',
    mobile: false,
    // Up to 1.5× the display density, inside the pixel budget above. The
    // frame-rate guard in main.js drops it further if the machine cannot
    // keep up, so this is a ceiling and not a demand.
    pixelRatio: Math.min(dpr, cap(2.0)),
    shadowMapSize: 2048,
    shadowRadius: 4,
    asphaltSize: 1024,
    dust: 1100,
    nearDust: 120,
    columns: 18,
    areaLights: true,
    post: { bloom: true, dof: true, ao: true, grade: true, smaa: true },
  };
}

// `?debug` works anywhere; `#debug` also works inside a framed page, where
// the query string never reaches the document.
export const DEBUG = typeof location !== 'undefined' && (
  /(\?|&)debug/.test(location.search) || /(^|#)debug$/.test(location.hash)
);
