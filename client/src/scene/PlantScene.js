/**
 * 3D plant view: renderer, camera navigation, picking, live animation, alarm
 * highlighting and floating data cards.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  buildTank, buildReactor, buildColumn, buildDrum, buildExchanger, buildPump, buildValve, buildPipe,
  buildPipeRack, buildStructure, buildGround,
} from './builders.js';
import { EQUIPMENT_LAYOUT, PIPES, VALVE_LAYOUT, CARDS, RACK, STRUCTURE, CAMERA_VIEWS } from './layout.js';
import { store } from '../store.js';
import { fmt } from '../ui/dom.js';

const BUILDERS = {
  tank: buildTank,
  reactor: buildReactor,
  column: buildColumn,
  drum: buildDrum,
  exchanger: buildExchanger,
  pump: buildPump,
};

const PRIORITY_COLORS = {
  CRITICAL: new THREE.Color(0xff2d2d),
  HIGH: new THREE.Color(0xff8c1a),
  MEDIUM: new THREE.Color(0xffd60a),
  LOW: new THREE.Color(0x39c5ff),
};
const SELECT_COLOR = new THREE.Color(0x4ea1ff);
const HOVER_COLOR = new THREE.Color(0x9fb3c8);
const BLACK = new THREE.Color(0x000000);

export class PlantScene {
  constructor(container) {
    this.container = container;
    this.objects = new Map(); // id → group
    this.updatables = [];
    this.pickables = [];
    this.cards = [];
    this.nameLabels = [];
    this.labelMode = 'values';
    this.hovered = null;
    this.alarmMap = new Map(); // object id → {priority, unack}
    this.view = { points: {}, motors: {}, valves: {}, flows: {}, visual: {} };
    this.flight = null;
    this.timer = new THREE.Timer();
    this.timer.connect?.(document);

    this.initRenderer();
    this.buildPlant();
    this.bindEvents();
    this.flyTo('overview', true);
    this.renderer.setAnimationLoop(() => this.frame());

    store.on('state', (s) => this.onState(s));
    store.on('select', (sel) => this.onSelect(sel));
  }

  // ---------------------------------------------------------------- setup
  initRenderer() {
    const { container } = this;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(renderer.domElement);
    this.renderer = renderer;

    const labels = new CSS2DRenderer();
    labels.domElement.className = 'label-layer';
    container.append(labels.domElement);
    this.labelRenderer = labels;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1216);
    scene.fog = new THREE.Fog(0x0e1216, 70, 160);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 3;
    controls.maxDistance = 140;
    controls.screenSpacePanning = true;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xc7d6e6, 0x1a1e23, 0.85));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.1);
    sun.position.set(-30, 50, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -55, right: 45, top: 40, bottom: -40, near: 1, far: 160 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.45);
    fill.position.set(30, 20, -30);
    scene.add(fill);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0x4ea1ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    this.selectionRing = ring;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  buildPlant() {
    const { scene } = this;
    scene.add(buildGround());
    scene.add(buildPipeRack(RACK));
    scene.add(buildStructure(STRUCTURE));

    for (const [id, cfg] of Object.entries(EQUIPMENT_LAYOUT)) {
      const builder = BUILDERS[cfg.type];
      if (!builder) continue;
      const obj = builder(id, cfg);
      obj.userData.id = id;
      this.register(id, obj);
      this.addNameLabel(id, obj, cfg, CARDS.some((c) => c.id === id));
    }
    // The agitator lives on the reactor model.
    this.objects.set('M-101', this.objects.get('R-101'));

    for (const [id, cfg] of Object.entries(VALVE_LAYOUT)) {
      const obj = buildValve(id, cfg);
      obj.userData.id = id;
      this.register(id, obj);
      const el = document.createElement('div');
      el.className = 'valve-label';
      el.innerHTML = `<span class="vl-tag"></span><span class="vl-pos"></span>`;
      el.querySelector('.vl-tag').textContent = id;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectPick({ kind: 'valve', id });
      });
      const label = new CSS2DObject(el);
      label.position.set(0, 0.85, 0);
      obj.add(label);
      this.nameLabels.push({ label, el, valve: id, kind: 'valve' });
    }

    for (const cfg of PIPES) {
      const pipe = buildPipe(cfg);
      scene.add(pipe);
      this.updatables.push(pipe);
    }

    for (const card of CARDS) this.addCard(card);
    this.applyLabelMode();
  }

  register(id, obj) {
    this.scene.add(obj);
    this.objects.set(id, obj);
    this.updatables.push(obj);
    obj.traverse((o) => {
      if (o.isMesh && o.userData.pick) this.pickables.push(o);
    });
  }

  addNameLabel(id, obj, cfg, hasCard = false) {
    const el = document.createElement('div');
    el.className = `eq-label ${cfg.type}`;
    el.textContent = id;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectPick({ kind: cfg.type === 'pump' ? 'motor' : 'equipment', id });
    });
    const label = new CSS2DObject(el);
    const box = new THREE.Box3().setFromObject(obj);
    const localTop = box.max.y - obj.position.y;
    label.position.set(0, cfg.type === 'pump' ? 1.4 : Math.min(localTop + 0.6, 3), 0);
    if (cfg.type === 'tank' || cfg.type === 'reactor' || cfg.type === 'column') label.position.y = 0.6;
    if (cfg.type === 'tank' || cfg.type === 'reactor' || cfg.type === 'column') label.position.z = (cfg.radius ?? 1) + 0.4;
    obj.add(label);
    this.nameLabels.push({ label, el, kind: 'name', hasCard });
  }

  addCard(card) {
    const el = document.createElement('div');
    el.className = 'card3d';
    const head = document.createElement('div');
    head.className = 'card3d-head';
    head.textContent = card.equipment ? `${card.equipment} ▸ bottom` : card.id;
    head.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectPick({ kind: 'equipment', id: card.equipment ?? card.id });
    });
    el.append(head);
    const rows = card.points.map((tag) => {
      const row = document.createElement('div');
      row.className = 'card3d-row';
      row.innerHTML = '<span class="c-tag"></span><span class="c-val"></span><span class="c-unit"></span>';
      row.querySelector('.c-tag').textContent = tag;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        store.select({ kind: 'point', id: tag });
      });
      el.append(row);
      return { tag, row, val: row.querySelector('.c-val'), unit: row.querySelector('.c-unit') };
    });
    const obj = new CSS2DObject(el);
    obj.position.set(...card.pos);
    this.scene.add(obj);
    this.cards.push({ obj, el, rows });
  }

  setLabelMode(mode) {
    this.labelMode = mode;
    this.applyLabelMode();
  }

  applyLabelMode() {
    const showCards = this.labelMode === 'values';
    const showNames = this.labelMode !== 'off';
    for (const c of this.cards) c.obj.visible = showCards;
    for (const n of this.nameLabels) n.label.visible = showNames && !(showCards && n.hasCard);
  }

  bindEvents() {
    const el = this.renderer.domElement;
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let down = null;
    const pick = (ev) => {
      const r = el.getBoundingClientRect();
      pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, this.camera);
      const hit = raycaster.intersectObjects(this.pickables, false).find((h) => h.object.userData.pick?.kind !== 'pipe');
      return hit?.object.userData.pick ?? null;
    };
    el.addEventListener('pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
      this.flight = null;
    });
    el.addEventListener('pointerup', (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const p = pick(ev);
      if (p) this.selectPick(p);
      else store.select(null);
    });
    el.addEventListener('dblclick', (ev) => {
      const p = pick(ev);
      if (p) this.focusOn(p.id);
    });
    let hoverPending = false;
    el.addEventListener('pointermove', (ev) => {
      if (hoverPending || down) return;
      hoverPending = true;
      requestAnimationFrame(() => {
        hoverPending = false;
        const p = pick(ev);
        this.hovered = p ? this.objectIdFor(p) : null;
        el.style.cursor = p ? 'pointer' : '';
      });
    });
    el.addEventListener('pointerleave', () => {
      this.hovered = null;
    });
  }

  /** Map a pick to the store selection. */
  selectPick(p) {
    if (p.kind === 'valve') {
      const loop = store.index.valveLoop.get(p.id);
      store.select(loop ? { kind: 'point', id: loop } : { kind: 'equipment', id: p.id });
    } else if (p.kind === 'motor') {
      store.select({ kind: 'motor', id: p.id });
    } else {
      store.select({ kind: 'equipment', id: p.id });
    }
  }

  objectIdFor(p) {
    return p.kind === 'motor' && p.id === 'M-101' ? 'R-101' : p.id;
  }

  /** Object id that represents a selection in the 3D model. */
  selectionObjectId(sel) {
    if (!sel) return null;
    if (sel.kind === 'point') {
      const loop = store.index.loops.get(sel.id);
      if (loop?.output?.valve && this.objects.has(loop.output.valve)) {
        // Show the loop's measured equipment for vessels, its valve for flows.
        const point = store.index.points.get(sel.id);
        if (point && this.objects.has(point.equipment) && !point.equipment.match(/^[A-Z]V-/)) return point.equipment;
        return loop.output.valve;
      }
      const point = store.index.points.get(sel.id);
      if (point?.equipment && this.objects.has(point.equipment)) return point.equipment;
      if (sel.id === 'HIC-115') return 'HV-115';
      if (sel.id === 'TIC-104' || sel.id === 'TIC-105') return 'R-101';
      return null;
    }
    if (sel.kind === 'motor' && sel.id === 'M-101') return 'R-101';
    return this.objects.has(sel.id) ? sel.id : null;
  }

  // ------------------------------------------------------------- camera
  flyTo(viewName, instant = false) {
    const v = CAMERA_VIEWS[viewName];
    if (!v) return;
    this.flyToPose(new THREE.Vector3(...v.position), new THREE.Vector3(...v.target), instant);
  }

  flyToPose(position, target, instant = false) {
    if (instant) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.flight = { fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), toP: position, toT: target, t: 0 };
  }

  focusOn(id) {
    const obj = this.objects.get(this.objectIdFor({ id, kind: id === 'M-101' ? 'motor' : 'equipment' })) ?? this.objects.get(id);
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(size * 1.6, 6);
    this.flyToPose(center.clone().add(dir.multiplyScalar(dist)), center);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const hgt = this.container.clientHeight || 1;
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.labelRenderer.setSize(w, hgt);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------- updates
  onState(state) {
    if (!state) return;
    const p104 = state.motors?.['P-104'];
    this.view = {
      ...state,
      flows: { ...state.flows, cwE102: (state.utilities?.cwAvail ?? 1) * 18 * (p104 && p104.speed > 0.5 ? 1 : 0.2) },
    };
    // Alarm map for 3D highlighting
    const map = new Map();
    for (const a of state.alarms ?? []) {
      if (a.state === 'SHELVED') continue;
      const eq = store.equipmentOf(a.tag);
      const id = eq === 'M-101' ? 'R-101' : eq;
      if (!id || !this.objects.has(id)) continue;
      const prev = map.get(id);
      const unack = a.state === 'UNACK' || a.state === 'RTN_UNACK';
      if (!prev || PRIORITY_RANK[a.priority] < PRIORITY_RANK[prev.priority]) map.set(id, { priority: a.priority, unack: unack || prev?.unack });
      else if (unack) prev.unack = true;
    }
    this.alarmMap = map;
    this.updateCards(state);
  }

  updateCards(state) {
    const alarmsByTag = new Map();
    for (const a of state.alarms ?? []) {
      if (a.state === 'SHELVED' || a.state === 'RTN_UNACK') continue;
      const prev = alarmsByTag.get(a.tag);
      if (!prev || PRIORITY_RANK[a.priority] < PRIORITY_RANK[prev]) alarmsByTag.set(a.tag, a.priority);
    }
    const bad = new Set(state.bad ?? []);
    for (const card of this.cards) {
      for (const r of card.rows) {
        const meta = store.index.points.get(r.tag);
        const v = state.points?.[r.tag];
        const text = bad.has(r.tag) ? 'BAD' : fmt(v, meta?.decimals ?? 1);
        if (r.val.textContent !== text) r.val.textContent = text;
        if (r.unit.textContent !== (meta?.units ?? '')) r.unit.textContent = meta?.units ?? '';
        const pr = alarmsByTag.get(r.tag);
        r.row.dataset.alarm = pr ?? (bad.has(r.tag) ? 'HIGH' : '');
        const loop = state.loops?.[r.tag];
        r.row.dataset.mode = loop ? loop.mode : '';
      }
    }
    for (const n of this.nameLabels) {
      if (n.kind !== 'valve') continue;
      const v = state.valves?.[n.valve];
      if (!v) continue;
      const pos = n.el.querySelector('.vl-pos');
      const txt = `${fmt(v.pos, 0)}%`;
      if (pos.textContent !== txt) pos.textContent = txt;
      n.el.classList.toggle('forced', v.forced !== undefined);
      n.el.classList.toggle('stuck', !!v.stuck);
    }
  }

  onSelect(sel) {
    const id = this.selectionObjectId(sel);
    this.selectedId = id;
    const obj = id ? this.objects.get(id) : null;
    if (!obj) {
      this.selectionRing.visible = false;
      return;
    }
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.min(Math.max(Math.hypot(size.x, size.z) * 0.6, 0.8), 4);
    this.selectionRing.scale.set(r, r, r);
    this.selectionRing.position.set(center.x, 0.06, center.z);
    this.selectionRing.visible = true;
  }

  applyHighlights(t) {
    const flash = Math.sin(t * 7) > 0;
    for (const [id, obj] of this.objects) {
      if (id === 'M-101') continue;
      const mats = obj.userData.highlight;
      if (!mats) continue;
      const alarm = this.alarmMap.get(id);
      let color = BLACK;
      let intensity = 0;
      if (alarm && (!alarm.unack || flash)) {
        color = PRIORITY_COLORS[alarm.priority] ?? PRIORITY_COLORS.HIGH;
        intensity = alarm.unack ? 0.85 : 0.45;
      } else if (id === this.selectedId) {
        color = SELECT_COLOR;
        intensity = 0.45;
      } else if (id === this.hovered) {
        color = HOVER_COLOR;
        intensity = 0.25;
      }
      for (const m of mats) {
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
    }
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(f.t + dt / 1.1, 1);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(f.fromP, f.toP, k);
      this.controls.target.lerpVectors(f.fromT, f.toT, k);
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update();
    this.applyHighlights(t);
    for (const u of this.updatables) u.userData.update?.(this.view, t, dt);
    if (this.selectionRing.visible) {
      this.selectionRing.material.opacity = 0.55 + 0.35 * Math.sin(t * 3);
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.timer.dispose?.();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}

const PRIORITY_RANK = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
