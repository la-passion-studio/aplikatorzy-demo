/**
 * aplikatorzy.pl — post processing
 *
 *   scene -> depth-of-field -> bloom -> ACES tone map -> grade -> SMAA
 *
 * The DOF is driven straight from the storyboard: focus distance and bokeh
 * strength are keyframed per shot, so the macro of the rear badge gets a real
 * shallow plane of focus while the hero shots stay crisp edge to edge.
 *
 * The scene is rendered into a target of our own that carries a depth
 * texture, and the blur pass reads THAT target rather than the composer's
 * ping-pong buffer — otherwise the depth attachment would be bound for
 * reading and writing at the same time, which is a feedback loop.
 *
 * Every stage is optional. If a pass cannot be built the chain simply gets
 * shorter; it never takes the page down with it.
 */

import {
  WebGLRenderTarget, DepthTexture, UnsignedIntType, HalfFloatType,
  NearestFilter, Vector2, Vector4,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/** Renders the scene into a target we own, so we keep its depth. */
class ScenePass extends Pass {
  constructor(scene, camera, target) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.target = target;
    this.needsSwap = false;
  }

  render(renderer) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
  }

  setSize(width, height) {
    this.target.setSize(width, height);
  }
}

/* --- depth of field ----------------------------------------------------- */

const DofShader = {
  name: 'DdtDof',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uFocus: { value: 6 },
    uStrength: { value: 0 },
    uMaxRadius: { value: 16 },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uFocus, uStrength, uMaxRadius, uNear, uFar;

    float linearDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      float viewZ = perspectiveDepthToViewZ(d, uNear, uFar);
      return -viewZ;
    }

    float circleOfConfusion(float d) {
      float coc = abs(d - uFocus) / max(d, 0.02);
      return clamp(coc * uStrength, 0.0, 1.0);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      if (uStrength < 0.001) { gl_FragColor = base; return; }

      float d = linearDepth(vUv);
      float coc = circleOfConfusion(d);
      if (coc < 0.012) { gl_FragColor = base; return; }

      float radius = coc * uMaxRadius;
      vec2 texel = 1.0 / uResolution;

      vec3 sum = base.rgb;
      float weight = 1.0;

      // 12 taps on a golden-angle spiral: smooth, isotropic, cheap
      const float GA = 2.39996323;
      for (int i = 1; i <= 12; i++) {
        float fi = float(i);
        float a = fi * GA;
        float r = sqrt(fi / 12.0) * radius;
        vec2 uv = clamp(vUv + vec2(cos(a), sin(a)) * r * texel, vec2(0.001), vec2(0.999));

        float sd = linearDepth(uv);
        // a sharp foreground must never smear over a blurred background
        float w = (sd < d - 0.05) ? circleOfConfusion(sd) : 1.0;
        sum += texture2D(tDiffuse, uv).rgb * w;
        weight += w;
      }

      gl_FragColor = vec4(sum / weight, base.a);
    }
  `,
};

/* --- ambient occlusion -------------------------------------------------- */

/**
 * Horizon-style AO reconstructed from the depth buffer alone — no second
 * geometry pass, no normal buffer. This is the single biggest "is it a photo
 * or is it CG" lever: contact darkening in the wheel arches, under the
 * mirrors, along the door shut lines and inside the cabin.
 */
const AoShader = {
  name: 'DdtAO',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uProjParams: { value: new Vector4(1, 0, 1, 0) },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
    uRadius: { value: 0.55 },
    uIntensity: { value: 0.9 },
    uBias: { value: 0.022 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform vec4 uProjParams;
    uniform float uNear, uFar, uRadius, uIntensity, uBias;

    float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }

    vec3 viewPos(vec2 uv) {
      float z = perspectiveDepthToViewZ(rawDepth(uv), uNear, uFar);
      vec2 ndc = uv * 2.0 - 1.0;
      return vec3((ndc.x * uProjParams.x + uProjParams.y) * (-z),
                  (ndc.y * uProjParams.z + uProjParams.w) * (-z), z);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float d = rawDepth(vUv);
      if (d >= 0.99999 || uIntensity < 0.001) { gl_FragColor = base; return; }

      vec3 P = viewPos(vUv);
      vec2 texel = 1.0 / uResolution;

      // normal from the depth buffer, using the closer of each neighbour pair
      vec3 pr = viewPos(vUv + vec2(texel.x, 0.0)) - P;
      vec3 pl = P - viewPos(vUv - vec2(texel.x, 0.0));
      vec3 pu = viewPos(vUv + vec2(0.0, texel.y)) - P;
      vec3 pd = P - viewPos(vUv - vec2(0.0, texel.y));
      vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl;
      vec3 dy = abs(pu.z) < abs(pd.z) ? pu : pd;
      vec3 N = normalize(cross(dx, dy));

      // screen-space radius that shrinks with distance
      float radius = uRadius / max(0.35, -P.z);
      float rot = hash12(gl_FragCoord.xy) * 6.2831853;
      float occ = 0.0;

      const int TAPS = 10;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i) + 0.5;
        float a = rot + fi * 2.39996323;
        float r = sqrt(fi / float(TAPS)) * radius;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

        vec3 S = viewPos(uv);
        vec3 diff = S - P;
        float dist = length(diff);
        if (dist < 1e-4) continue;

        float cosA = dot(N, diff / dist);
        // only count samples that rise above the surface, and fade distant ones
        float range = smoothstep(0.0, 1.0, uRadius / max(dist, 1e-3));
        occ += max(0.0, cosA - uBias) * range;
      }

      occ = clamp(1.0 - (occ / float(TAPS)) * uIntensity * 2.6, 0.0, 1.0);
      occ = pow(occ, 1.35);

      // AO belongs in the ambient term, so keep a floor under the highlights
      float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
      float keep = smoothstep(0.55, 2.2, luma);
      gl_FragColor = vec4(base.rgb * mix(occ, 1.0, keep), base.a);
    }
  `,
};

/* --- final grade -------------------------------------------------------- */

const GradeShader = {
  name: 'DdtGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.030 },
    uAberration: { value: 0.00022 },
    uSharpen: { value: 0.30 },
    uTexel: { value: new Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSharpen;
    uniform vec2 uTexel;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // a whisper of lateral chromatic aberration, only at the very edges
      float ab = uAberration * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      // Unsharp mask. A path-traced-looking render and a photograph differ
      // less in lighting than in micro-contrast: a real lens plus a sensor's
      // demosaic leaves crisp edges on chrome, panel gaps and badges. This is
      // a 4-tap cross, weighted so flat paint is untouched and only genuine
      // edges gain — enough to read as "shot", never as "sharpened".
      if (uSharpen > 0.0) {
        vec3 blur =
            texture2D(tDiffuse, uv + vec2( uTexel.x, 0.0)).rgb
          + texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb
          + texture2D(tDiffuse, uv + vec2(0.0,  uTexel.y)).rgb
          + texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb;
        vec3 detail = col - blur * 0.25;
        // clamp the overshoot so highlights never ring
        detail = clamp(detail, vec3(-0.09), vec3(0.09));
        col += detail * uSharpen;
      }

      // A window, not a film print.
      //
      // Everything below used to be a colour grade: a heavy vignette, a
      // filmic S-curve, split-toned shadows and highlights, lifted
      // saturation. That is how a car commercial is finished, and it is
      // exactly what tells the eye "this was shot and graded". Standing in
      // the studio there is no vignette, no crushed black, no teal shadow
      // and no orange highlight — the eye white-balances the room and sees
      // into the corners. So what is left here is only what a viewer's own
      // vision does: a trace of falloff at the very edge of view, and the
      // gentlest lift of contrast. Nothing is tinted.
      col *= 1.0 - uVignette * 0.11 * pow(clamp(r2 * 1.85, 0.0, 1.0), 1.6);

      col = clamp(col, 0.0, 1.0);
      // a tenth of the old S-curve: shape, not a look
      col = col * col * (3.0 - 2.0 * col) * 0.10 + col * 0.90;

      // neutral. saturation is left where the render put it
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.02);

      // film grain, quieter in the highlights the way real grain behaves
      float g = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += g * uGrain * (1.0 - luma * 0.72);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

/* --- assembly ----------------------------------------------------------- */

export function createPostFX(renderer, scene, camera, quality) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const w = Math.max(2, Math.floor(size.x));
  const h = Math.max(2, Math.floor(size.y));
  const useDof = !!quality.post.dof;
  const useAo = !!quality.post.ao;
  const needsDepth = useDof || useAo;

  // The composer's own ping-pong buffers. No depth needed here: only
  // full-screen passes ever draw into them.
  const composerTarget = new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });

  const composer = new EffectComposer(renderer, composerTarget);
  composer.setPixelRatio(1);   // the targets are already sized in device pixels

  let sceneTarget = null;
  let depthTexture = null;
  let dofPass = null;

  let aoPass = null;

  if (needsDepth) {
    depthTexture = new DepthTexture(w, h, UnsignedIntType);
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;

    sceneTarget = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      depthBuffer: true,
      depthTexture,
      samples: 0,
    });

    composer.addPass(new ScenePass(scene, camera, sceneTarget));

    if (useAo) {
      aoPass = new ShaderPass(AoShader);
      // ShaderPass would otherwise overwrite tDiffuse with the read buffer;
      // the first pass after the scene has to read our own target instead.
      aoPass.textureID = '__unused';
      aoPass.uniforms.__unused = { value: null };
      aoPass.material.uniforms.tDiffuse.value = sceneTarget.texture;
      aoPass.material.uniforms.tDepth.value = depthTexture;
      aoPass.material.uniforms.uResolution.value.set(w, h);
      aoPass.material.uniforms.uNear.value = camera.near;
      aoPass.material.uniforms.uFar.value = camera.far;
      composer.addPass(aoPass);
    }

    if (useDof) {
      dofPass = new ShaderPass(DofShader);
      if (!useAo) {
        dofPass.textureID = '__unused';
        dofPass.uniforms.__unused = { value: null };
        dofPass.material.uniforms.tDiffuse.value = sceneTarget.texture;
      }
      dofPass.material.uniforms.tDepth.value = depthTexture;
      dofPass.material.uniforms.uResolution.value.set(w, h);
      dofPass.material.uniforms.uNear.value = camera.near;
      dofPass.material.uniforms.uFar.value = camera.far;
      dofPass.material.uniforms.uMaxRadius.value = quality.mobile ? 9 : 16;
      composer.addPass(dofPass);
    }
  } else {
    composer.addPass(new RenderPass(scene, camera));
  }

  let bloomPass = null;
  if (quality.post.bloom) {
    // strength down and threshold up: only actual light sources bloom now,
    // the way a bright fixture flares in real vision — not every highlight
    bloomPass = new UnrealBloomPass(new Vector2(w, h), 0.085, 0.55, 0.985);
    composer.addPass(bloomPass);
  }

  composer.addPass(new OutputPass());

  let gradePass = null;
  if (quality.post.grade) {
    gradePass = new ShaderPass(GradeShader);
    // the unsharp mask samples one device pixel out, so it has to know how
    // big a device pixel is — otherwise it softens instead of sharpening
    gradePass.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    composer.addPass(gradePass);
  }

  let smaaPass = null;
  if (quality.post.smaa) {
    smaaPass = new SMAAPass(w, h);
    composer.addPass(smaaPass);
  }

  // whichever pass ends up last must draw to the canvas
  composer.passes.forEach((p, i) => { p.renderToScreen = i === composer.passes.length - 1; });

  /* Strażnik jakości mnoży siłę efektów, zamiast wyłączać przebiegi (powód
     przy setLevel). Zapamiętuję ostatnio zamówione wartości, bo setFocus jest
     wołane co klatkę i inaczej natychmiast skasowałoby zejście poziomu. */
  let lvDof = 1, lvAo = 1;
  let wantBokeh = 0, wantAoRadius = 0.55, wantAoIntensity = 0.9;
  const applyDof = () => {
    if (dofPass) dofPass.material.uniforms.uStrength.value =
      wantBokeh * (quality.mobile ? 0.6 : 1.0) * 0.42 * lvDof;
  };
  const applyAo = () => {
    if (!aoPass) return;
    aoPass.material.uniforms.uRadius.value = wantAoRadius;
    aoPass.material.uniforms.uIntensity.value = wantAoIntensity * lvAo;
  };

  return {
    composer,
    depthTexture,
    hasDof: useDof,

    /** @param {number} focus metres @param {number} bokeh 0..1 */
    setFocus(focus, bokeh) {
      if (!dofPass) return;
      dofPass.material.uniforms.uFocus.value = focus;
      // The storyboard still says where the eye is looking, but standing in
      // the room almost everything is sharp: a human pupil has an enormous
      // depth of field next to a fast lens. Kept as a hint, not an effect.
      wantBokeh = bokeh;
      applyDof();
    },

    setTime(t) {
      if (gradePass) gradePass.material.uniforms.uTime.value = t;
    },

    /**
     * Strażnik jakości: zdejmuje koszt, NIE zdejmując przebiegów.
     *
     * Wyłączenie przebiegu przez `enabled = false` wygląda niewinnie, a jest
     * pułapką: kompozytor pomija wyłączone przebiegi, więc pierwszym po
     * scenie staje się następny w kolejce — a obejście, które podstawia mu
     * teksturę sceny zamiast bufora ping-pong, zostało założone przy budowie
     * tylko temu, który był pierwszy wtedy. Po obniżeniu poziomu kolejny
     * czyta nieodświeżany bufor i obraz zamarza na przypadkowej klatce —
     * dokładnie na słabszych maszynach, dla których ten strażnik powstał.
     * Dlatego przebiegi zostają w łańcuchu, a gaszę ich działanie uniformami:
     * kształt łańcucha jest stały, więc nie ma czego osierocić.
     */
    setLevel(level) {
      lvAo = level >= 2 ? 1 : 0;
      lvDof = level >= 1 ? 1 : 0;
      applyAo();
      applyDof();
      if (smaaPass) smaaPass.enabled = level >= 1;   // ostatni w łańcuchu, bezpieczny
      if (bloomPass) bloomPass.enabled = level >= 1; // po OutputPass, też bezpieczny
    },

    /** Feed the AO pass the current projection so it can unproject depth. */
    setCamera(cam) {
      if (!aoPass) return;
      const e = cam.projectionMatrix.elements;
      aoPass.material.uniforms.uProjParams.value.set(
        1 / e[0], e[8] / e[0], 1 / e[5], e[9] / e[5]
      );
      aoPass.material.uniforms.uNear.value = cam.near;
      aoPass.material.uniforms.uFar.value = cam.far;
    },

    setAo(radius, intensity) {
      wantAoRadius = radius;
      wantAoIntensity = intensity;
      applyAo();
    },

    setGrade(vignette, grain) {
      if (!gradePass) return;
      gradePass.material.uniforms.uVignette.value = vignette;
      gradePass.material.uniforms.uGrain.value = grain;
    },

    setSize(width, height, pixelRatio) {
      const dw = Math.max(2, Math.floor(width * pixelRatio));
      const dh = Math.max(2, Math.floor(height * pixelRatio));
      composer.setSize(dw, dh);
      if (sceneTarget) sceneTarget.setSize(dw, dh);
      if (aoPass) {
        aoPass.material.uniforms.uResolution.value.set(dw, dh);
        aoPass.material.uniforms.tDiffuse.value = sceneTarget.texture;
        aoPass.material.uniforms.tDepth.value = sceneTarget.depthTexture;
      }
      if (dofPass) {
        dofPass.material.uniforms.uResolution.value.set(dw, dh);
        dofPass.material.uniforms.uNear.value = camera.near;
        dofPass.material.uniforms.uFar.value = camera.far;
        if (!aoPass) dofPass.material.uniforms.tDiffuse.value = sceneTarget.texture;
        dofPass.material.uniforms.tDepth.value = sceneTarget.depthTexture;
      }
      if (gradePass) gradePass.material.uniforms.uTexel.value.set(1 / dw, 1 / dh);
      if (bloomPass) bloomPass.setSize(dw, dh);
      if (smaaPass) smaaPass.setSize(dw, dh);
    },

    render(delta) {
      composer.render(delta);
    },

    dispose() {
      composer.dispose();
      composerTarget.dispose();
      if (sceneTarget) sceneTarget.dispose();
    },
  };
}
