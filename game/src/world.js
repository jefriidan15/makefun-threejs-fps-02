// MERIDIAN FOUNDRY — the map. A 40 x 36 m industrial yard at dusk: a furnace hall
// (Site A) in the north-west, a crane bay (Site B) in the south-east, three lanes of
// containers, crates and silos between them, and a yard wall all round. Every solid is
// a collider for movement and a surface a bullet stops on. Textures are procedural
// canvas art made here — no borrowed assets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Map bounds (half extents). Bots and the player stay inside these.
export const BOUNDS = { x: 19.2, z: 17.2 };

export const SITES = {
  A: { name: 'FURNACE', center: { x: -13, z: -11 }, radius: 4.2 },
  B: { name: 'CRANE BAY', center: { x: 13, z: 11 }, radius: 4.2 },
};

export const SPAWNS = {
  ember: [
    { x: -3, z: 14.5, yaw: 0 },
    { x: 0, z: 15.5, yaw: 0 },
    { x: 3, z: 14.5, yaw: 0 },
  ],
  azure: [
    { x: -3, z: -14.5, yaw: Math.PI },
    { x: 0, z: -15.5, yaw: Math.PI },
    { x: 3, z: -14.5, yaw: Math.PI },
  ],
};

// Waypoint graph: nodes on the three lanes plus both sites. Bots walk it with BFS.
export const WAYPOINTS = {
  nodes: [
    { x: 0, z: 14 }, // 0 ember spawn
    { x: -10, z: 12 }, // 1 west lane south
    { x: 10, z: 12 }, // 2 east lane south
    { x: 0, z: 8 }, // 3 mid south
    { x: -12, z: 4 }, // 4 west lane mid
    { x: 12, z: 4 }, // 5 east lane mid
    { x: -3, z: 3 }, // 6 centre yard — v1 had this at (0,0), inside the centre container; bots wedged on its faces
    { x: -6, z: -4 }, // 7 mid-north west
    { x: 6, z: -4 }, // 8 mid-north east
    { x: -13, z: -11 }, // 9 site A
    { x: 13, z: 11 }, // 10 site B (from north via 11)
    { x: 0, z: -14 }, // 11 azure spawn
    { x: -14, z: 2 }, // 12 west lane north
    { x: 14, z: -2 }, // 13 east lane north
    { x: -6, z: 8 }, // 14 west-mid south
    { x: 6, z: 8 }, // 15 east-mid south
    { x: 13, z: -11 }, // 16 north-east corner
    { x: -13, z: 11 }, // 17 south-west corner
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [1, 4], [1, 14], [2, 5], [2, 15], [3, 14], [3, 15],
    [3, 6], [4, 12], [4, 7], [5, 13], [5, 8], [6, 7], [6, 8], [7, 9], [7, 11],
    [8, 11], [8, 16], [9, 12], [10, 2], [10, 5], [10, 17], [11, 13], [11, 16],
    [12, 9], [13, 16], [14, 4], [15, 5], [16, 13], [17, 1], [17, 10], [12, 4],
  ],
};

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, count, colors, minR, maxR) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = 0.05 + Math.random() * 0.16;
    const r = minR + Math.random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function makeTextures() {
  const floor = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#57493c';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 900, ['#453a2e', '#6a5c4c', '#33291f', '#7d6a4e'], 2, 22);
    ctx.strokeStyle = 'rgba(20,16,12,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * s) / 4, 0); ctx.lineTo((i * s) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 4); ctx.lineTo(s, (i * s) / 4); ctx.stroke();
    }
    // oil stains near the lanes
    ctx.fillStyle = 'rgba(18,14,10,0.35)';
    ctx.beginPath(); ctx.ellipse(s * 0.3, s * 0.62, 70, 34, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.72, s * 0.3, 56, 26, -0.3, 0, Math.PI * 2); ctx.fill();
    // pale expansion-joint crosses so the yard reads as poured slabs
    ctx.strokeStyle = 'rgba(214,188,150,0.16)';
    ctx.lineWidth = 2;
    for (const [cx, cy] of [[0.2, 0.2], [0.8, 0.75], [0.55, 0.45]]) {
      ctx.beginPath(); ctx.moveTo(cx * s - 14, cy * s); ctx.lineTo(cx * s + 14, cy * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx * s, cy * s - 14); ctx.lineTo(cx * s, cy * s + 14); ctx.stroke();
    }
  }, 8, 7);
  const wall = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#4a4036';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 500, ['#38302a', '#5c5044', '#6b543a'], 2, 14);
    ctx.fillStyle = 'rgba(240,168,48,0.16)';
    ctx.fillRect(0, s * 0.72, s, 10);
    ctx.strokeStyle = 'rgba(15,12,10,0.6)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 8; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * s) / 8, 0); ctx.lineTo((i * s) / 8, s); ctx.stroke();
    }
  }, 10, 1);
  const container = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5a4a38';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 16; i += 1) ctx.fillRect(i * 16 + 6, 0, 5, s);
    speckle(ctx, s, 260, ['#7a3a22', '#3a2c20', '#8a6a3a'], 2, 12);
    ctx.fillStyle = 'rgba(240,168,48,0.75)';
    ctx.font = 'bold 34px monospace';
    ctx.fillText('MF-07', 18, 52);
  }, 2, 1);
  const crate = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#6b5232';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 200, ['#543d24', '#7d5f3a'], 2, 10);
    ctx.strokeStyle = 'rgba(30,20,12,0.7)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(s - 5, s - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s - 5, 5); ctx.lineTo(5, s - 5); ctx.stroke();
  });
  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8a020';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#191411';
    for (let i = -2; i < 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 32, s); ctx.lineTo(i * 32 + 32, 0); ctx.lineTo(i * 32 + 48, 0); ctx.lineTo(i * 32 + 16, s);
      ctx.fill();
    }
  }, 4, 1);
  // Furnace mouth: glowing coals behind dark grate bars — never a flat slab.
  const furnaceMouth = canvasTexture(256, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#ff8a1a');
    grad.addColorStop(0.55, '#ff5a00');
    grad.addColorStop(1, '#c22e00');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i += 1) {
      ctx.fillStyle = ['#ffd27a', '#ff9a3c', '#ff2a00', '#7a1a00'][(Math.random() * 4) | 0];
      ctx.globalAlpha = 0.35 + Math.random() * 0.5;
      ctx.beginPath();
      ctx.arc(Math.random() * s, s * 0.45 + Math.random() * s * 0.55, 4 + Math.random() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1a0e06';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(0, (i * s) / 4.4, s, 9);
    for (let i = 0; i < 4; i += 1) ctx.fillRect((i * s) / 3.6, 0, 8, s);
  });
  // Yard signage: the foundry's own name, painted on the walls.
  function signTexture(line1, line2) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#241a12';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#f0a830';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(line1, 256, 56);
    ctx.fillStyle = '#f2ede4';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(line2, 256, 98);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const signFoundry = signTexture('MERIDIAN FOUNDRY', 'FURNACE HALL — SITE A');
  const signCrane = signTexture('CRANE BAY', 'GANTRY 02 — SITE B');
  const signDanger = signTexture('DANGER', 'MOLTEN METAL — KEEP CLEAR');
  // Big painted site letters for the floor: the A and B read from across the
  // yard, so a player always knows which site they are standing in.
  function floorLetter(letter) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(240,168,48,0.9)';
    ctx.font = 'bold 190px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 136);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const letterA = floorLetter('A');
  const letterB = floorLetter('B');
  return { floor, wall, container, crate, hazard, furnaceMouth, signFoundry, signCrane, signDanger, letterA, letterB };
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const textures = makeTextures();

  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.94, metalness: 0.04 }),
    wall: new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.9, metalness: 0.06 }),
    container: new THREE.MeshStandardMaterial({ map: textures.container, roughness: 0.72, metalness: 0.35 }),
    containerBlue: new THREE.MeshStandardMaterial({ color: new THREE.Color('#33506b'), roughness: 0.7, metalness: 0.4 }),
    crate: new THREE.MeshStandardMaterial({ map: textures.crate, roughness: 0.88, metalness: 0.04 }),
    steel: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.45, metalness: 0.75 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.85, metalness: 0.25 }),
    hazard: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.8, metalness: 0.1 }),
    furnace: new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2018'), roughness: 0.6, metalness: 0.5, emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#211a15'), roughness: 0.95 }),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rt, rb, h, x, z, mat, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), mats[mat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const r = Math.max(rt, rb);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r)));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter walls (5 m, open sky above).
  box(40.4, 0.4, 36.4, 0, -0.2, 0, 'floor');
  box(0.5, 5, 36.4, -20.2, 2.5, 0, 'wall');
  box(0.5, 5, 36.4, 20.2, 2.5, 0, 'wall');
  box(40.4, 5, 0.5, 0, 2.5, -18.2, 'wall');
  box(40.4, 5, 0.5, 0, 2.5, 18.2, 'wall');
  // Hazard skirting along the walls, low.
  box(40, 0.3, 0.4, 0, 0.15, -17.8, 'hazard', false);
  box(40, 0.3, 0.4, 0, 0.15, 17.8, 'hazard', false);

  // ---- Site A: FURNACE (north-west) ----
  box(7, 4.4, 1.2, -13, 2.2, -14.6, 'furnace'); // furnace back wall
  const furnaceMouth = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 1.6, 0.3),
    new THREE.MeshStandardMaterial({ map: textures.furnaceMouth, emissive: new THREE.Color('#ff6a00'), emissiveMap: textures.furnaceMouth, emissiveIntensity: 1.1 }),
  );
  furnaceMouth.position.set(-13, 1.1, -13.9);
  group.add(furnaceMouth);
  shootables.push(furnaceMouth);
  // Painted yard signs on the back walls, above the sites.
  function wallSign(tex, w, x, y, z, yaw) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.25 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    group.add(mesh);
    return mesh;
  }
  wallSign(textures.signFoundry, 8, -13, 3.6, -17.9, 0);
  wallSign(textures.signCrane, 6, 13, 3.6, 17.9, Math.PI);
  wallSign(textures.signDanger, 4.5, -5.5, 3.1, -17.9, 0);
  // Painted site letters on the floor inside each ring.
  for (const [tex, site] of [[textures.letterA, SITES.A], [textures.letterB, SITES.B]]) {
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(site.center.x, 0.025, site.center.z);
    group.add(letter);
  }
  // Worn tyre tracks and scattered debris: the floor is a working yard, not
  // a clean slab. Flat decals and small non-colliding rubble, so routes and
  // sightlines do not change.
  const trackMat = new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.35, depthWrite: false });
  for (const [tx, tz, ry, len] of [[-6, 8, 0.3, 7], [6, -8, -0.3, 7], [0, 12, 1.2, 5], [-13, -2, 0.9, 5], [13, 2, -0.9, 5]]) {
    const track = new THREE.Mesh(new THREE.PlaneGeometry(0.9, len), trackMat);
    track.rotation.x = -Math.PI / 2;
    track.rotation.z = ry;
    track.position.set(tx, 0.02, tz);
    group.add(track);
  }
  for (const [rx, rz, s] of [[-2, 6, 0.32], [3, -6, 0.26], [-9, -2, 0.3], [9, 6, 0.24]]) {
    const rubble = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), mats.rust);
    rubble.position.set(rx, s * 0.3, rz);
    rubble.rotation.y = rx;
    rubble.castShadow = true;
    group.add(rubble);
  }
  // Objective beacons: a faint amber light column over each site, so the
  // objective reads from anywhere in the yard — a player always knows where
  // the round is decided. Additive, no collision, no light cost.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const site of [SITES.A, SITES.B]) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 9, 12, 1, true), beamMat);
    beam.position.set(site.center.x, 4.5, site.center.z);
    group.add(beam);
  }
  // Floodlight poles on the yard's long edges: tall steel masts with a warm
  // lamp head each. Emissive heads only — the existing point lights already
  // carry the illumination, so no new light cost.
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4, emissive: new THREE.Color(0xffc46a), emissiveIntensity: 1.4 });
  for (const [px, pz] of [[-18.8, 0.5], [18.8, -0.5]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5.4, 10), mats.steel);
    mast.position.set(px, 2.7, pz);
    mast.castShadow = true;
    group.add(mast);
    colliders.push(new THREE.Box3(new THREE.Vector3(px - 0.15, 0, pz - 0.15), new THREE.Vector3(px + 0.15, 5.4, pz + 0.15)));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.34), lampHeadMat);
    head.position.set(px, 5.5, pz);
    head.rotation.y = px < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(head);
  }
  cylinder(0.9, 1.1, 7.5, -16.2, -14.8, 'rust'); // chimney
  cylinder(0.7, 0.9, 6, -9.8, -14.8, 'steel'); // second stack
  box(3.2, 1.1, 1.4, -17.5, 0.55, -10.5, 'crate');
  box(2.2, 0.9, 1.2, -8.6, 0.45, -9.2, 'crate');
  // Site A marker ring on the floor
  const ringA = new THREE.Mesh(
    new THREE.RingGeometry(SITES.A.radius - 0.18, SITES.A.radius, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(SITES.A.center.x, 0.03, SITES.A.center.z);
  group.add(ringA);

  // ---- Site B: CRANE BAY (south-east) ----
  // Gantry crane: four legs and a top beam spanning the site.
  box(0.5, 6.5, 0.5, 9.5, 3.25, 8, 'steel');
  box(0.5, 6.5, 0.5, 16.5, 3.25, 8, 'steel');
  box(0.5, 6.5, 0.5, 9.5, 3.25, 14, 'steel');
  box(0.5, 6.5, 0.5, 16.5, 3.25, 14, 'steel');
  box(8, 0.7, 1, 13, 6.6, 8, 'steel');
  box(8, 0.7, 1, 13, 6.6, 14, 'steel');
  box(1.2, 1.4, 1.2, 13, 5.6, 11, 'rust'); // hoist block hanging over the site
  box(6, 2.6, 2.4, 16.5, 1.3, 13.5, 'containerBlue');
  box(1.8, 1.1, 1.4, 9.4, 0.55, 13.2, 'crate');
  const ringB = ringA.clone();
  ringB.position.set(SITES.B.center.x, 0.03, SITES.B.center.z);
  group.add(ringB);

  // ---- Lanes: containers, crates, silos, pipes ----
  // Centre yard block
  box(6, 2.6, 2.4, -1.5, 1.3, 0, 'container');
  box(2.4, 2.6, 6, 4.6, 1.3, -2, 'containerBlue');
  box(1.2, 1.1, 1.2, -6.4, 0.55, 1.4, 'crate');
  box(1.2, 1.1, 1.2, -6.4, 0.55, -1.2, 'crate');
  box(1.2, 1.1, 1.2, -6.4, 1.65, 0.1, 'crate');
  // West lane
  box(4.4, 2.6, 2.2, -13.5, 1.3, 3.5, 'containerBlue');
  box(1.6, 1.1, 1.6, -9, 0.55, 6.5, 'crate');
  box(1.6, 1.1, 1.6, -15.5, 0.55, -4.5, 'crate');
  cylinder(1.5, 1.5, 4.2, -17.5, 2.5, 'rust');
  // East lane
  box(4.4, 2.6, 2.2, 13.5, 1.3, -3.5, 'container');
  box(1.6, 1.1, 1.6, 9, 0.55, -6.5, 'crate');
  box(1.6, 1.1, 1.6, 15.5, 0.55, 4.5, 'crate');
  cylinder(1.5, 1.5, 4.2, 17.5, -7.5, 'steel');
  // Mid-north and mid-south cover
  box(3, 1.1, 1.2, -5, 0.55, -8.5, 'crate');
  box(3, 1.1, 1.2, 5, 0.55, -8.5, 'crate');
  box(3, 1.1, 1.2, -5, 0.55, 8.5, 'crate');
  box(3, 1.1, 1.2, 5, 0.55, 8.5, 'crate');
  // Pipes along the north wall and stacked barrels
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 30, 12), mats.steel);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, 3.6, -17.4);
  pipe.castShadow = true;
  group.add(pipe);
  shootables.push(pipe);
  for (const [bx, bz] of [[-7.5, -15.8], [-6.6, -15.8], [-7.05, -15.8]]) cylinder(0.55, 0.55, 1.3, bx, bz, 'rust', 12);
  for (const [bx, bz] of [[7.5, 15.8], [8.4, 15.8]]) cylinder(0.55, 0.55, 1.3, bx, bz, 'steel', 12);
  // Second pipe run along the south wall, higher, plus a mid-yard pipe stack
  // that breaks the long east sightline.
  const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 24, 12), mats.rust);
  pipe2.rotation.z = Math.PI / 2;
  pipe2.position.set(-2, 4.1, 17.4);
  pipe2.castShadow = true;
  group.add(pipe2);
  shootables.push(pipe2);
  box(3.4, 0.9, 0.9, 10.5, 0.45, -6, 'steel');
  box(2.6, 0.9, 0.9, 10.5, 1.35, -6, 'rust');
  box(1.4, 1.1, 1.4, -15.5, 0.55, 8.5, 'crate');
  box(1.4, 1.1, 1.4, 15.5, 0.55, -8.5, 'crate');
  box(1.2, 1.1, 1.2, 17, 0.55, 8, 'crate');
  for (const [bx, bz] of [[-17.5, -7.5], [-16.6, -7.5]]) cylinder(0.55, 0.55, 1.3, bx, bz, 'steel', 12);
  // Painted lane guides on the floor: worn amber chevrons down the west and
  // east lanes, so the three lanes read at a glance. Flat decals, no collision.
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xd8a020, transparent: true, opacity: 0.5 });
  for (const [lx, lz, ry] of [[-10, 6, 0], [10, -6, 0], [0, -6, 0]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 7), laneMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = ry;
    strip.position.set(lx, 0.02, lz);
    group.add(strip);
  }
  // Lit window strips high on the perimeter walls: the foundry at work.
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  for (const [wx, wz, ry] of [[-8, -17.9, 0], [4, -17.9, 0], [-4, 17.9, Math.PI], [10, 17.9, Math.PI]]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), windowMat);
    win.position.set(wx, 3.9, wz);
    win.rotation.y = ry;
    group.add(win);
  }

  // ---- Skyline and beacons beyond the walls ----
  // Dark factory silhouettes on the horizon so the yard sits in a city, not
  // a void, and two chimney stacks north of the wall with blinking red
  // aircraft beacons — the only moving lights in the sky.
  const skylineMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1e1610), roughness: 1 });
  for (const [sx, sz, sw, sh, sd] of [[-14, -26, 8, 11, 6], [2, -28, 6, 15, 6], [16, -26, 9, 8, 6], [-24, -6, 6, 9, 8], [24, 8, 6, 12, 8], [-22, 12, 6, 7, 6]]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), skylineMat);
    block.position.set(sx, sh / 2 - 0.5, sz);
    group.add(block);
  }
  const beaconMats = [];
  for (const [cx, cz, ch] of [[-8, -23, 14], [10, -23, 11]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, ch, 12), mats.rust);
    stack.position.set(cx, ch / 2 - 0.5, cz);
    group.add(stack);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 2 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), beaconMat);
    beacon.position.set(cx, ch - 0.3, cz);
    group.add(beacon);
    beaconMats.push(beaconMat);
  }

  // ---- Sky, fog and dusk light ----
  // Warm furnace glow low in the west against a cooling blue dusk overhead:
  // the palette the whole game reads by. Brighter than v1 — the v1 frames
  // came out muddy because the mid-ground fell to near-black.
  scene.background = new THREE.Color(0x3a2620);
  scene.fog = new THREE.Fog(new THREE.Color(0x3a2620), 24, 70);
  const skyGeo = new THREE.SphereGeometry(90, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x27355e) },
      mid: { value: new THREE.Color(0xa85428) },
      low: { value: new THREE.Color(0xff9a3c) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h)) : mix(low, mid, smoothstep(-0.05, 0.25, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  // Low sun disc on the western horizon, the light the whole yard is lit by.
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 128; sunCanvas.height = 128;
  const sctx = sunCanvas.getContext('2d');
  const sunGrad = sctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  sunGrad.addColorStop(0, 'rgba(255,214,140,1)');
  sunGrad.addColorStop(0.35, 'rgba(255,150,60,0.85)');
  sunGrad.addColorStop(1, 'rgba(255,120,40,0)');
  sctx.fillStyle = sunGrad;
  sctx.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false }));
  sunDisc.position.set(-70, 10, -30);
  sunDisc.scale.set(34, 34, 1);
  scene.add(sunDisc);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0x5a6a94), new THREE.Color(0x3a2a1c), 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xff9a3c), 3.2);
  sun.position.set(-26, 12, 6);
  sun.target.position.set(4, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6a7ab0), 1.0);
  fill.position.set(14, 10, -12);
  scene.add(fill);
  // Furnace glow and crane-bay lamp
  const furnaceLight = new THREE.PointLight(new THREE.Color(0xff6a00), 30, 16, 1.8);
  furnaceLight.position.set(-13, 1.6, -12.6);
  scene.add(furnaceLight);
  const lampB = new THREE.PointLight(new THREE.Color(0xffc46a), 18, 14, 1.8);
  lampB.position.set(13, 5.4, 11);
  scene.add(lampB);
  const lampMid = new THREE.PointLight(new THREE.Color(0x9ab0ff), 12, 12, 1.8);
  lampMid.position.set(0, 4.5, 0);
  scene.add(lampMid);

  // Site letter plates (canvas sprites) floating above each site.
  function sitePlate(text, x, z) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(20,14,10,0.85)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#f0a830';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 58);
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#f2ede4';
    ctx.fillText(text === 'A' ? 'FURNACE' : 'CRANE BAY', 128, 104);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.set(x, 4.6, z);
    sprite.scale.set(2.6, 1.3, 1);
    scene.add(sprite);
    return sprite;
  }
  const plateA = sitePlate('A', SITES.A.center.x, SITES.A.center.z);
  const plateB = sitePlate('B', SITES.B.center.x, SITES.B.center.z);

  let time = 0;
  return {
    colliders,
    shootables,
    group,
    step(dt) {
      time += dt;
      // Furnace mouth breathes; site plates bob gently; beacons blink.
      furnaceLight.intensity = 30 + Math.sin(time * 2.1) * 4 + Math.sin(time * 5.7) * 2;
      plateA.position.y = 4.6 + Math.sin(time * 0.9) * 0.12;
      plateB.position.y = 4.6 + Math.sin(time * 0.9 + 2) * 0.12;
      beaconMats.forEach((m, i) => { m.emissiveIntensity = Math.sin(time * 2.2 + i * 2.1) > 0 ? 2.4 : 0.12; });
    },
  };
}

// Breadth-first route across the waypoint graph, from the node nearest `from`
// to the node nearest `to`. Returns a list of {x,z} targets.
export function findRoute(from, to) {
  const { nodes, edges } = WAYPOINTS;
  const adj = nodes.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const nearest = (p) => {
    let best = 0; let bd = Infinity;
    nodes.forEach((n, i) => {
      const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const start = nearest(from);
  const goal = nearest(to);
  if (start === goal) return [{ x: to.x, z: to.z }];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const next of adj[cur]) {
      if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
    }
  }
  if (prev[goal] === -1) return [{ x: to.x, z: to.z }];
  const path = [];
  let cur = goal;
  while (cur !== start) { path.unshift(nodes[cur]); cur = prev[cur]; }
  path.push({ x: to.x, z: to.z });
  return path;
}
