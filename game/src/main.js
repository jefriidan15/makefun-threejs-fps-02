// MERIDIAN FOUNDRY — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. ?shot=start|play|plant|end with &seed=N sets up
// a deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady. window.__game exposes live state for testing.
import * as THREE from 'three';
import { createWorld, SPAWNS, SITES } from './world.js';
import { createBody } from './player.js';
import { createInput } from './input.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createMatch, siteAt, PLANT_SECONDS } from './game.js';
import { initAudio, suspendAudio, sfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
if (shot) {
  // Deterministic captures: the bots roll from the seed, not the clock.
  Math.random = mulberry32(seed);
  suspendAudio();
}

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
const player = createBody(world.colliders, SPAWNS.ember[1].x, SPAWNS.ember[1].z, SPAWNS.ember[1].yaw);
const bots = createBots(scene, world);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const shootables = world.shootables.concat(bots.hitMeshes);

const body = player.state;
const playerState = { body: player, alive: true };
let health = 100;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let frameCount = 0;
let stepCount = 0;
let prevFiring = false;
let grenade = null; // { mesh, vel, fuse }
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x22201c, emissive: 0xff2a1a, emissiveIntensity: 0.8, roughness: 0.5 });
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

function aliveCounts() {
  let ember = playerState.alive ? 1 : 0;
  let azure = 0;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    if (bot.team === 'ember') ember += 1;
    else azure += 1;
  }
  return { ember, azure };
}

const botCtx = {
  time: 0,
  player: playerState,
  playerSpeed: 0,
  planted: null,
  plantedSite: null,
  fx: effects,
  sound: (name) => sfx[name] && sfx[name](),
  damagePlayer,
  onKill,
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
  onNextRound: () => resetPositions(),
};

function onKill(victim, killer, weaponName, headshot = false) {
  hud.killfeed(killer, victim, weaponName, headshot);
  if (killer === 'Mly') {
    match.awardKill();
    sfx.kill();
  }
  hud.setAlive(aliveCounts().ember, aliveCounts().azure);
}

function damagePlayer(amount, fromName, headshot) {
  if (!playerState.alive || match.state.phase !== 'live') return;
  health -= amount;
  hud.setHealth(health);
  hud.damage();
  sfx.hurt();
  if (health <= 0) {
    health = 0;
    playerState.alive = false;
    match.onPlayerDeath();
    onKill('Mly', fromName, headshot ? 'Headshot' : 'Longshot-7', headshot);
    hud.banner('YOU ARE DOWN', `${fromName} got you. Your squad fights on.`, 3000);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  hud.setAlive(aliveCounts().ember, aliveCounts().azure);
}

function resetPositions() {
  const spawn = SPAWNS.ember[1];
  body.position.set(spawn.x, 0, spawn.z);
  body.velocity.set(0, 0, 0);
  body.yaw = spawn.yaw;
  body.pitch = 0;
  health = 100;
  playerState.alive = true;
  weapon.equip(WEAPONS[match.state.ownedWeapon]);
  bots.reset(SPAWNS);
  effects.hideCharge();
  if (grenade) { scene.remove(grenade.mesh); grenade = null; }
  hud.setHealth(100);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def.name);
  hud.setGrenades(match.state.grenades);
  hud.setCharge(true);
  hud.setAlive(3, 3);
  syncCamera();
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) { sfx.dry(); return false; }
  camera.getWorldDirection(direction);
  direction.x += (Math.random() * 2 - 1) * spread;
  direction.y += (Math.random() * 2 - 1) * spread;
  direction.z += (Math.random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const muzzle = tmpVec.copy(camera.position).addScaledVector(direction, 0.6);
  const end = hit ? hit.point : tmpVec2.copy(camera.position).addScaledVector(direction, 60);
  effects.tracer(muzzle, end, weapon.def.tracer);
  sfx.shot(weapon.def.id);
  if (hit) {
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const wasAlive = bot.alive;
      const headshot = hit.object.userData.part === 'head';
      const damage = weapon.def.damage * (headshot ? weapon.def.headMult : 1);
      bots.damageBot(bot, damage, 'Mly', headshot, botCtx);
      if (wasAlive) {
        hud.hitMarker(!bot.alive, shot ? 4000 : 90);
        if (bot.alive) sfx.hit();
      }
    } else {
      effects.sparksAt(hit.point, hit.face ? hit.face.normal : null);
    }
  }
  weapon.pullTrigger();
  player.recoil(0.009 + Math.random() * 0.004, (Math.random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function throwGrenade() {
  if (match.state.grenades <= 0 || match.state.phase !== 'live' || grenade) return;
  match.state.grenades -= 1;
  hud.setGrenades(match.state.grenades);
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position).addScaledVector(direction, 0.5);
  scene.add(mesh);
  grenade = { mesh, vel: direction.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)), fuse: 1.4 };
  sfx.buy();
}

function detonateGrenade() {
  if (!grenade) return;
  const pos = grenade.mesh.position.clone();
  scene.remove(grenade.mesh);
  grenade = null;
  effects.sparksAt(pos, null);
  sfx.flash();
  // Blind every bot facing the pop within 12 m; the player too, if looking at it.
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
  const pdx = pos.x - body.position.x;
  const pdz = pos.z - body.position.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 12 && playerState.alive) {
    camera.getWorldDirection(direction);
    const dot = direction.x * (pdx / (pdist || 1)) + direction.z * (pdz / (pdist || 1));
    if (dot > 0.1) hud.flash();
  }
}

function stepGrenade(dt) {
  if (!grenade) return;
  grenade.fuse -= dt;
  grenade.vel.y -= 14 * dt;
  const next = grenade.mesh.position.clone().addScaledVector(grenade.vel, dt);
  const box = new THREE.Box3(
    new THREE.Vector3(next.x - 0.1, next.y - 0.1, next.z - 0.1),
    new THREE.Vector3(next.x + 0.1, next.y + 0.1, next.z + 0.1),
  );
  let hit = next.y <= 0.1;
  if (!hit) for (const c of world.colliders) { if (box.intersectsBox(c)) { hit = true; break; } }
  if (hit) {
    grenade.vel.multiplyScalar(-0.35);
    grenade.vel.y = Math.abs(grenade.vel.y) * 0.4 + 1;
    if (grenade.vel.lengthSq() < 1) { grenade.vel.set(0, 0, 0); }
  } else {
    grenade.mesh.position.copy(next);
  }
  if (grenade.fuse <= 0) detonateGrenade();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    initAudio();
    hud.hideOverlays();
  } else if (match.state.phase === 'live' && playerState.alive) {
    hud.showOverlay('paused');
  } else if (match.state.phase === 'buy') {
    hud.showBuy(match.state.round);
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.state.phase === 'matchEnd' || match.state.phase === 'lobby') {
    match.startMatch();
    resetPositions();
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
    if (!shot) input.requestLock();
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

function step(dt) {
  stepCount += 1;
  elapsed += dt;
  botCtx.time = elapsed;
  const pressed = input.takePressed();
  const phase = match.state.phase;

  if (phase !== 'matchEnd') {
    // Plant: hold E inside a site while the round is live.
    let planting = false;
    let site = null;
    if (phase === 'live' && playerState.alive && !match.state.planted) {
      site = siteAt(body.position.x, body.position.z);
      planting = site !== null && (input.state.keys.has('KeyE') || pressed.has('KeyE'));
    }
    const plantResult = match.plantTick(dt, planting);
    if (plantResult === 'planting') {
      hud.plant(match.state.plantProgress, `PLANTING THE CHARGE — ${site === 'A' ? 'FURNACE' : 'CRANE BAY'}…`);
    } else if (plantResult === 'planted') {
      const center = site === 'A' ? SITES.A.center : SITES.B.center;
      const planted = match.plantAt(center.x, center.z, site);
      botCtx.planted = { x: planted.x, z: planted.z };
      botCtx.plantedSite = site;
      effects.showCharge(new THREE.Vector3(center.x, 0, center.z));
      hud.plant(null);
      hud.banner('CHARGE PLANTED', `${site === 'A' ? 'Furnace' : 'Crane Bay'} — defend it for ${35} seconds.`, 3200);
      hud.setCharge(false);
    } else {
      hud.plant(null);
    }

    match.step(dt, {
      alive: aliveCounts(),
      onDetonation: botCtx.onDetonation,
      onNextRound: botCtx.onNextRound,
    });
    if (match.state.planted) {
      botCtx.planted = { x: match.state.planted.x, z: match.state.planted.z };
      botCtx.plantedSite = match.state.planted.site;
    } else if (match.state.phase !== 'live') {
      botCtx.planted = null;
      botCtx.plantedSite = null;
    }
  }

  if (phase === 'live' && playerState.alive) {
    player.step(dt, input.state.keys);
    botCtx.playerSpeed = player.groundSpeed();
    if (pressed.has('KeyR') && weapon.reload()) sfx.reload();
    if (pressed.has('KeyG')) throwGrenade();
    if (pressed.has('KeyB')) hud.showBuy(match.state.round);
    const firing = input.state.firing;
    const trigger = weapon.def.auto ? firing : firing && !prevFiring;
    if (trigger && weapon.ready()) {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed(), body.sprinting));
    }
    prevFiring = firing;
    hud.setCrosshairSpread(3 + weapon.spread(player.groundSpeed(), body.sprinting) * 420);
  } else {
    prevFiring = false;
  }

  world.step(dt);
  effects.step(dt);
  weapon.step(dt);
  stepGrenade(dt);
  if (phase === 'live' || phase === 'roundEnd') {
    bots.step(dt, botCtx);
  }
  hud.drawMinimap({
    player: { x: body.position.x, z: body.position.z, yaw: body.yaw, alive: playerState.alive },
    bots: bots.bots.map((b) => ({ x: b.body.state.position.x, z: b.body.state.position.z, team: b.team, alive: b.alive })),
    planted: botCtx.planted,
    sites: { A: SITES.A.center, B: SITES.B.center },
  });
  hud.setHealth(health);
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
    player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
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

function runShot(name) {
  hud.hideOverlays();
  match.startMatch();
  resetPositions();
  if (name === 'start') {
    body.position.set(-2, 0, 12.5);
    body.yaw = -0.35;
    body.pitch = 0.02;
    settle(30);
    hud.showBuy(1);
  } else if (name === 'play') {
    match.state.score.ember = 1;
    match.state.score.azure = 0;
    match.state.round = 2;
    match.deploy();
    match.state.roundTime = 74;
    match.state.money = 3400;
    // Forward into mid, bots already pushing: let the round breathe.
    body.position.set(-4, 0, 9);
    body.yaw = 0.5;
    settle(300);
    // Turn on the nearest living Azure bot with a clear line of sight: try
    // several lane vantage points until one sees a bot at fighting range.
    const eye = new THREE.Vector3();
    function botVisibleFrom(eyePos, bot) {
      tmpVec2.set(bot.body.state.position.x, 1.2, bot.body.state.position.z);
      direction.copy(tmpVec2).sub(eyePos).normalize();
      scene.updateMatrixWorld(true);
      raycaster.set(eyePos, direction);
      const hit = raycaster.intersectObjects(shootables, false)[0];
      return !!hit && hit.object.userData.bot === bot;
    }
    const spots = [[-12, 8], [12, 8], [-8, 12], [8, 12], [0, 14], [-14, 2], [14, -2], [-7, 5], [7, 5], [-3, 10], [3, 10], [-6, -6], [6, -6], [-12, -6], [12, -6], [0, -4], [-4, 9]];
    let target = null;
    let bestPair = null; // [distance, spotX, spotZ, bot]
    for (const [sx, sz] of spots) {
      eye.set(sx, 1.6, sz);
      for (const bot of bots.bots) {
        if (bot.team !== 'azure' || !bot.alive) continue;
        const d = Math.hypot(bot.body.state.position.x - sx, bot.body.state.position.z - sz);
        if (d < 4 || d > 16) continue;
        if (!botVisibleFrom(eye, bot)) continue;
        if (!bestPair || d < bestPair[0]) bestPair = [d, sx, sz, bot];
      }
    }
    if (bestPair) {
      target = bestPair[3];
      body.position.set(bestPair[1], 0, bestPair[2]);
    }
    if (!target) {
      // Fallback: nearest Azure bot from wherever we stand, even if a crate
      // eats the round — the tracer and muzzle flash still read as combat.
      let best = Infinity;
      for (const bot of bots.bots) {
        if (bot.team !== 'azure' || !bot.alive) continue;
        const d = bot.body.state.position.distanceTo(body.position);
        if (d < best) { best = d; target = bot; }
      }
      body.position.set(-4, 0, 9);
    }
    if (target) {
      const tp = tmpVec.set(target.body.state.position.x, 1.2, target.body.state.position.z);
      aimAt(tp);
      shoot(0);
      settle(8);
      aimAt(tp);
      shoot(0);
      settle(2);
    }
    hud.setScore(1, 0, 2);
  } else if (name === 'plant') {
    match.state.score.ember = 2;
    match.state.score.azure = 1;
    match.state.round = 4;
    match.deploy();
    match.state.roundTime = 48;
    body.position.set(-11.5, 0, -8.5);
    body.yaw = 0.55;
    settle(120);
    // Step inside Site A on its south-east edge, facing the furnace mouth so
    // the site, the ring and the yard all read.
    body.position.set(-11, 0, -8.5);
    body.yaw = 0.69;
    syncCamera();
    match.state.plantProgress = 0.62;
    hud.plant(0.62, 'PLANTING THE CHARGE — FURNACE…');
    hud.setScore(2, 1, 4);
  } else if (name === 'demo') {
    // Attract/demo mode: plays one round unattended through the real code —
    // deploy, walk into Site A, hold E to plant, then fast-forward the fuse
    // to the round's resolution and into the next buy phase. The result lands
    // in window.__demo for automated checks; the frame freezes on the banner.
    match.state.score.ember = 0;
    match.state.score.azure = 0;
    match.deploy();
    body.position.set(-10.5, 0, -8);
    body.yaw = 0.69;
    syncCamera();
    input.state.keys.add('KeyE');
    let demoSteps = 0;
    let planted = false;
    while (demoSteps < 600 && match.state.phase === 'live' && !match.state.planted) {
      step(FIXED_STEP);
      demoSteps += 1;
      planted = !!match.state.planted;
    }
    input.state.keys.delete('KeyE');
    let resolved = match.state.phase;
    while (demoSteps < 12000 && match.state.phase === 'live') {
      step(FIXED_STEP);
      demoSteps += 1;
      resolved = match.state.phase;
    }
    // Let the round-end banner run out so the next buy phase opens.
    while (demoSteps < 13000 && match.state.phase === 'roundEnd') {
      step(FIXED_STEP);
      demoSteps += 1;
    }
    window.__demo = {
      planted,
      phase: match.state.phase,
      round: match.state.round,
      score: { ember: match.state.score.ember, azure: match.state.score.azure },
      steps: demoSteps,
      playerAlive: playerState.alive,
      botsAlive: bots.bots.filter((b) => b.alive).length,
    };
    hud.setScore(match.state.score.ember, match.state.score.azure, match.state.round);
  } else if (name === 'end') {
    match.state.score.ember = 5;
    match.state.score.azure = 3;
    match.state.round = 9;
    match.state.stats = { kills: 7, deaths: 2, plants: 1, defuses: 0 };
    match.endMatch();
    hud.setScore(5, 3, 9);
    hud.setTimer(0, 'matchEnd');
    settle(20);
  }
  hud.setScore(match.state.score.ember, match.state.score.azure, match.state.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
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
  get playerAlive() { return playerState.alive; },
  get bots() { return bots.bots.map((b) => ({ name: b.name, team: b.team, alive: b.alive, x: +b.body.state.position.x.toFixed(1), z: +b.body.state.position.z.toFixed(1), hp: b.health })); },
  get pos() { return { x: +body.position.x.toFixed(2), z: +body.position.z.toFixed(2), yaw: +body.yaw.toFixed(2) }; },
  get phase() { return match.state.phase; },
  get frames() { return frameCount; },
  get steps() { return stepCount; },
  version: 'meridian-foundry-1.0',
};

syncCamera();
hud.setHealth(100);
hud.setAmmo(weapon.state.mag, weapon.state.reserve);
hud.setWeapon(weapon.def.name);
hud.setMoney(800);
hud.setCharge(true);
hud.setAlive(3, 3);
bots.reset(SPAWNS);
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
