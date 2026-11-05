/**
 * aplikatorzy.pl — rigging a model that has no part names.
 *
 * The Revuelto GLB is properly authored: its nodes are called DoorLF, Wing_,
 * CTRL_Wheel_FL, its materials M_CarPaint, M_Glass, M_Rubber. Everything the
 * site does hangs off those names.
 *
 * The SVJ is a Sketchfab export. Every node is "Object_417", every material
 * is "Material.006", and sixty unrelated materials are all called
 * "tire_pirelli_pzerocorsa_d.003_9_31". There is nothing to match on.
 *
 * So this module identifies the car the other way round — by measuring it.
 * Wheels are round clusters of geometry low down at the corners of the
 * footprint. Paint is the clearcoated material that covers the most of the
 * shell. Glazing is what is transparent. Lamps are what is emissive and sits
 * at one end; screens are what is emissive and sits in the cabin. None of it
 * depends on a single name, which is the point.
 *
 * The wheel clustering here is the same algorithm that was measured against
 * the real file offline: it finds four wheels, symmetric to 1 cm, and a
 * wheelbase within 0.4% of the factory figure.
 */

import { Box3, Vector3, Group, Color, DoubleSide } from 'three';

/** Everything the site needs to know about a nameless car. */
export function autoRig(raw, opts = {}) {
  const debug = !!opts.debug;

  /* --- 1. throw away what is not the car ------------------------------- */
  // Sketchfab scenes often carry a stray ground plane. Ours has its own
  // floor, and two coplanar floors z-fight into a shimmering mess.
  const strays = [];
  raw.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    if (tris <= 4) strays.push(o);
  });
  for (const o of strays) if (o.parent) o.parent.remove(o);

  raw.updateMatrixWorld(true);

  /* --- 2. measure every mesh in world space ---------------------------- */
  const items = [];
  raw.traverse((o) => {
    if (!o.isMesh) return;
    const box = new Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const g = o.geometry;
    items.push({
      mesh: o,
      box,
      size,
      centre,
      tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3,
    });
  });

  const carBox = new Box3();
  for (const it of items) carBox.union(it.box);
  const carSize = carBox.getSize(new Vector3());
  const carMid = carBox.getCenter(new Vector3());

  /* --- 3. the four wheels ---------------------------------------------- */
  // A wheel reads as: round in the side view, a sensible fraction of the
  // car's height, sitting low, and off the centreline.
  const wheelish = items.filter((it) => {
    const { size: s, centre: c } = it;
    if (s.y < carSize.y * 0.22 || s.y > carSize.y * 0.85) return false;
    if (Math.abs(s.y - s.z) > Math.max(s.y, s.z) * 0.28) return false;
    if (c.y > carBox.min.y + carSize.y * 0.55) return false;
    if (Math.abs(c.x - carMid.x) < carSize.x * 0.30) return false;
    return true;
  });

  const corners = new Map();
  for (const it of wheelish) {
    const key = (it.centre.z < carMid.z ? 'A' : 'B') + (it.centre.x > carMid.x ? 'L' : 'R');
    const d = corners.get(key) || { n: 0, c: new Vector3(), r: 0 };
    d.n++;
    d.c.add(it.centre);
    d.r = Math.max(d.r, Math.max(it.size.y, it.size.z) / 2);
    corners.set(key, d);
  }
  for (const d of corners.values()) d.c.divideScalar(d.n);

  // Which end is the front? On every mid-engined supercar the rear wheels are
  // the bigger pair, so the smaller axle is the nose. It is a more reliable
  // signal than anything in this file's names.
  let frontTag = 'A';
  const rA = Math.max(corners.get('AL')?.r || 0, corners.get('AR')?.r || 0);
  const rB = Math.max(corners.get('BL')?.r || 0, corners.get('BR')?.r || 0);
  if (rB && rA && rB < rA) frontTag = 'B';

  const wheels = [];
  for (const [key, d] of corners) {
    const front = key[0] === frontTag;
    const side = key[1];
    // A wheel is many meshes — rim, tyre, disc, calliper. Gather every mesh
    // that sits wholly inside the wheel's own sphere, and hang them on a
    // steering pivot with a spin pivot inside it, exactly as the named rig
    // would have given us.
    const steerNode = new Group();
    steerNode.name = `auto_steer_${key}`;
    // d.c is a WORLD position, and `raw` is scaled (and may be rotated), so it
    // has to be converted into raw's own space before it can be used as a
    // local position. Skipping that conversion puts the pivot ~12 cm away from
    // the real hub: the wheel sits right until it turns, then swings out of
    // its arch — which is exactly what it did.
    steerNode.position.copy(raw.worldToLocal(d.c.clone()));
    raw.add(steerNode);
    const spinNode = new Group();
    spinNode.name = `auto_spin_${key}`;
    steerNode.add(spinNode);
    raw.updateMatrixWorld(true);

    let taken = 0;
    for (const it of items) {
      if (it.mesh.userData.autoWheel) continue;
      if (it.centre.distanceTo(d.c) > d.r * 1.25) continue;
      const reach = Math.max(
        it.box.max.distanceTo(d.c),
        it.box.min.distanceTo(d.c)
      );
      if (reach > d.r * 1.55) continue;            // do not swallow the arch
      spinNode.attach(it.mesh);
      // This export shares one material across parts that have nothing to do
      // with each other — the same material is on a tyre and on half the
      // bodywork. Grading the wheel would repaint the car, so every mesh that
      // joins a wheel gets its own copy first.
      it.mesh.material = Array.isArray(it.mesh.material)
        ? it.mesh.material.map((m) => m.clone())
        : it.mesh.material.clone();
      it.mesh.userData.autoWheel = true;
      it.mesh.userData.isWheel = true;
      taken++;
    }

    // where this wheel actually meets the ground, before anything is moved
    let bottom = Infinity;
    spinNode.traverse((o) => {
      if (!o.isMesh) return;
      bottom = Math.min(bottom, new Box3().setFromObject(o).min.y);
    });

    wheels.push({
      bottom,
      key: (front ? 'F' : 'R') + side,
      front,
      steerNode,
      spinNode,
      baseSteer: steerNode.quaternion.clone(),
      baseSpin: spinNode.quaternion.clone(),
      radius: d.r,
      meshes: taken,
    });
  }

  /* --- 3b. the doors ---------------------------------------------------- */
  // The body arrives as one welded shell, so the door skin was cut out of it
  // offline — by the outline of the door card that sits behind it — and comes
  // back as its own object. All that is left to do here is hang it.
  const doors = { L: null, R: null };
  const doorMeshes = [];
  raw.traverse((o) => { if (o.isMesh && /^Door[LR]F_cut$/.test(o.name)) doorMeshes.push(o); });

  for (const mesh of doorMeshes) {
    const side = mesh.name[4] === 'L' ? 'L' : 'R';
    const box = new Box3().setFromObject(mesh);
    const c = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());

    // A scissor door hinges at its FRONT edge, a third of the way up, and the
    // whole panel swings up and forward from there.
    const hingeWorld = new Vector3(c.x, box.min.y + s.y * 0.34, box.min.z);
    const g = new Group();
    g.name = `auto_door_${side}`;
    g.position.copy(raw.worldToLocal(hingeWorld.clone()));
    raw.add(g);
    raw.updateMatrixWorld(true);
    g.attach(mesh);

    // its own copy of the paint, so the open door can be visible from inside
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => { const k = m.clone(); k.side = DoubleSide; return k; })
      : (() => { const k = mesh.material.clone(); k.side = DoubleSide; return k; })();

    // which way is up? whichever sign lifts the far end of the panel.
    g.userData.liftSign = -1;
    g.userData.outSign = c.x > 0 ? 1 : -1;
    doors[side] = g;
  }

  /* --- 4. the materials ------------------------------------------------ */
  const mats = new Map();
  raw.traverse((o) => {
    if (!o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m) continue;
      const rec = mats.get(m.uuid) || { m, tris: 0, box: new Box3() };
      const g = o.geometry;
      rec.tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      rec.box.union(new Box3().setFromObject(o));
      mats.set(m.uuid, rec);
    }
  });

  const parts = {
    paint: [], glass: [], lamps: [], lenses: [], screens: [], tyres: [], rims: [], plate: [],
  };

  const frontZ = frontTag === 'A' ? carBox.min.z : carBox.max.z;
  const cabinZ = carMid.z + (frontTag === 'A' ? -1 : 1) * carSize.z * 0.10;

  for (const rec of mats.values()) {
    const { m, box, tris } = rec;
    const c = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());
    const covers = s.z / carSize.z;

    // Lamp lenses. The model authors them as nearly clear glass — alpha 0.07
    // to 0.22 — expecting something lit behind them. Nothing is, so they
    // simply are not there: the car looks like it has holes where the lights
    // should be. Small, transparent and at one end of the car means lamp.
    const nearFront = Math.abs(c.z - frontZ) < carSize.z * 0.26;
    const rearZ = frontTag === 'A' ? carBox.max.z : carBox.min.z;
    const nearRear = Math.abs(c.z - rearZ) < carSize.z * 0.26;
    if (m.transparent && m.opacity < 0.45 && s.x < carSize.x * 0.45 && (nearFront || nearRear)) {
      m.userData.autoZ = c.z;
      m.userData.lampEnd = nearFront ? 'F' : 'R';
      parts.lenses.push(m);
      continue;
    }
    // A wide, thin panel at the tail is the rear light bar.
    if (nearRear && s.x > carSize.x * 0.55 && s.y < carSize.y * 0.20 && c.y > carBox.min.y + carSize.y * 0.45) {
      m.userData.autoZ = c.z;
      m.userData.lampEnd = 'R';
      parts.lenses.push(m);
      continue;
    }
    if (m.transparent && m.opacity < 0.45 && s.y > carSize.y * 0.25) {
      parts.glass.push(m);
      continue;
    }
    if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) {
      // a lamp sits at one end and is wide and thin; a screen sits in the
      // cabin and is small
      const atEnd = Math.abs(c.z - frontZ) < carSize.z * 0.22
        || Math.abs(c.z - (frontTag === 'A' ? carBox.max.z : carBox.min.z)) < carSize.z * 0.22;
      m.userData.autoZ = c.z;           // which end of the car it sits at
      (atEnd && s.x > carSize.x * 0.3 ? parts.lamps : parts.screens).push(m);
      continue;
    }
    if (m.clearcoat > 0.05 && !m.map && covers > 0.6 && tris > 5000) {
      parts.paint.push({ m, tris });
      continue;
    }
  }
  parts.paint.sort((a, b) => b.tris - a.tris);
  parts.paint = parts.paint.map((p) => p.m);

  // tyres and rims: whatever the wheel groups actually contain
  for (const w of wheels) {
    w.spinNode.traverse((o) => {
      if (!o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const b = new Box3().setFromObject(o);
      const r = Math.max(b.getSize(new Vector3()).y, b.getSize(new Vector3()).z) / 2;
      for (const m of list) {
        if (!m) continue;
        (r > w.radius * 0.82 ? parts.tyres : parts.rims).push(m);
      }
    });
  }
  parts.tyres = [...new Set(parts.tyres)];
  parts.rims = [...new Set(parts.rims)].filter((m) => !parts.tyres.includes(m));

  if (debug) {
    /* eslint-disable no-console */
    console.groupCollapsed('%caplikatorzy.pl · auto rig', 'color:#c3ccd7');
    console.log('car', carSize.toArray().map((v) => +v.toFixed(2)));
    console.log('strays removed', strays.length, 'meshes', items.length, 'materials', mats.size);
    console.log('wheels', wheels.map((w) => `${w.key} r=${w.radius.toFixed(3)} ×${w.meshes}`));
    console.log('doors', Object.keys(doors).filter((k) => doors[k]).join(' ') || 'none');
    console.log('contact', wheels.map((w) => `${w.key} ${w.bottom.toFixed(3)}`).join(' '));
    console.log('paint', parts.paint.length, 'glass', parts.glass.length,
      'lamps', parts.lamps.length, 'lenses', parts.lenses.length, 'screens', parts.screens.length,
      'tyres', parts.tyres.length, 'rims', parts.rims.length);
    console.groupEnd();
    /* eslint-enable no-console */
  }

  return { wheels, doors, parts, carBox, carSize };
}

/** Grade a nameless car the way the named one is graded. */
export function autoGrade(parts, PAINT, tyreMap) {
  for (const m of parts.paint) {
    if (m.map) continue;                 // a painted-on livery stays as authored
    m.color = new Color(PAINT.body);
    m.metalness = PAINT.metalness;
    m.roughness = PAINT.roughness;
    m.envMapIntensity = PAINT.envMapIntensity;
    m.clearcoat = 1.0;
    m.clearcoatRoughness = Math.max(PAINT.clearcoatRoughness, 0.085);
    m.needsUpdate = true;
  }
  for (const m of parts.glass) {
    m.transmission = 0;
    m.transparent = true;
    m.opacity = Math.min(0.45, Math.max(0.22, m.opacity));
    m.roughness = 0.03;
    m.metalness = 0.0;
    m.envMapIntensity = 2.4;
    if (!m.map) m.color = new Color(0x2a3038);
    m.needsUpdate = true;
  }
  // Where the model brings its own texture it wins — these tyres carry a real
  // Pirelli sidewall. The drawn rubber is only for a tyre that has no map.
  for (const m of parts.tyres) {
    if (!m.map && tyreMap) { m.map = tyreMap; m.color = new Color(0xffffff); }
    else if (!m.map) m.color = new Color(0x141517);
    m.roughness = 0.94;
    m.metalness = 0.0;
    m.envMapIntensity = 0.22;
    m.needsUpdate = true;
  }
  for (const m of parts.rims) {
    if (!m.map) m.color = new Color(0x090a0b);
    m.metalness = m.map ? 0.65 : 0.30;
    m.roughness = m.map ? 0.18 : 0.11;
    m.envMapIntensity = 1.8;
    if (m.clearcoat !== undefined) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.05; }
    m.needsUpdate = true;
  }
  for (const m of parts.screens) {
    m.emissiveIntensity = 1.4;
    m.toneMapped = true;
    m.needsUpdate = true;
  }
  for (const m of parts.lamps) {
    m.userData.baseEmissive = 1.0;
    m.emissiveIntensity = 0.2;
    m.needsUpdate = true;
  }
  // give the lenses a body of their own so they read as lamps whether or not
  // they are switched on
  for (const m of parts.lenses) {
    const rear = m.userData.lampEnd === 'R';
    m.transparent = true;
    m.opacity = 0.92;
    m.depthWrite = true;
    m.roughness = 0.12;
    m.metalness = 0.0;
    m.envMapIntensity = 2.2;
    m.color = new Color(rear ? 0x4a0a08 : 0x20242b);
    m.emissive = new Color(rear ? 0xff2412 : 0xdce9ff);
    m.userData.baseEmissive = 1.0;
    m.emissiveIntensity = rear ? 0.14 : 0.10;
    m.toneMapped = true;
    m.needsUpdate = true;
  }
}
