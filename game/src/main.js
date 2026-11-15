// SABLE LINE — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. All game state lives in `game` (below);
// modules own one job each: world (map), player, weapon, bots, economy,
// rounds, hud, audio, input. ?scene=buy|combat|plant|end with &seed=N sets
// up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, WEAPON_ORDER } from './weapon.js';
import { createBots } from './bots.js';
import { createEconomy } from './economy.js';
import { createRounds, BUY_SECONDS, ROUND_SECONDS, WIN_ROUNDS, PLANT_SECONDS, DEFUSE_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const sceneParam = params.get('scene');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

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
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three 0.187
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const bots = createBots(scene, world);
const economy = createEconomy();
const rounds = createRounds();
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// One shared state object: the whole match, in one place.
const game = {
  time: 0, started: false, frozen: false, buyOpen: false,
  playerDead: false, kills: 0,
};

const body = player.state;
const botMeshes = bots.bots.map((b) => b.mesh);
const shootables = world.shootables;
const dir = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

// --- tracers: a reused pool of 14 line segments, no allocation in hot loops
const tracers = [];
for (let i = 0; i < 14; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc45e, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.opacity = 0.9;
  t.life = 0.09;
}

// --- the spark charge: blinking amber box at the planted site
const chargeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.35, 0.35),
  new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0xa35a00, emissiveIntensity: 1.2 }),
);
chargeMesh.visible = false;
scene.add(chargeMesh);
const chargeLight = new THREE.PointLight(0xff5a2e, 0, 9);
scene.add(chargeLight);

// --- grenades in flight
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e5a33, roughness: 0.6, metalness: 0.4 });

function damageAgent(target, amount, attacker, isHead) {
  // target: player.state (kind 'player') or a bot object.
  const isPlayer = target === body;
  if (isPlayer && !body.alive) return;
  if (!isPlayer && !target.alive) return;
  let dmg = amount;
  const armor = target.armor || 0;
  if (armor > 0) {
    const absorbed = Math.min(armor, dmg * 0.5);
    target.armor -= absorbed;
    dmg -= absorbed;
  }
  target.health -= dmg;
  if (isPlayer) {
    hud.damage();
    audio.hurt();
    hud.setHealth(body.health, body.armor);
  }
  if (target.health > 0) return;
  target.health = 0;
  if (isPlayer) {
    body.alive = false;
    game.playerDead = true;
    hud.showBanner('YOU ARE DOWN — your team fights on', 2200);
  } else {
    bots.kill(target);
    const killer = attacker === body ? 'You' : (attacker && attacker.name) || 'Unknown';
    hud.killFeed(`${killer} ▸ ${target.name}${isHead ? ' (headshot)' : ''}`);
    if (attacker === body) {
      economy.killReward();
      audio.hit(true);
      hud.setMoney(economy.state.money);
    }
  }
}

function shootPlayer(spread) {
  if (!weapon.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(dir);
  dir.x += (random() * 2 - 1) * spread;
  dir.y += (random() * 2 - 1) * spread;
  dir.z += (random() * 2 - 1) * spread;
  dir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, dir);
  const hits = raycaster.intersectObjects(shootables.concat(botMeshes), true);
  const hit = hits[0];
  const end = tmpV.copy(dir).multiplyScalar(60).add(camera.position);
  if (hit) end.copy(hit.point);
  spawnTracer(camera.position, end);
  if (hit) {
    const obj = hit.object;
    const bot = obj.userData.bot;
    if (bot && bot.alive) {
      const isHead = obj.userData.part === 'head';
      const def = weapon.def();
      const dmg = Math.round(def.damage * (isHead ? def.headMul : 1));
      damageAgent(bot, dmg, body, isHead);
      hud.hitMarker(bot.health <= 0, 90);
      audio.hit(bot.health <= 0);
    }
  }
  weapon.pullTrigger();
  audio.shot(weapon.def().kind, false);
  player.recoil(weapon.def().kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  bots.hear(body.position.x, body.position.z, game.time);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  return true;
}

function throwGrenade() {
  if (weapon.state.grenades <= 0 || rounds.state.phase !== 'live') return;
  weapon.state.grenades -= 1;
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  camera.getWorldDirection(dir);
  mesh.position.copy(camera.position);
  scene.add(mesh);
  grenades.push({ mesh, vel: tmpV2.copy(dir).multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)).clone(), fuse: 1.4, bounced: false });
  audio.shot('pistol', false);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  audio.explosion();
  const flash = new THREE.PointLight(0xffa040, 60, 18, 1.5);
  flash.position.copy(g.mesh.position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 220);
  const p = g.mesh.position;
  // Damage falls off with distance; the thrower is not immune.
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z);
    if (d < 6) damageAgent(bot, Math.round(110 * (1 - d / 7)), body, false);
  }
  if (body.alive) {
    const d = Math.hypot(body.position.x - p.x, body.position.z - p.z);
    if (d < 6) damageAgent(body, Math.round(90 * (1 - d / 7)), null, false);
  }
  bots.hear(p.x, p.z, game.time);
}

function plantProgress(dt) {
  // Player is Vanguard: only defuse. E held near the planted charge.
  const rs = rounds.state;
  if (rs.charge !== 'planted' || !body.alive) { rs.defusing = 0; return; }
  const site = SITES[rs.site];
  const d = Math.hypot(site.x - body.position.x, site.z - body.position.z);
  if (input.state.keys.has('KeyE') && d < 2.6) {
    rs.defusing += dt / DEFUSE_SECONDS;
    rs.defuser = 'You';
    if (Math.floor(rs.defusing * 20) !== Math.floor((rs.defusing - dt / DEFUSE_SECONDS) * 20)) audio.defuseTick();
    hud.setProgress(`DEFUSING — ${rs.site}`, rs.defusing);
    if (rs.defusing >= 1) onDefused();
  } else if (rs.planting > 0 && rs.planter) {
    hud.setProgress(`PLANTING — ${rs.site} (${rs.planter})`, rs.planting);
  } else if (rs.defusing > 0 && rs.defuser && rs.defuser !== 'You') {
    hud.setProgress(`DEFUSING — ${rs.site} (${rs.defuser})`, rs.defusing);
  } else {
    rs.defusing = 0;
    hud.setProgress(null, 0);
  }
}

function onPlanted(site) {
  rounds.state.charge = 'planted';
  const s = SITES[site];
  chargeMesh.position.set(s.x, 0.35, s.z);
  chargeMesh.visible = true;
  chargeLight.position.set(s.x, 1.2, s.z);
  chargeLight.intensity = 14;
  audio.planted();
  hud.showBanner(`CHARGE PLANTED AT SITE ${site} — DEFUSE IT`, 3000);
  hud.setCharge(`CHARGE AT SITE ${site} — ${Math.ceil(rounds.state.fuse)}s`, 'hot');
}

function onDefused() {
  rounds.state.charge = 'none';
  chargeMesh.visible = false;
  chargeLight.intensity = 0;
  hud.setCharge('', '');
  hud.setProgress(null, 0);
  endRound('vanguard', 'Charge defused');
}

function endRound(winner, reason) {
  if (rounds.state.phase !== 'live') return;
  const won = winner === 'vanguard';
  economy.roundEnd(won);
  rounds.endRound(winner, reason);
  chargeMesh.visible = false;
  chargeLight.intensity = 0;
  hud.setCharge('', '');
  hud.setProgress(null, 0);
  hud.setScore(rounds.state.vanguard, rounds.state.jackal, rounds.state.round);
  hud.setMoney(economy.state.money);
  hud.showBanner(won ? `ROUND WON — ${reason}` : `ROUND LOST — ${reason}`, 3400);
  if (won) audio.roundWin(); else audio.roundLose();
  if (rounds.state.phase === 'match') {
    const matchWon = rounds.state.vanguard >= WIN_ROUNDS;
    hud.showEnd(
      matchWon ? 'VANGUARD TAKES THE MATCH' : 'JACKALS TAKE THE MATCH',
      `${rounds.state.vanguard} — ${rounds.state.jackal} over ${rounds.state.round} rounds at Kestrel Yard. ${matchWon ? 'The yard holds.' : 'The charge did its work.'}`,
      'Play again',
    );
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function startRound() {
  const spawn = SPAWNS_V[0];
  player.reset(spawn[0], spawn[1], 0); // yaw 0 faces north, toward mid
  weapon.refillAmmo();
  bots.spawnAll({ vanguard: SPAWNS_V, jackal: SPAWNS_J }, random);
  game.playerDead = false;
  hud.setHealth(100, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.setScore(rounds.state.vanguard, rounds.state.jackal, rounds.state.round);
  hud.setMoney(economy.state.money);
}

const SPAWNS_V = [[-4, 15], [0, 15.5], [4, 15], [8, 14]];
const SPAWNS_J = [[-6, -15], [-2, -15.5], [2, -15.5], [6, -15]];

function startMatch() {
  economy.reset();
  rounds.resetMatch();
  weapon.equip('vk7');
  weapon.state.grenades = 0;
  body.armor = 0;
  startRound();
  game.buyOpen = true;
  hud.showBuy(economy.state.money);
  hud.setTimer(BUY_SECONDS, 'buy');
}

function step(dt) {
  game.time += dt;
  const rs = rounds.state;
  // --- round clock
  if (rs.phase === 'buy' || rs.phase === 'live') {
    rs.timeLeft -= dt;
    if (rs.phase === 'buy' && rs.timeLeft <= 0) {
      rounds.startLive();
      game.buyOpen = false;
      hud.hideBuy();
      hud.showBanner(rs.round === 1 ? 'ROUND 1 — DEFEND THE SITES' : `ROUND ${rs.round}`, 2000);
      if (!input.state.locked) hud.showOverlay('paused');
    } else if (rs.phase === 'live' && rs.timeLeft <= 0) {
      if (rs.charge === 'planted') {
        // Fuse keeps ticking below; time-out with a live charge is a Jackal win
        // only when the fuse also runs out — handled by the fuse branch.
      } else endRound('vanguard', 'Time expired — sites held');
    }
  } else if (rs.phase === 'over') {
    rs.timeLeft -= dt;
    if (rs.timeLeft <= 0) {
      rounds.nextRound();
      startRound();
      game.buyOpen = true;
      hud.showBuy(economy.state.money);
    }
  }
  // --- charge fuse
  if (rs.charge === 'planted') {
    rs.fuse -= dt;
    hud.setCharge(`CHARGE AT SITE ${rs.site} — ${Math.max(0, Math.ceil(rs.fuse))}s`, 'hot');
    chargeMesh.material.emissiveIntensity = 0.8 + Math.sin(game.time * 10) * 0.7;
    if (rs.fuse <= 0) {
      audio.explosion();
      endRound('jackal', 'Charge detonated');
    }
  }
  // --- win checks (live only)
  if (rs.phase === 'live') {
    if (bots.aliveCount('jackal') === 0) endRound('vanguard', 'Enemy team eliminated');
    else if (bots.aliveCount('vanguard') === 0 && !body.alive) endRound('jackal', 'Vanguard eliminated');
  }

  // --- input edges
  for (const code of input.drainPressed()) {
    if (code === 'KeyR' && rs.phase === 'live') {
      if (weapon.reload()) audio.reload();
    } else if (code === 'KeyB' && rs.phase === 'buy') {
      game.buyOpen = !game.buyOpen;
      if (game.buyOpen) { hud.showBuy(economy.state.money); if (document.pointerLockElement) document.exitPointerLock(); }
      else { hud.hideBuy(); input.requestLock(); }
    } else if (code === 'KeyG' && rs.phase === 'live') throwGrenade();
    else if (code.startsWith('Digit') && game.buyOpen && rs.phase === 'buy') {
      const map = { Digit1: 'p9', Digit2: 'rook', Digit3: 'vk7', Digit4: 'longbow', Digit5: 'grenade', Digit6: 'armor' };
      const id = map[code];
      if (id) {
        const bought = economy.buy(id, weapon, player);
        if (bought) { audio.buy(); hud.setMoney(economy.state.money); hud.showBuy(economy.state.money); hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades); }
        else audio.denied();
      }
    }
  }

  // --- player + weapon
  player.step(dt, input.state.keys);
  weapon.step(dt);
  if (input.state.firing && weapon.ready() && rs.phase === 'live' && body.alive) {
    shootPlayer(weapon.spread(player.groundSpeed(), body.crouching));
  }
  if (input.state.firing && weapon.state.mag === 0 && weapon.ready()) {
    if (weapon.reload()) audio.reload();
  }
  plantProgress(dt);

  // --- bots
  bots.step({
    time: game.time, dt, player: body, rounds, world, sites: SITES, random,
    damageAgent: (target, dmg, attacker, head) => damageAgent(target.ref || target, dmg, attacker, head),
    noise: (x, z) => bots.hear(x, z, game.time),
    onShot: (bot, ox, oy, oz, dx, dy, dz) => {
      tmpV.set(ox + dx * 40, oy + dy * 40, oz + dz * 40);
      tmpV2.set(ox, oy, oz);
      spawnTracer(tmpV2, tmpV);
      audio.shot('rifle', true);
    },
    onPlanted: (site) => onPlanted(site),
    onDefused: () => onDefused(),
  });

  // --- grenades
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.09) {
      g.mesh.position.y = 0.09;
      if (!g.bounced) { g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; g.bounced = true; }
      else g.vel.y = 0;
    }
    if (g.fuse <= 0) { explodeGrenade(g); grenades.splice(i, 1); }
  }
  // --- tracers fade
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    }
  }
  // --- HUD
  hud.setHealth(body.health, body.armor);
  hud.setTimer(rs.timeLeft, rs.phase);
  hud.setSpread(2 + weapon.spread(player.groundSpeed(), body.crouching) * 260 + weapon.state.bloom * 200);
  // Site rings pulse.
  for (const ring of world.lamps) {
    if (ring.userData.siteRing) {
      ring.rotation.z += dt * 0.6;
      ring.material.opacity = 0.45 + Math.sin(game.time * 2 + ring.position.x) * 0.25;
    }
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function onLockChange(locked) {
  if (sceneParam) return;
  audio.unlock();
  if (locked) {
    game.started = true;
    hud.hideOverlay();
    if (rounds.state.phase === 'buy' && !game.buyOpen) hud.hideBuy();
  } else if (rounds.state.phase !== 'match') {
    if (!game.buyOpen) hud.showOverlay(game.started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (sceneParam) return;
  if (rounds.state.phase === 'match') {
    startMatch();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  audio.unlock();
  if (rounds.state.phase === 'buy') {
    // Buy phase: stay unlocked so the mouse can click buy rows; B deploys
    // (closes the menu and takes pointer lock). Locking here would make the
    // menu unclickable, since a locked mouse never reaches the rows.
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});
hud.buildBuy((id) => {
  const bought = economy.buy(id, weapon, player);
  if (bought) {
    audio.buy();
    hud.setMoney(economy.state.money);
    hud.showBuy(economy.state.money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
    hud.setHealth(body.health, body.armor);
  } else audio.denied();
});

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!game.frozen) {
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
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
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
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(x, y, z) {
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  hud.hideBuy();
  game.buyOpen = false;
  if (name === 'buy') {
    body.position.set(-2, 0, 12);
    body.yaw = 0.15;
    body.pitch = -0.02;
    economy.state.money = 3200;
    rounds.state.phase = 'buy';
    rounds.state.timeLeft = 12;
    game.buyOpen = true;
    hud.showBuy(3200);
    hud.setMoney(3200);
    settle(30);
  } else if (name === 'combat') {
    rounds.startLive();
    rounds.state.timeLeft = 73;
    rounds.state.round = 3;
    rounds.state.vanguard = 2;
    rounds.state.jackal = 1;
    body.position.set(0, 0, 8);
    settle(10);
    // Place two Jackals in the mid sightline and one Vanguard teammate left.
    const j1 = bots.bots[3]; const j2 = bots.bots[4]; const v1 = bots.bots[0];
    j1.pos.set(-1.5, 0, -6); j1.yaw = 0; j1.mesh.position.copy(j1.pos);
    j2.pos.set(3.5, 0, -10); j2.yaw = 0.3; j2.mesh.position.copy(j2.pos);
    v1.pos.set(-6, 0, 4); v1.yaw = Math.PI; v1.mesh.position.copy(v1.pos);
    settle(6);
    aimAt(j1.pos.x, 1.2, j1.pos.z);
    shootPlayer(0);
    settle(4);
    aimAt(j2.pos.x, 1.2, j2.pos.z);
    hud.killFeed('You ▸ Vex');
    hud.showBanner('ROUND 3 — MID FIGHT', 4000);
    hud.setScore(2, 1, 3);
    hud.setMoney(1100);
  } else if (name === 'plant') {
    rounds.startLive();
    rounds.state.timeLeft = 41;
    rounds.state.round = 2;
    rounds.state.vanguard = 1;
    rounds.state.jackal = 0;
    body.position.set(20, 0, -10.5);
    settle(10);
    const j = bots.bots[3];
    j.pos.set(17, 0, -10.8); j.yaw = 1.2; j.mesh.position.copy(j.pos);
    rounds.plant('B');
    onPlanted('B');
    rounds.state.fuse = 12;
    settle(6);
    aimAt(16.5, 0.6, -10.5);
    hud.setScore(1, 0, 2);
    hud.setProgress('DEFUSE — HOLD E', 0.35);
  } else if (name === 'end') {
    rounds.state.vanguard = 5;
    rounds.state.jackal = 3;
    rounds.state.round = 8;
    rounds.state.phase = 'match';
    body.position.set(0, 0, 10);
    body.yaw = 0;
    settle(20);
    aimAt(0, 1.4, -8);
    hud.setScore(5, 3, 8);
    hud.showEnd(
      'VANGUARD TAKES THE MATCH',
      '5 — 3 over 8 rounds at Kestrel Yard. The yard holds.',
      'Play again',
    );
  }
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
  // Re-show transient UI last: virtual-time capture fast-forwards timers,
  // so banners and hit markers set earlier would already have expired.
  if (name === 'combat') {
    hud.hitMarker(false, 60000);
    hud.showBanner('ROUND 3 — MID FIGHT', 60000);
    hud.killFeed('You ▸ Vex');
  } else if (name === 'plant') {
    hud.showBanner('CHARGE PLANTED AT SITE B — DEFUSE IT', 60000);
    hud.setProgress('DEFUSE — HOLD E', 0.35);
  }
  // No banner for 'buy': the buy menu already fills the centre of the frame.
  syncCamera();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (sceneParam) runShot(sceneParam);
else {
  startMatch();
  requestAnimationFrame(frame);
}
