// MERIDIAN FOUNDRY v4 — boot, the fixed-step loop, and the deterministic
// screenshot staging. The sim ticks at 60 Hz no matter how fast the display
// renders; rendering only ever reads sim state, never advances it.
// ?shot=start|play|plant|end|demo with &seed=N stages one frozen frame (or
// one unattended demo round) and raises window.__shotReady. window.__game
// exposes live state so the headless harness can drive and inspect a round.
// v4: coordinated Azure executes (one site, one clock), retake cover ring,
// per-weapon recoil, auto-reload on an empty mag, and a cover frame that
// freezes a kill, a smoke screen and crossing tracers in one shot.
import * as THREE from 'three';
import { createWorld, SPAWNS, SITES } from './world.js';
import { createBody } from './player.js';
import { createInput } from './input.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots, CONTACT_GRACE_SECONDS } from './bots.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createMatch, siteAt, PLANT_SECONDS, DEFUSE_SECONDS } from './game.js';
import { initAudio, suspendAudio, sfx } from './audio.js';

const STEP = 1 / 60;
const FUSE_SECONDS = 35;
const SMOKE_RADIUS = 2.2;
const SMOKE_SECONDS = 12;

// ---- Seeded randomness for deterministic captures -----------------------
// A capture run replaces Math.random with a mulberry32 stream, so the bots
// roll the same way every time and the same frame comes out of the same seed.
const query = new URLSearchParams(window.location.search);
const shotName = query.get('shot');
const shotSeed = Number.parseInt(query.get('seed') ?? '1', 10) || 1;

function mulberry32(seedValue) {
  let a = seedValue;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
if (shotName) {
  Math.random = mulberry32(shotSeed);
  suspendAudio();
}

// ---- Renderer, scene, and the assembled game ------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const hud = createHud();
const match = createMatch(hud);
const rig = createBody(world.colliders, SPAWNS.ember[1].x, SPAWNS.ember[1].z, SPAWNS.ember[1].yaw);
const bots = createBots(scene, world);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const shootables = world.shootables.concat(bots.hitMeshes);

// ---- Mutable run state ----------------------------------------------------
const stance = rig.state;
const me = { body: rig, alive: true };
let health = 100;
let elapsed = 0;
let roundElapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let frameCount = 0;
let stepCount = 0;
let prevFiring = false;
// Thrown ordnance in flight: { mesh, vel, fuse, kind } — kind 'flash' or
// 'smoke'. At most one of each kind is airborne at a time.
const projectiles = [];
const smokePuffs = []; // { x, z, r, until, mesh } — live screens, read by bot LOS
const flashGeo = new THREE.SphereGeometry(0.09, 10, 8);
const flashMat = new THREE.MeshStandardMaterial({ color: 0x22201c, emissive: 0xff2a1a, emissiveIntensity: 0.8, roughness: 0.5 });
const smokeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a8880, emissive: 0x555550, emissiveIntensity: 0.3, roughness: 0.9 });
const smokeBlockGeo = new THREE.BoxGeometry(SMOKE_RADIUS * 2, 3, SMOKE_RADIUS * 2);
const smokeBlockMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const aimDir = new THREE.Vector3();
const scratch = new THREE.Vector3();
const scratch2 = new THREE.Vector3();

function squadCounts() {
  let ember = me.alive ? 1 : 0;
  let azure = 0;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    if (bot.team === 'ember') ember += 1;
    else azure += 1;
  }
  return { ember, azure };
}

function syncCamera() {
  camera.position.set(stance.position.x, stance.position.y + stance.eye, stance.position.z);
  camera.rotation.set(stance.pitch, stance.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - stance.position.x;
  const dy = point.y - (stance.position.y + stance.eye);
  const dz = point.z - stance.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  stance.yaw = Math.atan2(-dx, -dz);
  stance.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// ---- Damage, kills, and the AI link ---------------------------------------
// The link is the one object the bots are allowed to touch: the clock, the
// player, the planted charge, the live smoke, the effects, and the callbacks
// that feed kills and round events back into the match.
function registerKill(victim, killer, weaponName, headshot = false) {
  hud.killfeed(killer, victim, weaponName, headshot);
  if (killer === 'Mly') {
    match.awardKill();
    sfx.kill();
  }
  hud.setAlive(squadCounts().ember, squadCounts().azure);
}

function hurtPlayer(amount, fromName, headshot, fromPos) {
  if (!me.alive || match.state.phase !== 'live') return;
  link.contact = true; // first contact: the squads may now engage each other
  link.engaged = true;
  health -= amount;
  hud.setHealth(health);
  hud.damage();
  if (fromPos) {
    // Bearing of the shot relative to where the player faces: 0° is straight
    // ahead, +90° is to the right, 180° is behind. The HUD arc rotates to it.
    const fx = -Math.sin(stance.yaw);
    const fz = -Math.cos(stance.yaw);
    const dx = fromPos.x - stance.position.x;
    const dz = fromPos.z - stance.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const ax = dx / len;
    const az = dz / len;
    const bearing = Math.atan2(fx * az - fz * ax, fx * ax + fz * az) * 180 / Math.PI;
    hud.damageFrom(bearing);
  }
  sfx.hurt();
  if (health <= 0) {
    health = 0;
    me.alive = false;
    match.onPlayerDeath();
    registerKill('Mly', fromName, headshot ? 'Headshot' : 'Longshot-7', headshot);
    hud.banner('YOU ARE DOWN', `${fromName} got you. Your squad fights on.`, 3000);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  hud.setAlive(squadCounts().ember, squadCounts().azure);
}

const link = {
  time: 0,
  player: me,
  playerSpeed: 0,
  planted: null,
  plantedSite: null,
  contact: false,
  engaged: false, // the player has fired or been hit — the squads are in it now
  execute: null, // { site, at, until } — the shared Azure push, one site, one clock
  smoke: smokePuffs,
  fx: effects,
  sound: (name) => sfx[name] && sfx[name](),
  damagePlayer: hurtPlayer,
  onKill: registerKill,
  onDefused: (name) => {
    hud.killfeed(name, 'CHARGE', 'DEFUSE', false);
    effects.hideCharge();
    match.onDefused(name);
  },
  onDetonation: (site) => {
    const center = site.site === 'A' ? SITES.A.center : SITES.B.center;
    effects.explosion(new THREE.Vector3(center.x, 1, center.z));
    effects.hideCharge();
    sfx.explosion();
  },
  onNextRound: () => respawnAll(),
  // A bot's retake smoke: a screen lobbed from its chest toward the planted
  // site, so the defuser is covered while it channels. The smoke is also the
  // push signal — the squad sprints the site together behind it (utility
  // combo: smoke, then the execute), instead of one bot smoking while the
  // other two keep holding their old angles.
  onBotSmoke: (bot) => {
    const from = bot.body.state.position;
    const target = link.planted;
    if (!target) return;
    link.execute = { site: link.plantedSite, at: link.time, until: link.time + 12 };
    const dir = scratch.set(target.x - from.x, 0, target.z - from.z);
    const dist = dir.length() || 1;
    dir.divideScalar(dist);
    lobThrowable('smoke', new THREE.Vector3(from.x, from.y + 1.4, from.z), dir.multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)), 1.2);
  },
};

// ---- Shooting ---------------------------------------------------------------
function fireRound(spread) {
  // An empty mag reloads itself — a dry click in a firefight is a dead
  // player, and the R key is for topping up, not for unjamming the gun.
  if (!weapon.takeRound()) {
    if (weapon.state.reserve > 0 && weapon.reload()) sfx.reload();
    else sfx.dry();
    return false;
  }
  link.contact = true; // the player's shot is first contact
  link.engaged = true;
  camera.getWorldDirection(aimDir);
  aimDir.x += (Math.random() * 2 - 1) * spread;
  aimDir.y += (Math.random() * 2 - 1) * spread;
  aimDir.z += (Math.random() * 2 - 1) * spread;
  aimDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, aimDir);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const muzzle = scratch.copy(camera.position).addScaledVector(aimDir, 0.6);
  const end = hit ? hit.point : scratch2.copy(camera.position).addScaledVector(aimDir, 60);
  effects.tracer(muzzle, end, weapon.def.tracer);
  sfx.shot(weapon.def.id);
  if (hit) {
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const wasAlive = bot.alive;
      const headshot = hit.object.userData.part === 'head';
      const damage = weapon.def.damage * (headshot ? weapon.def.headMult : 1);
      bots.damageBot(bot, damage, 'Mly', headshot, link);
      if (wasAlive) {
        hud.hitMarker(!bot.alive, shotName ? 4000 : 90);
        hud.damageNumber(damage, headshot, shotName ? 10000 : 650);
        if (bot.alive) sfx.hit();
      }
    } else {
      effects.sparksAt(hit.point, hit.face ? hit.face.normal : null);
    }
  }
  weapon.pullTrigger();
  // Recoil is per-weapon, not one flat kick: the Deadeye bucks, the Raptor
  // barely moves — the pitch kick scales with the gun's own kick number.
  rig.recoil(weapon.def.kick * 0.7 + Math.random() * 0.004, (Math.random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

// ---- Throwables: flash and smoke --------------------------------------------
// One shared flight model for both grenade types; only the landing differs.
// Flash pops and blinds anyone facing it within 12 m. Smoke hangs for 12 s
// and blocks sight — bot LOS reads the puff list, the player's own shots
// stop on an invisible blocker box inside each puff.
function lobThrowable(kind, origin, velocity, fuse) {
  if (projectiles.some((p) => p.kind === kind)) return false;
  const mesh = new THREE.Mesh(kind === 'smoke' ? smokeGeo : flashGeo, kind === 'smoke' ? smokeMat : flashMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  projectiles.push({ mesh, vel: velocity.clone(), fuse, kind });
  return true;
}

function throwPlayerGrenade(kind) {
  if (match.state.phase !== 'live') return;
  const stock = kind === 'smoke' ? match.state.smokes : match.state.grenades;
  if (stock <= 0) return;
  camera.getWorldDirection(aimDir);
  const origin = scratch.copy(camera.position).addScaledVector(aimDir, 0.5);
  const velocity = aimDir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0));
  if (!lobThrowable(kind, origin, velocity, 1.4)) return;
  if (kind === 'smoke') {
    match.state.smokes -= 1;
    hud.setSmokes(match.state.smokes);
  } else {
    match.state.grenades -= 1;
    hud.setGrenades(match.state.grenades);
  }
  sfx.buy();
}

function burstFlash(pos) {
  effects.sparksAt(pos, null);
  sfx.flash();
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const bp = bot.body.state.position;
    const dist = Math.hypot(bp.x - pos.x, bp.z - pos.z);
    if (dist > 12) continue;
    const fx = -Math.sin(bot.body.state.yaw);
    const fz = -Math.cos(bot.body.state.yaw);
    const dx = (pos.x - bp.x) / (dist || 1);
    const dz = (pos.z - bp.z) / (dist || 1);
    if (fx * dx + fz * dz > 0.1) bot.blindUntil = elapsed + 2.5;
  }
  const pdx = pos.x - stance.position.x;
  const pdz = pos.z - stance.position.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 12 && me.alive) {
    camera.getWorldDirection(aimDir);
    const dot = aimDir.x * (pdx / (pdist || 1)) + aimDir.z * (pdz / (pdist || 1));
    if (dot > 0.1) hud.flash();
  }
}

function laySmoke(pos) {
  effects.smokeAt(pos);
  const blocker = new THREE.Mesh(smokeBlockGeo, smokeBlockMat);
  blocker.position.set(pos.x, 1.5, pos.z);
  blocker.updateMatrixWorld(true);
  scene.add(blocker);
  shootables.push(blocker);
  smokePuffs.push({ x: pos.x, z: pos.z, r: SMOKE_RADIUS, until: elapsed + SMOKE_SECONDS, mesh: blocker });
}

function stepProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.fuse -= dt;
    p.vel.y -= 14 * dt;
    const next = p.mesh.position.clone().addScaledVector(p.vel, dt);
    const box = new THREE.Box3(
      new THREE.Vector3(next.x - 0.1, next.y - 0.1, next.z - 0.1),
      new THREE.Vector3(next.x + 0.1, next.y + 0.1, next.z + 0.1),
    );
    let hit = next.y <= 0.1;
    if (!hit) for (const c of world.colliders) { if (box.intersectsBox(c)) { hit = true; break; } }
    if (hit) {
      p.vel.multiplyScalar(-0.35);
      p.vel.y = Math.abs(p.vel.y) * 0.4 + 1;
      if (p.vel.lengthSq() < 1) p.vel.set(0, 0, 0);
    } else {
      p.mesh.position.copy(next);
    }
    if (p.fuse <= 0) {
      const pos = p.mesh.position.clone();
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      if (p.kind === 'smoke') laySmoke(pos);
      else burstFlash(pos);
    }
  }
  // Expired screens leave the yard: the blocker leaves the raycast list so
  // shots pass through where the smoke was.
  for (let i = smokePuffs.length - 1; i >= 0; i -= 1) {
    if (elapsed <= smokePuffs[i].until) continue;
    const puff = smokePuffs[i];
    scene.remove(puff.mesh);
    const at = shootables.indexOf(puff.mesh);
    if (at >= 0) shootables.splice(at, 1);
    smokePuffs.splice(i, 1);
  }
}

// ---- Round lifecycle ----------------------------------------------------------
function respawnAll() {
  const spawn = SPAWNS.ember[1];
  stance.position.set(spawn.x, 0, spawn.z);
  stance.velocity.set(0, 0, 0);
  stance.yaw = spawn.yaw;
  stance.pitch = 0;
  health = 100;
  me.alive = true;
  weapon.equip(WEAPONS[match.state.ownedWeapon]);
  bots.reset(SPAWNS);
  effects.hideCharge();
  for (const p of projectiles) scene.remove(p.mesh);
  projectiles.length = 0;
  for (const puff of smokePuffs) {
    scene.remove(puff.mesh);
    const at = shootables.indexOf(puff.mesh);
    if (at >= 0) shootables.splice(at, 1);
  }
  smokePuffs.length = 0;
  hud.setHealth(100);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def.name);
  hud.setGrenades(match.state.grenades);
  hud.setSmokes(match.state.smokes);
  hud.setCharge(true);
  hud.setAlive(3, 3);
  hud.setHistory(match.state.history);
  link.contact = false;
  link.engaged = false;
  link.execute = null;
  roundElapsed = 0;
  syncCamera();
}

// ---- Input plumbing -------------------------------------------------------------
function onLockChange(locked) {
  if (shotName) return;
  if (locked) {
    started = true;
    initAudio();
    hud.hideOverlays();
  } else if (match.state.phase === 'live' && me.alive) {
    hud.showOverlay('paused');
  } else if (match.state.phase === 'buy') {
    hud.showBuy(match.state.round);
  }
}

hud.onPlay(() => {
  if (shotName) return;
  if (match.state.phase === 'matchEnd' || match.state.phase === 'lobby') {
    match.startMatch();
    respawnAll();
    hud.showBuy(1);
    return;
  }
  initAudio();
  if (match.state.phase === 'live') input.requestLock();
  else if (match.state.phase === 'buy') hud.showBuy(match.state.round);
});

hud.onBuy((id) => {
  if (id === 'deploy') {
    match.deploy();
    if (!shotName) input.requestLock();
    return;
  }
  if (match.buy(id)) {
    if (WEAPONS[id]) {
      weapon.equip(WEAPONS[id]);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
      hud.setWeapon(weapon.def.name);
    }
    hud.markBuyAffordable(match.state.money, match.state.ownedWeapon);
  }
  hud.setMoney(match.state.money);
});

// ---- The fixed step ---------------------------------------------------------------
function step(dt) {
  stepCount += 1;
  elapsed += dt;
  roundElapsed += dt;
  if (roundElapsed > CONTACT_GRACE_SECONDS) link.contact = true;
  link.time = elapsed;
  // Coordinated execute: on first contact with the player — or at 25 s if
  // the round stays quiet — the Azure squad stops laning and pushes one
  // site together: the site nearest the player, so the push comes at the
  // player instead of at an empty corner. One trigger per round.
  if (!link.execute && match.state.phase === 'live' && me.alive && (link.engaged || roundElapsed > 25)) {
    const dA = Math.hypot(stance.position.x - SITES.A.center.x, stance.position.z - SITES.A.center.z);
    const dB = Math.hypot(stance.position.x - SITES.B.center.x, stance.position.z - SITES.B.center.z);
    link.execute = { site: dA <= dB ? 'A' : 'B', at: elapsed, until: elapsed + 30 };
  }
  const pressed = input.takePressed();
  const phase = match.state.phase;

  if (phase !== 'matchEnd') {
    // Plant: hold E inside a site while the round is live.
    let planting = false;
    let site = null;
    if (phase === 'live' && me.alive && !match.state.planted) {
      site = siteAt(stance.position.x, stance.position.z);
      planting = site !== null && (input.state.keys.has('KeyE') || pressed.has('KeyE'));
    }
    const plantResult = match.plantTick(dt, planting);
    if (plantResult === 'planting') {
      hud.plant(match.state.plantProgress, `PLANTING THE CHARGE — ${site === 'A' ? 'FURNACE' : 'CRANE BAY'}…`);
    } else if (plantResult === 'planted') {
      const center = site === 'A' ? SITES.A.center : SITES.B.center;
      const planted = match.plantAt(center.x, center.z, site);
      link.planted = { x: planted.x, z: planted.z };
      link.plantedSite = site;
      effects.showCharge(new THREE.Vector3(center.x, 0, center.z));
      hud.plant(null);
      hud.banner('CHARGE PLANTED', `${site === 'A' ? 'Furnace' : 'Crane Bay'} — defend it for ${FUSE_SECONDS} seconds.`, 3200);
      hud.setCharge(false);
    } else {
      hud.plant(null);
    }

    match.step(dt, {
      alive: squadCounts(),
      onDetonation: link.onDetonation,
      onNextRound: link.onNextRound,
    });
    // Defuse bar: while the charge is live and an Azure bot is on it, the
    // player sees the defuse progressing in red — the objective UI works for
    // both teams, not just the planter.
    const defuser = bots.bots.find((b) => b.channel);
    if (defuser && match.state.planted) {
      hud.plant(defuser.channel.progress / DEFUSE_SECONDS, 'AZURE IS DEFUSING THE CHARGE — STOP THEM', 'defuse');
    }
    if (match.state.planted) {
      link.planted = { x: match.state.planted.x, z: match.state.planted.z };
      link.plantedSite = match.state.planted.site;
    } else if (match.state.phase !== 'live') {
      link.planted = null;
      link.plantedSite = null;
    }
  }

  if (phase === 'live' && me.alive) {
    rig.step(dt, input.state.keys);
    link.playerSpeed = rig.groundSpeed();
    if (pressed.has('KeyR') && weapon.reload()) sfx.reload();
    if (pressed.has('KeyG')) throwPlayerGrenade('flash');
    if (pressed.has('KeyQ')) throwPlayerGrenade('smoke');
    if (pressed.has('KeyB')) hud.showBuy(match.state.round);
    const firing = input.state.firing;
    const trigger = weapon.def.auto ? firing : firing && !prevFiring;
    if (trigger && weapon.ready()) {
      fireRound(shotName ? 0 : weapon.spread(rig.groundSpeed(), stance.sprinting));
    }
    prevFiring = firing;
    hud.setCrosshairSpread(3 + weapon.spread(rig.groundSpeed(), stance.sprinting) * 420);
  } else {
    prevFiring = false;
  }

  world.step(dt);
  effects.step(dt);
  weapon.step(dt);
  stepProjectiles(dt);
  if (phase === 'live' || phase === 'roundEnd') {
    bots.step(dt, link);
  }
  hud.drawMinimap({
    player: { x: stance.position.x, z: stance.position.z, yaw: stance.yaw, alive: me.alive },
    bots: bots.bots.map((b) => ({ x: b.body.state.position.x, z: b.body.state.position.z, team: b.team, alive: b.alive })),
    planted: link.planted,
    sites: { A: SITES.A.center, B: SITES.B.center },
  });
  hud.setHealth(health);
  // Ammo is pushed every step, not just after a shot: a reload finishes in
  // weapon.step, and without this the readout would sit stale at the old
  // magazine until the next round is fired. Cached inside the HUD, so the
  // DOM only changes when the numbers do.
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setReloading(weapon.state.reloadLeft > 0);
  hud.markBuyAffordable(match.state.money, match.state.ownedWeapon);
}

function frame(now) {
  frameCount += 1;
  requestAnimationFrame(frame);
  // The first rAF timestamp can predate performance.now() (the compositor
  // scheduled the frame before the page's clock caught up), so a raw delta
  // would dig the accumulator into a hole. Clamp the delta at zero.
  const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.1));
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    rig.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// ---- Deterministic shot staging ---------------------------------------------------
// Each shot sets up one frozen frame through the real code — the same match
// start, the same buy, the same deploy — then paints it twice and freezes.
// 'demo' instead plays a whole round unattended and reports how it resolved.
function runShot(name) {
  hud.hideOverlays();
  match.startMatch();
  respawnAll();
  if (name === 'start') {
    stance.position.set(-2, 0, 12.5);
    stance.yaw = -0.35;
    stance.pitch = 0.02;
    settle(30);
    hud.showBuy(1);
  } else if (name === 'play') {
    match.state.score.ember = 1;
    match.state.score.azure = 0;
    match.state.round = 2;
    // Cover frame: the Longshot-7 rifle (bought with round-2 money), not the
    // free pistol, so the view model and the fight both read.
    match.state.money = 3400;
    match.buy('longshot');
    weapon.equip(WEAPONS.longshot);
    match.deploy();
    match.state.roundTime = 74;
    match.state.money = 3400;
    // Forward into mid, bots already pushing: let the round breathe.
    stance.position.set(-4, 0, 9);
    stance.yaw = 0.5;
    settle(300);
    // Turn on the nearest living Azure bot with a clear line of sight: try
    // several lane vantage points until one sees a bot at fighting range.
    // Prefer a spot that sees TWO Azure bots — the cover reads as a firefight,
    // not a duel.
    const eye = new THREE.Vector3();
    function botVisibleFrom(eyePos, bot) {
      scratch2.set(bot.body.state.position.x, 1.2, bot.body.state.position.z);
      aimDir.copy(scratch2).sub(eyePos).normalize();
      scene.updateMatrixWorld(true);
      raycaster.set(eyePos, aimDir);
      const hit = raycaster.intersectObjects(shootables, false)[0];
      return !!hit && hit.object.userData.bot === bot;
    }
    const spots = [[-12, 8], [12, 8], [-8, 12], [8, 12], [0, 14], [-14, 2], [14, -2], [-7, 5], [7, 5], [-3, 10], [3, 10], [-6, -6], [6, -6], [-12, -6], [12, -6], [0, -4], [-4, 9]];
    let target = null;
    let secondBot = null;
    let bestPair = null; // [visibleCount, distance, spotX, spotZ, bot]
    for (const [sx, sz] of spots) {
      eye.set(sx, 1.6, sz);
      const seen = [];
      for (const bot of bots.bots) {
        if (bot.team !== 'azure' || !bot.alive) continue;
        const d = Math.hypot(bot.body.state.position.x - sx, bot.body.state.position.z - sz);
        if (d < 4 || d > 16) continue;
        if (!botVisibleFrom(eye, bot)) continue;
        seen.push([d, bot]);
      }
      if (!seen.length) continue;
      seen.sort((a, b) => a[0] - b[0]);
      const score = [seen.length, -seen[0][0], sx, sz, seen[0][1]];
      if (!bestPair || score[0] > bestPair[0] || (score[0] === bestPair[0] && score[1] > bestPair[1])) {
        bestPair = score;
        // The crossing tracer comes from the FARTHEST visible bot, not the
        // second-nearest: a long lateral beam reads across the whole frame,
        // while the nearest bot's beam is a short stub behind the camera.
        secondBot = seen.length > 1 ? seen[seen.length - 1][1] : null;
      }
    }
    if (bestPair) {
      target = bestPair[4];
      stance.position.set(bestPair[2], 0, bestPair[3]);
    }
    if (!target) {
      // Fallback: nearest Azure bot from wherever we stand, even if a crate
      // eats the round — the tracer and muzzle flash still read as combat.
      let best = Infinity;
      for (const bot of bots.bots) {
        if (bot.team !== 'azure' || !bot.alive) continue;
        const d = bot.body.state.position.distanceTo(stance.position);
        if (d < best) { best = d; target = bot; }
      }
      stance.position.set(-4, 0, 9);
    }
    if (target) {
      const tp = new THREE.Vector3(target.body.state.position.x, 1.2, target.body.state.position.z);
      aimAt(tp);
      fireRound(0);
      settle(8);
      // Re-aim every round: a duelling bot strafes ~0.7 m in the 8 steps
      // between shots, and a stale aim point misses a 0.52 m torso outright.
      tp.set(target.body.state.position.x, 1.2, target.body.state.position.z);
      aimAt(tp);
      fireRound(0);
      settle(2);
      // Third round finishes the target: the cover freezes a kill — the
      // falling body, the kill-feed row, the red hitmarker — not a duel
      // still in progress. Two Longshot body hits leave 24 HP; the third
      // is the kill, so re-aim at where the bot stands now, not where it
      // stood two shots ago.
      tp.set(target.body.state.position.x, 1.2, target.body.state.position.z);
      aimAt(tp);
      fireRound(0);
      settle(24);
      // A smoke screen staged off the firing lane, bloomed out: grey puff
      // in frame with the tracers, so the cover shows utility as well as
      // gunfire. It sits right of the line of fire so it never hides the kill.
      const midX = (stance.position.x + tp.x) / 2 + Math.cos(stance.yaw) * 2.5;
      const midZ = (stance.position.z + tp.z) / 2 - Math.sin(stance.yaw) * 2.5;
      laySmoke(new THREE.Vector3(midX, 0, midZ));
      settle(30);
      // Freeze a second bot's tracer in the frame: a streak from its muzzle
      // toward the player, stopping 2.5 m short and offset a step to the
      // player's screen-right, so the beam crosses the frame laterally
      // instead of pointing straight down the lens.
      if (secondBot && secondBot.alive) {
        const from = new THREE.Vector3(secondBot.body.state.position.x, secondBot.body.state.position.y + 1.4, secondBot.body.state.position.z);
        const to = scratch2.copy(stance.position).add(new THREE.Vector3(0, 1.35, 0)).sub(from);
        const dist = to.length();
        to.multiplyScalar(Math.max(0.5, (dist - 2.5) / dist)).add(from);
        to.x += Math.cos(stance.yaw) * 1.5;
        to.z -= Math.sin(stance.yaw) * 1.5;
        effects.tracer(from, to, 0x7aa8ff);
        effects.sparksAt(scratch.set(target.body.state.position.x, 1.2, target.body.state.position.z), null);
      }
      // Re-light the muzzle flash for the frozen frame: the flash only lives
      // 0.06 s, and the smoke-bloom settle after the last shot let it die.
      // pullTrigger only re-arms the flash/kick visuals — no round is fired.
      weapon.pullTrigger();
      settle(1);
    }
    hud.setScore(1, 0, 2);
  } else if (name === 'plant') {
    match.state.score.ember = 2;
    match.state.score.azure = 1;
    match.state.round = 4;
    match.deploy();
    match.state.roundTime = 48;
    stance.position.set(-11.5, 0, -8.5);
    stance.yaw = 0.55;
    // Settle 2 s: the squads are mid-push and nobody has taken damage yet.
    settle(120);
    // Step inside Site A on its south-east edge, facing the furnace mouth so
    // the site, the ring and the yard all read. Try nearby framings until
    // one also has an Azure bot retaking in frame — the plant shot should
    // show the threat, not an empty room.
    const eye = new THREE.Vector3();
    function azureVisibleFrom(eyePos, yaw) {
      // Line of sight AND inside the view cone: v1's check forgot the cone
      // and framed bots standing behind the camera.
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      for (const bot of bots.bots) {
        if (bot.team !== 'azure' || !bot.alive) continue;
        const dx = bot.body.state.position.x - eyePos.x;
        const dz = bot.body.state.position.z - eyePos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 || d > 15) continue;
        if ((dx * fx + dz * fz) / d < 0.643) continue; // outside ~50° half-cone (the 16:9 horizontal half-FOV is ~53°)
        scratch2.set(bot.body.state.position.x, 1.2, bot.body.state.position.z);
        aimDir.copy(scratch2).sub(eyePos).normalize();
        scene.updateMatrixWorld(true);
        raycaster.set(eyePos, aimDir);
        const hit = raycaster.intersectObjects(shootables, false)[0];
        if (hit && hit.object.userData.bot === bot) return true;
      }
      return false;
    }
    // The west-edge spot first: from inside the site's west edge, facing
    // north-east, the furnace mouth sits left of frame and the Azure bots
    // pushing down the north lane sit right of it — both in one frame.
    const plantSpots = [[-15, -9, -0.6], [-11, -8.5, 0.69], [-9, -7, 0.9], [-13, -6, 0.35], [-8, -10, 1.1], [-14, -9, 0.5], [-10, -6.5, 0.55]];
    let framed = false;
    for (const [px, pz, yaw] of plantSpots) {
      stance.position.set(px, 0, pz);
      stance.yaw = yaw;
      syncCamera();
      eye.set(px, 1.6, pz);
      if (azureVisibleFrom(eye, yaw)) { framed = true; break; }
    }
    if (!framed) {
      stance.position.set(-11, 0, -8.5);
      stance.yaw = 0.69;
    }
    syncCamera();
    match.state.plantProgress = 0.62;
    hud.plant(0.62, 'PLANTING THE CHARGE — FURNACE…');
    // A retaking Azure bot's tracer across the site: the plant frame shows
    // the threat arriving, not an empty room with a progress bar. Pick a bot
    // inside the view cone so the beam actually crosses the frame.
    const fx = -Math.sin(stance.yaw);
    const fz = -Math.cos(stance.yaw);
    for (const bot of bots.bots) {
      if (bot.team !== 'azure' || !bot.alive) continue;
      const dx = bot.body.state.position.x - stance.position.x;
      const dz = bot.body.state.position.z - stance.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 15 || (dx * fx + dz * fz) / d < 0.643) continue;
      const from = new THREE.Vector3(bot.body.state.position.x, bot.body.state.position.y + 1.4, bot.body.state.position.z);
      const to = scratch2.copy(stance.position).add(new THREE.Vector3(0, 1.3, 0));
      to.x += Math.cos(stance.yaw) * 1.2;
      to.z -= Math.sin(stance.yaw) * 1.2;
      effects.tracer(from, to, 0x7aa8ff);
      break;
    }
    hud.setScore(2, 1, 4);
  } else if (name === 'demo') {
    // Attract/demo mode: plays one round unattended through the real code —
    // deploy, walk into Site A, hold E to plant, then fast-forward the fuse
    // to the round's resolution and into the next buy phase. The result lands
    // in window.__demo for automated checks; the frame freezes on the banner.
    match.state.score.ember = 0;
    match.state.score.azure = 0;
    match.deploy();
    stance.position.set(-10.5, 0, -8);
    stance.yaw = 0.69;
    syncCamera();
    input.state.keys.add('KeyE');
    let demoSteps = 0;
    let planted = false;
    while (demoSteps < 600 && match.state.phase === 'live' && !match.state.planted) {
      step(STEP);
      demoSteps += 1;
      planted = !!match.state.planted;
    }
    input.state.keys.delete('KeyE');
    let resolved = match.state.phase;
    while (demoSteps < 12000 && match.state.phase === 'live') {
      step(STEP);
      demoSteps += 1;
      resolved = match.state.phase;
    }
    // Let the round-end banner run out so the next buy phase opens.
    while (demoSteps < 13000 && match.state.phase === 'roundEnd') {
      step(STEP);
      demoSteps += 1;
    }
    window.__demo = {
      planted,
      phase: match.state.phase,
      round: match.state.round,
      score: { ember: match.state.score.ember, azure: match.state.score.azure },
      steps: demoSteps,
      playerAlive: me.alive,
      botsAlive: bots.bots.filter((b) => b.alive).length,
    };
    hud.setScore(match.state.score.ember, match.state.score.azure, match.state.round);
  } else if (name === 'end') {
    match.state.score.ember = 5;
    match.state.score.azure = 3;
    match.state.round = 9;
    match.state.stats = { kills: 7, deaths: 2, plants: 1, defuses: 0 };
    // The staged final needs a real round history, or the pips and the
    // round-by-round line in the match report would render empty.
    match.state.history = [
      { winner: 'ember', reason: 'Azure squad eliminated.' },
      { winner: 'azure', reason: 'Time expired — nothing planted.' },
      { winner: 'ember', reason: 'The charge detonated at Furnace.' },
      { winner: 'ember', reason: 'Azure squad eliminated.' },
      { winner: 'azure', reason: 'Ember squad eliminated.' },
      { winner: 'ember', reason: 'The charge detonated at Crane Bay.' },
      { winner: 'azure', reason: 'DAGGER defused the charge.' },
      { winner: 'ember', reason: 'Azure squad eliminated.' },
    ];
    hud.setHistory(match.state.history);
    match.endMatch();
    // Face the lit yard (furnace glow, mid-yard) instead of the dark north
    // wall, and let the yard show through the panel: the v1 score shot's
    // backdrop was nearly black.
    stance.position.set(0, 0, 15.5);
    stance.yaw = 0.45;
    stance.pitch = 0.03;
    syncCamera();
    document.getElementById('overlay').style.background = 'rgba(20,14,10,0.55)';
    hud.setScore(5, 3, 9);
    hud.setTimer(0, 'matchEnd');
    settle(20);
  }
  hud.setScore(match.state.score.ember, match.state.score.azure, match.state.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def.name);
  hud.setMoney(match.state.money);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = {
  match: match.state,
  get health() { return health; },
  get playerAlive() { return me.alive; },
  get bots() { return bots.bots.map((b) => ({ name: b.name, role: b.role, team: b.team, alive: b.alive, x: +b.body.state.position.x.toFixed(1), z: +b.body.state.position.z.toFixed(1), hp: b.health })); },
  get pos() { return { x: +stance.position.x.toFixed(2), z: +stance.position.z.toFixed(2), yaw: +stance.yaw.toFixed(2) }; },
  get phase() { return match.state.phase; },
  get frames() { return frameCount; },
  get steps() { return stepCount; },
  version: 'meridian-foundry-4.0',
};

syncCamera();
hud.setHealth(100);
hud.setAmmo(weapon.state.mag, weapon.state.reserve);
hud.setWeapon(weapon.def.name);
hud.setMoney(800);
hud.setCharge(true);
hud.setAlive(3, 3);
bots.reset(SPAWNS);
if (shotName) runShot(shotName);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
