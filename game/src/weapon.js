// Weapons: one table, one view-model builder, one state machine.
// Spread grows with movement speed and with each shot fired (bloom), and
// shrinks when crouched or standing still — stopping to aim pays.
// Grenades are a separate throw (G): an arcing projectile handled by main.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// name, price, mag, reserve, damage (torso), head multiplier, fire gap (s),
// reload (s), auto?, spread still, spread moving, kick, view-model kind.
export const WEAPONS = {
  p9: { name: 'P9 sidearm', price: 0, mag: 12, reserve: 36, damage: 26, headMul: 2.5, gap: 0.16, reload: 1.3, auto: false, spreadStill: 0.004, spreadMove: 0.03, kick: 0.006, kind: 'pistol', model: 'pistol' },
  rook: { name: 'Rook SMG', price: 1500, mag: 28, reserve: 84, damage: 22, headMul: 2.2, gap: 0.075, reload: 1.7, auto: true, spreadStill: 0.006, spreadMove: 0.034, kick: 0.005, kind: 'smg', model: 'smg' },
  vk7: { name: 'VK-7 carbine', price: 2700, mag: 30, reserve: 90, damage: 34, headMul: 2.6, gap: 0.096, reload: 1.9, auto: true, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, kind: 'rifle', model: 'rifle' },
  longbow: { name: 'Longbow DMR', price: 4500, mag: 8, reserve: 24, damage: 78, headMul: 2.0, gap: 0.85, reload: 2.6, auto: false, spreadStill: 0.0008, spreadMove: 0.05, kick: 0.02, kind: 'dmr', model: 'dmr' },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const WEAPON_ORDER = ['p9', 'rook', 'vk7', 'longbow'];

export function createWeapon(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1e2428, roughness: 0.7, metalness: 0.3 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.45, metalness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2122, roughness: 0.6, metalness: 0.4 });
  const amberMat = new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.5, metalness: 0.2 });

  let model = new THREE.Group();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: 0xffc45e, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  const flashLight = new THREE.PointLight(0xffc45e, 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flash, flashLight);

  function box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    model.add(m);
    return m;
  }

  function buildModel(kind) {
    camera.remove(model);
    model = new THREE.Group();
    if (kind === 'pistol') {
      box(0.06, 0.09, 0.22, 0, 0, -0.1, bodyMat);
      box(0.05, 0.12, 0.06, 0, -0.08, 0.02, gripMat);
      box(0.02, 0.02, 0.06, 0, 0.055, -0.18, amberMat);
    } else if (kind === 'smg') {
      box(0.08, 0.09, 0.34, 0, 0, -0.08, bodyMat);
      box(0.05, 0.05, 0.3, 0, 0.02, -0.3, gripMat);
      box(0.06, 0.14, 0.07, 0, -0.09, 0.04, gripMat);
      box(0.04, 0.04, 0.12, 0, -0.06, -0.16, darkMat);
    } else if (kind === 'dmr') {
      box(0.08, 0.1, 0.5, 0, 0, -0.12, darkMat);
      box(0.04, 0.04, 0.55, 0, 0.03, -0.42, gripMat);
      box(0.05, 0.06, 0.14, 0, 0.08, -0.1, bodyMat); // scope
      box(0.07, 0.09, 0.2, 0, -0.02, 0.24, gripMat);
      box(0.05, 0.12, 0.06, 0, -0.09, 0.05, gripMat);
    } else {
      box(0.09, 0.1, 0.42, 0, 0, -0.08, bodyMat);
      box(0.045, 0.045, 0.4, 0, 0.025, -0.42, gripMat);
      box(0.075, 0.08, 0.22, 0, -0.02, 0.24, gripMat);
      box(0.05, 0.05, 0.1, 0, 0.075, -0.12, amberMat); // sight
    }
    model.position.set(0.2, -0.26, -0.55);
    model.scale.setScalar(0.6);
    camera.add(model);
  }

  const state = {
    id: 'vk7', mag: 30, reserve: 90, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, bloom: 0, grenades: 0,
  };

  function equip(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    state.id = id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.bloom = 0;
    buildModel(def.model);
    return true;
  }
  buildModel('rifle');

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.045);
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.id];
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    def() { return WEAPONS[state.id]; },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.id].gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.03, state.bloom + 0.004);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    // Spread: base by stance/speed + bloom from sustained fire. Crouch halves it.
    spread(speed, crouching) {
      const def = WEAPONS[state.id];
      const move = Math.min(1, speed / 5.4);
      let s = def.spreadStill + move * def.spreadMove + state.bloom;
      if (crouching) s *= 0.55;
      return s;
    },
    refillAmmo() {
      const def = WEAPONS[state.id];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.bloom = 0;
    },
  };
}
