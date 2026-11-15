// Kestrel Yard: a decommissioned freight yard at dusk, 44 x 36 m.
// Lanes: A lane (west, past the warehouse), B lane (east, through the container
// stacks), mid (down the rail spine), and a connector behind the crane.
// Sites: A = the warehouse floor (west), B = the container stacks (east).
// Every box is a collider for movement and a surface bullets stop on.
// Textures are procedural canvas (palette.makeCanvasTexture); lights are a
// dusk hemisphere + one warm directional key + six amber sodium lamps.
import * as THREE from 'three';
import { PALETTE, makeCanvasTexture, speckle } from './palette.js';

export const SITES = {
  A: { x: -16.5, z: -10.5, name: 'SITE A — WAREHOUSE' },
  B: { x: 16.5, z: -10.5, name: 'SITE B — CONTAINERS' },
};
export const SPAWNS = {
  vanguard: [[-4, 15], [0, 15.5], [4, 15], [8, 14]],
  jackal: [[-6, -15], [-2, -15.5], [2, -15.5], [6, -15]],
};
// Waypoint graph: bots walk node to node. [x, z, neighbours...]
export const WAYPOINTS = [
  [0, 15], [0, 8], [0, 0], [0, -8], [0, -15], // mid spine 0-4
  [-10, 12], [-16, 6], [-16, -2], [-16, -10], [-10, -14], // A lane 5-9
  [10, 12], [16, 6], [16, -2], [16, -10], [10, -14], // B lane 10-14
  [-8, 0], [8, 0], [-8, -8], [8, -8], // connector 15-18
  [-4, -12], [4, -12], [-12, 12], [12, 12], // site approaches 19-22
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [9, 4], [0, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 4],
  [2, 15], [15, 7], [2, 16], [16, 12], [15, 17], [16, 18], [17, 3], [18, 3],
  [3, 19], [19, 9], [3, 20], [20, 14], [1, 21], [21, 5], [1, 22], [22, 10],
  [8, 17], [13, 18], [6, 15], [11, 16],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const lamps = [];

  const concreteTex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#3a4042'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 11, ['#2a2f30', '#4a5052', '#55503e'], 900);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * s) / 4, 0); ctx.lineTo((i * s) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 4); ctx.lineTo(s, (i * s) / 4); ctx.stroke();
    }
  });
  concreteTex.repeat.set(11, 9);
  const rustTex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5a3a28'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 23, ['#7a4a2a', '#3a2418', '#8a5a30', '#2a2f30'], 1400);
    ctx.fillStyle = 'rgba(245,166,35,0.16)';
    ctx.fillRect(0, 0, s, 10); ctx.fillRect(0, s - 10, s, 10);
  });
  const wallTex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#33393d'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 37, ['#23282b', '#454e52', '#5a4a34'], 1100);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
    for (let y = 32; y < s; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  });
  const hazardTex = makeCanvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#c8931a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#1c1c1c';
    for (let i = -2; i < 6; i += 1) {
      ctx.save(); ctx.translate(i * 32, 0); ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, -20, 16, s + 40); ctx.restore();
    }
  });

  const matConcrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0.02 });
  const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.05 });
  const matRust = new THREE.MeshStandardMaterial({ map: rustTex, roughness: 0.75, metalness: 0.35 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.55, metalness: 0.6 });
  const matAmber = new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.5, metalness: 0.2, emissive: 0x7a4d00, emissiveIntensity: 0.6 });
  const matHazard = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8 });
  const matTeal = new THREE.MeshStandardMaterial({ color: 0x2e5a66, roughness: 0.7, metalness: 0.3 });
  const matRed = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.7, metalness: 0.3 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1c2122, roughness: 0.9 });
  const matLamp = new THREE.MeshBasicMaterial({ color: 0xffc45e });

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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

  // Ground + perimeter (44 x 36, walls 5 m).
  box(44.4, 0.4, 36.4, 0, -0.2, 0, matConcrete);
  box(0.5, 5, 36.4, -22.2, 2.5, 0, matWall);
  box(0.5, 5, 36.4, 22.2, 2.5, 0, matWall);
  box(44.4, 5, 0.5, 0, 2.5, -18.2, matWall);
  box(44.4, 5, 0.5, 0, 2.5, 18.2, matWall);

  // Rail spine down mid: two rusted rails + sleepers (low, walkable look, no collide on rails).
  for (const rx of [-0.8, 0.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 34), matSteel);
    rail.position.set(rx, 0.07, 0); rail.receiveShadow = true; group.add(rail);
  }
  for (let z = -16; z <= 16; z += 2) box(2.4, 0.08, 0.5, 0, 0.04, z, matDark, false);

  // SITE A warehouse (west): three walls + roof edge, open to the east.
  box(0.6, 4.2, 11, -20.5, 2.1, -10.5, matWall);
  box(8, 4.2, 0.6, -16.5, 2.1, -15.7, matWall);
  box(8, 4.2, 0.6, -16.5, 2.1, -5.3, matWall);
  box(8.4, 0.3, 11.4, -16.5, 4.35, -10.5, matRust);
  box(2.2, 1.0, 1.2, -19, 0.5, -8, matRust); // pallets inside A
  box(1.4, 0.9, 1.4, -14.5, 0.45, -13, matSteel);
  // Hazard strip marking the plant zone at A.
  const stripA = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 3.4), matHazard);
  stripA.position.set(-16.5, 0.03, -10.5); stripA.receiveShadow = true; group.add(stripA);

  // SITE B container stacks (east): corrugated boxes, two high in places.
  box(6, 2.6, 2.6, 16.5, 1.3, -13.5, matRust);
  box(6, 2.6, 2.6, 16.5, 1.3, -7.5, matTeal);
  box(6, 2.6, 2.6, 16.5, 3.9, -13.5, matTeal);
  box(2.6, 2.6, 6, 12.5, 1.3, -10.5, matRed);
  box(2.6, 2.6, 2.6, 19.5, 1.3, -8, matRust);
  const stripB = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 3.4), matHazard);
  stripB.position.set(16.5, 0.03, -10.5); stripB.receiveShadow = true; group.add(stripB);

  // Mid cover: crane legs, crates, a low wall, a tanker.
  box(1.0, 5.5, 1.0, -3, 2.75, 0, matSteel);
  box(1.0, 5.5, 1.0, 3, 2.75, 0, matSteel);
  box(7.4, 0.8, 1.2, 0, 5.6, 0, matAmber); // crane beam
  box(1.6, 1.6, 1.6, -5.5, 0.8, -3, matRust);
  box(1.2, 1.2, 1.2, -5.5, 2.2, -3, matTeal);
  box(1.6, 1.6, 1.6, 5.5, 0.8, -3, matTeal);
  box(1.2, 1.2, 1.2, 5.5, 2.2, -3, matRust);
  box(4.5, 1.1, 1.1, 0, 0.55, 6.5, matSteel); // mid low wall
  box(3.2, 1.1, 1.6, -9, 0.55, 8.5, matRust);
  box(3.2, 1.1, 1.6, 9, 0.55, 8.5, matTeal);
  // Tanker cylinder lying across the connector.
  const tanker = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 18), matRust);
  tanker.rotation.z = Math.PI / 2; tanker.position.set(-11, 1.1, -2);
  tanker.castShadow = true; tanker.receiveShadow = true; group.add(tanker);
  colliders.push(new THREE.Box3(new THREE.Vector3(-13.5, 0, -3.1), new THREE.Vector3(-8.5, 2.2, -0.9)));
  shootables.push(tanker);
  // Spawn cover + scattered crates.
  box(2.2, 1.1, 1.2, -6, 0.55, 13.5, matRust);
  box(2.2, 1.1, 1.2, 6, 0.55, 13.5, matTeal);
  box(1.4, 1.4, 1.4, -13, 0.7, 2, matTeal);
  box(1.4, 1.4, 1.4, 13, 0.7, 2, matRust);
  box(1.2, 0.9, 1.2, -2, 0.45, -12, matRust);
  box(1.2, 0.9, 1.2, 2, 0.45, -12, matTeal);
  box(2.0, 1.0, 1.0, 18, 0.5, 4, matRust);
  box(2.0, 1.0, 1.0, -18, 0.5, 4, matTeal);

  // Site markers: floating amber beacon rings (visual only).
  for (const key of ['A', 'B']) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.06, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.75 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(SITES[key].x, 2.6, SITES[key].z);
    ring.userData.siteRing = key;
    group.add(ring);
    lamps.push(ring);
  }

  // Sodium lamps on poles: warm pools of light.
  const lampSpots = [[-10, 6], [10, 6], [-10, -6], [10, -6], [0, 14], [0, -14]];
  for (const [x, z] of lampSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), matSteel);
    pole.position.set(x, 2.3, z); pole.castShadow = true; group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), matLamp);
    head.position.set(x, 4.65, z); group.add(head);
    const light = new THREE.PointLight(0xff9a2e, 26, 15, 1.8);
    light.position.set(x, 4.4, z);
    scene.add(light);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.15, 0, z - 0.15), new THREE.Vector3(x + 0.15, 4.6, z + 0.15)));
  }

  // Dusk lighting: teal hemisphere, warm low key sun, cool fill.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color('#0c1418'), 1.35));
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.1);
  key.position.set(-14, 16, 10);
  key.target.position.set(4, 0, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26; key.shadow.camera.right = 26;
  key.shadow.camera.top = 22; key.shadow.camera.bottom = -22;
  key.shadow.camera.far = 60; key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7d8c'), 0.75);
  fill.position.set(12, 10, -12);
  scene.add(fill);

  // Segment vs AABB line-of-sight: true when nothing solid blocks a->b.
  // Walls only (colliders taller than 1.2 m count); low crates do not block sight.
  const tall = colliders.filter((b) => b.max.y - b.min.y > 1.2 && b.max.y > 1.2);
  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    for (const box3 of tall) {
      let tmin = 0; let tmax = 1;
      const o = [ax, ay, az]; const d = [dx, dy, dz];
      const mn = [box3.min.x, box3.min.y, box3.min.z];
      const mx = [box3.max.x, box3.max.y, box3.max.z];
      let blocked = false;
      for (let i = 0; i < 3; i += 1) {
        if (Math.abs(d[i]) < 1e-9) {
          if (o[i] < mn[i] || o[i] > mx[i]) { blocked = true; break; }
        } else {
          let t1 = (mn[i] - o[i]) / d[i];
          let t2 = (mx[i] - o[i]) / d[i];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { blocked = true; break; }
        }
      }
      if (!blocked && tmin < 1 && tmax > 0) return false;
    }
    return true;
  }

  return { colliders, shootables, group, lamps, losClear, waypoints: WAYPOINTS, edges: EDGES };
}
