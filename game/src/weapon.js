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
    bars: { power: 34, range: 30, rate: 45 },
  },
  raptor: {
    id: 'raptor', name: 'RAPTOR-12', kind: 'SMG', price: 1200,
    damage: 26, headMult: 2.5, mag: 28, reserve: 112, gap: 0.085, auto: true,
    reload: 1.6, spreadStill: 0.006, spreadMove: 0.03, kick: 0.008, tracer: 0xffc46a,
    blurb: 'Fast hose. Shreds up close, drifts at range.',
    bars: { power: 26, range: 35, rate: 95 },
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT-7', kind: 'Rifle', price: 2500,
    damage: 38, headMult: 2.5, mag: 30, reserve: 90, gap: 0.105, auto: true,
    reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.013, tracer: 0xffe9a8,
    blurb: 'The yard rifle. Accurate, steady, honest.',
    bars: { power: 55, range: 80, rate: 60 },
  },
  deadeye: {
    id: 'deadeye', name: 'DEADEYE-50', kind: 'Sniper', price: 4000,
    damage: 88, headMult: 2.5, mag: 5, reserve: 20, gap: 1.15, auto: false,
    reload: 2.6, spreadStill: 0.0006, spreadMove: 0.05, kick: 0.032, tracer: 0xfff6d8,
    blurb: 'One shot, one lesson. Punishes a moving shooter.',
    bars: { power: 100, range: 100, rate: 12 },
  },
};

export const GRENADE = {
  id: 'spark9', name: 'SPARK-9 FLASH', price: 200,
  blurb: 'Blinds anyone facing it within 12 m for a few seconds.',
};

// Second grenade type: a smoke screen. It hangs in the air for 12 s and
// blocks bot line of sight (and the player's own shots), so a plant or a
// retake can be covered instead of rushed.
export const SMOKE = {
  id: 'smoke4', name: 'SMOKE-4 SCREEN', price: 300,
  blurb: 'Thick grey smoke for 12 s. Blocks sight — both ways. Press Q to throw.',
};

const MOVE_REFERENCE = 5.2;

export function createWeapon(camera) {
  // Gunmetal view model, not v1's near-white receiver: under the warm dusk
  // light the old ink-coloured slab rendered as a yellow plank. Dark steel
  // with amber only on the sights and muzzle brake reads as a firearm.
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1c1e20), roughness: 0.75, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2b2e33), roughness: 0.45, metalness: 0.55 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });

  const model = new THREE.Group();
  let def = WEAPONS.sidewinder;

  // Canvas starburst muzzle flash: a hot core, four spikes and a soft halo —
  // a textured sprite, never the plain disc v1 used. Rolled a random amount
  // on every shot so no two flashes look alike.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 128; flashCanvas.height = 128;
  {
    const ctx = flashCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255,246,214,1)');
    grad.addColorStop(0.25, 'rgba(255,200,90,0.95)');
    grad.addColorStop(0.6, 'rgba(255,120,30,0.55)');
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,230,160,0.95)';
    for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      ctx.save();
      ctx.translate(64, 64);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(58, 0); ctx.lineTo(0, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath(); ctx.arc(64, 64, 12, 0, Math.PI * 2); ctx.fill();
  }
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  flashTexture.colorSpace = THREE.SRGBColorSpace;
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.235, -0.72);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 2);
  flashLight.position.set(0.25, -0.22, -0.85);
  camera.add(flashLight);

  // Slimmer than v1 (the old slab read as a yellow box, not a gun): a thin
  // receiver, a separate barrel, an angled grip, a magazine, and real iron
  // sights — a front post and a rear ring — so the silhouette reads as a
  // firearm even at a glance.
  function rebuildModel() {
    while (model.children.length) model.remove(model.children[0]);
    const long = def.id === 'deadeye' ? 0.62 : def.id === 'longshot' ? 0.48 : def.id === 'raptor' ? 0.36 : 0.22;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, long), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, long * 0.9), gripMat);
    barrel.position.set(0, 0.018, -long * 0.85);
    const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.05), accentMat);
    muzzleBrake.position.set(0, 0.018, -long * 1.28);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.16), gripMat);
    stock.position.set(0, -0.015, long / 2 + 0.05);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.05), gripMat);
    grip.position.set(0, -0.085, long / 2 - 0.04);
    grip.rotation.x = 0.35;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.06), gripMat);
    mag.position.set(0, -0.08, -long * 0.15);
    mag.rotation.x = -0.12;
    // Iron sights: a front post and a rear ring the eye lines up through.
    const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.008), accentMat);
    frontPost.position.set(0, 0.06, -long * 0.95);
    const rearRing = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16), accentMat);
    rearRing.position.set(0, 0.055, long * 0.28);
    const rearBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.03), bodyMat);
    rearBase.position.set(0, 0.04, long * 0.28);
    model.add(receiver, barrel, muzzleBrake, stock, grip, mag, frontPost, rearRing, rearBase);
    model.scale.setScalar(0.5);
    model.position.set(0.25, -0.27, -0.55);
    model.rotation.set(0, -0.2, 0.05);
    // Flash sits just past the muzzle brake (local -long*1.28, scaled).
    flash.position.set(0.25, -0.245, -0.55 - long * 1.28 * 0.5 - 0.03);
  }
  rebuildModel();
  camera.add(model);

  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    // Just enough warm spill to sell the flash; v1's 7 turned the whole
    // view model yellow.
    flashLight.intensity = state.flash > 0 ? 1.5 : 0;
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
      flash.rotation.z = Math.random() * Math.PI * 2;
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
