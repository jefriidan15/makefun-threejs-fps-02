// Transient effects, all pooled and reused: tracers, impact sparks, the planted
// charge's blink and the explosion. Nothing allocates in the per-frame path
// beyond a few pooled vectors.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 10;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const count = 26;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffc46a, size: 0.09, transparent: true, opacity: 0, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, velocities: new Float32Array(count * 3), life: 0, count });
  }
  let sparkCursor = 0;

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

  return {
    tracer(from, to, color = 0xffe9a8) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const pos = slot.line.geometry.attributes.position.array;
      pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
      pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.material.color.setHex(color);
      slot.line.material.opacity = 0.85;
      slot.life = 0.09;
    },
    sparksAt(point, normal) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const pos = slot.points.geometry.attributes.position.array;
      const n = normal ? tmp.copy(normal).normalize() : tmp.set(0, 1, 0);
      for (let i = 0; i < slot.count; i += 1) {
        pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
        const spread = 2.2;
        slot.velocities[i * 3] = n.x * 2 + (Math.random() - 0.5) * spread;
        slot.velocities[i * 3 + 1] = Math.abs(n.y) * 2 + Math.random() * 2.4;
        slot.velocities[i * 3 + 2] = n.z * 2 + (Math.random() - 0.5) * spread;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.opacity = 1;
      slot.life = 0.45;
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
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
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
      if (chargeMesh.visible) {
        chargeBlink += dt;
        const on = Math.sin(chargeBlink * 9) > 0;
        chargeLight.intensity = on ? 6 : 0.4;
        chargeBody.material.emissiveIntensity = on ? 1.6 : 0.3;
      }
    },
  };
}
