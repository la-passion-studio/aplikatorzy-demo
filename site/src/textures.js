/**
 * aplikatorzy.pl — procedural texture atelier
 *
 * Every map in the scene is generated on a canvas at runtime: asphalt,
 * blossom clusters, petals, tyre smoke, contact shadow. Nothing has to be
 * downloaded, the whole garden is a few kilobytes of code, and the look is
 * identical on every machine because every generator is seeded.
 */

import {
  CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearFilter,
  LinearMipmapLinearFilter, DataTexture, RGBAFormat,
} from 'three';

/* --- deterministic noise ------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(rng, size) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const w = (t) => t * t * (3 - 2 * t);
    const at = (a, b) => g[((b % size) + size) % size * size + (((a % size) + size) % size)];
    const a00 = at(xi, yi), a10 = at(xi + 1, yi), a01 = at(xi, yi + 1), a11 = at(xi + 1, yi + 1);
    const u = w(xf), v = w(yf);
    return (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v;
  };
}

function fbm(noise, x, y, octaves = 5) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += noise(x * f, y * f) * amp;
    f *= 2.07;
    amp *= 0.5;
  }
  return v;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/* --- polished concrete --------------------------------------------------- */

/** @returns {{map:CanvasTexture, roughnessMap:CanvasTexture, normalMap:CanvasTexture}} */
export function makeConcrete(size = 1024) {
  const rng = mulberry32(7411);
  const noise = valueNoise(mulberry32(9137), 64);

  const albedo = canvas(size);
  const rough = canvas(size);
  const height = new Float32Array(size * size);

  const a = albedo.getContext('2d');
  const r = rough.getContext('2d');

  const aImg = a.createImageData(size, size);
  const rImg = r.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size, v = y / size;

      // aggregate grain + large scale mottling
      const grain = fbm(noise, u * 96, v * 96, 4);
      const macro = fbm(noise, u * 5.5, v * 5.5, 4);
      const wet = fbm(noise, u * 2.3 + 11, v * 2.3 + 7, 3);

      // a poured, power-trowelled floor: dark, even, with cloudy burnish
      // marks and the odd fleck of aggregate showing through
      let l = 0.46 + macro * 0.11 + (grain - 0.5) * 0.055;

      // scattered brighter aggregate stones
      const stone = fbm(noise, u * 210 + 3, v * 210 + 5, 2);
      if (stone > 0.70) l += (stone - 0.70) * 0.22;

      l = Math.max(0.055, Math.min(0.165, l));
      const srgb = Math.pow(l, 1 / 2.2) * 255;

      aImg.data[i] = srgb * 1.02;
      aImg.data[i + 1] = srgb * 1.0;
      aImg.data[i + 2] = srgb * 0.99;   // asphalt is a warm grey, not a blue one
      aImg.data[i + 3] = 255;

      // roughness: damp patches read as long soft reflections
      // polished, so it holds a long soft reflection — but burnished in
      // swirls, which is what stops it reading as a sheet of water
      // polished terrazzo: a long, soft mirror with burnish swirls
      const burnish = Math.pow(Math.max(0, wet - 0.34) / 0.66, 1.1);
      let rg = 0.34 - burnish * 0.14 + (grain - 0.5) * 0.05 + macro * 0.07;
      rg = Math.max(0.16, Math.min(0.46, rg));
      const rv = rg * 255;
      rImg.data[i] = rv; rImg.data[i + 1] = rv; rImg.data[i + 2] = rv; rImg.data[i + 3] = 255;

      height[y * size + x] = grain * 0.75 + macro * 0.25;
    }
  }
  a.putImageData(aImg, 0, 0);
  r.putImageData(rImg, 0, 0);

  const map = new CanvasTexture(albedo);
  map.colorSpace = SRGBColorSpace;
  const roughnessMap = new CanvasTexture(rough);
  const normalMap = normalFromHeight(height, size, 1.5);

  for (const t of [map, roughnessMap, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
  }
  return { map, roughnessMap, normalMap };
}

function normalFromHeight(height, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/* --- cabin materials ----------------------------------------------------- */

/**
 * 2x2 twill carbon weave. Returns an albedo and a normal map: the weave has
 * to be in the NORMAL for the clearcoat to catch it and flash as the camera
 * moves, which is the thing that reads as real carbon rather than a photo of
 * carbon printed on plastic.
 */
export function makeCarbon(size = 512, tile = 16) {
  const albedo = canvas(size);
  const a = albedo.getContext('2d');
  const cell = size / tile;              // one weave cell
  const strand = cell / 2;

  a.fillStyle = '#0a0a0c';
  a.fillRect(0, 0, size, size);

  const height = new Float32Array(size * size);
  const rng = mulberry32(6120);

  for (let gy = 0; gy < tile * 2; gy++) {
    for (let gx = 0; gx < tile * 2; gx++) {
      // 2x2 twill: the float steps one cell per row
      const over = ((gx + gy) % 4) < 2;
      const x = gx * strand;
      const y = gy * strand;

      const g = a.createLinearGradient(
        x, y, over ? x + strand : x, over ? y : y + strand);
      const base = 22 + rng() * 10;
      g.addColorStop(0, `rgb(${base * 0.45},${base * 0.45},${base * 0.5})`);
      g.addColorStop(0.5, `rgb(${base * 1.9},${base * 1.9},${base * 2.05})`);
      g.addColorStop(1, `rgb(${base * 0.45},${base * 0.45},${base * 0.5})`);
      a.fillStyle = g;
      a.fillRect(x, y, strand, strand);

      // the same profile drives the height, so the weave is felt not painted
      for (let py = 0; py < strand; py++) {
        for (let px = 0; px < strand; px++) {
          const u = (over ? px : py) / strand;
          const h = Math.sin(u * Math.PI);
          const ix = ((x + px) | 0) % size;
          const iy = ((y + py) | 0) % size;
          height[iy * size + ix] = h;
        }
      }
    }
  }

  const map = new CanvasTexture(albedo);
  map.colorSpace = SRGBColorSpace;
  const normalMap = normalFromHeight(height, size, 3.2);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

/**
 * Alcantara: a dense, short pile. The look comes from a fine directional
 * fuzz in the normal plus a roughness that never dips — suede has no
 * specular highlight, it has a sheen, which the material sets separately.
 */
export function makeAlcantara(size = 512) {
  const rng = mulberry32(3311);
  const noise = valueNoise(mulberry32(8123), 128);
  const rough = canvas(size);
  const r = rough.getContext('2d');
  const rImg = r.createImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fine = fbm(noise, (x / size) * 190, (y / size) * 190, 3);
      const drift = fbm(noise, (x / size) * 9 + 4, (y / size) * 9 + 9, 3);
      // pile lies in a direction, so the cloudiness is stretched
      const lay = fbm(noise, (x / size) * 26, (y / size) * 5 + 30, 3);

      const v = 0.86 + (fine - 0.5) * 0.10 + (drift - 0.5) * 0.06 + (lay - 0.5) * 0.05;
      const rv = Math.max(0.6, Math.min(1, v)) * 255;
      rImg.data[i] = rv; rImg.data[i + 1] = rv; rImg.data[i + 2] = rv; rImg.data[i + 3] = 255;
      height[y * size + x] = fine * 0.75 + lay * 0.25;
    }
  }
  r.putImageData(rImg, 0, 0);

  const roughnessMap = new CanvasTexture(rough);
  const normalMap = normalFromHeight(height, size, 1.15);
  for (const t of [roughnessMap, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
  }
  return { roughnessMap, normalMap };
}

/** Fine pebble grain for the leather. */
export function makeLeather(size = 512) {
  const noise = valueNoise(mulberry32(4477), 96);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = fbm(noise, (x / size) * 62, (y / size) * 62, 4);
      const cell = Math.pow(Math.abs(c - 0.5) * 2, 0.55);
      height[y * size + x] = 1 - cell;
    }
  }
  const normalMap = normalFromHeight(height, size, 1.5);
  normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
  normalMap.anisotropy = 8;
  return { normalMap };
}

/** A soft round mote for the dust drifting through the light slots. */
export function makeDust(size = 64) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* --- sakura ------------------------------------------------------------- */

/** A soft cluster of blossom — used as an instanced billboard on the trees. */
export function makeBlossomCluster(size = 256, seed = 12) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);

  const n = 46;
  for (let i = 0; i < n; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.62) * size * 0.42;
    const x = size / 2 + Math.cos(ang) * rad;
    const y = size / 2 + Math.sin(ang) * rad * 0.86;
    const rr = size * (0.035 + rng() * 0.075);

    const tint = rng();
    const col = tint > 0.72
      ? [253, 246, 246]
      : tint > 0.3
        ? [244, 214, 216]
        : [226, 178, 184];

    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.95)`);
    g.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},0.55)`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // feather the silhouette so clusters never show a hard billboard edge
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A single falling petal, soft edged, with a faint crease. */
export function makePetal(size = 128) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,247,248,0.98)');
  g.addColorStop(0.45, 'rgba(247,214,219,0.97)');
  g.addColorStop(1, 'rgba(225,168,179,0.92)');

  ctx.fillStyle = g;
  ctx.beginPath();
  const cx = size / 2;
  ctx.moveTo(cx, size * 0.06);
  ctx.bezierCurveTo(size * 0.94, size * 0.22, size * 0.90, size * 0.80, cx, size * 0.96);
  ctx.bezierCurveTo(size * 0.10, size * 0.80, size * 0.06, size * 0.22, cx, size * 0.06);
  ctx.closePath();
  ctx.fill();

  // notch at the tip — the sakura signature
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.965, size * 0.11, size * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = 'rgba(214,150,163,0.35)';
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.moveTo(cx, size * 0.16);
  ctx.lineTo(cx, size * 0.88);
  ctx.stroke();

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* --- smoke -------------------------------------------------------------- */

export function makeSmoke(size = 256, seed = 31) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const noise = valueNoise(mulberry32(seed), 32);
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size - 0.5, v = y / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const n = fbm(noise, (x / size) * 6, (y / size) * 6, 5);
      let alpha = (1 - Math.min(1, r)) ** 2.1 * (0.45 + n * 0.85);
      alpha = Math.max(0, Math.min(1, alpha));
      const l = 214 + n * 34;
      img.data[i] = l; img.data[i + 1] = l * 0.99; img.data[i + 2] = l * 0.97;
      img.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* --- contact shadow ----------------------------------------------------- */

/** Soft baked occlusion under the car, so it is welded to the asphalt. */
export function makeContactShadow(size = 512) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // broad ambient pool
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.80)');
  g.addColorStop(0.42, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // dense core under the floorpan (the car lies along the texture's Y axis)
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(0.58, 0.95);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.44);
  core.addColorStop(0, 'rgba(0,0,0,0.92)');
  core.addColorStop(0.6, 'rgba(0,0,0,0.45)');
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // four tyre contact patches — the darkest points on the ground
  const patch = (nx, ny) => {
    ctx.save();
    ctx.translate(size / 2 + nx * size * 0.5, size / 2 + ny * size * 0.5);
    ctx.scale(1, 1.55);
    const p = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.085);
    p.addColorStop(0, 'rgba(0,0,0,0.95)');
    p.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = p;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.085, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  // wheel contact patches, placed for a 3.6 m x 7.4 m plane under the car
  patch(-0.473, 0.348); patch(0.473, 0.348);   // front axle  (z = +1.288 m)
  patch(-0.473, -0.403); patch(0.473, -0.403); // rear axle   (z = -1.493 m)

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A plain radial alpha ramp — used to feather the edge off a disc. */
export function makeRadialAlpha(size = 256, inner = 0.45) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.72, '#9a9a9a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  return t;
}

/* --- soft round sprite (bokeh / light bloom helpers) -------------------- */

export function makeGlow(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* ── the car's own surfaces ──────────────────────────────────────────────
   The GLB ships a greyscale tread atlas and a couple of normal maps, but
   nothing that survives a close-up at 30% of frame width. These are drawn
   at 1024–2048 px so the wheel, the weave and the screens hold up when the
   camera is 40 cm from them.                                              */

/**
 * Tyre rubber.
 *
 * The model's own tyre texture is a UV ATLAS — several tyres and sidewall
 * strips packed into one 2048 sheet — so anything drawn as bands across it
 * lands in the wrong place. This is deliberately uniform instead: carbon
 * black with the fine mottling and bloom of real rubber, which is correct
 * whatever the unwrap does. The tread shape still comes from the model's
 * own normal map, which is authored to those UVs.
 */
export function makeTyre(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const rnd = mulberry32(8123);

  x.fillStyle = '#121214';
  x.fillRect(0, 0, size, size);

  // cloudy bloom, the way rubber weathers
  for (let i = 0; i < 260; i++) {
    const r = 12 + rnd() * 64;
    const g = x.createRadialGradient(rnd() * size, rnd() * size, 0, 0, 0, r);
    x.globalAlpha = 0.05 + rnd() * 0.05;
    const v = 8 + rnd() * 26 | 0;
    g.addColorStop(0, `rgb(${v},${v},${v + 2})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    const gx = rnd() * size, gy = rnd() * size;
    x.save(); x.translate(gx, gy); x.fillRect(-r, -r, r * 2, r * 2); x.restore();
  }
  x.globalAlpha = 1;

  const img = x.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 11;
    img.data[i] = Math.max(6, Math.min(40, img.data[i] + n));
    img.data[i + 1] = Math.max(6, Math.min(40, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(7, Math.min(42, img.data[i + 2] + n));
  }
  x.putImageData(img, 0, 0);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** Carbon fibre: a real 2×2 twill, as a normal map plus its own base colour. */
export function makeCarbonWeave(size = 512, tile = 20) {
  const base = document.createElement('canvas');
  const nrm = document.createElement('canvas');
  base.width = base.height = nrm.width = nrm.height = size;
  const b = base.getContext('2d');
  const n = nrm.getContext('2d');
  const cell = size / tile;

  b.fillStyle = '#0a0b0d'; b.fillRect(0, 0, size, size);
  n.fillStyle = '#8080ff'; n.fillRect(0, 0, size, size);

  // 2x2 twill: the float steps one cell along on every row, which is what
  // gives carbon its diagonal sheen rather than a flat chequerboard.
  for (let row = 0; row < tile; row++) {
    for (let col = 0; col < tile; col++) {
      const over = ((col + row) % 4) < 2;       // warp over weft?
      const px = col * cell, py = row * cell;
      const g = b.createLinearGradient(px, py, over ? px + cell : px, over ? py : py + cell);
      g.addColorStop(0, '#07080a');
      g.addColorStop(0.5, '#23262c');
      g.addColorStop(1, '#07080a');
      b.fillStyle = g;
      b.fillRect(px, py, cell, cell);

      // the normal: each float is a cylinder, lit across its short axis
      const ng = n.createLinearGradient(px, py, over ? px + cell : px, over ? py : py + cell);
      if (over) { ng.addColorStop(0, '#4d4dff'); ng.addColorStop(0.5, '#8080ff'); ng.addColorStop(1, '#b3b3ff'); }
      else { ng.addColorStop(0, '#80b3ff'); ng.addColorStop(0.5, '#8080ff'); ng.addColorStop(1, '#804dff'); }
      n.fillStyle = ng;
      n.fillRect(px, py, cell, cell);
    }
  }

  const bt = new CanvasTexture(base);
  bt.colorSpace = SRGBColorSpace;
  bt.wrapS = bt.wrapT = RepeatWrapping;
  bt.repeat.set(3, 3);
  const nt = new CanvasTexture(nrm);
  nt.wrapS = nt.wrapT = RepeatWrapping;
  nt.repeat.set(3, 3);
  return { map: bt, normalMap: nt };
}

/** Driver's binnacle, as it looks with the car running: speed, revs, gear. */
/**
 * The driver's display, drawn to the Revuelto's own layout.
 *
 * The real car puts a full circular rev counter in the middle of the screen,
 * numbered 0 to 10 with the red zone from 8.5, and hangs the digital speed
 * and the gear inside it. Everything else is arranged around that circle:
 * the electric side of the drivetrain down the left — battery state and a
 * charge / boost meter, because a Revuelto is a plug-in V12 — and the two
 * rotary selectors down the right: ANIMA (CITTÀ, STRADA, SPORT, CORSA) and
 * the hybrid mode (RECHARGE, HYBRID, PERFORMANCE). The car is standing in a
 * studio with the ignition on, so it reads idle: 0 km/h, N, needle just off
 * the stop.
 */
/**
 * The driver's display, drawn to the Revuelto's own layout.
 *
 * The real car puts a full circular rev counter in the middle of the screen,
 * numbered 0 to 10 with the red zone from 8.5, and hangs the digital speed
 * and the gear inside it. Everything else sits around that circle: the
 * electric half of the drivetrain down the left — state of charge and a
 * charge / boost meter, because a Revuelto is a plug-in V12 — and the two
 * rotary selectors down the right: ANIMA (CITTÀ, STRADA, SPORT, CORSA) and
 * the hybrid mode (RECHARGE, HYBRID, PERFORMANCE). The car is standing in a
 * studio with the ignition on, so it reads idle: 0 km/h, N, needle just off
 * the stop.
 *
 * The three regions are laid out to hard pixel boundaries — left column,
 * dial, right column — because the numerals ring the dial on the OUTSIDE of
 * the track and will happily run into the side columns (and off the canvas)
 * if the radius is chosen by eye. Hence the numerals sit inside the track,
 * the way they do on the real screen.
 */
export function makeCluster(w = 1024, h = 384) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const SANS = '"DM Sans", system-ui, sans-serif';

  x.fillStyle = '#04060b';
  x.fillRect(0, 0, w, h);

  const cx = w * 0.5, cy = h * 0.52;
  const R = h * 0.312;                 // outermost ink: R + 0.052h < h/2
  const colL = w * 0.039;
  const colR = w * 0.684;

  const A0 = Math.PI * 0.72, A1 = Math.PI * 2.28;   // gap at the bottom
  const ang = (v) => A0 + (A1 - A0) * (v / 10);
  const REDLINE = 8.5;
  const IDLE = 0.9;

  /* --- the dial ------------------------------------------------------- */

  x.lineCap = 'butt';
  x.lineWidth = h * 0.047;
  x.strokeStyle = 'rgba(126,160,200,0.20)';
  x.beginPath(); x.arc(cx, cy, R, A0, ang(REDLINE)); x.stroke();

  // the red zone — on a V12 it takes the whole last quarter of the sweep
  x.strokeStyle = 'rgba(255,45,42,0.60)';
  x.beginPath(); x.arc(cx, cy, R, ang(REDLINE), A1); x.stroke();

  // what the engine is actually doing
  x.lineWidth = h * 0.056;
  x.strokeStyle = '#a8dcff';
  x.shadowColor = '#3d9bff';
  x.shadowBlur = h * 0.12;
  x.beginPath(); x.arc(cx, cy, R, A0, ang(IDLE)); x.stroke();
  x.shadowBlur = 0;

  // ticks outside the track, numerals inside it
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (let v = 0; v <= 10; v += 0.5) {
    const a = ang(v);
    const major = Number.isInteger(v);
    const r0 = R + h * 0.031;
    const r1 = r0 + (major ? h * 0.021 : h * 0.010);
    x.strokeStyle = v >= REDLINE ? 'rgba(255,60,54,0.95)' : 'rgba(214,232,255,0.75)';
    x.lineWidth = major ? h * 0.011 : h * 0.005;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    x.stroke();

    if (!major) continue;
    const rt = R - h * 0.070;
    x.fillStyle = v >= REDLINE ? '#ff5b52' : 'rgba(226,240,255,0.88)';
    x.font = `600 ${h * 0.058}px ${SANS}`;
    x.fillText(String(v), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
  }

  /* --- speed and gear, inside the dial -------------------------------- */

  x.fillStyle = '#a8dcff';
  x.font = `600 ${h * 0.082}px ${SANS}`;
  x.fillText('N', cx, cy - h * 0.145);

  x.fillStyle = '#ffffff';
  x.font = `600 ${h * 0.190}px ${SANS}`;
  x.fillText('0', cx, cy + h * 0.020);

  x.fillStyle = 'rgba(226,240,255,0.55)';
  x.font = `500 ${h * 0.052}px ${SANS}`;
  x.fillText('km/h', cx, cy + h * 0.128);

  // sits in the gap at the foot of the dial
  x.fillStyle = 'rgba(160,190,225,0.50)';
  x.font = `500 ${h * 0.042}px ${SANS}`;
  x.fillText('x1000 rpm', cx, cy + h * 0.265);

  /* --- left: the electric half of the drivetrain ---------------------- */

  x.textAlign = 'left';

  x.fillStyle = 'rgba(160,190,225,0.55)';
  x.font = `500 ${h * 0.046}px ${SANS}`;
  x.fillText('BATTERIA', colL, h * 0.25);

  const cellW = h * 0.030, cellH = h * 0.046, gap = h * 0.013;
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i < 7 ? '#4ce07a' : 'rgba(150,180,215,0.18)';
    x.fillRect(colL + i * (cellW + gap), h * 0.31, cellW, cellH);
  }
  x.fillStyle = '#e6f2ff';
  x.font = `600 ${h * 0.078}px ${SANS}`;
  x.fillText('87%', colL, h * 0.47);

  x.fillStyle = 'rgba(160,190,225,0.55)';
  x.font = `500 ${h * 0.044}px ${SANS}`;
  x.fillText('CHARGE', colL, h * 0.60);
  x.fillText('BOOST', colL + h * 0.40, h * 0.60);

  const mW = h * 0.60, mH = h * 0.038, mY = h * 0.655;
  x.fillStyle = 'rgba(150,180,215,0.16)';
  x.fillRect(colL, mY, mW, mH);
  x.fillStyle = 'rgba(226,240,255,0.45)';
  x.fillRect(colL + mW * 0.5 - h * 0.004, mY - h * 0.011, h * 0.008, mH + h * 0.022);

  /* --- right: the two rotary selectors -------------------------------- */

  const modes = ['CITTÀ', 'STRADA', 'SPORT', 'CORSA'];
  x.font = `600 ${h * 0.058}px ${SANS}`;
  for (let i = 0; i < modes.length; i++) {
    const on = i === 0;
    x.fillStyle = on ? '#ffb020' : 'rgba(180,205,235,0.30)';
    x.fillText(modes[i], colR + h * 0.055, h * 0.24 + i * h * 0.082);
    if (on) x.fillRect(colR, h * 0.24 - h * 0.030, h * 0.013, h * 0.060);
  }

  const hy = ['RECHARGE', 'HYBRID', 'PERFORMANCE'];
  x.font = `500 ${h * 0.048}px ${SANS}`;
  for (let i = 0; i < hy.length; i++) {
    x.fillStyle = i === 1 ? '#4ce07a' : 'rgba(180,205,235,0.26)';
    x.fillText(hy[i], colR + h * 0.055, h * 0.655 + i * h * 0.068);
  }

  /* --- top strip ------------------------------------------------------ */

  x.fillStyle = 'rgba(180,205,235,0.42)';
  x.font = `500 ${h * 0.046}px ${SANS}`;
  x.fillText('14 °C', colL, h * 0.085);
  x.textAlign = 'right';
  x.fillText('21:40', w - colL, h * 0.085);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  return t;
}

/** Centre display: a live navigation map with the route back to the studio. */
export function makeNavScreen(w = 640, h = 1024) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const rnd = mulberry32(4471);

  x.fillStyle = '#0b1016'; x.fillRect(0, 0, w, h);

  // map: blocks and streets, seen from a low chase angle
  x.fillStyle = '#131a23';
  for (let i = 0; i < 90; i++) {
    const bx = rnd() * w, by = h * 0.10 + rnd() * h * 0.72;
    x.fillRect(bx, by, 30 + rnd() * 90, 26 + rnd() * 80);
  }
  x.strokeStyle = '#1e2732'; x.lineWidth = 9;
  for (let i = 0; i < 12; i++) {
    x.beginPath(); x.moveTo(0, h * 0.1 + i * h * 0.07); x.lineTo(w, h * 0.1 + i * h * 0.07 - 40); x.stroke();
    x.beginPath(); x.moveTo(i * w * 0.1, h * 0.08); x.lineTo(i * w * 0.1 + 60, h * 0.86); x.stroke();
  }

  // the route
  x.strokeStyle = '#2f7dff'; x.lineWidth = 22; x.lineJoin = 'round'; x.lineCap = 'round';
  x.shadowColor = '#2f7dff'; x.shadowBlur = 26;
  x.beginPath();
  x.moveTo(w * 0.5, h * 0.80);
  x.lineTo(w * 0.5, h * 0.55);
  x.lineTo(w * 0.24, h * 0.40);
  x.lineTo(w * 0.24, h * 0.16);
  x.stroke();
  x.shadowBlur = 0;

  // own position
  x.fillStyle = '#ffffff';
  x.beginPath(); x.moveTo(w * 0.5, h * 0.775); x.lineTo(w * 0.47, h * 0.815); x.lineTo(w * 0.53, h * 0.815); x.closePath(); x.fill();

  // top bar: the next instruction
  x.fillStyle = 'rgba(6,10,14,0.92)'; x.fillRect(0, 0, w, h * 0.115);
  x.fillStyle = '#ffffff';
  x.font = `600 ${h * 0.036}px "DM Sans", system-ui, sans-serif`;
  x.textAlign = 'left';
  x.fillText('Studio', w * 0.20, h * 0.052);
  x.font = `400 ${h * 0.026}px "DM Sans", system-ui, sans-serif`;
  x.fillStyle = 'rgba(255,255,255,0.6)';
  x.fillText('400 m  ·  aplikatorzy.pl', w * 0.20, h * 0.088);
  // turn arrow
  x.strokeStyle = '#2f7dff'; x.lineWidth = h * 0.012; x.lineCap = 'round';
  x.beginPath(); x.moveTo(w * 0.11, h * 0.085); x.lineTo(w * 0.11, h * 0.048); x.lineTo(w * 0.07, h * 0.048); x.stroke();
  x.beginPath(); x.moveTo(w * 0.085, h * 0.030); x.lineTo(w * 0.055, h * 0.048); x.lineTo(w * 0.085, h * 0.066); x.closePath();
  x.fillStyle = '#2f7dff'; x.fill();

  // bottom bar: media
  x.fillStyle = 'rgba(6,10,14,0.92)'; x.fillRect(0, h * 0.885, w, h * 0.115);
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.font = `500 ${h * 0.028}px "DM Sans", system-ui, sans-serif`;
  x.fillText('aplikatorzy.pl  ·  GDYNIA', w * 0.08, h * 0.935);
  x.fillStyle = 'rgba(255,255,255,0.4)';
  x.font = `400 ${h * 0.022}px "DM Sans", system-ui, sans-serif`;
  x.fillText('Car wrapping & stylizacja', w * 0.08, h * 0.972);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  return t;
}

/** Draws the aplikatorzy.pl monogram (two interlocking "d") into a 2D context. */
export function drawMark(x, cx, cy, h, stroke) {
  // the SVG symbol is 40 x 30 units; scale it to the requested height
  const k = h / 30;
  x.save();
  x.translate(cx - 20 * k, cy - 15 * k);
  x.lineWidth = 2.6 * k;
  x.lineJoin = 'miter';
  x.lineCap = 'butt';
  x.strokeStyle = stroke;
  x.beginPath();
  x.moveTo(5 * k, 28.5 * k); x.lineTo(20 * k, 1.8 * k); x.lineTo(35 * k, 28.5 * k);
  x.moveTo(12.4 * k, 18.6 * k); x.lineTo(27.6 * k, 18.6 * k);
  x.stroke();
  x.restore();
}

/** Redraws once the web font is in, so lettering never falls back to Arial. */
function withFont(draw, tex, font = '500 64px Unbounded') {
  draw();
  if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load(font),
      document.fonts.load(font.replace(/^\d+/, '200')),
    ]).then(() => { draw(); tex.needsUpdate = true; }).catch(() => {});
  }
}

/**
 * The rear plate: a show plate with the studio's name instead of a
 * registration.
 */
export function makePlate() {
  const W = 1024, H = 220;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;

  const draw = () => {
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#f1f2f0'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#111317'; x.fillRect(0, 0, W * 0.085, H);
    drawMark(x, W * 0.0425, H * 0.50, H * 0.30, '#d9dfe6');
    x.fillStyle = '#0b0c0f';
    x.textBaseline = 'middle';
    x.textAlign = 'center';
    x.font = `500 ${H * 0.25}px Unbounded, "Helvetica Neue", Arial, sans-serif`;
    const a = 'aplikatorzy', b = '.pl';
    const wa = x.measureText(a).width;
    x.font = `200 ${H * 0.25}px Unbounded, "Helvetica Neue", Arial, sans-serif`;
    const wb = x.measureText(b).width;
    const left = W * 0.545 - (wa + wb) / 2;
    x.textAlign = 'left';
    x.font = `500 ${H * 0.25}px Unbounded, "Helvetica Neue", Arial, sans-serif`;
    x.fillText(a, left, H * 0.52);
    x.font = `200 ${H * 0.25}px Unbounded, "Helvetica Neue", Arial, sans-serif`;
    x.fillText(b, left + wa, H * 0.52);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 4;
    x.strokeRect(2, 2, W - 4, H - 4);
  };
  withFont(draw, t);
  return t;
}

/**
 * The sign on the studio wall: the studio's own plate — black glass, red
 * border, a red tile with the white "A" — as it hangs on their real garage
 * wall. Drawn on transparent, sized to the 9.6 x 3.43 m strip of wall.
 */
export function makeSign() {
  const W = 2800, H = 1000;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;

  const rr = (px, py, w, h, r) => {
    x.beginPath();
    x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r); x.closePath();
  };

  const draw = () => {
    x.clearRect(0, 0, W, H);
    // lower part of the panel: the wide shots look at the wall from below
    const ph = H * 0.30, base = H * 0.95;
    const py = base - ph;
    x.textBaseline = 'middle';
    x.font = `400 ${ph * 0.5}px Michroma, Unbounded, "Helvetica Neue", Arial, sans-serif`;
    const tw = x.measureText('PLIKATORZY').width;
    const tile = ph;                    // the red square
    const pw = tile + ph * 0.32 + tw + ph * 0.92;
    const px = (W - pw) / 2;
    // plate: black glass with a red border
    rr(px, py, pw, ph, ph * 0.12);
    const g = x.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, '#34343a'); g.addColorStop(0.5, '#0b0b0d'); g.addColorStop(1, '#202024');
    x.fillStyle = g; x.fill();
    x.lineWidth = ph * 0.06; x.strokeStyle = '#d9202b'; x.stroke();
    // red tile with the white A
    x.save();
    rr(px + ph * 0.03, py + ph * 0.03, tile - ph * 0.06, ph - ph * 0.06, ph * 0.09); x.clip();
    const rg = x.createLinearGradient(0, py, 0, py + ph);
    rg.addColorStop(0, '#f0303b'); rg.addColorStop(1, '#a3111a');
    x.fillStyle = rg; x.fillRect(px, py, tile, ph);
    x.restore();
    const cx = px + tile / 2, cy = py + ph / 2, k = ph / 100;
    x.fillStyle = '#fff'; x.beginPath();
    x.moveTo(cx - 27 * k, cy + 28 * k); x.lineTo(cx, cy - 30 * k); x.lineTo(cx + 27 * k, cy + 28 * k);
    x.lineTo(cx + 15 * k, cy + 28 * k); x.lineTo(cx, cy - 2 * k); x.lineTo(cx - 15 * k, cy + 28 * k); x.closePath(); x.fill();
    // lettering
    x.fillStyle = '#ffffff';
    x.fillText('PLIKATORZY', px + tile + ph * 0.32, py + ph * 0.52);
    x.font = `400 ${ph * 0.2}px Michroma, Unbounded, Arial, sans-serif`;
    x.fillStyle = '#e3202c';
    x.fillText('.PL', px + tile + ph * 0.32 + tw + ph * 0.05, py + ph * 0.78);
  };
  withFont(draw, t, '400 64px Michroma');
  return t;
}

/**
 * Asphalt.
 *
 * Not the polished terrazzo the showroom had: coarse aggregate in a bitumen
 * matrix, laid in passes, with the damp sheen that makes a dark road
 * photograph well. The aggregate carries into the normal map so the grazing
 * light across it reads as stone rather than noise.
 */
export function makeAsphalt(size = 1024) {
  const base = document.createElement('canvas');
  const rough = document.createElement('canvas');
  const nrm = document.createElement('canvas');
  base.width = base.height = rough.width = rough.height = nrm.width = nrm.height = size;
  const b = base.getContext('2d');
  const r = rough.getContext('2d');
  const rnd = mulberry32(5150);

  b.fillStyle = '#17181a'; b.fillRect(0, 0, size, size);
  r.fillStyle = '#8c8c8c'; r.fillRect(0, 0, size, size);

  // the laying passes: long, very slightly different shades
  for (let i = 0; i < 7; i++) {
    const y = (i / 7) * size;
    b.fillStyle = `rgba(255,255,255,${0.012 + rnd() * 0.016})`;
    b.fillRect(0, y, size, size / 7);
  }

  // aggregate
  const height = new Float32Array(size * size);
  const stones = Math.floor(size * size / 190);
  for (let i = 0; i < stones; i++) {
    const x = rnd() * size, y = rnd() * size;
    const rad = 1.2 + rnd() * 4.2;
    const v = 30 + rnd() * 58 | 0;
    b.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    b.beginPath(); b.ellipse(x, y, rad, rad * (0.7 + rnd() * 0.6), rnd() * 3.1, 0, Math.PI * 2); b.fill();
    const rv = 150 + rnd() * 70 | 0;
    r.fillStyle = `rgb(${rv},${rv},${rv})`;
    r.beginPath(); r.ellipse(x, y, rad, rad * 0.9, 0, 0, Math.PI * 2); r.fill();
    const ir = Math.ceil(rad);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const px = (x + dx) | 0, py = (y + dy) | 0;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const d = Math.hypot(dx, dy) / rad;
        if (d > 1) continue;
        height[py * size + px] = Math.max(height[py * size + px], Math.cos(d * 1.57) * 0.9);
      }
    }
  }

  // damp patches: where the surface is sealed it holds the light
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, rad = size * (0.05 + rnd() * 0.16);
    const g = r.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(60,60,60,0.55)');
    g.addColorStop(1, 'rgba(60,60,60,0)');
    r.fillStyle = g; r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // grain over both
  const bi = b.getImageData(0, 0, size, size);
  for (let i = 0; i < bi.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    bi.data[i] += n; bi.data[i + 1] += n; bi.data[i + 2] += n;
  }
  b.putImageData(bi, 0, 0);

  // normal map from the aggregate heights
  const n = nrm.getContext('2d');
  const ni = n.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      ni.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      ni.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      ni.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
    }
  }
  n.putImageData(ni, 0, 0);

  const map = new CanvasTexture(base);
  map.colorSpace = SRGBColorSpace;
  const roughnessMap = new CanvasTexture(rough);
  const normalMap = new CanvasTexture(nrm);
  for (const t of [map, roughnessMap, normalMap]) t.wrapS = t.wrapT = RepeatWrapping;
  return { map, roughnessMap, normalMap };
}
