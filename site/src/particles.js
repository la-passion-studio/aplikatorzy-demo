/**
 * aplikatorzy.pl — sakura petals and tyre smoke
 *
 * Both systems are GPU-resident: one instanced draw call each, no DOM nodes,
 * no per-particle JavaScript. Every petal's position is a closed-form
 * function of (seed, time, scrollFlow), which means the scroll genuinely
 * drives them — and dragging the scrollbar backwards runs them backwards.
 */

import {
  InstancedMesh, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial,
  Color, DoubleSide, AdditiveBlending, NormalBlending, Vector3, StaticDrawUsage,
} from 'three';
import { makePetal, makeSmoke, mulberry32 } from './textures.js';
import { FOG_COLOR } from './environment.js';

/* ========================================================================
 * Sakura petals
 * ===================================================================== */

const petalVert = /* glsl */`
  precision highp float;

  attribute vec4 aSeed;      // x,z start, fall speed, size
  attribute vec4 aSpin;      // spin axis offsets + phase
  attribute float aY;        // start height 0..1
  attribute float aTint;

  uniform float uTime;
  uniform float uFlow;       // time + scroll, the master clock of the fall
  uniform float uHeight;
  uniform float uRadius;
  uniform vec3  uOrigin;     // keeps the field centred on the camera
  uniform float uSizeScale;

  varying vec2 vUv;
  varying float vTint;
  varying float vFog;
  varying float vFacing;

  mat3 rotation(vec3 axis, float a) {
    float s = sin(a), c = cos(a);
    float t = 1.0 - c;
    axis = normalize(axis);
    return mat3(
      t * axis.x * axis.x + c,          t * axis.x * axis.y - s * axis.z, t * axis.x * axis.z + s * axis.y,
      t * axis.x * axis.y + s * axis.z, t * axis.y * axis.y + c,          t * axis.y * axis.z - s * axis.x,
      t * axis.x * axis.z - s * axis.y, t * axis.y * axis.z + s * axis.x, t * axis.z * axis.z + c
    );
  }

  void main() {
    vUv = uv;
    vTint = aTint;

    float fall = aSeed.z;
    float phase = aSpin.w;

    // height: wraps around, driven by the master clock -> reverses with scroll
    float h = fract(aY - uFlow * fall * 0.055 + 1000.0);
    float y = h * uHeight;

    // lateral drift: a slow spiral, plus a gentle breeze
    float drift = uFlow * 0.35 + phase;
    vec3 pos = vec3(
      aSeed.x + sin(drift * 0.6) * 0.9 + sin(uTime * 0.21 + phase) * 0.35,
      y,
      aSeed.y + cos(drift * 0.47) * 0.9 + cos(uTime * 0.18 + phase * 1.7) * 0.35
    );

    pos.xz += uOrigin.xz;
    pos.x = mod(pos.x - uOrigin.x + uRadius, uRadius * 2.0) - uRadius + uOrigin.x;
    pos.z = mod(pos.z - uOrigin.z + uRadius, uRadius * 2.0) - uRadius + uOrigin.z;

    // tumbling — also on the master clock, so it rewinds too
    mat3 rot = rotation(vec3(aSpin.x, aSpin.y, aSpin.z), uFlow * (0.9 + fall) * 1.6 + phase);
    vec3 local = rot * vec3(position.xy * aSeed.w * uSizeScale, 0.0);

    vec4 mv = modelViewMatrix * vec4(pos + local, 1.0);
    vFog = -mv.z;

    // fade a petal out when it turns edge-on, so it never flickers
    vec3 n = rot * vec3(0.0, 0.0, 1.0);
    vFacing = abs(normalize((modelViewMatrix * vec4(n, 0.0)).xyz).z);

    gl_Position = projectionMatrix * mv;
  }
`;

const petalFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uOpacity;
  uniform float uEdge;
  varying vec2 vUv;
  varying float vTint;
  varying float vFog;
  varying float vFacing;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.03) discard;
    vec3 col = tex.rgb * vTint;
    float f = 1.0 - exp(-pow(uFogDensity * max(vFog, 0.0), 2.0));
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
    float edge = mix(1.0, 0.25 + 0.75 * smoothstep(0.02, 0.35, vFacing), uEdge);
    gl_FragColor = vec4(col, tex.a * uOpacity * edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * @param {number} count
 * @param {{radius:number,height:number,size:number,seed:number,opacity:number}} opts
 */
export function createPetals(count, opts = {}) {
  const {
    radius = 26, height = 17, size = 1, seed = 4821, opacity = 1,
    texture = null, additive = false, flat = false,
  } = opts;

  const rng = mulberry32(seed);
  const geo = new PlaneGeometry(0.115, 0.135);

  const aSeed = new Float32Array(count * 4);
  const aSpin = new Float32Array(count * 4);
  const aY = new Float32Array(count);
  const aTint = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    aSeed[i * 4] = Math.cos(a) * r;
    aSeed[i * 4 + 1] = Math.sin(a) * r;
    aSeed[i * 4 + 2] = 0.55 + rng() * 0.95;              // fall speed
    aSeed[i * 4 + 3] = (0.75 + rng() * 0.9) * size;      // size

    aSpin[i * 4] = rng() * 2 - 1;
    aSpin[i * 4 + 1] = rng() * 2 - 1;
    aSpin[i * 4 + 2] = rng() * 2 - 1;
    aSpin[i * 4 + 3] = rng() * Math.PI * 2;

    aY[i] = rng();
    aTint[i] = 0.82 + rng() * 0.32;
  }

  const material = new ShaderMaterial({
    vertexShader: petalVert,
    fragmentShader: petalFrag,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : NormalBlending,
    uniforms: {
      uMap: { value: texture || makePetal(128) },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uHeight: { value: height },
      uRadius: { value: radius },
      uOrigin: { value: new Vector3() },
      uSizeScale: { value: 1 },
      uFogColor: { value: FOG_COLOR.clone() },
      uFogDensity: { value: 0.006 },
      uOpacity: { value: opacity },
      uEdge: { value: flat ? 0 : 1 },
    },
  });

  const mesh = new InstancedMesh(geo, material, count);
  mesh.geometry.setAttribute('aSeed', new InstancedBufferAttribute(aSeed, 4));
  mesh.geometry.setAttribute('aSpin', new InstancedBufferAttribute(aSpin, 4));
  mesh.geometry.setAttribute('aY', new InstancedBufferAttribute(aY, 1));
  mesh.geometry.setAttribute('aTint', new InstancedBufferAttribute(aTint, 1));
  mesh.instanceMatrix.setUsage(StaticDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'petals';

  return {
    mesh,
    /**
     * @param {number} time    seconds (ambient life)
     * @param {number} flow    time + scroll distance: the deterministic clock
     * @param {Vector3} origin keeps the column of petals around the camera
     */
    update(time, flow, origin) {
      material.uniforms.uTime.value = time;
      material.uniforms.uFlow.value = flow;
      if (origin) material.uniforms.uOrigin.value.set(origin.x, 0, origin.z);
    },
    material,
    dispose() { geo.dispose(); material.dispose(); },
  };
}

/* ========================================================================
 * Tyre smoke — arrival only
 * ===================================================================== */

const smokeVert = /* glsl */`
  precision highp float;
  attribute vec4 aSeed;   // birth, lifetime, size, drift
  attribute vec3 aPos;    // emitter offset
  attribute vec3 aVel;
  uniform float uTime;    // seconds since the car started moving
  varying vec2 vUv;
  varying float vAlpha;
  varying float vRot;

  void main() {
    vUv = uv;
    float age = (uTime - aSeed.x) / aSeed.y;
    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // cull off-screen
      vAlpha = 0.0;
      return;
    }

    float e = pow(age, 0.65);
    vec3 pos = aPos + aVel * e * aSeed.y;
    pos.y += e * 0.85 * aSeed.w;
    pos.x += sin(age * 5.0 + aSeed.x * 9.0) * 0.18 * e;

    float scale = aSeed.z * (0.35 + e * 2.3);
    vAlpha = smoothstep(0.0, 0.10, age) * (1.0 - smoothstep(0.35, 1.0, age));
    vRot = aSeed.x * 6.28 + age * 1.2;

    float c = cos(vRot), s = sin(vRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    mv.xy += p * scale;
    gl_Position = projectionMatrix * mv;
  }
`;

const smokeFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.001) discard;
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(uColor * tex.rgb, tex.a * vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Puffs are emitted from the two rear contact patches while the car is still
 * moving; each one has a deterministic birth time, so the whole burst is a
 * pure function of the arrival clock.
 */
export function createSmoke(count, { rearAxleZ = -1.49, trackHalf = 0.85, duration = 1.35 } = {}) {
  const rng = mulberry32(77123);
  const geo = new PlaneGeometry(1, 1);

  const aSeed = new Float32Array(count * 4);
  const aPos = new Float32Array(count * 3);
  const aVel = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const birth = (i / count) * duration;
    // the last puffs are the weakest — the car is nearly stopped by then
    const energy = 1 - (i / count) * 0.72;

    aSeed[i * 4] = birth;
    aSeed[i * 4 + 1] = 1.1 + rng() * 1.5;
    aSeed[i * 4 + 2] = (0.42 + rng() * 0.5) * (0.6 + energy);
    aSeed[i * 4 + 3] = 0.5 + rng() * 0.9;

    aPos[i * 3] = side * trackHalf + (rng() - 0.5) * 0.22;
    aPos[i * 3 + 1] = 0.07 + rng() * 0.12;
    aPos[i * 3 + 2] = rearAxleZ - 0.25 - rng() * 0.4;

    aVel[i * 3] = side * (0.25 + rng() * 0.45) * energy;
    aVel[i * 3 + 1] = 0.12 + rng() * 0.22;
    aVel[i * 3 + 2] = -(0.9 + rng() * 1.5) * energy;
  }

  const material = new ShaderMaterial({
    vertexShader: smokeVert,
    fragmentShader: smokeFrag,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    uniforms: {
      uMap: { value: makeSmoke(256) },
      uTime: { value: -1 },
      uOpacity: { value: 0.42 },
      uColor: { value: new Color(0.62, 0.60, 0.585) },
    },
  });

  const mesh = new InstancedMesh(geo, material, count);
  mesh.geometry.setAttribute('aSeed', new InstancedBufferAttribute(aSeed, 4));
  mesh.geometry.setAttribute('aPos', new InstancedBufferAttribute(aPos, 3));
  mesh.geometry.setAttribute('aVel', new InstancedBufferAttribute(aVel, 3));
  mesh.instanceMatrix.setUsage(StaticDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.name = 'tyre-smoke';

  return {
    mesh,
    /** @param {number} t seconds since the arrival began; pass -1 to stop */
    update(t, fade = 1) {
      material.uniforms.uTime.value = t;
      material.uniforms.uOpacity.value = 0.42 * fade;
      mesh.visible = t >= 0 && fade > 0.002;
    },
    material,
    dispose() { geo.dispose(); material.dispose(); },
  };
}
