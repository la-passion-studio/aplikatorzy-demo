/**
 * aplikatorzy.pl — the hall
 *
 * A Revuelto does not belong under cherry trees. It belongs in a dark
 * architectural volume: board-formed concrete, a polished floor, and three
 * long slots of light overhead. Those slots are the whole trick — a long,
 * soft, linear source is exactly what a photographer rigs above a car,
 * because it draws the shoulder line from nose to tail in one unbroken
 * streak. Everything else in here is there to be reflected.
 *
 * The same volume does day and night: `setNight(k)` drops the ambient, pushes
 * the slots and the perimeter band, and hands the scene over to the car's own
 * headlights. The main-beam button drives it.
 */

import {
  Group, Mesh, Box3, MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial,
  SphereGeometry, CircleGeometry, PlaneGeometry, BoxGeometry, CylinderGeometry,
  RingGeometry, TorusGeometry,
  BackSide, DoubleSide, AdditiveBlending, Vector2, Vector3, Color, Scene,
  DirectionalLight, HemisphereLight, PointLight, SpotLight, RectAreaLight, TextureLoader,
  Matrix4, PMREMGenerator, FogExp2, RepeatWrapping, MathUtils, SRGBColorSpace,
  InstancedMesh, Euler, Quaternion, MeshPhysicalMaterial, FrontSide, LatheGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  makeConcrete, makeAsphalt, makeContactShadow, makeRadialAlpha, mulberry32, makeSign,
} from './textures.js';

/** Key light direction — high and a little forward, like a studio boom. */
export const SUN_DIR = new Vector3(-0.38, 0.72, 0.58).normalize();

export const FOG_COLOR = new Color(0x1b1b1b);   // było 0x1d1a1c — ten sam Y, bez fioletu
const FOG_NIGHT = new Color(0x090a0c);   // było 0x0b0509

/* Hall dimensions (metres) */
const HALL = {
  radius: 46,
  height: 8.6,
  slotY: 8.15,
  slotLength: 78,
  slotWidth: 0.62,
  slotX: [-6.2, 0, 6.2],
  bandY: 2.4,
};

/* --- the volume beyond the hall ---------------------------------------- */

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uTop, uBottom, uGlow;
  uniform float uNight;

  void main() {
    vec3 d = normalize(vDir);
    float h = smoothstep(-0.35, 0.55, d.y);
    vec3 col = mix(uBottom, uTop, h);
    // a cold wash of city light spilling in at the horizon
    col += uGlow * exp(-abs(d.y) * 7.0) * (0.35 + uNight * 0.85);
    col *= mix(1.0, 0.45, uNight);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(scene) {
  const material = new ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      // cold graphite overhead, a steel-blue wash at the horizon
      uTop: { value: new Color(0x14171c) },
      uBottom: { value: new Color(0x2b323b) },
      uGlow: { value: new Color(0x6e819a) },
      uNight: { value: 0 },
    },
  });
  const sky = new Mesh(new SphereGeometry(300, 32, 20), material);
  sky.name = 'volume';
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

/* --- PMREM: what the paint actually reflects ---------------------------- */

export function createEnvironment(renderer) {
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const env = new Scene();

  // the dark shell
  const shell = new Mesh(
    new SphereGeometry(40, 24, 16),
    new MeshBasicMaterial({ side: BackSide, toneMapped: false })
  );
  shell.material.color.setRGB(0.020, 0.021, 0.024);
  env.add(shell);

  // The key source the bodywork reflects.
  //
  // Its position and size are deliberately untouched — they are what draws the
  // highlight the car already has, and that was not the complaint. Only the
  // colour changed, and it changed at constant Rec.709 luminance: (17.0, 9.2,
  // 7.4) carried Y = 10.73 with R−B = +9.6, so the neutral source of the same
  // luminance is a flat 10.73. That is the whole correction — the frame keeps
  // its brightness and loses the amber.
  //
  // This mattered more here than anywhere else. Matte paint has almost no
  // colour of its own: at 0.3 % albedo it is a mirror that has been sanded, so
  // what you see is the room, not the pigment. A source at R/B = 2.3 does not
  // make a black car look warmly lit — it makes it brown.
  {
    const sun = new Mesh(
      new PlaneGeometry(3.4, 1.5),
      new MeshBasicMaterial({ side: DoubleSide, toneMapped: false })
    );
    sun.material.color.setRGB(10.728, 10.728, 10.728);
    sun.position.set(-8.2, 2.1, 5.4);
    sun.lookAt(0, 1, 0);
    env.add(sun);
  }

  // soft wall bounce, warm on one side and cool on the other
  const panel = (x, y, z, w, h, r, g, b) => {
    const m = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ side: DoubleSide, toneMapped: false })
    );
    m.material.color.setRGB(r, g, b);
    m.position.set(x, y, z);
    m.lookAt(0, 2, 0);
    env.add(m);
  };
  // a full-height glazed frontage on one side is what actually lights a
  // showroom, and what puts the long gradient down the flank of the car
  // matched to the cyclorama's real albedo: reflect the wall that is
  // actually there, not the white one it used to be
  panel(0, 3.4, -8.9, 22, 6.5, 0.012, 0.015, 0.021);
  panel(-13.8, 3.0, 0, 22, 6.0, 0.045, 0.048, 0.055);
  panel(13.8, 3.0, 0, 22, 6.0, 0.045, 0.048, 0.055);
  panel(0, 3.0, 13.0, 26, 6.0, 0.05, 0.053, 0.06);
  // The broad source overhead, which is what draws the long highlight down the
  // middle of the bodywork. It used to be a blossom canopy, and it was still
  // pink — (1.30, 0.86, 0.95) — long after the blossom went. Neutralised at its
  // own luminance, Y = 0.96.
  {
    const soft = new Mesh(
      new PlaneGeometry(26, 26),
      new MeshBasicMaterial({ side: DoubleSide, toneMapped: false })
    );
    soft.material.color.setRGB(0.960, 0.960, 0.960);
    soft.position.set(0, 7.4, -1.0);
    soft.rotation.x = Math.PI / 2;
    env.add(soft);
  }

  // the bright ceiling itself
  const lid = new Mesh(new CircleGeometry(34, 36), new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }));
  lid.material.color.setRGB(0.071, 0.071, 0.071);   // was (0.10, 0.062, 0.074)
  lid.rotation.x = Math.PI / 2;
  lid.position.y = 9.2;
  env.add(lid);

  // the floor bounce — dark, but not nothing
  const floor = new Mesh(
    new CircleGeometry(38, 40),
    new MeshBasicMaterial({ side: DoubleSide, toneMapped: false })
  );
  floor.material.color.setRGB(0.012, 0.015, 0.021);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.5;
  env.add(floor);

  const target = pmrem.fromScene(env, 0.015, 0.1, 120);
  env.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  pmrem.dispose();
  return target.texture;
}

/* --- lights ------------------------------------------------------------- */

export function createLights(scene, quality) {
  const group = new Group();
  group.name = 'lights';

  const key = new DirectionalLight(0xfdfdff, 1.70);
  key.position.copy(SUN_DIR).multiplyScalar(22);
  key.castShadow = true;
  const s = quality.shadowMapSize;
  key.shadow.mapSize.set(s, s);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 46;
  // Wrapped as tightly as the car allows. At +/-7 a 2048 map spends 6.8 mm
  // on a texel, which is wider than a panel gap; at +/-5 it is 4.9 mm, and
  // that is the difference between a soft grey pool under the car and a
  // shadow with the shape of the sills and the diffuser in it.
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = quality.shadowRadius;
  group.add(key, key.target);

  const rim = new DirectionalLight(0xdae4f0, 1.60);
  rim.position.set(7.5, 4.2, -9.5);
  group.add(rim);

  const fill = new DirectionalLight(0xe8ecf2, 0.14);
  fill.position.set(-8.5, 2.6, 7.5);
  group.add(fill);

  const hemi = new HemisphereLight(0xa9b6c6, 0x0a0b0d, 0.16);
  group.add(hemi);

  scene.add(group);
  return { group, sun: key, key, rim, fill, hemi };
}

export function createCabinLight(parent) {
  // The practical used to be 0xffd0a0 — a strong amber, the colour of a
  // domestic reading lamp. Inside a cabin trimmed entirely in black suede
  // and black leather that is the only light there is, so every surface
  // came back brown: the headliner, the wheel rim, the carbon. A Revuelto's
  // cabin lighting is a cool white LED strip, and black stays black under
  // it. Neutral, and dimmer, so the trim reads by its own specular rather
  // than by being washed in colour.
  const light = new PointLight(0xdfe6f0, 0, 3.4, 2);
  light.position.set(0.05, 0.86, 0.30);
  parent.add(light);
  // the blue wash off the screens, which is a real thing in that cabin
  const glow = new PointLight(0x8fb4ff, 0, 1.9, 2);
  glow.position.set(0.36, 0.62, 0.52);
  parent.add(glow);
  return { light, glow };
}

/* --- floor -------------------------------------------------------------- */

export function createGround(scene, envMap, quality) {
  const { map, roughnessMap, normalMap } = makeAsphalt(quality.asphaltSize);
  for (const t of [map, roughnessMap, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(110, 110);
    t.anisotropy = 16;
  }

  const material = new MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    // damp asphalt: rough enough to read as road, sealed enough to hold a
    // soft reflection of the softboxes under the car
    color: 0x9fa2a8,
    roughness: 0.82,
    metalness: 0.0,
    envMap,
    envMapIntensity: 0.65,
    normalScale: new Vector2(1.15, 1.15),
    dithering: true,
  });

  const ground = new Mesh(new CircleGeometry(300, 96), material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'floor';
  scene.add(ground);

  return { ground, material };
}

/** The pool of shade that welds the car to the floor. */
export function createContactShadow(parent) {
  const mat = new MeshBasicMaterial({
    map: makeContactShadow(512),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    color: 0x000000,
  });
  const mesh = new Mesh(new PlaneGeometry(3.6, 7.4), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 2;
  mesh.name = 'contact-shadow';
  parent.add(mesh);
  return mesh;
}

/* --- the hall ----------------------------------------------------------- */

/**
 * The studio.
 *
 * Built by hand rather than invented here: a 28 x 23 m hangar with a real
 * cyclorama sweeping into the back wall, roof trusses, ducting, sprinklers,
 * a suspended diffusion panel, two softboxes on stands, fresnels, floor
 * lamps, director's chairs, a cart, a ladder and cables taped to the floor.
 * Every one of its 293 parts is named, which is what makes it possible to
 * light it properly instead of guessing.
 *
 * The model carries emissive fixtures but no lights, so the fixtures are
 * matched here one for one: an area light inside each softbox, a long one
 * under the diffusion panel, and a spot in each fresnel, all aimed at the
 * car. That correspondence is what stops it reading as a photograph of a
 * room with a car pasted in.
 */
export async function createStudio(scene, renderer, url, quality) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const studio = gltf.scene;
  studio.name = 'studio';

  // Scale and placement are set by two things the camera does: it never goes
  // further back than z = -5.35, so the cyclorama wall has to sit at -9 to
  // stay out of shot; and the car has to read BIG against that wall, which
  // means shrinking the building rather than moving it. At 0.68 the wall is
  // 4.4 m instead of 6.5 m tall and the hall is 19 m wide.
  const S = 0.68;
  const SHIFT = -1.55;
  studio.scale.setScalar(S);
  studio.position.z = SHIFT;
  const at = (x, y, z) => [x * S, y * S, z * S + SHIFT];

  const fixtures = new Set();
  studio.traverse((o) => {
    if (!o.isMesh) return;
    // Keep the architecture; clear production equipment from the showroom.
    if (/ventilation duct|duct hoop|sprinkler|suspended ceiling rail|rail suspension|truss|director chair|equipment cart|cart caster|ladder|floor cable|front low lamp|left floor lamp/.test(o.name.replace(/_/g, ' '))) {
      o.visible = false;
    }
    o.castShadow = false;
    o.receiveShadow = true;
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m) continue;
      m.envMapIntensity = 0.25;
      if (m.name.replace(/_/g, ' ') === 'brushed aluminum') {
        m.color.setRGB(0.12, 0.14, 0.17);
        m.roughness = 0.48;
      }
      if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) {
        m.userData.baseEmissive = m.emissiveIntensity ?? 1;
        fixtures.add(m);
      }
      // The cyclorama is authored at 93% white, and it is the single biggest
      // surface in shot — the whole back wall and the floor sweep. At that
      // albedo it fills the frame with white and flattens the car against
      // it. Brought down to a deep neutral grey: still obviously a lit cyc
      // with a gradient across it, but now the Lamborghini is the brightest
      // thing in the room instead of the wall behind it.
      if (/cyclorama|concrete.floor/.test(m.name || '')) {
        m.color.setRGB(0.012, 0.015, 0.021);
        m.roughness = 0.62;
        m.envMapIntensity = 0.15;
        m.needsUpdate = true;
      }
    }
  });
  scene.add(studio);
  studio.updateMatrixWorld(true);

  // Where the car actually has to stand. The stage is a real building with a
  // floor of its own, so "y = 0" is not the ground — the cyclorama floor is,
  // and it is a couple of centimetres proud of the slab around it.
  let floorY = 0;
  const floorMesh = studio.getObjectByName('cyclorama_floor') || studio.getObjectByName('cyclorama floor') || studio.getObjectByName('floor_slab') || studio.getObjectByName('floor slab');
  if (floorMesh) floorY = new Box3().setFromObject(floorMesh).max.y;

  /* --- the backdrop on the cyclorama ----------------------------------- */
  // A large-format print hung on the cyc, the way a stand is actually
  // dressed for a shoot: cherry blossom on the branch above, and a calm
  // warm band along the bottom where the car stands, so the bodywork is
  // never read against busy detail. It is lit rather than glowing — a low
  // emissive keeps it visible while the hall's own lights are aimed at the
  // car, and it dims with everything else when the lamps go out.
  const backdropMap = new TextureLoader().load('media/sakura-backdrop.jpg');
  backdropMap.colorSpace = SRGBColorSpace;
  backdropMap.anisotropy = 8;
  const backdropMat = new MeshStandardMaterial({
    map: backdropMap,
    emissive: new Color(0xffffff),
    emissiveMap: backdropMap,
    emissiveIntensity: 0.62,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.10,
  });
  backdropMat.userData.baseEmissive = 0.62;
  const backdrop = new Mesh(new PlaneGeometry(20.0, 6.2), backdropMat);
  // 4 cm proud of the cyc, and the wordmark sits 5 cm in front of it again
  backdrop.position.set(0, 3.10, -10.95 + 0.04);
  backdrop.name = 'backdrop';
  studio.add(backdrop);

  /* --- the name on the back wall --------------------------------------- */
  const wordmark = new Mesh(
    new PlaneGeometry(8.0, 8.0 * (266 / 745)),
    new MeshBasicMaterial({
      // dark lettering again: it now sits on the blossom, not on a black wall
      map: new TextureLoader().load('media/wordmark-dark.png'),
      transparent: true, opacity: 0.88, depthWrite: false,
    })
  );
  // 5 cm proud of the backdrop so it never z-fights with the print
  wordmark.position.set(0, 3.30, -10.95 + 0.09);
  wordmark.name = 'wordmark';
  studio.add(wordmark);

  /* --- lights, one per fixture ----------------------------------------- */
  const areas = [];
  if (quality.areaLights) {
    RectAreaLightUniformsLib.init();

    const box = (x, y, z, w, h, intensity) => {
      const a = new RectAreaLight(0xfffaf4, intensity, w, h);
      a.position.set(x, y, z);
      a.lookAt(0, 0.8, 0);
      scene.add(a);
      areas.push(a);
      return a;
    };
    // the two softboxes on their stands
    box(...at(-8.98, 2.66, 1.90), 1.06 * S, 1.12 * S, 13);
    box(...at(8.98, 2.76, -0.90), 1.06 * S, 1.12 * S, 13);

    // the big suspended diffusion panel: the soft top light that draws the
    // long highlight down the middle of the bodywork
    const top = new RectAreaLight(0xffffff, 2.1, 19.5 * S, 2.7 * S);
    top.position.set(...at(0, 6.88, -6.10));
    top.rotation.x = -Math.PI / 2;
    scene.add(top);
    areas.push(top);
  }

  const spots = [];
  for (const [x, y, z] of [[-10.62, 2.50, -5.38], [10.62, 2.70, -4.88], [11.62, 3.30, 5.32]]) {
    const sp = new SpotLight(0xfff6ec, 17, 30, 0.42, 0.55, 1.6);
    sp.position.set(...at(x, y, z));
    sp.target.position.set(0, 0.6, 0);
    sp.castShadow = false;
    scene.add(sp);
    scene.add(sp.target);
    spots.push(sp);
  }

  const baseKey = 1.70, baseRim = 1.60, baseFill = 0.14, baseHemi = 0.12;
  const baseArea = areas.map((a) => a.intensity);
  const baseSpot = spots.map((sp) => sp.intensity);

  return {
    group: studio,
    floorY,
    wordmark,
    areas,
    spots,

    /** The studio comes up to power during the opening. `k` 0..1 */
    setIgnition(k) {
      const v = MathUtils.clamp(k, 0, 1);
      let i = 0;
      for (const m of fixtures) {
        const start = (i++ % 3) * 0.12;
        let f = MathUtils.clamp((v - start) / 0.34, 0, 1);
        if (f > 0 && f < 1) f *= 0.55 + 0.45 * Math.sin(f * 31.0) * Math.sin(f * 9.0);
        m.emissiveIntensity = (m.userData.baseEmissive || 1) * Math.max(0, f);
      }
      backdropMat.emissiveIntensity = backdropMat.userData.baseEmissive * v;
      areas.forEach((a, n) => { a.intensity = baseArea[n] * v; });
      spots.forEach((sp, n) => { sp.intensity = baseSpot[n] * v; });
    },

    /** 0 = the studio lit, 1 = lights down and only the car's own lamps. */
    setNight(k, lights, sky, scene2) {
      const n = MathUtils.clamp(k, 0, 1);
      lights.key.intensity = baseKey * (1 - n * 0.92);
      lights.rim.intensity = baseRim * (1 - n * 0.55) + n * 0.35;
      lights.fill.intensity = baseFill * (1 - n * 0.92);
      lights.hemi.intensity = baseHemi * (1 - n * 0.85);

      for (const m of fixtures) m.emissiveIntensity = (m.userData.baseEmissive || 1) * (1 - n * 0.82);
      backdropMat.emissiveIntensity = backdropMat.userData.baseEmissive * (1 - n * 0.70);
      areas.forEach((a, i) => { a.intensity = baseArea[i] * (1 - n * 0.88); });
      spots.forEach((sp, i) => { sp.intensity = baseSpot[i] * (1 - n * 0.9); });
      wordmark.material.opacity = 0.72 * (1 - n * 0.35);

      if (sky) sky.material.uniforms.uNight.value = n;
      if (scene2 && scene2.fog) {
        scene2.fog.color.copy(FOG_COLOR).lerp(FOG_NIGHT, n);
        scene2.fog.density = 0.0034 + n * 0.0060;
      }
    },
  };
}

/* --- the working floor -------------------------------------------------- */

/**
 * What a shooting floor actually looks like.
 *
 * The hangar model brings the building — trusses, ducting, softboxes,
 * fresnels, the cart and the ladder — but its cyclorama floor is a clean
 * white sweep. Seen from the side that is fine; seen from directly above,
 * which the plan shot now does, an unmarked white field is the one thing
 * that gives away a render. So the floor gets what a real stage has: the
 * seam of the turntable, gaffer marks where the wheels stand, the scuffed
 * halo a car leaves on a cyc, and the crew's kit pushed just out of frame.
 *
 * Everything here only receives shadow. Nothing casts, so the shadow camera
 * stays wrapped tightly around the car where the detail matters.
 */
export function createStudioDetail(scene, floorY, envMap) {
  const group = new Group();
  group.name = 'studio-detail';
  group.position.y = floorY;
  scene.add(group);

  // The imported cyclorama ends through the middle of the car. Continue
  // its raised surface across the full turntable so all four tyres meet it.
  const deck = new Mesh(new CircleGeometry(4.6, 128), new MeshStandardMaterial({
    color: new Color().setRGB(0.012, 0.015, 0.021),
    roughness: 0.62, metalness: 0, envMap, envMapIntensity: 0.15,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  deck.name = 'continuous-turntable-floor';
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  group.add(deck);

  const flat = (geo, color, opacity, y) => {
    const mesh = new Mesh(geo, new MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, toneMapped: false,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = 1;
    group.add(mesh);
    return mesh;
  };

  // the halo a car wears into a cyclorama: tyre dust, boot marks, the lot
  const scuff = flat(new CircleGeometry(4.6, 64), 0x0c0e11, 0.22, 0.0016);
  scuff.material.alphaMap = makeRadialAlpha(256, 0.15);
  scuff.material.needsUpdate = true;

  // the turntable seam, and the hairline ring inside it
  flat(new RingGeometry(3.26, 3.40, 96), 0x8d95a2, 0.22, 0.0030);
  flat(new RingGeometry(3.44, 3.46, 96), 0x8d95a2, 0.12, 0.0030);
  flat(new RingGeometry(1.03, 1.055, 64), 0x8d95a2, 0.14, 0.0030);

  // Gaffer marks: a T at each wheel contact patch, laid to the real track
  // and wheelbase. These go in their own group because the car turns on the
  // spot through the film — it is standing on the turntable, and the marks
  // are stuck to the turntable, so they have to turn with it. Left in world
  // space they would drift out from under the tyres the moment the car
  // rotated, which is worse than having no marks at all.
  const marks = new Group();
  marks.name = 'stage-marks';
  for (const [x, z] of [[-0.88, 1.36], [0.88, 1.36], [-0.90, -1.32], [0.90, -1.32]]) {
    const t = new Group();
    t.position.set(x, 0.0034, z);
    const bar = (w, d, ox, oz) => {
      const m = new Mesh(
        new PlaneGeometry(w, d),
        // pale gaffer tape: on a dark floor black marks are invisible, and
        // a crew tapes marks in white anyway
        new MeshBasicMaterial({ color: 0xc6cbd3, transparent: true, opacity: 0.30,
          depthWrite: false, toneMapped: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(ox, 0, oz);
      m.renderOrder = 1;
      t.add(m);
    };
    bar(0.44, 0.045, 0, 0);                       // the cross of the T
    bar(0.045, 0.26, 0, z > 0 ? 0.15 : -0.15);    // the stem, pointing out
    marks.add(t);
  }

  // a gold hairline arc on the stage edge — the one piece of the brand that
  // belongs on the floor rather than the wall
  flat(new RingGeometry(5.30, 5.325, 128, 1, Math.PI * 0.08, Math.PI * 0.30),
    0xc6a664, 0.42, 0.0030);

  // Recessed champagne light strips frame the back wall without blocking
  // the camera rail. One shared material, no additional shadow maps.
  const trim = new MeshStandardMaterial({
    color: 0xbda77c, emissive: 0xd7bc88, emissiveIntensity: 1.15,
    roughness: 0.4, metalness: 0.65,
  });
  for (const x of [-5.8, -4.9, 4.9, 5.8]) {
    const strip = new Mesh(new BoxGeometry(0.028, 3.35, 0.025), trim);
    strip.position.set(x, 1.9, -8.88);
    group.add(strip);
  }
  // A fine perimeter inlay anchors the car; it is flush with the floor.
  flat(new RingGeometry(3.38, 3.395, 128), 0xc6a664, 0.48, 0.004);
  marks.visible = false;

  // `marks` is handed back unparented: main.js hangs it on the car's yaw
  // pivot so it turns with the car, while everything else stays with the room
  return { group, marks };
}


/* --- the grove ---------------------------------------------------------- */

/**
 * A clearing in a cherry wood, at dusk.
 *
 * Built rather than modelled, because a forest is mostly repetition and
 * repetition is cheap: one merged geometry carries every trunk and branch in
 * the near ring, one instanced quad carries every blossom cluster, and the
 * distance is a single seamless panorama on a cylinder. Three draw calls for
 * the whole wood.
 *
 * The clearing is kept clear on purpose. The storyboard swings the camera out
 * to seven metres and climbs to six and a half for the plan shot, so nothing
 * solid stands inside a radius of ten — the trees ring the car, they never
 * cross in front of it.
 *
 * Returns the same handle the hangar did: the film only ever asks for the
 * floor height, the power-up and the night fade.
 */
export function createSakuraGrove(scene, renderer, quality, envMap) {
  const grove = new Group();
  grove.name = 'grove';
  scene.add(grove);

  const loader = new TextureLoader();
  const rnd = mulberry32(90210);
  const rf = (a, b) => a + (b - a) * rnd();

  /* --- the wood in the distance --------------------------------------- */
  const far = loader.load('media/grove.jpg');
  far.colorSpace = SRGBColorSpace;
  far.wrapS = RepeatWrapping;
  far.repeat.x = 3;                       // three passes of the panorama round
  far.anisotropy = 8;
  const ring = new Mesh(
    new CylinderGeometry(64, 64, 30, 64, 1, true),
    new MeshBasicMaterial({ map: far, side: BackSide, fog: true, toneMapped: true })
  );
  ring.position.y = 11.2;                 // treeline lands on the horizon
  ring.name = 'treeline';
  grove.add(ring);

  /* --- the near ring: trunks and branches, merged --------------------- */
  const bark = new MeshStandardMaterial({
    color: 0x2a1d24, roughness: 0.93, metalness: 0.0, envMap, envMapIntensity: 0.22,
  });
  const limbs = [];
  const puffs = [];
  const COUNT = quality.mobile ? 9 : 16;

  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + rf(-0.16, 0.16);
    const rad = rf(10.5, 17.0);
    const bx = Math.cos(a) * rad;
    const bz = Math.sin(a) * rad;
    const h = rf(4.6, 7.4);
    const lean = rf(-0.14, 0.14);
    const leanZ = rf(-0.14, 0.14);

    const trunk = new CylinderGeometry(rf(0.10, 0.17), rf(0.22, 0.34), h, 7, 1);
    trunk.translate(0, h / 2, 0);
    const m = new Matrix4().compose(
      new Vector3(bx, 0, bz),
      new Quaternion().setFromEuler(new Euler(leanZ, rf(0, 6.283), lean)),
      new Vector3(1, 1, 1)
    );
    trunk.applyMatrix4(m);
    limbs.push(trunk);

    // limbs reaching out of the top third, and a cluster of blossom on each
    const n = Math.round(rf(3, 6));
    for (let k = 0; k < n; k++) {
      const up = rf(0.55, 0.95) * h;
      const ang = rf(0, 6.283);
      const rise = rf(0.45, 1.15);
      const len = rf(1.1, 2.4);
      const ex = bx + lean * up + Math.cos(ang) * len;
      const ez = bz + leanZ * up + Math.sin(ang) * len;
      const ey = up + rise;
      const sx = bx + lean * up;
      const sz = bz + leanZ * up;
      const dir = new Vector3(ex - sx, ey - up, ez - sz);
      const L = dir.length();
      const limb = new CylinderGeometry(0.035, rf(0.07, 0.12), L, 5, 1);
      limb.translate(0, L / 2, 0);
      limb.applyMatrix4(new Matrix4().compose(
        new Vector3(sx, up, sz),
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()),
        new Vector3(1, 1, 1)
      ));
      limbs.push(limb);

      const per = Math.round(rf(3, 6));
      for (let q = 0; q < per; q++) {
        puffs.push({
          p: new Vector3(ex + rf(-0.7, 0.7), ey + rf(-0.35, 0.75), ez + rf(-0.7, 0.7)),
          s: rf(1.5, 3.4),
          r: new Euler(rf(-0.5, 0.5), rf(0, 6.283), rf(-0.45, 0.45)),
        });
      }
    }
  }

  const trunks = new Mesh(mergeGeometries(limbs, false), bark);
  trunks.castShadow = false;
  trunks.receiveShadow = true;
  trunks.name = 'trunks';
  grove.add(trunks);
  for (const g of limbs) g.dispose();

  /* --- the blossom, one instanced quad for the lot -------------------- */
  const blossomTex = loader.load('media/blossom.png');
  blossomTex.colorSpace = SRGBColorSpace;
  const blossomMat = new MeshStandardMaterial({
    map: blossomTex,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    side: DoubleSide,
    roughness: 0.96,
    metalness: 0.0,
    envMap,
    envMapIntensity: 0.30,
    emissive: new Color(0x3a1420),
    emissiveIntensity: 0.55,
  });
  blossomMat.userData.baseEmissive = 0.55;
  const canopy = new InstancedMesh(new PlaneGeometry(1, 1), blossomMat, puffs.length);
  const tmp = new Matrix4();
  puffs.forEach((q, i) => {
    tmp.compose(q.p, new Quaternion().setFromEuler(q.r), new Vector3(q.s, q.s, q.s));
    canopy.setMatrixAt(i, tmp);
  });
  canopy.instanceMatrix.needsUpdate = true;
  canopy.frustumCulled = false;
  canopy.renderOrder = 1;
  canopy.name = 'canopy';
  grove.add(canopy);

  /* --- paper lanterns: the clearing's own light ----------------------- */
  const fixtures = new Set();
  const lamps = [];
  const paper = new MeshStandardMaterial({
    color: 0xffe2c0, roughness: 0.85, metalness: 0.0,
    emissive: new Color(0xffb870), emissiveIntensity: 1.0, toneMapped: false,
  });
  paper.userData.baseEmissive = 1.0;
  fixtures.add(paper);

  const LANTERNS = quality.mobile ? 5 : 9;
  for (let i = 0; i < LANTERNS; i++) {
    const a = (i / LANTERNS) * Math.PI * 2 + 0.31;
    const rad = rf(8.4, 12.5);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const y = rf(1.5, 3.1);
    const body = new Mesh(new SphereGeometry(rf(0.16, 0.25), 12, 9), paper);
    body.position.set(x, y, z);
    body.scale.y = 1.25;
    grove.add(body);
    const cord = new Mesh(new CylinderGeometry(0.006, 0.006, y, 4), bark);
    cord.position.set(x, y * 1.5, z);
    grove.add(cord);
    const light = new PointLight(0xffb066, 0, 13, 2);
    light.position.set(x, y, z);
    grove.add(light);
    lamps.push({ light, peak: rf(1.4, 2.3) });
  }

  const baseKey = 1.70, baseRim = 1.60, baseFill = 0.14, baseHemi = 0.12;

  return {
    group: grove,
    floorY: 0,
    wordmark: null,
    areas: [],
    spots: [],

    /** dusk settles in and the lanterns come up. `k` 0..1 */
    setIgnition(k) {
      const v = MathUtils.clamp(k, 0, 1);
      let i = 0;
      for (const m of fixtures) {
        const start = (i++ % 3) * 0.10;
        const f = MathUtils.clamp((v - start) / 0.40, 0, 1);
        m.emissiveIntensity = (m.userData.baseEmissive || 1) * f;
      }
      lamps.forEach((l) => { l.light.intensity = l.peak * v; });
      blossomMat.emissiveIntensity = blossomMat.userData.baseEmissive * v;
    },

    /** 0 = the clearing lit, 1 = night, and only the lanterns and the car. */
    setNight(k, lights, sky, scene2) {
      const n = MathUtils.clamp(k, 0, 1);
      lights.key.intensity = baseKey * (1 - n * 0.93);
      lights.rim.intensity = baseRim * (1 - n * 0.60) + n * 0.28;
      lights.fill.intensity = baseFill * (1 - n * 0.90);
      lights.hemi.intensity = baseHemi * (1 - n * 0.80);

      // the lanterns are the one thing that gains when the sun goes
      for (const m of fixtures) m.emissiveIntensity = (m.userData.baseEmissive || 1) * (1 + n * 0.55);
      lamps.forEach((l) => { l.light.intensity = l.peak * (1 + n * 0.75); });
      blossomMat.emissiveIntensity = blossomMat.userData.baseEmissive * (1 - n * 0.35);
      ring.material.color.setScalar(1 - n * 0.55);

      if (sky) sky.material.uniforms.uNight.value = n;
      if (scene2 && scene2.fog) {
        scene2.fog.color.copy(FOG_COLOR).lerp(FOG_NIGHT, n);
        scene2.fog.density = 0.0060 + n * 0.0085;
      }
    },
  };
}


/* --- aplikatorzy.pl GARAGE -------------------------------------------------- */

/**
 * A private collection garage, built round.
 *
 * The first version of this room was rectangular, and it was wrong for a
 * reason worth writing down. The camera in this film sits low — a metre off
 * the floor — and looks very slightly downwards at the car. Trace that ray
 * past the bodywork and it meets the FLOOR about nine metres behind the car,
 * long before it reaches a wall twelve metres away. In eighteen of the
 * twenty-five shots there was therefore nothing behind the subject but
 * polished stone running off into the dark. The room had walls; the picture
 * never saw them.
 *
 * That is the exact problem a cyclorama solves, and it solves it by curving:
 * floor and wall are one continuous surface, so from any low angle something
 * is always rising behind the subject. So this room is a rotunda — stone
 * floor out to 8.4 m, a cove sweeping up over the next three, then a wall
 * standing to 7.2 m, which also puts the plan shot back inside the room
 * instead of above its ceiling.
 *
 * Everything else is unchanged in spirit: one stone, one wood, one metal,
 * and light from lines rather than from fittings.
 */
export function createGarage(scene, renderer, quality, envMap) {
  const room = new Group();
  room.name = 'garage';
  scene.add(room);

  const loader = new TextureLoader();
  // Measured, not chosen by eye. Trace each shot's ray past the car: with a
  // flat floor out to 8.4 m the wide shots still met stone six to seven
  // metres beyond the subject, because the camera is low and barely tilted.
  // The sweep has to start closer than that — at 5.8 m it is three metres
  // behind the tail, which is exactly where a photographer puts a cyc.
  const R_FLAT = 5.8;      // flat floor out to here
  const R_WALL = 11.0;     // the wall stands at this radius
  const COVE_H = 3.6;      // the sweep rises over this
  const TALL = 7.2;        // above the plan shot's 6.45

  const tex = (url, rx, ry, srgb = true) => {
    const t = loader.load(url);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return t;
  };

  /* --- the floor ------------------------------------------------------- */
  const floor = new Mesh(
    new CircleGeometry(R_FLAT + 0.15, 96),
    new MeshStandardMaterial({
      map: tex('media/g-floor.jpg', 4, 4),
      roughnessMap: tex('media/g-floor-r.jpg', 4, 4, false),
      roughness: 1.0, metalness: 0.12, envMap, envMapIntensity: 1.05, dithering: true,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  room.add(floor);

  /* --- the cove and the wall, as one lathed surface -------------------- */
  const profile = [];
  profile.push(new Vector2(R_FLAT, 0));
  const STEPS = 14;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;                       // quarter ellipse, floor -> wall
    profile.push(new Vector2(
      R_FLAT + (R_WALL - R_FLAT) * Math.sin(t * Math.PI / 2),
      COVE_H * (1 - Math.cos(t * Math.PI / 2))
    ));
  }
  profile.push(new Vector2(R_WALL, TALL));
  const shell = new Mesh(
    new LatheGeometry(profile, 96),
    new MeshStandardMaterial({
      map: tex('media/g-wall.jpg', 26, 1),
      // the slats are a warm walnut; a cool tint takes them to smoked steel
      color: 0xbac8dc,
      roughness: 0.78, metalness: 0.0, envMap, envMapIntensity: 0.40,
      side: BackSide,
    })
  );
  shell.name = 'cove';
  shell.receiveShadow = true;
  room.add(shell);

  const ceil = new Mesh(
    new CircleGeometry(R_WALL, 64),
    new MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.95, metalness: 0.0, side: BackSide })
  );
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.y = TALL;
  room.add(ceil);

  /* --- brass ----------------------------------------------------------- */
  const brass = new MeshStandardMaterial({
    // A metal's reflectance IS its colour, and it is now reflecting a neutral
    // room instead of an amber one. Left at 0xb08b46 the fittings would come
    // back a duller, greyer gold than before; saturated a step so the brass
    // reads exactly as it did. The warmth in the room should live here, on a
    // surface — not in the light landing on the car.
    color: 0xd4d9df, roughness: 0.16, metalness: 1.0, envMap, envMapIntensity: 1.9,
  });
  for (const [r, thick] of [[3.55, 0.022], [3.74, 0.010]]) {
    const ring = new Mesh(new TorusGeometry(r, thick, 8, 128), brass);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    room.add(ring);
  }

  /* --- what emits ------------------------------------------------------ */
  const fixtures = new Set();
  const emissive = (hex, intensity) => {
    /* Oprawy PODLEGAJĄ tonowaniu — i to jest poprawka błędu, nie kosmetyka.
       three wyłącza tone mapping, kiedy renderuje do bufora pośredniego, więc
       w normalnej ścieżce z post-processingiem flaga `toneMapped: false` i tak
       nic nie robiła: ACES nakładał się raz, na końcu, na wszystko. Ale kiedy
       łańcuch post-processingu padnie i scena idzie prosto na kanwę, ta sama
       flaga nagle zaczyna działać — i świecące materiały omijają krzywą ACES,
       zapisując się surowo. Biały szyld 9,6 × 3,43 m i pierścień światła pod
       całym sufitem wychodzą wtedy czystą bielą i kadr jest prześwietlony.
       Usunięcie flagi nie zmienia nic w ścieżce właściwej, a naprawia awaryjną. */
    const m = new MeshBasicMaterial({ color: hex });
    m.userData.baseColor = new Color(hex);
    m.userData.baseEmissive = intensity;
    m.color.copy(m.userData.baseColor).multiplyScalar(intensity);
    fixtures.add(m);
    return m;
  };

  // one continuous ring of light where the wall meets the ceiling
  const cove = emissive(0xdbe6f5, 1.0);
  const coveRing = new Mesh(new TorusGeometry(R_WALL - 0.12, 0.035, 6, 128), cove);
  coveRing.rotation.x = -Math.PI / 2;
  coveRing.position.y = TALL - 0.22;
  room.add(coveRing);

  // Two pendants, flanking the car rather than crossing over it: the plan
  // shot looks straight down from 6.45 m, and a bar on the centre line sits
  // squarely between that camera and the roof of the car.
  const lamp = emissive(0xf4f8ff, 1.0);
  const areas = [];
  if (quality.areaLights) RectAreaLightUniformsLib.init();
  for (const pz of [-4.6, 4.6]) {
    const housing = new Mesh(new BoxGeometry(7.4, 0.14, 0.30), brass);
    housing.position.set(0, 4.90, pz);
    room.add(housing);
    const tube = new Mesh(new BoxGeometry(7.1, 0.035, 0.20), lamp);
    tube.position.set(0, 4.81, pz);
    room.add(tube);
    for (const hx of [-3.2, 3.2]) {
      const rod = new Mesh(new CylinderGeometry(0.012, 0.012, TALL - 4.90, 5), brass);
      rod.position.set(hx, (TALL + 4.90) / 2, pz);
      room.add(rod);
    }
    if (quality.areaLights) {
      // 0xfff2dc → 0xf3f3f3: same luminance (Y = 0.899), no amber. The tube
      // above still *looks* warm, because that is the fitting; what it throws
      // on the car is white, because that is what a showroom actually throws.
      const a = new RectAreaLight(0xf3f3f3, 7.5, 7.1, 0.30);
      a.position.set(0, 4.77, pz);
      a.rotation.x = -Math.PI / 2;
      room.add(a);
      areas.push(a);
    }
  }

  // The sign: the studio's monogram and name, in chrome.
  //
  // It is bent to the wall rather than hung flat on it. A flat panel this
  // wide across a wall of this radius would stand more than a metre off the
  // sweep at its centre and read as a floating billboard; a cylinder segment
  // at the wall's own radius sits on it exactly. The segment is generated
  // from theta = 0 at +Z running towards +X, so seen from inside the room
  // the texture arrives mirrored — hence the flipped U below, which is the
  // one line that is easy to get wrong and impossible to miss when it is.
  const signTex = makeSign();
  signTex.wrapS = RepeatWrapping;
  signTex.repeat.x = -1;
  signTex.offset.x = 1;
  signTex.anisotropy = 8;
  const signMat = new MeshBasicMaterial({
    map: signTex, transparent: true, depthWrite: false,
    side: BackSide,
  });
  signMat.userData.baseEmissive = 1.0;
  signMat.userData.baseColor = new Color(0xffffff);
  fixtures.add(signMat);

  // Sized to the VERTICAL part of the wall. The sweep curves inward below
  // 3.6 m, so anything hanging past that line lifts off the surface —
  // the sign therefore stands from the top of the cove to just under the
  // ceiling: 9.6 m across, 3.43 m tall, which is most of the wall there is.
  const SIGN_ARC = 0.8807;       // 9.6 m of wall
  const SIGN_H = 3.43;
  const signGeo = (thetaCentre) => new CylinderGeometry(
    R_WALL - 0.10, R_WALL - 0.10, SIGN_H, 64, 1, true,
    thetaCentre - SIGN_ARC / 2, SIGN_ARC
  );
  // Lowered to 4.70 m (bottom edge at 2.99 m) so the name sits in frame
  // below the navigation bar. The sweep is still within 7 cm of the wall
  // radius at that height, so the panel does not visibly lift off it.
  const sign = new Mesh(signGeo(Math.PI), signMat);
  sign.position.y = 4.70;
  sign.name = 'wordmark';
  room.add(sign);

  // a second one facing the other way, because the camera orbits past 180°
  const signB = new Mesh(signGeo(0), signMat);
  signB.position.y = 4.70;
  room.add(signB);

  // No furniture. Anything standing on the sweep breaks the one thing the
  // sweep is there for, which is an uninterrupted surface behind the car.

  /* --- practical lights matched to the fittings ------------------------ */
  //
  // Every one of these was amber, and together they were the other half of the
  // brown. Each is replaced by the neutral of its own Rec.709 luminance, so
  // the intensities below are unchanged and the room keeps its exact falloff:
  //
  //   0xffe6bb → 0xe9e9e9   Y = 0.814
  //   0xffd6a4 → 0xdddddd   Y = 0.720
  //   0xffbe7c → 0xcbcbcb   Y = 0.595
  //
  // The warmth that should survive is the warmth of a *surface*: the brass
  // fittings and the cove glow are still gold. What is gone is gold light
  // falling on a black car from six directions at once.
  const lamps = [];
  for (const [x, y, z, hex, peak] of [
    [0, 4.6, -4.6, 0xe9e9e9, 2.4],
    [0, 4.6, 4.6, 0xe9e9e9, 2.4],
    [0, TALL - 0.6, -R_WALL + 1.4, 0xdddddd, 1.6],
    [0, TALL - 0.6, R_WALL - 1.4, 0xdddddd, 1.2],
    [-R_WALL + 1.6, 2.2, 0, 0xcbcbcb, 1.1],
    [R_WALL - 1.6, 2.2, 0, 0xcbcbcb, 1.1],
  ]) {
    const l = new PointLight(hex, 0, 30, 2);
    l.position.set(x, y, z);
    room.add(l);
    lamps.push({ light: l, peak });
  }

  const baseKey = 1.70, baseRim = 1.60, baseFill = 0.14, baseHemi = 0.12;
  const setFixture = (m, k) => {
    m.color.copy(m.userData.baseColor).multiplyScalar((m.userData.baseEmissive || 1) * k);
  };

  return {
    group: room,
    floorY: 0,
    wordmark: sign,
    areas,
    spots: [],

    setIgnition(k) {
      const v = MathUtils.clamp(k, 0, 1);
      let i = 0;
      for (const m of fixtures) {
        const start = (i++ % 3) * 0.14;
        setFixture(m, MathUtils.clamp((v - start) / 0.38, 0, 1));
      }
      lamps.forEach((l) => { l.light.intensity = l.peak * v; });
      areas.forEach((a) => { a.intensity = 7.5 * v; });
    },

    setNight(k, lights, sky, scene2) {
      const n = MathUtils.clamp(k, 0, 1);
      lights.key.intensity = baseKey * (1 - n * 0.94);
      lights.rim.intensity = baseRim * (1 - n * 0.62) + n * 0.30;
      lights.fill.intensity = baseFill * (1 - n * 0.90);
      lights.hemi.intensity = baseHemi * (1 - n * 0.85);

      // the pendants drop away; the brass sign and the cove ring are what a
      // collection garage leaves burning overnight
      for (const m of fixtures) {
        const keep = (m === signMat || m === cove) ? (1 - n * 0.15) : (1 - n * 0.88);
        setFixture(m, keep);
      }
      lamps.forEach((l, i) => { l.light.intensity = l.peak * (i >= 2 ? 1 - n * 0.35 : 1 - n * 0.90); });
      areas.forEach((a) => { a.intensity = 7.5 * (1 - n * 0.92); });

      if (sky) sky.material.uniforms.uNight.value = n;
      if (scene2 && scene2.fog) {
        scene2.fog.color.copy(FOG_COLOR).lerp(FOG_NIGHT, n);
        scene2.fog.density = 0.0050 + n * 0.0075;
      }
    },
  };
}

export function createFog(scene) {
  scene.fog = new FogExp2(FOG_COLOR.getHex(), 0.0045);
  return scene.fog;
}
