/**
 * Procedural 3D models of plant equipment. Each builder returns a THREE.Group
 * with `userData.pick` (what is selected when clicked) and
 * `userData.update(view, time)` to animate it from live DCS state.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ materials
export const COLORS = {
  steel: 0xa3adb8,
  darkSteel: 0x46505b,
  structure: 0x5f6b45,
  concrete: 0x2a2f35,
  shell: 0xb9c6d3,
  liquidA: new THREE.Color(0x4f9dff),
  liquidB: new THREE.Color(0xf0a64a),
  running: new THREE.Color(0x46c46e),
  stopped: new THREE.Color(0x7b8794),
  tripped: new THREE.Color(0xff3b3b),
  forced: new THREE.Color(0xd65cff),
  valveOpen: new THREE.Color(0xf2f5f8),
  valveClosed: new THREE.Color(0x3a434d),
  pipe: { process: 0x9aa3ad, vapour: 0xb3a98f, product: 0xb39066, steam: 0xc98272, cw: 0x5aa894, cwr: 0x4b8a9c },
};

export function steelMaterial(color = COLORS.steel, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.45, ...extra });
}

export function shellMaterial() {
  return new THREE.MeshStandardMaterial({
    color: COLORS.shell,
    metalness: 0.3,
    roughness: 0.15,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function liquidMaterial() {
  return new THREE.MeshStandardMaterial({ color: COLORS.liquidA, metalness: 0.05, roughness: 0.25, transparent: true, opacity: 0.85 });
}

/** Liquid colour from composition: blue = reactant A, amber = product B. */
export function liquidColor(xA, target = new THREE.Color()) {
  return target.copy(COLORS.liquidB).lerp(COLORS.liquidA, Math.min(Math.max(xA ?? 0.5, 0), 1));
}

/** Heat tint 0..1 for hot equipment. */
function heatColor(T, lo, hi, target = new THREE.Color()) {
  const t = Math.min(Math.max((T - lo) / (hi - lo), 0), 1);
  return target.setRGB(0.25 + 0.75 * t, 0.12 * (1 - t), 0.02);
}

const mark = (obj, pick) => {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.userData.pick = pick;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return obj;
};

const Y = new THREE.Vector3(0, 1, 0);

/** Cylinder between two points. */
export function cylinderBetween(a, b, radius, material, radial = 12) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const geo = new THREE.CylinderGeometry(radius, radius, len, radial);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, vb.clone().sub(va).normalize());
  return mesh;
}

function ellipsoidHead(radius, depth, up, material) {
  const geo = new THREE.SphereGeometry(radius, 28, 12, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.scale.y = depth / radius;
  return m;
}

// ------------------------------------------------------------------- vessels
export function buildTank(id, cfg) {
  const g = new THREE.Group();
  const [x, y, z] = cfg.pos;
  g.position.set(x, y, z);
  const r = cfg.radius;
  const hgt = cfg.height;
  const base = cfg.base ?? 0.3;

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.35, base, 32), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.95 }));
  plinth.position.y = base / 2;
  g.add(plinth);

  const shellMat = shellMaterial();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 40, 1, true), shellMat);
  shell.position.y = base + hgt / 2;
  g.add(shell);
  const roofMat = steelMaterial(0x9aa6b2);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, 0.35, 40), roofMat);
  roof.position.y = base + hgt + 0.175;
  g.add(roof);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 40), steelMaterial(0x7a8590));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = base + 0.01;
  g.add(bottom);
  // Shell bands (stiffener rings) for readability.
  for (let i = 0; i <= 4; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.025, 6, 48), steelMaterial(0x8794a1));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = base + (hgt * i) / 4;
    g.add(ring);
  }
  const liqMat = liquidMaterial();
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.97, 1, 40), liqMat);
  liquid.position.y = base;
  g.add(liquid);
  const surface = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  surface.rotation.x = Math.PI / 2;
  g.add(surface);
  // Ladder
  g.add(ladder(r + 0.12, base, base + hgt, 0));

  mark(g, { kind: 'equipment', id });
  g.userData.highlight = [roofMat, shellMat];
  g.userData.update = (view) => {
    const v = view.visual?.[id];
    if (!v) return;
    const lvl = Math.max(v.level, 0.002) * hgt;
    liquid.scale.y = lvl;
    liquid.position.y = base + lvl / 2;
    surface.position.y = base + lvl;
    liquidColor(v.xA, liqMat.color);
  };
  return g;
}

export function buildReactor(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const r = cfg.radius;
  const hgt = cfg.height;
  const y0 = cfg.legs;
  const headDepth = r / 2;

  const legMat = steelMaterial(COLORS.darkSteel);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cylinderBetween([Math.cos(a) * r * 0.95, 0, Math.sin(a) * r * 0.95], [Math.cos(a) * r * 0.95, y0 + 0.5, Math.sin(a) * r * 0.95], 0.09, legMat, 8);
    g.add(leg);
  }
  const shellMat = shellMaterial();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 40, 1, true), shellMat);
  shell.position.y = y0 + hgt / 2;
  g.add(shell);
  // Cooling jacket: a translucent outer shell over the lower 80 %.
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0x5aa894, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.3 });
  const jacket = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r + 0.08, hgt * 0.8, 40, 1, true), jacketMat);
  jacket.position.y = y0 + hgt * 0.4 + 0.05;
  g.add(jacket);

  const headMat = steelMaterial(0xa9b4bf, { transparent: true, opacity: 0.55 });
  const top = ellipsoidHead(r, headDepth, true, headMat);
  top.position.y = y0 + hgt;
  g.add(top);
  const bot = ellipsoidHead(r, headDepth, false, headMat);
  bot.position.y = y0;
  g.add(bot);

  // Liquid
  const liqMat = liquidMaterial();
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.97, 1, 40), liqMat);
  g.add(liquid);
  const liqBottom = ellipsoidHead(r * 0.97, headDepth * 0.97, false, liqMat);
  liqBottom.position.y = y0;
  g.add(liqBottom);

  // Agitator drive and impeller
  const drive = new THREE.Group();
  drive.position.y = y0 + hgt + headDepth;
  const gearbox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), steelMaterial(0x546070));
  gearbox.position.y = 0.25;
  const motorMat = steelMaterial(COLORS.running.getHex());
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 20), motorMat);
  motor.position.y = 0.9;
  drive.add(gearbox, motor);
  mark(drive, { kind: 'motor', id: 'M-101' });
  g.add(drive);
  const impeller = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hgt + headDepth, 8), steelMaterial(0xcfd6dd));
  shaft.position.y = (hgt + headDepth) / 2;
  impeller.add(shaft);
  for (const yy of [0.5, 2.2]) {
    for (let i = 0; i < 4; i += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.18), steelMaterial(0xcfd6dd));
      blade.position.set(Math.cos((i * Math.PI) / 2) * 0.38, yy, Math.sin((i * Math.PI) / 2) * 0.38);
      blade.rotation.y = (-i * Math.PI) / 2;
      blade.rotation.x = 0.5;
      impeller.add(blade);
    }
  }
  impeller.position.y = y0;
  g.add(impeller);

  // Platform at the top head
  g.add(platform(r + 0.15, r + 1.0, y0 + hgt + 0.1));
  g.add(ladder(r + 0.95, 0, y0 + hgt + 0.1, Math.PI));

  mark(g, { kind: 'equipment', id });
  mark(drive, { kind: 'motor', id: 'M-101' });
  g.userData.highlight = [headMat, shellMat];

  const heat = new THREE.Color();
  g.userData.update = (view, t, dt) => {
    const v = view.visual?.[id];
    if (!v) return;
    const lvl = Math.max(v.level, 0.002) * hgt;
    liquid.scale.y = lvl;
    liquid.position.y = y0 + lvl / 2;
    liquidColor(v.xA, liqMat.color);
    // Reactor shell glows when hot
    if (v.T > 88) {
      heatColor(v.T, 88, 130, heat);
      headMat.emissive.copy(heat);
      headMat.emissiveIntensity = 0.9;
    }
    const m = view.motors?.['M-101'];
    if (m) {
      impeller.rotation.y += (m.speed ?? 0) * dt * 6;
      motorMat.color.copy(m.status === 'TRIPPED' ? COLORS.tripped : m.speed > 0.5 ? COLORS.running : COLORS.stopped);
    }
    // Jacket colour follows the jacket temperature
    const tj = view.points?.['TIC-105'];
    if (Number.isFinite(tj)) jacketMat.color.setHSL(0.45 - Math.min(Math.max((tj - 30) / 80, 0), 1) * 0.45, 0.45, 0.45);
  };
  return g;
}

export function buildColumn(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const r = cfg.radius;
  const hgt = cfg.height;
  const y0 = cfg.skirt;

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, y0, 32), steelMaterial(COLORS.darkSteel));
  skirt.position.y = y0 / 2;
  g.add(skirt);
  const shellMat = shellMaterial();
  shellMat.opacity = 0.18;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 32, 1, true), shellMat);
  shell.position.y = y0 + hgt / 2;
  g.add(shell);
  const headMat = steelMaterial(0xa9b4bf);
  const top = ellipsoidHead(r, r / 2, true, headMat);
  top.position.y = y0 + hgt;
  g.add(top);

  // Trays – coloured by a temperature gradient from top to bottom.
  const trayMats = [];
  const nTrays = 24;
  for (let i = 0; i < nTrays; i += 1) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b98a6, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.7 });
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.04, 28), mat);
    tray.position.y = y0 + 2.2 + (i * (hgt - 3.2)) / (nTrays - 1);
    g.add(tray);
    trayMats.push(mat);
  }
  // Sump liquid
  const liqMat = liquidMaterial();
  const sumpHeight = 2.0;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 1, 32), liqMat);
  g.add(liquid);
  // Platforms and ladder
  for (const py of [y0 + 6, y0 + 12, y0 + hgt - 0.3]) g.add(platform(r + 0.1, r + 0.9, py));
  g.add(ladder(r + 0.85, 0, y0 + hgt - 0.3, -Math.PI / 2));
  // Insulation bands
  for (let yy = y0; yy <= y0 + hgt; yy += 1.5) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.005, 0.02, 6, 40), steelMaterial(0x8794a1));
    band.rotation.x = Math.PI / 2;
    band.position.y = yy;
    g.add(band);
  }

  mark(g, { kind: 'equipment', id });
  g.userData.highlight = [headMat, shellMat];
  const tmp = new THREE.Color();
  g.userData.update = (view) => {
    const v = view.visual?.[id];
    if (!v) return;
    const lvl = Math.max(v.level, 0.002) * sumpHeight;
    liquid.scale.y = lvl;
    liquid.position.y = y0 + lvl / 2;
    liquidColor(v.xA, liqMat.color);
    const tTop = view.points?.['TI-113'] ?? 90;
    const tBot = view.points?.['TIC-112'] ?? 150;
    for (let i = 0; i < trayMats.length; i += 1) {
      const T = tBot + ((tTop - tBot) * i) / (trayMats.length - 1);
      const k = Math.min(Math.max((T - 60) / 120, 0), 1);
      trayMats[i].color.copy(tmp.setHSL(0.6 - 0.6 * k, 0.55, 0.5));
    }
  };
  return g;
}

export function buildDrum(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const r = cfg.radius;
  const L = cfg.length;
  const shellMat = shellMaterial();
  shellMat.opacity = 0.25;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 32, 1, true), shellMat);
  shell.rotation.z = Math.PI / 2;
  g.add(shell);
  const headMat = steelMaterial(0xa9b4bf, { transparent: true, opacity: 0.6 });
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), headMat);
    head.scale.y = 0.5;
    head.rotation.z = (-s * Math.PI) / 2;
    head.position.x = (s * L) / 2;
    g.add(head);
  }
  // Liquid: a horizontal cylinder clipped at the liquid level.
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const liqMat = liquidMaterial();
  liqMat.clippingPlanes = [clip];
  liqMat.side = THREE.DoubleSide;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, L * 0.99, 32), liqMat);
  liquid.rotation.z = Math.PI / 2;
  g.add(liquid);
  for (const s of [-1, 1]) {
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, r * 1.6), steelMaterial(COLORS.darkSteel));
    saddle.position.set(s * L * 0.3, -r - 0.1, 0);
    g.add(saddle);
  }
  mark(g, { kind: 'equipment', id });
  g.userData.highlight = [headMat, shellMat];
  const world = new THREE.Vector3();
  g.userData.update = (view) => {
    const v = view.visual?.[id];
    if (!v) return;
    g.getWorldPosition(world);
    // Plane: keep points with y < level → normal (0,-1,0), constant = surface y
    const levelY = world.y - r * 0.95 + 2 * r * 0.95 * Math.min(Math.max(v.level, 0), 1);
    clip.constant = levelY;
    liquidColor(v.xA, liqMat.color);
  };
  return g;
}

export function buildExchanger(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const r = cfg.radius;
  const L = cfg.length;
  const inner = new THREE.Group();
  const shellMat = steelMaterial(cfg.service === 'steam' ? 0xb7a199 : 0x9db5ad);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 28), shellMat);
  shell.rotation.z = Math.PI / 2;
  inner.add(shell);
  const chMat = steelMaterial(0x8a96a3);
  for (const s of [-1, 1]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.3, 28), chMat);
    ch.rotation.z = Math.PI / 2;
    ch.position.x = s * (L / 2 + 0.15);
    inner.add(ch);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), chMat);
    cap.scale.y = 0.35;
    cap.rotation.z = (-s * Math.PI) / 2;
    cap.position.x = s * (L / 2 + 0.3);
    inner.add(cap);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.2, cfg.pos[1] - r + 0.1, r * 1.8), steelMaterial(COLORS.darkSteel));
    saddle.position.set(s * L * 0.3, -(cfg.pos[1] - r + 0.1) / 2 - r + 0.1, 0);
    inner.add(saddle);
  }
  if (cfg.axis === 'z') inner.rotation.y = Math.PI / 2;
  g.add(inner);
  mark(g, { kind: 'equipment', id });
  g.userData.highlight = [shellMat];
  g.userData.update = () => {};
  return g;
}

// ------------------------------------------------------------- rotating eqpt
export function buildPump(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.15, 0.7), steelMaterial(COLORS.darkSteel));
  base.position.set(0.1, 0.075, 0);
  g.add(base);
  const casingMat = steelMaterial(0x5c7a99);
  const volute = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 24), casingMat);
  volute.rotation.z = Math.PI / 2;
  volute.position.set(-0.35, 0.5, 0);
  g.add(volute);
  const suction = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 12), casingMat);
  suction.rotation.z = Math.PI / 2;
  suction.position.set(-0.62, 0.45, 0);
  g.add(suction);
  const discharge = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.25, 12), casingMat);
  discharge.position.set(-0.35, 0.82, 0);
  g.add(discharge);
  const motorMat = steelMaterial(COLORS.stopped.getHex());
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.75, 24), motorMat);
  motor.rotation.z = Math.PI / 2;
  motor.position.set(0.45, 0.45, 0);
  g.add(motor);
  // Cooling fan cowl with a visible rotating fan
  const fan = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.07), steelMaterial(0xe8edf2));
    blade.rotation.x = (i * Math.PI) / 4;
    fan.add(blade);
  }
  fan.position.set(0.86, 0.45, 0);
  g.add(fan);
  const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12), steelMaterial(0xe0a03a));
  coupling.rotation.z = Math.PI / 2;
  coupling.position.set(-0.08, 0.45, 0);
  g.add(coupling);
  mark(g, { kind: 'motor', id });
  g.userData.highlight = [casingMat, motorMat];
  g.userData.update = (view, t, dt) => {
    const m = view.motors?.[id];
    if (!m) return;
    fan.rotation.x += (m.speed ?? 0) * dt * 25;
    if (m.status === 'TRIPPED') {
      motorMat.color.copy(COLORS.tripped);
      motorMat.emissive.copy(COLORS.tripped);
      motorMat.emissiveIntensity = Math.sin(t * 6) > 0 ? 0.6 : 0;
    } else {
      motorMat.color.copy(m.speed > 0.5 ? COLORS.running : COLORS.stopped);
    }
  };
  return g;
}

// ------------------------------------------------------------------- valves
export function buildValve(id, cfg) {
  const g = new THREE.Group();
  g.position.set(...cfg.pos);
  const bodyMat = steelMaterial(COLORS.valveClosed.getHex());
  const body = new THREE.Group();
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 16), bodyMat);
    cone.rotation.z = (s * Math.PI) / 2;
    cone.position.x = s * 0.16;
    body.add(cone);
  }
  const flangeMat = steelMaterial(0x8a96a3);
  for (const s of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16), flangeMat);
    fl.rotation.z = Math.PI / 2;
    fl.position.x = s * 0.33;
    body.add(fl);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), steelMaterial(0xcfd6dd));
  stem.position.y = 0.2;
  body.add(stem);
  const actMat = steelMaterial(0x6d8fb3);
  const actuator = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), actMat);
  actuator.scale.y = 0.6;
  actuator.position.y = 0.38;
  body.add(actuator);
  const diaphragm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20), actMat);
  diaphragm.position.y = 0.38;
  body.add(diaphragm);
  // Position indicator flag on the stem
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xffd60a }));
  flag.position.set(0.08, 0.1, 0);
  body.add(flag);
  if (cfg.axis === 'z') body.rotation.y = Math.PI / 2;
  if (cfg.axis === 'y') {
    body.rotation.z = Math.PI / 2;
  }
  g.add(body);
  mark(g, { kind: 'valve', id });
  g.userData.highlight = [bodyMat, actMat];
  g.userData.update = (view, t) => {
    const v = view.valves?.[id];
    if (!v) return;
    const f = Math.min(Math.max(v.pos / 100, 0), 1);
    bodyMat.color.copy(COLORS.valveClosed).lerp(COLORS.valveOpen, f);
    flag.position.y = 0.06 + 0.18 * f;
    if (v.forced !== undefined) {
      actMat.color.copy(COLORS.forced);
    } else if (v.stuck) {
      actMat.color.setHex(0xff9f1a);
      actMat.emissive.setHex(0xff9f1a);
      actMat.emissiveIntensity = Math.sin(t * 5) > 0 ? 0.5 : 0;
    } else {
      actMat.color.setHex(0x6d8fb3);
    }
  };
  return g;
}

// --------------------------------------------------------------------- pipes
let flowTexture = null;
function getFlowTexture() {
  if (flowTexture) return flowTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b8bec4';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = '#ffffff';
  // chevron pointing in +u
  ctx.beginPath();
  ctx.moveTo(40, 0);
  ctx.lineTo(70, 8);
  ctx.lineTo(40, 16);
  ctx.lineTo(52, 16);
  ctx.lineTo(82, 8);
  ctx.lineTo(52, 0);
  ctx.closePath();
  ctx.fill();
  flowTexture = new THREE.CanvasTexture(c);
  flowTexture.wrapS = THREE.RepeatWrapping;
  flowTexture.wrapT = THREE.RepeatWrapping;
  flowTexture.colorSpace = THREE.SRGBColorSpace;
  return flowTexture;
}

/** Polyline path with rounded bends. */
function pipeCurve(points, bend = 0.35) {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath();
  let start = pts[0].clone();
  for (let i = 1; i < pts.length; i += 1) {
    const cur = pts[i];
    if (i === pts.length - 1) {
      path.add(new THREE.LineCurve3(start, cur.clone()));
      break;
    }
    const next = pts[i + 1];
    const inDir = cur.clone().sub(pts[i - 1]);
    const outDir = next.clone().sub(cur);
    const rr = Math.min(bend, inDir.length() / 2, outDir.length() / 2);
    const a = cur.clone().sub(inDir.normalize().multiplyScalar(rr));
    const b = cur.clone().add(outDir.normalize().multiplyScalar(rr));
    if (a.distanceTo(start) > 1e-4) path.add(new THREE.LineCurve3(start, a));
    path.add(new THREE.QuadraticBezierCurve3(a, cur.clone(), b));
    start = b;
  }
  return path;
}

export function buildPipe(cfg) {
  const curve = pipeCurve(cfg.path);
  const length = curve.getLength();
  const segments = Math.max(8, Math.ceil(length * 3) + cfg.path.length * 8);
  const radius = cfg.radius ?? (cfg.service === 'cw' || cfg.service === 'cwr' || cfg.service === 'steam' ? 0.08 : 0.1);
  const geo = new THREE.TubeGeometry(curve, segments, radius, 10, false);
  const tex = getFlowTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(length / 1.2, 1);
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.pipe[cfg.service] ?? COLORS.pipe.process, map: tex, metalness: 0.35, roughness: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pick = { kind: 'pipe', id: cfg.id };
  const flows = Array.isArray(cfg.flow) ? cfg.flow : cfg.flow ? [cfg.flow] : [];
  mesh.userData.update = (view, t, dt) => {
    let f = 0;
    for (const k of flows) f += view.flows?.[k] ?? 0;
    const speed = Math.min(Math.max(f / (cfg.max || 1), 0), 1.5);
    tex.offset.x -= speed * dt * 1.6;
  };
  // Flanged ends
  const group = new THREE.Group();
  group.add(mesh);
  for (const end of [cfg.path[0], cfg.path.at(-1)]) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.35, 10, 8), steelMaterial(0x7d8894));
    fl.position.set(...end);
    group.add(fl);
  }
  group.userData.update = mesh.userData.update;
  return group;
}

// ---------------------------------------------------------------- structure
export function platform(innerR, outerR, y) {
  const g = new THREE.Group();
  const grating = new THREE.Mesh(new THREE.RingGeometry(innerR, outerR, 40, 1, 0, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0x55606b, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.7 }));
  grating.rotation.x = -Math.PI / 2;
  grating.position.y = y;
  g.add(grating);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(outerR, 0.025, 6, 48, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0xd9a400, metalness: 0.3, roughness: 0.6 }));
  rail.rotation.x = Math.PI / 2;
  rail.position.y = y + 1.0;
  g.add(rail);
  return g;
}

export function ladder(dist, y0, y1, angle) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9a400, metalness: 0.3, roughness: 0.6 });
  for (const s of [-0.22, 0.22]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, y1 - y0, 6), mat);
    rail.position.set(dist, (y0 + y1) / 2, s);
    g.add(rail);
  }
  const rungGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.44, 5);
  const n = Math.floor((y1 - y0) / 0.3);
  const rungs = new THREE.InstancedMesh(rungGeo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  for (let i = 0; i < n; i += 1) {
    m.compose(new THREE.Vector3(dist, y0 + 0.3 * (i + 0.5), 0), q, new THREE.Vector3(1, 1, 1));
    rungs.setMatrixAt(i, m);
  }
  g.add(rungs);
  g.rotation.y = angle;
  return g;
}

export function buildPipeRack(rack) {
  const g = new THREE.Group();
  const mat = steelMaterial(COLORS.structure, { metalness: 0.3, roughness: 0.7 });
  const top = Math.max(...rack.beams);
  for (const x of rack.xs) {
    for (const z of rack.z) g.add(cylinderBetween([x, 0, z], [x, top + 0.1, z], 0.12, mat, 6));
    for (const y of rack.beams) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, Math.abs(rack.z[1] - rack.z[0]) + 0.4), mat);
      beam.position.set(x, y, (rack.z[0] + rack.z[1]) / 2);
      g.add(beam);
    }
  }
  for (const y of rack.beams) {
    for (const z of rack.z) {
      const x0 = rack.xs[0];
      const x1 = rack.xs.at(-1);
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.18, 0.18), mat);
      stringer.position.set((x0 + x1) / 2, y + 0.2, z);
      g.add(stringer);
    }
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export function buildStructure(s) {
  const g = new THREE.Group();
  const mat = steelMaterial(COLORS.structure, { metalness: 0.3, roughness: 0.7 });
  const top = Math.max(...s.floors);
  for (const x of s.x) for (const z of s.z) g.add(cylinderBetween([x, 0, z], [x, top, z], 0.13, mat, 6));
  for (const y of s.floors) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(s.x[1] - s.x[0] + 0.4, 0.08, s.z[1] - s.z[0] + 0.4), new THREE.MeshStandardMaterial({ color: 0x55606b, metalness: 0.4, roughness: 0.75, transparent: true, opacity: 0.75 }));
    floor.position.set((s.x[0] + s.x[1]) / 2, y - 0.75, (s.z[0] + s.z[1]) / 2);
    g.add(floor);
    for (const z of s.z) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(s.x[1] - s.x[0], 0.2, 0.15), mat);
      b.position.set((s.x[0] + s.x[1]) / 2, y - 0.75, z);
      g.add(b);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(s.x[1] - s.x[0], 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9a400 }));
      rail.position.set((s.x[0] + s.x[1]) / 2, y + 0.3, z);
      g.add(rail);
    }
  }
  // Diagonal bracing
  g.add(cylinderBetween([s.x[0], 0, s.z[0]], [s.x[1], s.floors[0] - 0.75, s.z[0]], 0.06, mat, 5));
  g.add(cylinderBetween([s.x[1], 0, s.z[1]], [s.x[0], s.floors[0] - 0.75, s.z[1]], 0.06, mat, 5));
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export function buildGround() {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 90), new THREE.MeshStandardMaterial({ color: COLORS.concrete, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  // Paved roads framing the unit
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 1 });
  for (const [cx, cz, w, d] of [[-6, 9, 84, 4], [-6, -14, 84, 4], [-46, -2.5, 4, 27], [34, -2.5, 4, 27]]) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(cx, 0.01, cz);
    road.receiveShadow = true;
    g.add(road);
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a7a3a });
  for (const cz of [9, -14]) {
    for (let x = -46; x < 34; x += 4) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.12), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x + 1, 0.02, cz);
      g.add(dash);
    }
  }
  // Bund walls around the tanks
  const bundMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.9 });
  const bund = (cx, cz, w, d) => {
    for (const [dx, dz, sx, sz] of [[0, -d / 2, w, 0.2], [0, d / 2, w, 0.2], [-w / 2, 0, 0.2, d], [w / 2, 0, 0.2, d]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.6, sz), bundMat);
      wall.position.set(cx + dx, 0.3, cz + dz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);
    }
  };
  bund(-34, -4, 6, 6);
  bund(17, 1, 7, 7);
  // Process area slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(40, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.9 }));
  slab.position.set(-4, 0.05, -2.5);
  slab.receiveShadow = true;
  g.add(slab);
  return g;
}
