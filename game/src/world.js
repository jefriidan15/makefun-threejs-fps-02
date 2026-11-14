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
    { x: 0, z: 0 }, // 6 centre yard
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
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 900, ['#3a332b', '#5a5148', '#2e2822'], 2, 22);
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
  }, 8, 7);
  const wall = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#3d3630';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 500, ['#2e2822', '#4d443a', '#6b543a'], 2, 14);
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
  return { floor, wall, container, crate, hazard };
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
    new THREE.MeshStandardMaterial({ color: 0x1a0e06, emissive: new THREE.Color('#ff6a00'), emissiveIntensity: 1.5 }),
  );
  furnaceMouth.position.set(-13, 1.1, -13.9);
  group.add(furnaceMouth);
  shootables.push(furnaceMouth);
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

  // ---- Sky, fog and dusk light ----
  scene.background = new THREE.Color(0x2a1c22);
  scene.fog = new THREE.Fog(new THREE.Color(0x2a1c22), 22, 62);
  const skyGeo = new THREE.SphereGeometry(90, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x1c2440) },
      mid: { value: new THREE.Color(0x7a3a2e) },
      low: { value: new THREE.Color(0xf08a2e) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h)) : mix(low, mid, smoothstep(-0.05, 0.25, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0x4a5578), new THREE.Color(0x2a1c14), 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xff9a3c), 2.6);
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
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6a7ab0), 0.75);
  fill.position.set(14, 10, -12);
  scene.add(fill);
  // Furnace glow and crane-bay lamp
  const furnaceLight = new THREE.PointLight(new THREE.Color(0xff6a00), 26, 16, 1.8);
  furnaceLight.position.set(-13, 1.6, -12.6);
  scene.add(furnaceLight);
  const lampB = new THREE.PointLight(new THREE.Color(0xffc46a), 14, 14, 1.8);
  lampB.position.set(13, 5.4, 11);
  scene.add(lampB);
  const lampMid = new THREE.PointLight(new THREE.Color(0x9ab0ff), 8, 12, 1.8);
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
    sprite.position.set(x, 5.4, z);
    sprite.scale.set(3.4, 1.7, 1);
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
      // Furnace mouth breathes; site plates bob gently.
      furnaceLight.intensity = 24 + Math.sin(time * 2.1) * 4 + Math.sin(time * 5.7) * 2;
      plateA.position.y = 5.4 + Math.sin(time * 0.9) * 0.12;
      plateB.position.y = 5.4 + Math.sin(time * 0.9 + 2) * 0.12;
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
