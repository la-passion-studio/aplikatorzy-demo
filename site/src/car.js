/**
 * aplikatorzy.pl — the Lamborghini
 *
 * Loads lamborghini_revuelto.glb with GLTFLoader (no viewer, no iframe, no
 * image sequence: a real Object3D in a real scene), then:
 *
 *   - measures it with Box3 and normalises orientation, scale and ride height
 *   - discovers the rig by walking the node hierarchy — four wheels with
 *     separate steering and spin pivots, headlights, tail lights, glass,
 *     interior, callipers, brake discs, badges
 *   - re-grades the materials for a luxury automotive campaign: clearcoat
 *     paint, cheap-but-convincing glazing, emissive lamps
 *
 * Everything the camera timeline needs is exposed on the returned object.
 */

import {
  Box3, Vector3, Vector2, Group, Quaternion, Color, FrontSide, PointLight, Mesh,
  CylinderGeometry, ShaderMaterial, AdditiveBlending, DoubleSide, MathUtils,
  Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, MeshPhysicalMaterial, Matrix4,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_URL, MODEL_PARTS, MODEL_BYTES, PAINT } from './config.js';
import { makeTyre, makeCarbonWeave, makeCluster, makeNavScreen, makePlate } from './textures.js';
import { autoRig, autoGrade } from './autoRig.js';

const TARGET_LENGTH = 4.95;   // metres — the real Revuelto
// Corner tokens are matched as whole words: "CTRL_Wheel_FL_1" must resolve to
// FL and nothing else — note that a naive /rl/ would happily match the "RL"
// hiding inside "CTRL".
const WHEEL_KEYS = [
  { key: 'FL', re: /(?:^|[^a-z])fl(?![a-z])/i, front: true },
  { key: 'FR', re: /(?:^|[^a-z])fr(?![a-z])/i, front: true },
  { key: 'RL', re: /(?:^|[^a-z])rl(?![a-z])/i, front: false },
  { key: 'RR', re: /(?:^|[^a-z])rr(?![a-z])/i, front: false },
];
const WHEEL_PIVOT = /(?:^|[^a-z])(?:ctrl|pivot|hub|axle)(?:[^a-z]|$)/i;

const X_AXIS = new Vector3(1, 0, 0);

// Drawn once, shared by every material that needs them.
let TYRE = null;
let WEAVE = null;

export async function loadCar({ onProgress, debug = false } = {}) {
  const loader = new GLTFLoader();

  const gltf = MODEL_PARTS && MODEL_PARTS.length
    ? await loadFromParts(loader, MODEL_PARTS, onProgress)
    : await new Promise((resolve, reject) => {
      loader.load(
        MODEL_URL,
        resolve,
        (e) => {
          if (!onProgress) return;
          // Some servers do not report Content-Length for the .glb; fall back
          // to the known asset size so the loader bar stays honest.
          const total = e.total || 44629752;
          onProgress(Math.min(0.999, e.loaded / total));
        },
        (err) => reject(new Error(`Nie udało się wczytać modelu 3D (${err?.message || err})`))
      );
    });

  const raw = gltf.scene;

  /* --- 1. measure ------------------------------------------------------ */
  let box = new Box3().setFromObject(raw);
  let size = box.getSize(new Vector3());

  // Which horizontal axis is the car's length? Do not assume the export is
  // already nose-along-Z.
  if (size.x > size.z) {
    raw.rotation.y = Math.PI / 2;
    raw.updateMatrixWorld(true);
    box = new Box3().setFromObject(raw);
    size = box.getSize(new Vector3());
  }

  const scale = TARGET_LENGTH / Math.max(0.001, size.z);
  raw.scale.multiplyScalar(scale);
  raw.updateMatrixWorld(true);
  box = new Box3().setFromObject(raw);
  size = box.getSize(new Vector3());

  /* --- 2. rig discovery ------------------------------------------------ */
  const wheels = [];
  const parts = {
    body: [], glass: [], interior: [], lightsF: [], lightsR: [],
    calipers: [], discs: [], tyres: [], badges: [], engine: [],
    screens: [], plates: [], steering: [],
  };
  const materials = new Map();
  const rig = { doorL: [], doorR: [], wing: [] };

  raw.traverse((o) => {
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) if (m && !materials.has(m.uuid)) materials.set(m.uuid, m);
    }

    const name = o.name || '';
    const isWheelPivot = /wheel/i.test(name) && WHEEL_PIVOT.test(name);
    for (const w of WHEEL_KEYS) {
      if (isWheelPivot && w.re.test(name) && !wheels.find((x) => x.key === w.key)) {
        // CTRL_* is the steering pivot; its single child is the spin pivot
        const spin = o.children.find((c) => c.children.length || c.isMesh) || o;
        wheels.push({
          key: w.key,
          front: w.front,
          steerNode: o,
          spinNode: spin,
          baseSteer: o.quaternion.clone(),
          baseSpin: spin.quaternion.clone(),
        });
      }
    }

    if (!o.isMesh) return;
    const path = pathOf(o);
    if (/GRP_Glass|Glass[A-Z]/i.test(path) || /M_Glass/i.test(o.material?.name || '')) parts.glass.push(o);
    if (/GRP_Interior|SteeringWheel|Seat|Dash/i.test(path)) parts.interior.push(o);
    if (/GRP_Lights_F|Headlight|LensL?HL|LensRHL/i.test(path)) parts.lightsF.push(o);
    if (/GRP_Lights_R|Taillight|TailLight/i.test(path)) parts.lightsR.push(o);
    if (/GRP_Engine/i.test(path)) parts.engine.push(o);
    if (/GRP_Body|GRP_Hood|GRP_Trunk/i.test(path)) parts.body.push(o);
    // Moving bodywork: scissor doors (panel + trim + glass + mirror) and the
    // active wing. The meshes themselves are called Object_NNN — the part name
    // lives on the node that owns them.
    const owner = (o.parent && o.parent.name) || name;
    if (/^DoorLF_|^DoorCardLF|^WingMirrorL|^MirrorBaseL|^GlassLF_|^GlassLM_/i.test(owner)) {
      rig.doorL.push(o);
    } else if (/^DoorRF_|^DoorCardRF|^WingMirrorR|^MirrorBaseR|^GlassRF_|^GlassRM_/i.test(owner)) {
      rig.doorR.push(o);
    } else if (/^Wing_|^WingHingeAim|^WingPistonUpper/i.test(owner)) {
      rig.wing.push(o);
    }

    if (/Caliper/i.test(o.material?.name || '')) parts.calipers.push(o);
    if (/Rotor|BrakeRotor/i.test(o.material?.name || '')) parts.discs.push(o);
    if (/Rubber/i.test(o.material?.name || '')) parts.tyres.push(o);
    if (/Badge/i.test(o.material?.name || '') || /Badge/i.test(name)) parts.badges.push(o);
    if (/M_Screen/i.test(o.material?.name || '')) parts.screens.push(o);
    if (/M_PlateBase/i.test(o.material?.name || '')) parts.plates.push(o);
    if (/SteeringWheel/i.test(pathOf(o))) parts.steering.push(o);
  });

  // Does this model carry usable part names at all? The Revuelto does; a
  // Sketchfab export where every node is "Object_417" does not, and for those
  // the whole rig has to be measured instead of matched.
  const AUTO = wheels.length < 4 && rig.doorL.length === 0 && rig.wing.length === 0;
  let auto = null;
  if (AUTO) {
    auto = autoRig(raw, { debug });
    wheels.length = 0;
    wheels.push(...auto.wheels);
  } else if (wheels.length < 4) {
    buildWheelsFromGeometry(raw, wheels, box);
  }

  /* --- 3. which way is forwards? --------------------------------------- */
  // The front axle must end up at +Z. Measure it from the rig, not from hope.
  const axleZ = (front) => {
    const w = wheels.filter((x) => x.front === front);
    if (!w.length) return front ? 1 : -1;
    return w.reduce((sum, x) => sum + x.steerNode.getWorldPosition(new Vector3()).z, 0) / w.length;
  };
  const flipped = wheels.length === 4 && axleZ(true) < axleZ(false);

  /* --- 4. place it on the asphalt, centred ----------------------------- */
  const model = new Group();
  model.name = 'revuelto';
  model.add(raw);
  if (flipped) raw.rotation.y += Math.PI;
  raw.updateMatrixWorld(true);

  const box2 = flipped ? new Box3().setFromObject(raw) : box;
  const c2 = box2.getCenter(new Vector3());
  raw.position.x -= c2.x;
  raw.position.z -= c2.z;
  raw.position.y -= box2.min.y;
  model.updateMatrixWorld(true);

  // Dropping the car by its lowest point only guarantees that ONE corner
  // touches. This model is built nose-down: the front tyres reach 38 mm lower
  // than the rears, so sitting it on the lowest point leaves the back axle in
  // the air. Pitch it until both axles are on the ground, then drop it again.
  if (wheels.length === 4 && wheels.every((w) => Number.isFinite(w.bottom))) {
    const axle = (front) => {
      const w = wheels.filter((x) => x.front === front);
      const bottom = w.reduce((m, x) => Math.min(m, x.bottom), Infinity);
      const z = w.reduce((sum, x) => sum + x.steerNode.getWorldPosition(new Vector3()).z, 0) / w.length;
      return { bottom, z };
    };
    const F = axle(true);
    const R = axle(false);
    const base = Math.hypot(F.z - R.z, 0) || 1;
    // positive pitch drops the nose; we want whichever sign lifts the low end
    const pitch = Math.atan2(F.bottom - R.bottom, base) * (F.z > R.z ? 1 : -1);
    if (Math.abs(pitch) > 0.0005 && Math.abs(pitch) < 0.08) {
      raw.rotation.x += pitch;
      raw.updateMatrixWorld(true);
      // Anchor to the tyre bounds, rather than a potentially lower body part.
      const tyreBottom = Math.min(...wheels.map((w) => new Box3().setFromObject(w.spinNode).min.y));
      raw.position.y -= tyreBottom;
      model.updateMatrixWorld(true);
      if (debug) console.log('aplikatorzy.pl · levelled by', (pitch * 180 / Math.PI).toFixed(2), 'deg');
    }
  }

  const finalBox = new Box3().setFromObject(model);
  const finalSize = finalBox.getSize(new Vector3());

  /* --- 5. wheel radius, from the tyres --------------------------------- */
  let wheelRadius = 0.34;
  if (wheels.length) {
    const wb = new Box3().setFromObject(wheels.find((w) => !w.front)?.spinNode || wheels[0].spinNode);
    wheelRadius = Math.max(0.15, wb.getSize(new Vector3()).y / 2);
  }

  /* --- 6. materials ---------------------------------------------------- */
  const glassMaterials = [];
  const tyreMaterials = [];
  const screenMaterials = [];
  const headlightMaterials = [];
  const taillightMaterials = [];
  let wrapNow = null;
  let wrapTarget = null;

  /* The wrap picker lays the film down as a wave: a front sweeps nose to tail along the
     car's own axis, new film behind it, old film ahead of it, with a thin bright seam on
     the front. Colour, metalness and roughness are blended per pixel in the paint shader;
     the other properties still ease globally. */
  const wave = {
    uFrom: { value: new Color() }, uTo: { value: new Color() },
    uFromM: { value: 0 }, uToM: { value: 0 }, uFromR: { value: 0 }, uToR: { value: 0 },
    uFront: { value: -99 }, uCarInv: { value: new Matrix4() }, uOn: { value: 0 },
  };
  let waveT = 1;                 // 0..1 progress; 1 = finished
  const WAVE_SECONDS = 1.5;
  const installWave = (m) => {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, wave);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uCarInv;\nvarying float vCz;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCz = (uCarInv * modelMatrix * vec4(transformed, 1.0)).z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uFrom, uTo; uniform float uFromM, uToM, uFromR, uToR, uFront, uOn; varying float vCz;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float wmask = uOn > 0.5 ? 1.0 - smoothstep(uFront - 0.10, uFront + 0.10, vCz) : 0.0;   // 1 = old film, 0 = new
diffuseColor.rgb = mix(diffuseColor.rgb, uFrom, wmask);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughnessFactor, uFromR, wmask), 0.02, 1.0);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = clamp(mix(metalnessFactor, uFromM, wmask), 0.0, 1.0);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uOn > 0.5) totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * exp(-pow((vCz - uFront) / 0.07, 2.0)) * 0.55;`);
    };
    m.customProgramCacheKey = () => 'wavepaint';
    m.needsUpdate = true;
  };

  const applyWrap = () => {
    const w = wrapNow;
    for (const m of paintMats) {
      m.color.setRGB(w.rgb[0], w.rgb[1], w.rgb[2]);
      m.metalness = w.metalness;
      m.roughness = w.roughness;
      m.envMapIntensity = w.env;
      if (m.clearcoat !== undefined) {
        m.clearcoat = w.clearcoat;
        m.clearcoatRoughness = w.clearcoatRoughness;
        m.sheen = w.sheen;
        m.iridescence = w.iridescence;
      }
    }
  };
  let paintMaterial = null;
  const paintMats = [];            // every graded body-paint material, for the wrap picker

  /* --- paint: one shader for the whole body ---------------------------- */
  // The model carries TWO paint materials. Only one of them declares the
  // clearcoat extension, so GLTFLoader builds that one as a physical
  // material and the other — which happens to wear most of the bodywork,
  // 35k of the 50k painted triangles — as a plain standard material with no
  // clearcoat at all. Graded side by side they are visibly different cars:
  // deep wet lacquer on the doors, flat metallic on the shell. So any paint
  // material that is not physical is rebuilt as one before grading, and the
  // meshes wearing it are pointed at the replacement.
  {
    const swap = new Map();
    for (const m of materials.values()) {
      const n = (m.name || '').toLowerCase();
      if (!(n.includes('carpaint') || n.includes('car_paint'))) continue;
      if (m.isMeshPhysicalMaterial) continue;
      // Built through the constructor, never with copy(): copying a standard
      // material into a physical one leaves clearcoat, transmission, ior and
      // the rest undefined, and an undefined uniform is a NaN in the shader.
      const up = new MeshPhysicalMaterial({
        color: m.color ? m.color.clone() : new Color(0xffffff),
        metalness: m.metalness ?? 1,
        roughness: m.roughness ?? 1,
        map: m.map || null,
        normalMap: m.normalMap || null,
        roughnessMap: m.roughnessMap || null,
        metalnessMap: m.metalnessMap || null,
        aoMap: m.aoMap || null,
        side: m.side,
        transparent: !!m.transparent,
        opacity: m.opacity ?? 1,
        envMapIntensity: m.envMapIntensity ?? 1,
        flatShading: !!m.flatShading,
      });
      if (m.normalScale && up.normalScale) up.normalScale.copy(m.normalScale);
      up.name = m.name;
      swap.set(m.uuid, up);
    }
    if (swap.size) {
      raw.traverse((o) => {
        if (!o.material) return;
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => (m && swap.get(m.uuid)) || m);
        } else {
          const up = swap.get(o.material.uuid);
          if (up) o.material = up;
        }
      });
      for (const [uuid, up] of swap) { materials.delete(uuid); materials.set(up.uuid, up); }
    }
  }

  // Did this material's base-colour texture actually decode? A GLB texture that
  // fails to load leaves three.js holding a 1x1 WHITE pixel, and a white base
  // colour on a tyre is exactly the "jasne biale opony" problem: the rubber
  // reads as a cream doughnut instead of black. Everywhere below, a material
  // that has lost its map is given a sane solid colour instead of white.
  let missingMaps = 0;
  const mapped = (m) => {
    const im = m.map && m.map.image;
    const ok = !!(im && (im.width || im.videoWidth));
    if (m.map && !ok) missingMaps++;
    return ok;
  };
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  for (const m of materials.values()) {
    const n = (m.name || '').toLowerCase();

    // Names like "Material.006" and sixty copies of "tire_pirelli_..." on
    // parts that are not tyres would send every branch below down the wrong
    // path, so a nameless model is graded from measurement instead.
    if (AUTO) {
      if (m.isMeshStandardMaterial) m.envMapIntensity = m.envMapIntensity ?? 1.0;
      continue;
    }

    // The GLB is properly authored: carbon, alcantara, leather, carpet, the
    // tyre and the badges all ship their own normal / metallic-roughness /
    // base-colour maps. Never replace those — only set the handful of scalars
    // that our lighting needs. Anything else throws away the model's detail.

    if (n.includes('carpaint') || n.includes('car_paint')) {
      gradePaint(m);
      paintMats.push(m);
      installWave(m);
      if (!paintMaterial || n === 'm_carpaint') paintMaterial = m;
      continue;
    }

    if (n.includes('glass')) {
      // Real transmission on 19 panes plus a 560-mesh model is a frame-rate
      // trap. Reflective tinted glazing reads the same at these distances.
      m.transmission = 0;
      m.transparent = true;
      m.opacity = n.includes('dark') ? 0.40 : n.includes('red') ? 0.55 : 0.24;
      m.roughness = 0.03;
      m.metalness = 0.0;
      m.envMapIntensity = 2.4;
      m.depthWrite = false;
      m.side = FrontSide;
      m.ior = 1.5;
      if (m.clearcoat !== undefined) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.02; }
      m.userData.baseOpacity = m.opacity;
      glassMaterials.push(m);
      continue;
    }

    if (n.includes('emitter') || n === 'headlights') {
      m.emissive = new Color(0xeef4ff);
      m.emissiveIntensity = 1.4;
      m.userData.baseEmissive = 1.4;
      headlightMaterials.push(m);
      continue;
    }
    if (n.includes('emission_red')) {
      m.emissive = new Color(0xff1622);
      m.emissiveIntensity = 2.4;
      m.userData.baseEmissive = 2.4;
      taillightMaterials.push(m);
      continue;
    }

    // --- the tyre: base colour AND normal come from the model -------------
    if (n.startsWith('wheel')) {
      // The model ships a real 2048 tyre atlas — sidewalls, lettering and
      // tread strips — unwrapped to match its own normal map. A generic
      // procedural tread drawn over that unwrap does not line up with the
      // relief, which is what made the rubber look wrong on all four corners.
      // So the model's maps win; only the response is set here. The atlas is
      // graded to real rubber reflectance offline, because as authored it is
      // near-pure black and a black tyre reads as a hole, not a tyre.
      if (mapped(m)) {
        m.color.setHex(0xffffff);
      } else {
        // the atlas failed to decode: fall back to drawn rubber rather than
        // three.js's 1x1 white pixel ("jasne białe opony")
        if (!TYRE) TYRE = makeTyre();
        m.map = TYRE;
        m.color.setHex(0xffffff);
      }
      m.roughness = 0.93;
      m.metalness = 0.0;
      // A tyre is black, and a bright studio will happily make it grey: a
      // white cyclorama is a huge soft source and rubber does reflect it.
      // Kept low enough that only the shoulder picks up a highlight — that
      // one highlight is what gives the tyre volume, and everything else
      // stays black.
      m.envMapIntensity = 0.22;
      if (m.normalScale) m.normalScale.set(1.7, 1.7);
      if (m.clearcoat !== undefined) {
        m.clearcoat = 0.08;              // the faint sheen of a dressed tyre
        m.clearcoatRoughness = 0.8;
      }
      if (m.sheen !== undefined) {
        m.sheen = 0.22;
        m.sheenColor = new Color(0x474c53);
        m.sheenRoughness = 0.96;
      }
      m.needsUpdate = true;
      tyreMaterials.push(m);
      continue;
    }

    // --- rubber trim: seals, wiper blades, valve stems, tread blocks ------
    if (n.includes('rubber')) {
      // authored at 0.2% reflectance, which is darker than anything real
      m.color.setRGB(0.030, 0.030, 0.032);
      m.roughness = 0.86;
      m.metalness = 0.0;
      m.envMapIntensity = 0.42;
      m.needsUpdate = true;
      continue;
    }

    // --- carbon: the model's own twill normal map, under clearcoat --------
    if (n.includes('carbon')) {
      // A 2x2 twill drawn as base colour + normal. The GLB only carries a
      // normal here, so without this the "carbon" is a flat dark panel.
      // The model carries a real carbon normal map authored to its own UVs.
      // Where it does, it wins — a generic weave stretched over an unknown
      // unwrap is exactly the plasticky "fake carbon" look to avoid. The
      // drawn twill is the fallback for panels that ship no normal at all.
      if (m.normalMap) {
        if (m.normalScale) m.normalScale.set(1.9, 1.9);
      } else {
        if (!WEAVE) WEAVE = makeCarbonWeave();
        m.map = WEAVE.map;
        m.normalMap = WEAVE.normalMap;
        if (m.normalScale) m.normalScale.set(1.5, 1.5);
      }
      m.color.setHex(0x14161a);
      m.roughness = 0.30;
      m.metalness = 0.30;
      m.envMapIntensity = 1.6;
      if (m.clearcoat !== undefined) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.10; }
      if (m.normalScale) m.normalScale.set(1.25, 1.25);
      if (m.clearcoat !== undefined) {
        m.clearcoat = 1.0;
        m.clearcoatRoughness = 0.04;
      }
      m.needsUpdate = true;
      continue;
    }

    // The reference is a cabin trimmed head to toe in BLACK suede: the
    // headliner, the pillars, the seat centres, the dash top. What makes it
    // read is not colour — there is none — but the cool grazing sheen along
    // every curve. So the albedo stays where the model put it (near black)
    // and the sheen does the work.
    if (n.includes('alcantara')) {
      m.color.setRGB(0.011, 0.011, 0.012);
      m.roughness = 0.97;
      m.metalness = 0.0;
      m.envMapIntensity = 0.52;
      if (m.normalScale) m.normalScale.set(1.25, 1.25);
      if (m.sheen !== undefined) {
        m.sheen = 1.0;
        m.sheenColor = new Color(0x7e8796);
        m.sheenRoughness = 0.82;
      }
      m.needsUpdate = true;
      continue;
    }
    if (n.includes('leather')) {
      m.color.setRGB(0.013, 0.013, 0.014);
      m.roughness = 0.54;
      m.metalness = 0.0;
      m.envMapIntensity = 0.70;
      if (m.normalScale) m.normalScale.set(1.15, 1.15);
      // the low satin a hide keeps, which is what separates leather from
      // suede in the same black
      if (m.clearcoat !== undefined) { m.clearcoat = 0.35; m.clearcoatRoughness = 0.42; }
      m.needsUpdate = true;
      continue;
    }
    if (n.includes('carpet')) {
      m.roughness = 0.98;
      m.envMapIntensity = 0.45;
      if (m.sheen !== undefined) { m.sheen = 0.7; m.sheenColor = new Color(0x4a5058); }
      continue;
    }

    // --- the badges: gold, with the model's own roughness + normal --------
    if (n.includes('badge')) {
      // The shield on the nose, the wheel centres and the script on the
      // engine cover all come from the model. They only disappear when they
      // are under-lit, so they get the highest environment response on the
      // car and a polish that catches the ceiling slots head-on.
      m.metalness = 1.0;
      m.envMapIntensity = 3.4;
      if (m.roughness === undefined || m.roughness > 0.45) m.roughness = 0.24;
      m.needsUpdate = true;
      continue;
    }
    // lettering and labels keep their alpha-mapped artwork untouched
    if (n.includes('label')) {
      m.envMapIntensity = 1.2;
      m.metalness = Math.min(m.metalness ?? 0, 0.3);
      continue;
    }

    // The trim strips down the dash, round the vents and along the console
    // are the only bright thing in that cabin, and they are what give the
    // black its shape. Brushed alloy: bright, tight, and polished enough to
    // catch the fixtures as hard lines.
    if (n.includes('aluminum') || n.includes('aluminium')) {
      m.color.setRGB(0.55, 0.565, 0.60);
      m.metalness = 1.0;
      m.roughness = 0.24;
      m.envMapIntensity = 2.1;
      m.needsUpdate = true;
      continue;
    }
    // The rest of the cabin's metalwork. For a metal the base colour IS its
    // reflectance, and these ship between 2% and 9% — darker than any metal
    // that exists, which is why the trim reads as black gaps instead of the
    // bright strips that cut a black interior into shape. Each gets the
    // reflectance of the alloy it is meant to be. Where the model supplied a
    // texture it wins; only the untextured ones are re-tinted.
    {
      const METAL = {
        detailmetallic: [0.55, 0.560, 0.575, 0.22],
        anodized: [0.30, 0.305, 0.320, 0.30],
        gunmetal: [0.28, 0.288, 0.305, 0.32],
        titanium: [0.42, 0.400, 0.360, 0.34],
        steel: [0.55, 0.558, 0.570, 0.28],
        detail: [0.42, 0.428, 0.440, 0.30],
      };
      const key = Object.keys(METAL).find((k) => n.includes(k));
      if (key) {
        const [r, g, b, rough] = METAL[key];
        if (!mapped(m)) m.color.setRGB(r, g, b);
        m.metalness = 1.0;
        m.roughness = rough;
        m.envMapIntensity = 1.7;
        m.needsUpdate = true;
        continue;
      }
    }

    if (n.includes('chrome') || n.includes('mirror')) {
      m.roughness = 0.035;
      m.metalness = 1.0;
      m.envMapIntensity = 2.6;
      continue;
    }
    // the rim: a dark forged alloy, polished enough to hold the hall's
    // light slots as long streaks rather than glowing like plastic
    if (n.includes('wheelrim') || n.includes('rim')) {
      // gloss black, the way the car wears them: black paint over the
      // forging, with a clearcoat that turns the ceiling slots into two
      // hard white lines across each spoke
      m.color.setHex(0x090a0b);
      m.metalness = 0.30;
      m.roughness = 0.11;
      m.envMapIntensity = 1.9;
      if (m.clearcoat !== undefined) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.045; }
      m.needsUpdate = true;
      continue;
    }
    if (n.includes('caliper')) {
      m.color = new Color(PAINT.caliper);
      m.roughness = 0.32;
      m.metalness = 0.2;
      m.envMapIntensity = 1.4;
      continue;
    }
    if (n.includes('rotor') || n.includes('brakerotor')) {
      m.roughness = 0.38;
      m.metalness = 0.9;
      m.envMapIntensity = 1.6;
      continue;
    }
    if (n.includes('grille')) {
      m.roughness = 0.42;
      m.metalness = 0.55;
      m.envMapIntensity = 1.3;
      continue;
    }
    if (n.includes('screen')) {
      screenMaterials.push(m);
      continue;
    }
    // Rosso contrast stitching: a thread's worth of geometry carrying the
    // only colour in the whole cabin, so it has to hold up against black on
    // both sides. Lifted and given a thread sheen rather than left flat.
    if (n.includes('stitch')) {
      m.color.setHex(0xd8202c);
      m.emissive = new Color(0x3a0508);
      m.emissiveIntensity = 0.62;
      m.roughness = 0.52;
      m.metalness = 0.0;
      m.envMapIntensity = 1.0;
      if (m.sheen !== undefined) {
        m.sheen = 0.8;
        m.sheenColor = new Color(0xff6b6b);
        m.sheenRoughness = 0.6;
      }
      m.needsUpdate = true;
      continue;
    }
    if (n.includes('seatbelt')) {
      m.roughness = 0.7;
      m.envMapIntensity = 0.5;
      continue;
    }

    // --- the blacks -------------------------------------------------------
    // Half this model's triangles wear materials authored between 0.1% and
    // 1% reflectance. Nothing real is that dark: soot is about 2%. Rendered
    // as authored they are holes punched in the car — no form, no edge, no
    // material. The deepest recesses are meant to read as voids and keep
    // theirs; everything else is lifted to a floor it can actually shade at.
    if (n.includes('plasticblack')) {
      m.color.setRGB(0.024, 0.024, 0.026);
      m.roughness = 0.52;
      m.metalness = 0.0;
      m.envMapIntensity = 0.85;
      m.needsUpdate = true;
      continue;
    }

    // everything else keeps its authored look; only the environment response
    // is brought in line with the showroom
    if (m.isMeshStandardMaterial) {
      m.envMapIntensity = m.envMapIntensity ?? 1.0;
      if (!n.includes('blackhole') && !n.includes('shadow') && lum(m.color) < 0.020) {
        const k = 0.022 / Math.max(1e-4, lum(m.color));
        m.color.setRGB(
          Math.min(1, m.color.r * k || 0.022),
          Math.min(1, m.color.g * k || 0.022),
          Math.min(1, m.color.b * k || 0.023)
        );
      }
      // Leftover generic materials ("material_0", "Material") carry glTF's
      // default white. On a graphite car nothing is white, so anything bright
      // that has no working texture is brought down to a dark trim colour.
      if (!mapped(m) && lum(m.color) > 0.5) m.color.setHex(0x1a1b1d);
    }
  }
  if (debug) console.log('aplikatorzy.pl · textures missing:', missingMaps);
  window.__DDT_TEX_MISSING = missingMaps;

  /* --- 6b. hinged bodywork: scissor doors + active wing ----------------- */
  // The hinge groups live in MODEL space — metres, +Z forward, y = 0 on the
  // asphalt — so the numbers below are real measurements off the car and stay
  // correct whichever way round the GLB happened to be authored.
  // Object3D.attach() moves a mesh to a new parent while preserving its world
  // transform, so not a single panel shifts when it is re-hung.
  model.updateMatrixWorld(true);

  const hinge = (x, y, z, meshes) => {
    if (!meshes.length) return null;
    const g = new Group();
    g.position.set(x, y, z);
    model.add(g);
    model.updateMatrixWorld(true);
    for (const m of meshes) {
      g.attach(m);
      m.castShadow = true;
      m.receiveShadow = true;
    }
    return g;
  };

  // The cut doors stay shut. A panel sawn out of a welded shell swings
  // without a frame, a shut line or an inner skin, and it shows.
  const doorL = AUTO ? null : hinge(0.87, 0.52, 1.06, rig.doorL);
  const doorR = AUTO ? null : hinge(-0.87, 0.52, 1.06, rig.doorR);
  const wing = AUTO ? null : hinge(0, 0.73, -1.97, rig.wing);

  /* --- 6c. callipers steer, they do not spin ---------------------------- */
  // A brake calliper is bolted to the hub carrier, not to the rim. In the GLB
  // it sits under the spin pivot, so it orbited the axle and kept ending up at
  // the bottom of the disc. Anything more than 100 mm off the axle line is
  // brake hardware and belongs on the steering pivot instead.
  for (const w of wheels) {
    if (AUTO) break;          // no callipers to find without names
    const centre = w.spinNode.getWorldPosition(new Vector3());
    const axis = X_AXIS.clone()
      .applyQuaternion(w.steerNode.getWorldQuaternion(new Quaternion()))
      .normalize();
    for (const child of [...w.spinNode.children]) {
      const b = new Box3().setFromObject(child);
      if (b.isEmpty()) continue;
      const d = b.getCenter(new Vector3()).sub(centre);
      d.sub(axis.clone().multiplyScalar(d.dot(axis)));   // radial offset only
      if (d.length() > 0.10) w.steerNode.attach(child);
    }
  }

  /* --- 6d. position lamps ---------------------------------------------- */
  // Not headlamps that blind the camera: the running lights a car shows when
  // it is standing in a showroom with the ignition on. The front Y signature
  // and the rear bar come up together, and each gets one small lamp so the
  // bodywork around it picks up the glow instead of the lens floating.
  const lampRig = new Group();
  lampRig.name = 'lamps';
  model.add(lampRig);

  // A point light casts no shadow, so with a 3 m reach the rear pair shone
  // straight through the bodywork and painted the rear tyres red (and the
  // front pair tinted the front ones). Each glow now sits just outside its
  // lens and dies out before it reaches the wheel arch: the body around the
  // lamp and the floor under it still pick it up, the tyres do not.
  const lampGlows = [];
  for (const side of [1, -1]) {
    const front = new PointLight(0xdce9ff, 0, 0.95, 2.0);
    front.position.set(side * 0.70, 0.54, 2.30);
    lampRig.add(front);
    lampGlows.push({ light: front, peak: 1.6 });

    const rear = new PointLight(0xff2b18, 0, 0.95, 2.0);
    rear.position.set(side * 0.74, 0.74, -2.42);
    lampRig.add(rear);
    lampGlows.push({ light: rear, peak: 2.4 });
  }

  /* --- 6e. the screens and the plate ------------------------------------ */
  // M_Screen is one material shared by every display in the cabin, so each
  // mesh gets its own copy: the binnacle in front of the driver shows speed
  // and revs, the centre stack shows the route back to the studio.
  if (AUTO) {
    // The measured rig already knows which materials are lamps and which are
    // the cabin displays; they only need grading and wiring to the switch.
    autoGrade(auto.parts, PAINT, (TYRE = TYRE || makeTyre()));
    const mid = auto.carBox.getCenter(new Vector3()).z;
    for (const m of auto.parts.lamps) {
      const isRear = (m.userData.autoZ ?? 0) > mid;
      m.userData.baseEmissive = 1.0;
      (isRear ? taillightMaterials : headlightMaterials).push(m);
    }
    for (const m of auto.parts.lenses) {
      (m.userData.lampEnd === 'R' ? taillightMaterials : headlightMaterials).push(m);
    }
    for (const m of auto.parts.screens) screenMaterials.push(m);
    if (auto.parts.paint.length) paintMaterial = auto.parts.paint[0];
    glassMaterials.push(...auto.parts.glass);
  }

  const steerX = parts.steering.length
    ? new Box3().setFromObject(parts.steering[0]).getCenter(new Vector3()).x
    : 0.4;
  const screens = AUTO ? [] : parts.screens.map((o) => {
    const c = new Box3().setFromObject(o).getCenter(new Vector3());
    return { mesh: o, x: c.x, driver: Math.sign(c.x) === Math.sign(steerX) && Math.abs(c.x) > 0.12 };
  });
  screens.sort((p1, p2) => Math.abs(p2.x - steerX) - Math.abs(p1.x - steerX));
  const screenTex = { cluster: null, nav: null };
  for (let i = 0; i < screens.length; i++) {
    const isCluster = i === screens.length - 1;   // nearest the wheel
    const src = Array.isArray(screens[i].mesh.material)
      ? screens[i].mesh.material[0] : screens[i].mesh.material;
    const mat = src.clone();
    if (isCluster) {
      screenTex.cluster = screenTex.cluster || makeCluster();
      mat.emissiveMap = screenTex.cluster;
      mat.map = screenTex.cluster;
    } else {
      screenTex.nav = screenTex.nav || makeNavScreen();
      mat.emissiveMap = screenTex.nav;
      mat.map = screenTex.nav;
    }
    mat.color = new Color(0x000000);
    mat.emissive = new Color(0xffffff);
    mat.emissiveIntensity = 1.0;
    mat.roughness = 0.12;
    mat.metalness = 0.0;
    mat.toneMapped = true;
    mat.needsUpdate = true;
    screens[i].mesh.material = mat;
    screenMaterials.push(mat);
  }

  // the rear plate carries the studio name, not a registration
  const plateTex = (!AUTO && parts.plates.length) ? makePlate() : null;
  for (const o of parts.plates) {
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const mat = src.clone();
    mat.map = plateTex;
    mat.color = new Color(0xffffff);
    mat.roughness = 0.42;
    mat.metalness = 0.0;
    mat.envMapIntensity = 0.9;
    mat.needsUpdate = true;
    o.material = mat;
  }

  /* --- 7. shadows & static matrices ------------------------------------ */
  // Only these eight nodes ever change their local transform; every other
  // node can stop recomputing its matrix, which is 1000+ matrix composes
  // saved on every single frame. World matrices still propagate normally.
  const animated = new Set();
  for (const w of wheels) { animated.add(w.steerNode); animated.add(w.spinNode); }
  for (const g of [doorL, doorR, wing]) if (g) animated.add(g);

  const exterior = new Set([...parts.body, ...parts.lightsF, ...parts.lightsR, ...parts.glass]);
  raw.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = exterior.has(o) || !!o.userData.isWheel;
      o.receiveShadow = true;
    }
  });
  for (const w of wheels) w.spinNode.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // The door seals stayed on the body when the doors were cut out, so with a
  // door up they hang across the opening like a bar right in the cabin shot.
  // With the door shut they sit behind its skin anyway, so they simply go.
  raw.traverse((o) => {
    if (/^DoorJamb[LR]F/.test(o.name)) o.visible = false;
  });

  // 1080 nodes recomputing their matrix every frame is pure waste — only the
  // wheels actually move relative to the body.
  raw.traverse((o) => {
    if (animated.has(o)) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  if (debug) {
    /* eslint-disable no-console */
    console.groupCollapsed('%caplikatorzy.pl · model', 'color:#c3ccd7');
    console.log('size (m)', finalSize.toArray().map((v) => +v.toFixed(3)));
    console.log('scale applied', +scale.toFixed(4), 'flipped', flipped);
    console.log('wheels', wheels.map((w) => w.key), 'radius', +wheelRadius.toFixed(3));
    console.log('TYRE CONTACT mm', wheels.map((w) => w.key + ': ' + (new Box3().setFromObject(w.spinNode).min.y * 1000).toFixed(2)).join(', '));
    console.log('materials', materials.size, 'meshes', countMeshes(raw));
    console.log('parts', Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])));
    console.groupEnd();
    /* eslint-enable no-console */
  }

  /* --- 8. the public rig ----------------------------------------------- */
  const spinAxes = wheels.map((w) => X_AXIS.clone().applyQuaternion(w.baseSpin.clone().invert()).normalize());
  const tmpQ = new Quaternion();
  const UP = new Vector3(0, 1, 0);

  const car = {
    model,
    root: raw,
    size: finalSize,
    box: finalBox,
    wheelRadius,
    wheels,
    parts,
    materials: [...materials.values()],
    paintMaterial,
    glassMaterials,
    screenMaterials,
    headlightMaterials,
    taillightMaterials,

    /** Roll the wheels. `distance` is metres travelled. */
    setWheelSpin(distance) {
      const angle = distance / wheelRadius;
      for (let i = 0; i < wheels.length; i++) {
        const w = wheels[i];
        tmpQ.setFromAxisAngle(spinAxes[i], angle);
        w.spinNode.quaternion.copy(w.baseSpin).multiply(tmpQ);
      }
    },

    /** Steer the front wheels. `deg` is small on purpose. */
    setSteer(deg) {
      const a = (deg * Math.PI) / 180;
      for (const w of wheels) {
        if (!w.front) continue;
        tmpQ.setFromAxisAngle(UP, a);
        w.steerNode.quaternion.copy(tmpQ).multiply(w.baseSteer);
        w.steerNode.updateMatrix();
      }
    },

    /** 0 = glazing present, 1 = fully dissolved for the cabin fly-through. */
    setGlassDissolve(v) {
      const k = Math.max(0, Math.min(1, v));
      for (const m of glassMaterials) {
        const base = m.userData.baseOpacity ?? 0.3;
        m.opacity = base * (1 - k);
        m.visible = k < 0.985;
      }
      for (const mesh of parts.glass) mesh.visible = k < 0.985;
    },

    /** Lamps. `v` 0..1 */
    setLamps(v) {
      const k = Math.max(0, Math.min(1, v));
      for (const m of headlightMaterials) m.emissiveIntensity = (m.userData.baseEmissive || 1) * k;
      for (const m of taillightMaterials) m.emissiveIntensity = (m.userData.baseEmissive || 1) * k;
    },

    /**
     * The wrap picker. Every preset is a full paint recipe (colour, metal,
     * roughness, lacquer), eased from the current one so a change reads as the
     * film being laid down rather than a swap. clearcoat / sheen / iridescence
     * never reach exactly 0: a physical material compiles a different shader
     * the moment one of them does, and that is a visible hitch.
     */
    wraps: WRAPS,
    wrap: 'factory',
    setWrap(id, instant = false) {
      const w = WRAPS[id];
      if (!w) return;
      this.wrap = id;
      const next = wrapRecipe(w);
      if (instant || !wrapNow) {
        wrapTarget = next;
        wrapNow = { ...wrapTarget, rgb: wrapTarget.rgb.slice() };
        wave.uOn.value = 0; waveT = 1;
        applyWrap();
        return;
      }
      // what is on the car right now (mid-wave: the blend) becomes the "old film"
      const k = waveT < 1 ? waveT : 1;
      const cur = wrapTarget;
      const old = waveT < 1 ? { rgb: wave.uFrom.value.toArray().map((v, i) => v + (wave.uTo.value.toArray()[i] - v) * k), m: wave.uFromM.value + (wave.uToM.value - wave.uFromM.value) * k, r: wave.uFromR.value + (wave.uToR.value - wave.uFromR.value) * k } : { rgb: cur.rgb, m: cur.metalness, r: cur.roughness };
      wave.uFrom.value.setRGB(old.rgb[0], old.rgb[1], old.rgb[2]);
      wave.uFromM.value = old.m; wave.uFromR.value = old.r;
      wrapTarget = next;
      wave.uTo.value.setRGB(next.rgb[0], next.rgb[1], next.rgb[2]);
      wave.uToM.value = next.metalness; wave.uToR.value = next.roughness;
      waveT = 0; wave.uOn.value = 1;
      // colour / metalness / roughness of the material itself jump to the new film at once; the
      // shader holds the old look ahead of the front
      wrapNow.rgb = next.rgb.slice(); wrapNow.metalness = next.metalness; wrapNow.roughness = next.roughness;
      applyWrap();
    },
    /** Call every frame; cheap when nothing is changing. */
    updateWrap(dt) {
      if (!wrapTarget) return;
      if (!wrapNow) wrapNow = { ...wrapTarget, rgb: wrapTarget.rgb.slice() };
      const k = 1 - Math.exp(-dt * 5.5);
      let moving = false;
      if (waveT < 1) {
        waveT = Math.min(1, waveT + dt / WAVE_SECONDS);
        const e = waveT * waveT * (3 - 2 * waveT);
        wave.uFront.value = 2.7 - e * 5.6;           // nose (+z) to tail (-z), margins for the soft edge
        wave.uCarInv.value.copy(model.matrixWorld).invert();
        if (waveT >= 1) wave.uOn.value = 0;
      }
      for (const key of WRAP_KEYS) {
        const d = wrapTarget[key] - wrapNow[key];
        if (Math.abs(d) > 0.0005) { wrapNow[key] += d * k; moving = true; } else wrapNow[key] = wrapTarget[key];
      }
      for (let i = 0; i < 3; i++) {
        const d = wrapTarget.rgb[i] - wrapNow.rgb[i];
        if (Math.abs(d) > 0.0003) { wrapNow.rgb[i] += d * k; moving = true; } else wrapNow.rgb[i] = wrapTarget.rgb[i];
      }
      if (moving) applyWrap();
    },

    setPaintColor(hex) {
      if (!paintMaterial) return;
      paintMaterial.color.set(hex);
    },

    hasDoors: !!(doorL && doorR),
    hasWing: !!wing,

    /**
     * Scissor doors. 0 = shut, 1 = fully up. They swing a few degrees out
     * before they lift, the way the real hinge works.
     * @param {number} l left door @param {number} r right door
     */
    setDoors(l, r) {
      const shape = (v) => {
        const k = Math.max(0, Math.min(1, v));
        return { lift: MathUtils.degToRad(64) * k, out: MathUtils.degToRad(7) * Math.sin(Math.PI * Math.min(1, k * 1.6)) };
      };
      // A cut door hangs on a pivot built from measurement, so which way it
      // lifts is stored with it rather than assumed.
      const swing = (g, v, mirror) => {
        if (!g) return;
        const sh = shape(v);
        const lift = (g.userData.liftSign || 1) * sh.lift;
        g.rotation.set(lift, 0, mirror * sh.out);
      };
      swing(doorL, l, 1);
      swing(doorR, r === undefined ? l : r, -1);
    },

    /** Active rear wing. 0 = stowed, 1 = deployed. */
    setWing(v) {
      if (!wing) return;
      const k = Math.max(0, Math.min(1, v));
      wing.rotation.x = MathUtils.degToRad(24) * k;
      wing.position.y = 0.73 + 0.085 * k;
      wing.position.z = -1.97 - 0.045 * k;
    },

    /**
     * Main beam. Drives the lamp emissives, two real spot lights that fall on
     * the asphalt, and the volumetric cones in the morning haze.
     * @param {number} v 0..1
     */
    /**
     * Position lights. Not a main beam: this is the lamp signature a car
     * shows standing still with the ignition on — the front Y bars and the
     * rear lamps come up together, bright enough to read as switched on and
     * dim enough not to flare into the lens.
     * @param {number} v 0..1
     */
    setPositionLights(v) {
      const k = Math.max(0, Math.min(1, v));
      for (const m of headlightMaterials) {
        m.emissiveIntensity = (m.userData.baseEmissive || 1) * (0.10 + k * 3.4);
        m.emissive.setRGB(0.80 + k * 0.10, 0.87 + k * 0.08, 1.0);
      }
      for (const m of taillightMaterials) {
        m.emissiveIntensity = (m.userData.baseEmissive || 1) * (0.08 + k * 2.7);
        m.emissive.setRGB(1.0, 0.09 + k * 0.05, 0.05);
      }
      for (const g of lampGlows) g.light.intensity = k * g.peak;
    },

    /** Cabin displays: 0 off, 1 running. */
    setScreens(v) {
      const k = Math.max(0, Math.min(1, v));
      for (const m of screenMaterials) m.emissiveIntensity = k * 1.35;
    },

    lampGlows,
  };

  car.setGlassDissolve(0);
  car.setLamps(0.35);
  car.setDoors(0, 0);
  car.setWing(0);
  car.setPositionLights(0);
  car.setScreens(1);
  return car;
}

/* --- helpers ------------------------------------------------------------ */



/** Fetch the model in pieces and glue it back together before parsing. */
async function loadFromParts(loader, parts, onProgress) {
  const buffers = [];
  let received = 0;

  for (let i = 0; i < parts.length; i++) {
    const res = await fetch(parts[i]);
    if (!res.ok) throw new Error(`Nie udało się wczytać modelu 3D (${parts[i]}: ${res.status})`);

    // stream it so the loading bar moves with the download, not in six jumps
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(Math.min(0.995, received / MODEL_BYTES));
      }
      const size = chunks.reduce((n, c) => n + c.length, 0);
      const joined = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) { joined.set(c, at); at += c.length; }
      buffers.push(joined);
    } else {
      const ab = new Uint8Array(await res.arrayBuffer());
      received += ab.length;
      if (onProgress) onProgress(Math.min(0.995, received / MODEL_BYTES));
      buffers.push(ab);
    }
  }

  const total = buffers.reduce((n, b) => n + b.length, 0);
  const glb = new Uint8Array(total);
  let at = 0;
  for (const b of buffers) { glb.set(b, at); at += b.length; }

  return new Promise((resolve, reject) => {
    loader.parse(
      glb.buffer, '',
      resolve,
      (err) => reject(new Error(`Nie udało się odczytać modelu 3D (${err?.message || err})`))
    );
  });
}

function gradePaint(m) {
  // setRGB with no colour-space argument writes the renderer's WORKING space,
  // which is linear-sRGB — so the triple goes in exactly as authored, with none
  // of the quantisation a near-black hex suffers. The hex is kept only as a
  // fallback for a config that predates bodyLinear.
  m.color = Array.isArray(PAINT.bodyLinear)
    ? new Color().setRGB(...PAINT.bodyLinear)
    : new Color(PAINT.body);
  m.metalness = PAINT.metalness;
  m.roughness = PAINT.roughness;
  m.envMapIntensity = PAINT.envMapIntensity;
  if (m.isMeshPhysicalMaterial || m.clearcoat !== undefined) {
    // Everything that distinguishes gloss from matte lives in these two
    // numbers, so they come from the config rather than being hard-coded
    // here: a clearcoat that is still present but scatters instead of
    // mirroring is what a matte finish actually is.
    m.clearcoat = PAINT.clearcoat ?? 1.0;
    m.clearcoatRoughness = PAINT.clearcoatRoughness;
    m.iridescence = PAINT.iridescence ?? 0.12;
    m.iridescenceIOR = 1.4;
    m.sheen = PAINT.sheenAmount ?? 0.25;
    m.sheenColor = new Color(PAINT.sheen);
    m.sheenRoughness = 0.5;
  }
  m.needsUpdate = true;
}

function pathOf(o) {
  const names = [];
  let n = o;
  let guard = 0;
  while (n && guard++ < 24) { if (n.name) names.push(n.name); n = n.parent; }
  return names.join('/');
}

function countMeshes(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

/**
 * Last-resort wheel discovery: find four round clusters near the ground at
 * the corners of the footprint. Never used with this GLB — it exists so the
 * site survives being pointed at a differently authored model.
 */
function buildWheelsFromGeometry(raw, wheels, box) {
  if (wheels.length === 4) return;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const found = { FL: null, FR: null, RL: null, RR: null };

  raw.traverse((o) => {
    if (!o.isMesh) return;
    const b = new Box3().setFromObject(o);
    const c = b.getCenter(new Vector3());
    const s = b.getSize(new Vector3());
    if (c.y > box.min.y + size.y * 0.55) return;
    if (Math.abs(s.y - s.z) > s.y * 0.45) return;            // roughly circular
    if (s.y < size.y * 0.2) return;
    const key = (c.z > center.z ? 'F' : 'R') + (c.x > center.x ? 'L' : 'R');
    if (!found[key]) found[key] = o.parent || o;
  });

  for (const [key, node] of Object.entries(found)) {
    if (!node || wheels.find((w) => w.key === key)) continue;
    wheels.push({
      key,
      front: key[0] === 'F',
      steerNode: node.parent || node,
      spinNode: node,
      baseSteer: (node.parent || node).quaternion.clone(),
      baseSpin: node.quaternion.clone(),
    });
  }
}


/* --- wrap recipes ---------------------------------------------------------- */

const WRAP_KEYS = ['env', 'clearcoat', 'clearcoatRoughness', 'sheen', 'iridescence'];

/** Colours are authored as sRGB hex and converted once, into the working space. */
export const WRAPS = {
  factory:  { label: 'Fabryczny fiolet', hex: null, linear: [0.0300, 0.0105, 0.0880], metalness: 0.70, roughness: 0.27, env: 1.35, clearcoat: 1.0, clearcoatRoughness: 0.06, sheen: 0.38, iridescence: 0.10 },
  blackchrome: { label: 'Czarny chrom', hex: 0x2a2d33, metalness: 1.0, roughness: 0.05, env: 4.2, clearcoat: 0.03, clearcoatRoughness: 0.1, sheen: 0.02, iridescence: 0.02 },
  chrome:   { label: 'Chrom', hex: 0xffffff, metalness: 1.0, roughness: 0.03, env: 5.5, clearcoat: 0.03, clearcoatRoughness: 0.1, sheen: 0.02, iridescence: 0.02 },
  bluematte: { label: 'Niebieski mat', hex: 0x1d5fae, metalness: 0.72, roughness: 0.52, env: 1.15, clearcoat: 0.03, clearcoatRoughness: 0.6, sheen: 0.25, iridescence: 0.02 },
  greymatte: { label: 'Szary mat', hex: 0x5a5e66, metalness: 0.55, roughness: 0.6, env: 1.05, clearcoat: 0.03, clearcoatRoughness: 0.6, sheen: 0.2, iridescence: 0.02 },
  redsatin: { label: 'Czerwony satyna', hex: 0xb3121c, metalness: 0.25, roughness: 0.34, env: 1.2, clearcoat: 0.35, clearcoatRoughness: 0.25, sheen: 0.3, iridescence: 0.02 },
  orange:   { label: 'Pomarańcz', hex: 0xff6a00, metalness: 0.15, roughness: 0.2, env: 1.3, clearcoat: 1.0, clearcoatRoughness: 0.05, sheen: 0.1, iridescence: 0.02 },
};

function wrapRecipe(w) {
  const rgb = w.linear ? w.linear.slice() : (() => { const c = new Color(w.hex); return [c.r, c.g, c.b]; })();
  return {
    rgb,
    metalness: w.metalness, roughness: w.roughness, env: w.env,
    clearcoat: Math.max(0.03, w.clearcoat), clearcoatRoughness: w.clearcoatRoughness,
    sheen: Math.max(0.02, w.sheen), iridescence: Math.max(0.02, w.iridescence),
  };
}
