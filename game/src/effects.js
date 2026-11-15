// Transient effects, all pooled and reused: tracers, impact sparks, the planted
// charge's blink and the explosion. Nothing allocates in the per-frame path
// beyond a few pooled vectors.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 10;

export function createEffects(scene) {
  // Tracers are thin additive cylinders stretched from muzzle to impact, not
  // 1 px lines: v1's lines were nearly invisible at 1280x720. Pooled, reused,
  // nothing allocated in the per-frame path beyond pooled vectors.
  const tracers = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(geo, mat);
    beam.frustumCulled = false;
    beam.visible = false;
    scene.add(beam);
    tracers.push({ beam, life: 0 });
  }
  let tracerCursor = 0;

  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const count = 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffc46a, size: 0.13, transparent: true, opacity: 0, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, velocities: new Float32Array(count * 3), life: 0, count });
  }
  let sparkCursor = 0;

  // Impact glow: one soft additive sprite per hit, pooled, fades in 0.25 s.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 64;
  {
    const ctx = glowCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,230,160,1)');
    grad.addColorStop(0.4, 'rgba(255,160,60,0.7)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glows = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.visible = false;
    scene.add(sprite);
    glows.push({ sprite, life: 0 });
  }
  let glowCursor = 0;

  // Smoke screen: pooled grey sprites that bloom out and hang for 12 s.
  // One sprite per puff, six in the pool; the visuals live here, the
  // line-of-sight block lives in main.js (it owns the smoke list the bots read).
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = 128; smokeCanvas.height = 128;
  {
    const ctx = smokeCanvas.getContext('2d');
    for (let i = 0; i < 26; i += 1) {
      const gx = 20 + Math.random() * 88;
      const gy = 20 + Math.random() * 88;
      const gr = 14 + Math.random() * 26;
      const grad = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
      grad.addColorStop(0, 'rgba(168,164,158,0.85)');
      grad.addColorStop(1, 'rgba(168,164,158,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
    }
  }
  const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
  smokeTexture.colorSpace = THREE.SRGBColorSpace;
  const smokes = [];
  for (let i = 0; i < 6; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    smokes.push({ sprite, life: 0 });
  }
  let smokeCursor = 0;

  const explosionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, depthWrite: false }),
  );
  explosionMesh.visible = false;
  scene.add(explosionMesh);
  const explosionLight = new THREE.PointLight(new THREE.Color(0xff7a1a), 0, 30, 1.6);
  scene.add(explosionLight);
  let explosionLife = 0;

  const chargeMesh = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.32, 0.36),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1c1c22), roughness: 0.5, metalness: 0.4, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 0.4 }),
  );
  const chargeLight = new THREE.PointLight(new THREE.Color(0xff2a1a), 0, 6, 1.6);
  chargeLight.position.y = 0.3;
  chargeMesh.add(chargeBody, chargeLight);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
  let chargeBlink = 0;

  const tmp = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  return {
    tracer(from, to, color = 0xffe9a8) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const length = tmpDir.copy(to).sub(from).length();
      if (length < 0.05) return;
      slot.beam.position.copy(from);
      slot.beam.quaternion.setFromUnitVectors(up, tmpDir.normalize());
      slot.beam.scale.set(1, length, 1);
      slot.beam.material.color.setHex(color);
      slot.beam.material.opacity = 0.75;
      slot.beam.visible = true;
      slot.life = 0.09;
    },
    sparksAt(point, normal) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const pos = slot.points.geometry.attributes.position.array;
      const n = normal ? tmp.copy(normal).normalize() : tmp.set(0, 1, 0);
      for (let i = 0; i < slot.count; i += 1) {
        pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
        const spread = 2.6;
        slot.velocities[i * 3] = n.x * 2.4 + (Math.random() - 0.5) * spread;
        slot.velocities[i * 3 + 1] = Math.abs(n.y) * 2.4 + Math.random() * 2.8;
        slot.velocities[i * 3 + 2] = n.z * 2.4 + (Math.random() - 0.5) * spread;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.opacity = 1;
      slot.life = 0.45;
      const glow = glows[glowCursor];
      glowCursor = (glowCursor + 1) % MAX_SPARKS;
      glow.sprite.position.copy(point);
      glow.sprite.scale.setScalar(0.55);
      glow.sprite.material.opacity = 0.9;
      glow.sprite.visible = true;
      glow.life = 0.25;
    },
    explosion(point) {
      explosionMesh.position.copy(point);
      explosionMesh.visible = true;
      explosionMesh.scale.setScalar(0.5);
      explosionLife = 0.7;
      explosionLight.position.copy(point).y += 1;
      explosionLight.intensity = 120;
      this.sparksAt(point, null);
    },
    smokeAt(point) {
      const slot = smokes[smokeCursor];
      smokeCursor = (smokeCursor + 1) % smokes.length;
      slot.sprite.position.set(point.x, 1.1, point.z);
      slot.sprite.scale.setScalar(1.5);
      slot.sprite.material.opacity = 0.55;
      slot.sprite.visible = true;
      slot.life = 12;
    },
    showCharge(point) {
      chargeMesh.position.set(point.x, 0.2, point.z);
      chargeMesh.visible = true;
      chargeBlink = 0;
    },
    hideCharge() {
      chargeMesh.visible = false;
      chargeLight.intensity = 0;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.beam.material.opacity = Math.max(0, t.life / 0.09) * 0.75;
          if (t.life <= 0) t.beam.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          const pos = s.points.geometry.attributes.position.array;
          for (let i = 0; i < s.count; i += 1) {
            pos[i * 3] += s.velocities[i * 3] * dt;
            pos[i * 3 + 1] += s.velocities[i * 3 + 1] * dt;
            pos[i * 3 + 2] += s.velocities[i * 3 + 2] * dt;
            s.velocities[i * 3 + 1] -= 9 * dt;
          }
          s.points.geometry.attributes.position.needsUpdate = true;
          s.points.material.opacity = Math.max(0, s.life / 0.45);
        }
      }
      if (explosionLife > 0) {
        explosionLife -= dt;
        const k = 1 - Math.max(0, explosionLife / 0.7);
        explosionMesh.scale.setScalar(0.5 + k * 7);
        explosionMesh.material.opacity = Math.max(0, explosionLife / 0.7) * 0.85;
        explosionLight.intensity = Math.max(0, explosionLife / 0.7) * 120;
        if (explosionLife <= 0) explosionMesh.visible = false;
      }
      for (const g of glows) {
        if (g.life > 0) {
          g.life -= dt;
          g.sprite.material.opacity = Math.max(0, g.life / 0.25) * 0.9;
          if (g.life <= 0) g.sprite.visible = false;
        }
      }
      // Smoke blooms to full size in the first second, holds, then thins
      // out over the last three.
      for (const s of smokes) {
        if (s.life > 0) {
          s.life -= dt;
          const age = 12 - s.life;
          const scale = Math.min(4.6, 1.5 + age * 3.1);
          s.sprite.scale.setScalar(scale);
          s.sprite.material.opacity = s.life < 3 ? 0.55 * (s.life / 3) : 0.55;
          if (s.life <= 0) s.sprite.visible = false;
        }
      }
      if (chargeMesh.visible) {
        chargeBlink += dt;
        const on = Math.sin(chargeBlink * 9) > 0;
        chargeLight.intensity = on ? 6 : 0.4;
        chargeBody.material.emissiveIntensity = on ? 1.6 : 0.3;
      }
    },
  };
}
