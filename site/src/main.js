/**
 * aplikatorzy.pl — main
 *
 * The scroll is the director. Nothing here is random: every frame of the film
 * is a pure function of (scroll progress, arrival clock), which is why
 * scrolling back up replays the whole thing exactly in reverse.
 *
 * There is deliberately no OrbitControls — the visitor cannot spin the car,
 * they can only run the film.
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Clock,
  ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap, Color, MathUtils,
} from 'three';
import { gsap } from '../vendor/gsap/index.js';
import { ScrollTrigger } from '../vendor/gsap/ScrollTrigger.js';

import { evaluate, adaptToAspect, beatOpacity, BEATS, RAIL, clamp } from './cameraTimeline.js';
import { detectQuality, DEBUG, ARRIVAL, CINEMA_LENGTH_VH } from './config.js';
import {
  createSky, createEnvironment, createLights, createGarage,
  createContactShadow, createCabinLight, createFog,
} from './environment.js';
import { makeDust } from './textures.js';
import { loadCar } from './car.js';
import { createPetals, createSmoke } from './particles.js';
import { createPostFX } from './postfx.js';
import { initSite, setLoaderProgress, finishLoader, showFatal } from './site.js';

gsap.registerPlugin(ScrollTrigger);

// `?capture` renders the film on its own, frame by frame, for stills and
// clips: no page chrome, a readable canvas and a hand-driven clock.
const CAPTURE = typeof location !== 'undefined' && /(\?|&)capture/.test(location.search);

const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  scroll: 0,        // smoothed scroll progress 0..1 (the scrub target)
  arrival: 0,       // seconds since the car started rolling; < 0 = not started
  arrived: false,
  canvasOpacity: 1,
  paused: false,
};

const shot = evaluate(0);
const tmpVec = new Vector3();
const tmpFwd = new Vector3();

/** Names the boot stage, so a stall is reportable instead of invisible. */
const mark = (s) => {
  if (typeof window !== 'undefined') window.__rcStage = s;
  if (DEBUG) console.log('[aplikatorzy.pl] etap:', s);
};

boot().catch((err) => {
  console.error(err);
  showFatal(`${err?.message || String(err)} (etap: ${
    typeof window !== 'undefined' ? window.__rcStage : '?'})`);
});

async function boot() {
  const canvas = document.getElementById('stage');
  const quality = detectQuality();

  /* --- renderer ------------------------------------------------------- */
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,            // SMAA handles it inside the composer
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: CAPTURE,
  });

  if (!renderer.capabilities.isWebGL2) {
    throw new Error('Twoja przeglądarka nie obsługuje WebGL 2.');
  }

  mark('renderer');
  // Record the GPU so a driver-level failure is identifiable from one
  // screenshot instead of a guessing game.
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) window.__rcGpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch { /* not available: not important */ }

  // A lost context is the one failure that leaves a silent empty canvas.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (window.__rcNote) {
      window.__rcNote('aplikatorzy.pl — karta graficzna przerwała rysowanie scen'
        + 'y (utrata kontekstu WebGL). GPU: ' + (window.__rcGpu || 'nieznany')
        + '\nOdśwież stronę; jeśli powtórzy się, zmniejszę jakość renderu.');
    }
  }, false);

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setClearColor(new Color(0x0b0c0e), 1);

  /* --- scene ---------------------------------------------------------- */
  const scene = new Scene();
  createFog(scene);
  const sky = createSky(scene);

  const camera = new PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.035, 420);
  camera.position.set(-5.2, 1.2, 6.5);

  mark('srodowisko');
  const envMap = createEnvironment(renderer);
  scene.environment = envMap;

  const lights = createLights(scene, quality);
  // A clearing in a cherry wood instead of a hangar: the ground, the ring of
  // trees, the lanterns and the distance are all built here, and the handle
  // that comes back answers the same three questions the studio did.
  mark('garaz');
  const hall = createGarage(scene, renderer, quality, envMap);

  /* --- the car -------------------------------------------------------- */
  mark('model: pobieranie');
  const car = await loadCar({
    debug: DEBUG,
    onProgress: (p) => setLoaderProgress(p * 0.92),
  });

  mark('model: gotowy');
  setLoaderProgress(0.95);

  // carPivot carries the world yaw (the camera rig rides on it);
  // carBody carries the arrival run-up and the suspension settle.
  const carPivot = new Group();
  const carBody = new Group();
  carPivot.add(carBody);
  carBody.add(car.model);
  // stand it on the studio's own floor rather than on the abstract y = 0
  carPivot.position.y = hall.floorY || 0;
  scene.add(carPivot);

  // the pool of shade travels with the car, otherwise it would sit alone on
  // the asphalt while the Lamborghini is still driving in
  createContactShadow(carBody);
  const cabin = createCabinLight(carBody);

  // the sun aims at the car so the shadow camera stays tight around it
  lights.sun.target.position.set(0, 0.6, 0);
  lights.sun.target.updateMatrixWorld();

  /* --- particles ------------------------------------------------------ */
  // Dust hanging in the light slots. Nothing says "this air has volume"
  // like motes catching a beam.
  const dustTex = makeDust(64);
  const dust = createPetals(quality.dust, {
    radius: 22, height: 9, size: 0.26, seed: 4821, opacity: 0.09,
    texture: dustTex, additive: true, flat: true,
  });
  scene.add(dust.mesh);

  const nearDust = createPetals(quality.nearDust, {
    radius: 4.5, height: 5.0, size: 0.34, seed: 991, opacity: 0.07,
    texture: dustTex, additive: true, flat: true,
  });
  scene.add(nearDust.mesh);

  const smoke = createSmoke(quality.mobile ? 36 : ARRIVAL.smokePuffs, {
    rearAxleZ: -car.size.z / 2 + 0.98,
    trackHalf: 0.86,
    duration: 1.4,
  });
  carPivot.add(smoke.mesh);

  /* --- post ----------------------------------------------------------- */
  let post = null;
  try {
    mark('postprodukcja');
    post = createPostFX(renderer, scene, camera, quality);
  } catch (err) {
    console.warn('[aplikatorzy.pl] post-processing unavailable, rendering direct:', err);
    post = null;
  }

  // Compile every shader now, behind the loader. Otherwise the first time the
  // scroll reaches a new shot (cabin, night, glass) the GPU stops to compile
  // mid-film — a hitch the eye reads as the camera jumping.
  try {
    camera.updateMatrixWorld();
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch { /* warming is an optimisation, never a reason to stop */ }

  setLoaderProgress(1);

  /* --- site chrome ---------------------------------------------------- */
  mark('strona');
  initSite();
  document.documentElement.style.setProperty('--cinema-vh', `${CINEMA_LENGTH_VH}vh`);

  /* --- scroll --------------------------------------------------------- */
  const scrubTarget = { p: 0 };
  gsap.to(scrubTarget, {
    p: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '#cinema',
      start: 'top top',
      end: 'bottom bottom',
      scrub: quality.mobile ? 0.7 : 1.1,
      invalidateOnRefresh: true,
    },
  });

  const veil = document.getElementById('stage-veil');
  ScrollTrigger.create({
    trigger: '#site',
    start: 'top 94%',
    end: 'top 26%',
    onUpdate: (self) => {
      state.canvasOpacity = 1 - self.progress;
      canvas.style.opacity = state.canvasOpacity.toFixed(3);
      if (veil) veil.style.opacity = state.canvasOpacity.toFixed(3);
    },
  });

  /* --- main beam: the one control the visitor gets ---------------------- */
  const beam = { on: false, value: 0 };
  let lastNight = -1;
  let introCut = false;
  const lampEl = document.getElementById('lamp');
  // Lampa należy do filmu 3D – znika, gdy na ekran wjeżdżają sekcje z treścią
  // (inaczej na telefonie zasłania zdjęcia aut w katalogu).
  let contentUp = false;
  const firstSection = document.querySelector('main .section, .section');
  if (firstSection && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      contentUp = e.isIntersecting || e.boundingClientRect.top < 0;
      // pętla renderu może już stać (film schowany), więc chowamy lampę od razu
      if (contentUp && lampEl) lampEl.classList.remove('is-on');
      const wp = document.getElementById('wraps');
      if (contentUp && wp) wp.classList.remove('is-on');
    }, { rootMargin: '0px 0px -35% 0px' }).observe(firstSection);
  }
  const beamBtn = document.getElementById('beam-toggle');
  if (beamBtn) {
    const stateEl = beamBtn.querySelector('.lamp__state');
    const paint = () => {
      beamBtn.setAttribute('aria-pressed', String(beam.on));
      if (stateEl) stateEl.textContent = beam.on ? 'TRYB NOCNY' : 'WYŁĄCZONE';
    };
    beamBtn.addEventListener('click', () => {
      beam.on = !beam.on;
      paint();
      // The swing has to be re-armed on every press, not just added: a class
      // that is already there restarts no animation, so it comes off first and
      // is put back on the next frame. Tapping twice in a second should rock
      // the lamp twice, which is half the pleasure of the thing.
      beamBtn.classList.add('is-used');
      beamBtn.classList.remove('is-swinging');
      requestAnimationFrame(() => beamBtn.classList.add('is-swinging'));
    });
    beamBtn.addEventListener('animationend', (e) => {
      if (e.animationName === 'lamp-swing') beamBtn.classList.remove('is-swinging');
    });
    paint();
  }

  /* --- wrap picker: the one thing worth touching on a wrapping studio's page */
  car.setWrap('factory', true);
  const wrapsEl = document.getElementById('wraps');
  if (wrapsEl) {
    const wrapBtns = [...wrapsEl.querySelectorAll('[data-wrap]')];
    const nameEl = wrapsEl.querySelector('.wraps__name');
    const pick = (id) => {
      car.setWrap(id);
      for (const b of wrapBtns) b.setAttribute('aria-pressed', String(b.dataset.wrap === id));
      if (nameEl && car.wraps[id]) nameEl.textContent = car.wraps[id].label;
    };
    for (const b of wrapBtns) b.addEventListener('click', () => pick(b.dataset.wrap));
    pick('factory');
  }

  /* --- the film rail ---------------------------------------------------- */
  const railEl = document.getElementById('rail');
  const railFill = document.getElementById('rail-fill');
  const railList = document.getElementById('rail-list');
  const railItems = [];
  if (railList) {
    for (const r of RAIL) {
      const li = document.createElement('li');
      li.textContent = r.label;
      railList.appendChild(li);
      railItems.push({ ...r, el: li, on: false });
    }
  }

  /* --- the arrival ---------------------------------------------------- */
  const beats = BEATS.map((b) => ({ ...b, el: document.getElementById(b.id), last: -1 }));

  mark('start filmu');
  finishLoader();

  // the car waits just off frame until the loader has begun to dissolve,
  // then sweeps in — the two motions overlap on purpose
  const ARRIVAL_DELAY = 0.75;

  // If the browser restored a scroll position (a refresh half way down the
  // film), the arrival makes no sense: the camera would already be at shot 6
  // while the car was still 21 m up the road. Start settled instead.
  // Only a genuinely restored position (a refresh well down the film) skips
  // the arrival. A few pixels of browser scroll must not cost the opening.
  // With reduced motion the car is simply there: no arrival run, no smoke, no drifting motes.
  const restored = CAPTURE || window.scrollY > 400 || REDUCED;
  if (CAPTURE) document.body.classList.add('is-capture');
  if (restored) introCut = true;

  if (restored) {
    state.arrival = ARRIVAL.duration + 2;
    state.arrived = true;
    document.body.classList.remove('is-locked');
    ScrollTrigger.refresh();
  } else {
    document.body.classList.add('is-locked');
    window.scrollTo(0, 0);
    state.arrival = -ARRIVAL_DELAY;
    gsap.delayedCall(ARRIVAL_DELAY + ARRIVAL.duration * 0.85, () => {
      state.arrived = true;
      document.body.classList.remove('is-locked');
      ScrollTrigger.refresh();
    });
  }

  // Keep the adaptive tier available to both resize and the render loop.
  let level = quality.post.ao ? 2 : 1;
  let slow = 0;              // consecutive slow windows: one hitch must not cost the picture its sharpness
  let resScale = 1;          // dynamic resolution: 1 = the tier's pixel ratio, stepped down while the film misses 60 fps

  const syncRenderSize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.max(0.6, Math.min(
      quality.pixelRatio, detectQuality().pixelRatio, level === 0 ? 1.25 : Infinity,
    ) * resScale);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    if (post) post.setSize(w, h, ratio);
  };

  /* --- resize / visibility -------------------------------------------- */
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Recompute the viewport budget without undoing an adaptive downgrade.
    syncRenderSize();
    ScrollTrigger.refresh();
  };
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(onResize);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    state.paused = document.hidden;
    if (!document.hidden) clock.getDelta();      // swallow the gap
  });

  /* --- debug ---------------------------------------------------------- */
  const hud = DEBUG ? makeHud() : null;

  /* --- the loop ------------------------------------------------------- */
  const clock = new Clock();
  let elapsed = 0;
  let postFailed = false;

  // Adaptive quality. A frame budget is not a nice-to-have on a 560-mesh
  // model with four full-screen passes: if the machine cannot hold it, shed
  // work rather than let the whole film crawl.
  let frameAcc = 0;
  let frameN = 0;
  // skip the first two windows: loader fade and the arrival are not the
  // steady state, and one compile spike must not cost the film its quality
  let settle = 2;
  if (post) post.setLevel(level);
  window.__rcLevel = level;

  // A frame that throws leaves the canvas black with nothing on screen and
  // nothing in the page to say why. Surfacing the first failure is the
  // difference between "it is broken" and a fault that can be fixed.
  let loopFailed = false;
  const reportFatal = (err) => {
    if (loopFailed) return;
    loopFailed = true;
    /* eslint-disable no-console */
    console.error('[aplikatorzy.pl] render loop failed:', err);
    /* eslint-enable no-console */
    const box = document.getElementById('fatal');
    const msg = document.getElementById('fatal-msg');
    if (msg) {
      msg.textContent = `${String((err && err.message) || err)} · klatka ${
        framesDrawn} · GPU ${window.__rcGpu || 'nieznany'}`;
    }
    if (box) box.hidden = false;
  };

  let framesDrawn = 0;
  renderer.setAnimationLoop(() => {
   try {
    // the first frame on screen is the proof the film actually started
    if (++framesDrawn === 2) {
      window.__rcRunning = true;
      mark('rysuje');
      const n = document.getElementById('boot-note');
      if (n) n.hidden = true;
    }
    const delta = Math.min(0.05, clock.getDelta());
    if (state.paused || window.__ddtManual) return;
    elapsed += delta;

    if (!state.arrived || state.arrival < ARRIVAL.duration + 1.6) state.arrival += delta;

    state.scroll = clamp(scrubTarget.p, 0, 1);

    // If the visitor scrolls while the car is still driving in — and inside a
    // framed page the body lock cannot always stop them — do not leave the
    // camera at shot 6 with the car still 20 m up the road. Cut the arrival
    // short and let them drive the film.
    if (!state.arrived && state.scroll > 0.02) {
      state.arrival = ARRIVAL.duration + 2;
      state.arrived = true;
      introCut = true;
      document.body.classList.remove('is-locked');
    }

    // once the page has scrolled past the film there is nothing to draw
    if (state.canvasOpacity < 0.015) return;

    updateFilm(delta, elapsed);

    // measure, then shed
    frameAcc += delta;
    frameN++;
    if (frameAcc > 0.9) {
      const avg = frameAcc / frameN;
      // the target is 60 fps (16.7 ms). First give up resolution — every pass runs per pixel, so it
      // buys the most — down to 70 %; only then start dropping effects.
      if (avg > 0.0205 && settle <= 0 && resScale > 0.7 && ++slow >= 2) {
        slow = 0;
        resScale = Math.max(0.7, resScale * 0.88);
        syncRenderSize();
        settle = 1;
        console.info(`[aplikatorzy.pl] ${(avg * 1000).toFixed(0)} ms/frame — resolution x${resScale.toFixed(2)}`);
      } else if (avg > 0.0205 && resScale <= 0.7 && level > 0 && settle <= 0) {
        level -= 1;
        settle = 2;
        if (post) post.setLevel(level);
        window.__rcLevel = level;
        if (level === 0) {
          syncRenderSize();
        }
        console.info(`[aplikatorzy.pl] ${(avg * 1000).toFixed(0)} ms/frame — quality level ${level}`);
      }
      if (avg <= 0.0205) slow = 0;
      settle -= 1;
      frameAcc = 0;
      frameN = 0;
    }

    if (post && !postFailed) {
      try {
        post.setTime(elapsed);
        post.render(delta);
      } catch (err) {
        console.warn('[aplikatorzy.pl] post-processing failed, falling back:', err);
        postFailed = true;
      }
    }
    if (!post || postFailed) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
   } catch (err) {
     reportFatal(err);
     renderer.setAnimationLoop(null);
   }
  });

  if (CAPTURE) {
    // Draws exactly one frame of the film at a given scroll position and
    // clock, independent of the display's frame rate.
    window.__ddt = {
      canvas,
      frame({ scroll = 0, t = 0, dt = 1 / 30, night = false, wrap = null, from = null, wave = null } = {}) {
        if (from) car.setWrap(from, true);
        if (wrap) { car.setWrap(wrap, wave == null); if (wave != null) car.updateWrap(wave * 1.5); }
        window.__ddtManual = true;
        scrubTarget.p = scroll;
        state.scroll = clamp(scroll, 0, 1);
        state.arrived = true;
        state.arrival = ARRIVAL.duration + 2;
        beam.on = !!night;
        beam.value = night ? 1 : 0;
        updateFilm(dt, t);
        if (post && !postFailed) { post.setTime(t); post.render(dt); }
        else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
      },
      shots: () => BEATS.map((b) => b.id),
    };
  }

  /* ==================================================================== */

  function updateFilm(delta, time) {
    /* --- the hall powers up --------------------------------------------- */
    // Three slots strike one after another, the exposure comes up from black
    // and only then does the car arrive. That is the first three seconds.
    const intro = introCut || (state.arrived && state.arrival > ARRIVAL.duration)
      ? 1
      : clamp(time / ARRIVAL.ignition, 0, 1);
    if (intro < 1) hall.setIgnition(intro);
    // never fade the whole picture to black on the way in: the floor is at
    // 45% before the fixtures strike, so there is always something on screen
    renderer.toneMappingExposure = 0.86 * (0.45 + 0.55 * Math.pow(intro, 1.6));

    /* --- storyboard ---------------------------------------------------- */
    evaluate(state.scroll, shot);
    adaptToAspect(shot, camera.aspect);

    /* --- arrival ------------------------------------------------------- */
    const a = clamp(state.arrival / ARRIVAL.duration, 0, 1);
    const drive = easeOutExpo(a);
    const travelled = ARRIVAL.approach * drive;

    carBody.position.z = -(ARRIVAL.approach - travelled);
    car.setWheelSpin(travelled);

    // the body dips under braking and settles on the springs
    const brake = Math.sin(Math.PI * Math.min(1, a / 0.86));
    const settle = a > 0.86 ? Math.exp(-(a - 0.86) * 24) * Math.sin((a - 0.86) * 46) : 0;
    // extremely subtle: half a degree of dive, then the springs settle.
    // Any more and a 5 m car visibly lifts a wheel off the asphalt.
    carBody.rotation.x = 0.0085 * brake + 0.0050 * settle;
    carBody.position.y = -0.006 * brake;

    // a hint of steering: on the way in, and again as the camera studies the
    // front wheel — never more than a few degrees
    const wheelShot = bump(shot.story, 0.27, 0.40);
    car.setSteer((1 - a) * -2.6 + wheelShot * 3.4);

    // smoke lives only while the tyres are actually scrubbing
    const smokeFade = 1 - smoothstep((state.arrival - 1.9) / 1.5);
    const noArrival = state.arrival > ARRIVAL.duration + 1.2;
    smoke.update(noArrival ? -1 : state.arrival, noArrival ? 0 : clamp(smokeFade, 0, 1));

    /* --- car in the world ---------------------------------------------- */
    const yaw = MathUtils.degToRad(shot.yaw);
    carPivot.rotation.y = yaw;

    /* --- camera -------------------------------------------------------- */
    // the storyboard is authored in the car's frame, so the rig rides the yaw
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const px = shot.pos[0] * cos + shot.pos[2] * sin;
    const pz = -shot.pos[0] * sin + shot.pos[2] * cos;
    const tx = shot.target[0] * cos + shot.target[2] * sin;
    const tz = -shot.target[0] * sin + shot.target[2] * cos;

    // the opening frame breathes outwards a touch while the car settles
    const breathe = state.arrived ? 1 : 1 + 0.085 * (1 - drive);
    camera.position.set(
      tx + (px - tx) * breathe,
      shot.target[1] + (shot.pos[1] - shot.target[1]) * breathe,
      tz + (pz - tz) * breathe
    );
    // a held camera never sits perfectly still: a few millimetres of slow drift and a
    // fraction of a degree of roll. Off for captures and for reduced motion.
    let sway = 0;
    if (!CAPTURE && !REDUCED) {
      const a = time * 0.63, b = time * 0.41;
      camera.position.x += Math.sin(a) * 0.004 + Math.sin(a * 2.3) * 0.0015;
      camera.position.y += Math.sin(b + 1.2) * 0.0035;
      camera.position.z += Math.cos(b) * 0.003;
      sway = Math.sin(time * 0.37) * 0.14;
    }
    tmpVec.set(tx, shot.target[1], tz);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmpVec);
    if (shot.roll || sway) camera.rotateZ(MathUtils.degToRad((shot.roll || 0) + sway));

    camera.fov = shot.fov;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(shot.shift[0]) > 0.0005 || Math.abs(shot.shift[1]) > 0.0005) {
      camera.setViewOffset(w, h, -shot.shift[0] * w, shot.shift[1] * h, w, h);
    } else if (camera.view && camera.view.enabled) {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();

    /* --- bodywork that moves -------------------------------------------- */
    car.updateWrap(delta);
    car.setDoors(shot.doorL, shot.doorR);
    car.setWing(shot.wing);

    // main beam: on while the car drives in, then the visitor's to command
    const arrivalBeam = clamp(1 - (state.arrival - 1.4) / 1.1, 0, 1) * (state.arrival > -0.3 ? 1 : 0);
    // the lamps come up as the car arrives, then it is the visitor's switch
    const beamTarget = Math.max(beam.on ? 1 : 0, arrivalBeam * 0.55);
    beam.value += (beamTarget - beam.value) * Math.min(1, delta * 7);
    car.setPositionLights(beam.value);

    // the main-beam switch takes the whole hall down to night with it
    const night = beam.on ? beam.value : 0;   // lamps on => hall goes dark
    if (intro >= 1 && Math.abs(night - lastNight) > 0.002) {
      lastNight = night;
      hall.setNight(night, lights, sky, scene);
      document.body.classList.toggle('is-night', night > 0.5);
    }

    /* --- interior: dissolve the glazing, light the cabin ---------------- */
    car.setGlassDissolve(shot.glass);
    // The cabin is already lit through the open glazing; the practicals are
    // there to shape it, not to flood it.
    cabin.light.intensity = shot.cabin * 0.52;
    cabin.glow.intensity = shot.cabin * 0.34;

    /* --- motes in the air ---------------------------------------------- */
    // one deterministic clock: a slow ambient drift plus the scroll itself
    const flow = (REDUCED ? 0 : time * 0.30) + state.scroll * 16;
    dust.update(time, flow, camera.position);
    camera.getWorldDirection(tmpFwd);
    tmpVec.copy(camera.position).addScaledVector(tmpFwd, 2.4);
    nearDust.update(time, flow * 1.2, tmpVec);

    // motes hanging in a beam are a cinematographer's flourish; in a clean
    // studio you simply do not see them. Kept at a tenth, only so the air
    // over the cyclorama is not perfectly, tellingly empty.
    const lit = 0.018 * intro * (1 + beam.value * 0.9);
    dust.material.uniforms.uOpacity.value = lit * (1 - shot.glass * 0.9);
    nearDust.material.uniforms.uOpacity.value = 0.014 * intro * (1 - shot.glass);
    nearDust.mesh.visible = shot.glass < 0.97;

    /* --- depth of field / grade ---------------------------------------- */
    if (post) {
      post.setFocus(shot.focus, shot.bokeh);
      // grain is a film stock and a sensor, not eyesight. What is left is a
      // trace, purely to stop the dark gradients on the cyclorama banding.
      post.setGrade(1.0 + lastNight * 0.30,
        (quality.mobile ? 0.004 : 0.005) + lastNight * 0.004);
      post.setCamera(camera);
      // tighter, stronger occlusion in the close-ups where it reads most
      const close = clamp((3.2 - dist3(shot.pos, shot.target)) / 2.4, 0, 1);
      post.setAo(0.45 + close * 0.35, 0.85 + close * 0.35);
    }

    /* --- the text beats ------------------------------------------------ */
    const story = state.arrived ? shot.story : 0;
    for (const b of beats) {
      if (!b.el) continue;
      let o = beatOpacity(b, story);
      if (!state.arrived) o *= clamp((state.arrival - ARRIVAL.duration * 0.55) / 0.7, 0, 1);
      if (Math.abs(o - b.last) < 0.004) continue;
      b.last = o;
      b.el.style.opacity = o.toFixed(3);
      // No blur filter here: re-blurring large type on top of a canvas that
      // repaints every frame cost more than the whole AO pass. Fade + lift.
      b.el.style.setProperty('--beat-shift', `${((1 - o) * 22).toFixed(1)}px`);
      b.el.style.visibility = o < 0.004 ? 'hidden' : 'visible';
    }

    /* --- the film rail -------------------------------------------------- */
    // The lamp is no longer a beat, so it is no longer on screen for 11 % of
    // the scroll. It hangs for as long as the film does — a control you can
    // only reach during one chapter is not a control.
    const filmUp = state.arrived && state.canvasOpacity > 0.5;
    if (lampEl) lampEl.classList.toggle('is-on', filmUp && !contentUp);
    if (wrapsEl) wrapsEl.classList.toggle('is-on', filmUp && !contentUp);

    if (railEl) {
      railEl.classList.toggle('is-on', filmUp);
      if (railFill) railFill.style.transform = `scaleY(${story.toFixed(4)})`;
      let active = 0;
      for (let i = 0; i < railItems.length; i++) if (story >= railItems[i].t - 0.02) active = i;
      for (let i = 0; i < railItems.length; i++) {
        const on = i === active;
        if (on !== railItems[i].on) {
          railItems[i].on = on;
          railItems[i].el.classList.toggle('is-on', on);
        }
      }
    }

    if (hud) hud.update(state, shot, renderer, delta, beats, intro);
  }
}

/* --- helpers ------------------------------------------------------------ */

const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -9.2 * x));
const smoothstep = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A smooth 0 -> 1 -> 0 bump across [a, b]. */
function bump(x, a, b) {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return Math.sin(Math.PI * t);
}

function makeHud() {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:12px;bottom:12px;z-index:300;font:11px/1.55 ui-monospace,
    SFMono-Regular,Menlo,monospace;color:#c3ccd7;background:rgba(8,9,11,.82);padding:10px 14px;
    border:1px solid rgba(243,240,234,.14);white-space:pre;pointer-events:none;letter-spacing:.02em`;
  document.body.appendChild(el);
  let acc = 0, frames = 0, fps = 0;
  return {
    update(st, s, renderer, delta, beats, intro) {
      acc += delta; frames++;
      if (acc > 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
      const info = renderer.info.render;
      el.textContent =
        `scroll   ${st.scroll.toFixed(3)}\n` +
        `story    ${s.story.toFixed(3)}\n` +
        `shot     ${s.name}\n` +
        `fov      ${s.fov.toFixed(1)}   roll ${s.roll.toFixed(1)}\n` +
        `yaw      ${s.yaw.toFixed(1)}\n` +
        `focus    ${s.focus.toFixed(2)} m   bokeh ${s.bokeh.toFixed(2)}\n` +
        `glass    ${s.glass.toFixed(2)}   cabin ${s.cabin.toFixed(2)}\n` +
        `local    ${s.pos.map((v) => v.toFixed(2)).join(', ')}\n` +
        `fps      ${fps}\n` +
        `calls    ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k\n` +
        `arrived  ${st.arrived}  t=${st.arrival.toFixed(2)}  intro=${(intro || 0).toFixed(2)}\n` +
        `canvasOp ${st.canvasOpacity.toFixed(2)}   lvl ${window.__rcLevel}\n` +
        (beats
          ? `beats    ${beats.length} / el ${beats.filter((b) => b.el).length} / ` +
            `hero ${(beats[0] && beats[0].last != null ? beats[0].last : -1).toFixed(2)}`
          : 'beats    -');
    },
  };
}
