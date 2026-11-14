// Weapons: the buy-menu catalogue and one hitscan weapon at a time. A weapon owns
// its numbers and its view model; main.js owns the ray and the damage. Spread grows
// with movement speed and with sprinting, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidewinder: {
    id: 'sidewinder', name: 'P9 SIDEWINDER', kind: 'Pistol', price: 0,
    damage: 34, headMult: 2.5, mag: 12, reserve: 48, gap: 0.22, auto: false,
    reload: 1.1, spreadStill: 0.0035, spreadMove: 0.02, kick: 0.011, tracer: 0xffd27a,
    blurb: 'Reliable sidearm. Free, always in your holster.',
  },
  raptor: {
    id: 'raptor', name: 'RAPTOR-12', kind: 'SMG', price: 1200,
    damage: 26, headMult: 2.5, mag: 28, reserve: 112, gap: 0.085, auto: true,
    reload: 1.6, spreadStill: 0.006, spreadMove: 0.03, kick: 0.008, tracer: 0xffc46a,
    blurb: 'Fast hose. Shreds up close, drifts at range.',
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT-7', kind: 'Rifle', price: 2500,
    damage: 38, headMult: 2.5, mag: 30, reserve: 90, gap: 0.105, auto: true,
    reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.013, tracer: 0xffe9a8,
    blurb: 'The yard rifle. Accurate, steady, honest.',
  },
  deadeye: {
    id: 'deadeye', name: 'DEADEYE-50', kind: 'Sniper', price: 4000,
    damage: 88, headMult: 2.5, mag: 5, reserve: 20, gap: 1.15, auto: false,
    reload: 2.6, spreadStill: 0.0006, spreadMove: 0.05, kick: 0.032, tracer: 0xfff6d8,
    blurb: 'One shot, one lesson. Punishes a moving shooter.',
  },
};

export const GRENADE = {
  id: 'spark9', name: 'SPARK-9 FLASH', price: 200,
  blurb: 'Blinds anyone facing it within 12 m for a few seconds.',
};

const MOVE_REFERENCE = 5.2;

export function createWeapon(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });

  const model = new THREE.Group();
  let def = WEAPONS.sidewinder;

  function rebuildModel() {
    while (model.children.length) model.remove(model.children[0]);
    const long = def.id === 'deadeye' ? 0.62 : def.id === 'longshot' ? 0.48 : def.id === 'raptor' ? 0.36 : 0.22;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, long), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, long * 0.9), gripMat);
    barrel.position.set(0, 0.025, -long * 0.85);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), gripMat);
    stock.position.set(0, -0.02, long / 2 + 0.06);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accentMat);
    sight.position.set(0, 0.075, -long * 0.4);
    model.add(receiver, barrel, stock, sight);
    model.scale.setScalar(0.8);
    model.position.set(0.27, -0.24, -0.52);
    model.rotation.set(0, -0.2, 0.05);
  }
  rebuildModel();
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(0.09, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.27, -0.2, -1.0);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 3);
  flashLight.position.set(0.27, -0.18, -0.7);
  camera.add(flashLight);

  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.52 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 7 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
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
    get def() { return def; },
    step,
    equip(nextDef, keepAmmo = false) {
      def = nextDef;
      rebuildModel();
      if (!keepAmmo) {
        state.mag = def.mag;
        state.reserve = def.reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    spread(speed, sprinting) {
      const move = Math.min(1, speed / MOVE_REFERENCE) * def.spreadMove;
      return def.spreadStill + move + (sprinting ? 0.02 : 0);
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
