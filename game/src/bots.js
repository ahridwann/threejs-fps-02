// Bots: 7 of them — 3 Vanguard teammates, 4 Jackals. Each bot is a small
// state machine: route (walk a waypoint path), hold (watch an angle),
// attack (seen an enemy, burst fire), plant / defuse (the objective), and
// investigate (heard gunfire). Vision is distance + field of view + a real
// line-of-sight test against the map; hearing reacts to shots within 30 m.
// Shooting is hitscan against body/head spheres with error that grows with
// distance and target speed — bots miss moving targets at range, like people.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const NAMES_V = ['Kestrel', 'Bramble', 'Sable'];
const NAMES_J = ['Vex', 'Rook', 'Marrow', 'Talon'];
const BOT_HEALTH = 100;
const BOT_SPEED = 3.4;
const VIEW_DIST = 38;
const HEAR_DIST = 30;
const REACT_TIME = 0.45;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function bfs(waypoints, edges, from, to) {
  if (from === to) return [to];
  const adj = waypoints.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const n of adj[cur]) {
      if (prev[n] === -1) { prev[n] = cur; queue.push(n); }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let cur = to;
  while (cur !== from) { path.unshift(cur); cur = prev[cur]; }
  return path;
}

function nearestWp(waypoints, x, z) {
  let best = 0; let bd = 1e9;
  for (let i = 0; i < waypoints.length; i += 1) {
    const dx = waypoints[i][0] - x; const dz = waypoints[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function createBots(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const bots = [];
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 12, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const vestGeo = new THREE.BoxGeometry(0.56, 0.4, 0.34);
  const matV = new THREE.MeshStandardMaterial({ color: 0x4d8fa3, roughness: 0.7 });
  const matJ = new THREE.MeshStandardMaterial({ color: 0xc65a3a, roughness: 0.7 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 });
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xc9a37e, roughness: 0.7 });

  function makeBot(index, team, name) {
    const isV = team === 'vanguard';
    const mesh = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, isV ? matV : matJ);
    torso.position.y = 1.05;
    const vest = new THREE.Mesh(vestGeo, matDark);
    vest.position.y = 1.05;
    const head = new THREE.Mesh(headGeo, matSkin);
    head.position.y = 1.58;
    const legL = new THREE.Mesh(legGeo, matDark);
    legL.position.set(-0.14, 0.35, 0);
    const legR = new THREE.Mesh(legGeo, matDark);
    legR.position.set(0.14, 0.35, 0);
    const gun = new THREE.Mesh(gunGeo, matDark);
    gun.position.set(0.2, 1.15, -0.3);
    mesh.add(torso, vest, head, legL, legR, gun);
    mesh.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    group.add(mesh);
    const bot = {
      index, name, team, mesh, head, gun,
      pos: new THREE.Vector3(0, 0, 0),
      yaw: 0, health: BOT_HEALTH, armor: 0, alive: true,
      state: 'route', path: [], wpIndex: 0, holdUntil: 0,
      target: null, seenAt: -99, reactUntil: 0, burstLeft: 0,
      cooldown: 0, aimError: 0.03, heard: null, heardAt: -99,
      site: null, channel: 0, channelKind: null, walkPhase: 0,
      damage: 24, accuracy: 0.55, carrier: false, kills: 0,
    };
    bots.push(bot);
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    vest.userData.bot = bot;
    vest.userData.part = 'torso';
    return bot;
  }

  for (let i = 0; i < 3; i += 1) makeBot(i, 'vanguard', NAMES_V[i]);
  for (let i = 0; i < 4; i += 1) makeBot(3 + i, 'jackal', NAMES_J[i]);

  function spawnAll(spawns, random) {
    for (const bot of bots) {
      const list = spawns[bot.team];
      const [x, z] = list[bot.index % list.length];
      bot.pos.set(x + (random() - 0.5), 0, z + (random() - 0.5));
      bot.yaw = bot.team === 'vanguard' ? 0 : Math.PI; // Vanguard face north, Jackals south
      bot.health = BOT_HEALTH;
      bot.armor = 0;
      bot.alive = true;
      bot.state = 'route';
      bot.path = [];
      bot.target = null;
      bot.channel = 0;
      bot.channelKind = null;
      bot.heard = null;
      bot.mesh.visible = true;
      bot.mesh.rotation.set(0, bot.yaw, 0);
      bot.mesh.position.copy(bot.pos);
    }
    // One Jackal carries the charge.
    bots[3].carrier = true;
  }

  function moveBot(bot, dt, tx, tz, colliders) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const stepLen = Math.min(BOT_SPEED * dt, dist);
    const nx = bot.pos.x + (dx / dist) * stepLen;
    const nz = bot.pos.z + (dz / dist) * stepLen;
    // Axis-separated AABB slide, radius 0.34, height 1.7.
    let blocked = false;
    for (const c of colliders) {
      if (c.max.y < 0.3) continue; // ground slab: walk on it, don't bump into it
      if (nx + 0.34 > c.min.x && nx - 0.34 < c.max.x && 0.1 < c.max.y && 1.7 > c.min.y && bot.pos.z + 0.34 > c.min.z && bot.pos.z - 0.34 < c.max.z) { blocked = true; break; }
    }
    if (!blocked) bot.pos.x = nx;
    blocked = false;
    for (const c of colliders) {
      if (c.max.y < 0.3) continue;
      if (bot.pos.x + 0.34 > c.min.x && bot.pos.x - 0.34 < c.max.x && 0.1 < c.max.y && 1.7 > c.min.y && nz + 0.34 > c.min.z && nz - 0.34 < c.max.z) { blocked = true; break; }
    }
    if (!blocked) bot.pos.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.walkPhase += dt * 9;
    return dist < 0.4;
  }

  // Ray vs sphere: returns distance along the ray, or -1.
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = cx - ox; const ly = cy - oy; const lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) return -1;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) return -1;
    return tca - Math.sqrt(r * r - d2);
  }

  return {
    bots,
    spawnAll,
    // ctx: { time, dt, player, rounds, world, losClear, damageAgent, noise, random, onShot }
    step(ctx) {
      const { time, dt, player, rounds, random } = ctx;
      const live = rounds.state.phase === 'live';
      const chargePlanted = rounds.state.charge === 'planted';
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.cooldown = Math.max(0, bot.cooldown - dt);
        // --- pick a site for the Jackal carrier once per round
        if (bot.team === 'jackal' && bot.carrier && !bot.site && rounds.state.phase === 'live') {
          bot.site = random() < 0.5 ? 'A' : 'B';
        }
        // --- vision scan (throttled by reaction): nearest visible enemy
        let seen = null;
        let seenDist = 1e9;
        const enemies = [];
        if (bot.team === 'jackal') {
          if (player.alive) enemies.push({ kind: 'player', pos: player.position, eye: player.eye, speed: Math.hypot(player.velocity.x, player.velocity.z), ref: player });
          for (const other of bots) if (other.team === 'vanguard' && other.alive) enemies.push({ kind: 'bot', pos: other.pos, eye: 1.6, speed: BOT_SPEED, ref: other });
        } else {
          for (const other of bots) if (other.team === 'jackal' && other.alive) enemies.push({ kind: 'bot', pos: other.pos, eye: 1.6, speed: BOT_SPEED, ref: other });
        }
        for (const e of enemies) {
          const dx = e.pos.x - bot.pos.x;
          const dz = e.pos.z - bot.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > VIEW_DIST) continue;
          const ang = Math.atan2(-dx, -dz);
          let diff = ang - bot.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) > 1.15 && dist > 4) continue; // outside ~130 deg cone
          if (!world.losClear(bot.pos.x, 1.5, bot.pos.z, e.pos.x, e.eye, e.pos.z)) continue;
          if (dist < seenDist) { seenDist = dist; seen = e; }
        }
        if (seen && live) {
          if (bot.target !== seen) { bot.reactUntil = time + REACT_TIME; bot.burstLeft = 0; }
          bot.target = seen;
          bot.seenAt = time;
          bot.state = 'attack';
        } else if (bot.target && time - bot.seenAt > 1.2) {
          bot.target = null;
          if (bot.state === 'attack') bot.state = 'route';
        }

        // --- objective behaviour overrides routing
        if (bot.team === 'jackal' && bot.carrier && !chargePlanted && rounds.state.phase === 'live' && !bot.target) {
          bot.state = 'plant';
        } else if (bot.team === 'vanguard' && chargePlanted && !bot.target) {
          bot.state = 'defuse';
        } else if (bot.state === 'plant' && chargePlanted) bot.state = 'route';
        else if (bot.state === 'defuse' && !chargePlanted) bot.state = 'route';

        // --- hearing: investigate recent gunfire
        if (!bot.target && bot.heard && time - bot.heardAt < 4 && bot.state === 'route') {
          bot.state = 'investigate';
        }

        // --- act
        if (bot.state === 'attack' && bot.target && live) {
          const t = bot.target;
          const dx = t.pos.x - bot.pos.x;
          const dz = t.pos.z - bot.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          bot.yaw = Math.atan2(-dx, -dz);
          // Strafe a little while firing; close distance if far.
          if (dist > 14) moveBot(bot, dt, t.pos.x, t.pos.z, world.colliders);
          if (time >= bot.reactUntil && bot.cooldown === 0) {
            if (bot.burstLeft === 0) bot.burstLeft = 3 + ((random() * 3) | 0);
            bot.burstLeft -= 1;
            bot.cooldown = bot.burstLeft > 0 ? 0.11 : 0.7 + random() * 0.5;
            this.fire(bot, t, dist, ctx);
          }
        } else if (bot.state === 'plant' && bot.carrier) {
          const site = ctx.sites[bot.site];
          const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
          if (d > 1.2) {
            this.routeTo(bot, site.x, site.z, ctx);
          } else {
            bot.channel += dt / 3.5;
            bot.channelKind = 'plant';
            rounds.state.planting = bot.channel;
            rounds.state.planter = bot.name;
            if (bot.channel >= 1) {
              rounds.plant(bot.site);
              ctx.onPlanted(bot.site);
              bot.channel = 0;
              bot.state = 'hold';
              bot.holdUntil = time + 3;
            }
          }
        } else if (bot.state === 'defuse') {
          const site = ctx.sites[rounds.state.site];
          if (!site) { bot.state = 'route'; }
          else {
            const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
            if (d > 1.2) this.routeTo(bot, site.x, site.z, ctx);
            else {
              bot.channel += dt / 5;
              bot.channelKind = 'defuse';
              rounds.state.defusing = bot.channel;
              rounds.state.defuser = bot.name;
              if (bot.channel >= 1) {
                ctx.onDefused();
                bot.channel = 0;
                bot.state = 'route';
              }
            }
          }
        } else if (bot.state === 'hold') {
          if (time > bot.holdUntil) bot.state = 'route';
        } else if (bot.state === 'investigate' && bot.heard) {
          const arrived = moveBot(bot, dt, bot.heard.x, bot.heard.z, world.colliders);
          if (arrived || time - bot.heardAt > 4) { bot.heard = null; bot.state = 'route'; }
        } else {
          // route: pick a destination by team + phase, walk the waypoint graph
          if (!bot.path.length) {
            let dest;
            if (bot.team === 'jackal') {
              const site = ctx.sites[bot.site || (random() < 0.5 ? 'A' : 'B')];
              dest = nearestWp(world.waypoints, site.x + (random() - 0.5) * 4, site.z + (random() - 0.5) * 4);
            } else if (chargePlanted) {
              const site = ctx.sites[rounds.state.site];
              dest = nearestWp(world.waypoints, site.x, site.z);
            } else {
              // Vanguard holds: mid, A lane, B lane, connector
              const holds = [[0, 0], [-10, 6], [10, 6], [0, 8], [-8, -8], [8, -8]];
              const h = holds[(bot.index + ((rounds.state.round * 2) | 0)) % holds.length];
              dest = nearestWp(world.waypoints, h[0], h[1]);
            }
            const from = nearestWp(world.waypoints, bot.pos.x, bot.pos.z);
            bot.path = bfs(world.waypoints, world.edges, from, dest);
            if (!bot.path.length) bot.path = [dest];
            bot.wpIndex = 0;
          }
          const wp = world.waypoints[bot.path[bot.wpIndex]];
          const arrived = moveBot(bot, dt, wp[0], wp[1], world.colliders);
          if (arrived) {
            bot.wpIndex += 1;
            if (bot.wpIndex >= bot.path.length) {
              bot.path = [];
              if (bot.team === 'vanguard' && !chargePlanted && random() < 0.7) {
                bot.state = 'hold';
                bot.holdUntil = time + 2 + random() * 3;
                // face the likely enemy approach
                bot.yaw = Math.atan2(-(0 - bot.pos.x), -(-14 - bot.pos.z));
              }
            }
          }
        }

        // --- mesh sync: walk bob, death fall
        bot.mesh.position.set(bot.pos.x, 0, bot.pos.z);
        bot.mesh.rotation.y = bot.yaw;
        if (bot.alive) {
          const moving = bot.state === 'route' || bot.state === 'investigate' || bot.state === 'attack';
          bot.mesh.position.y = moving ? Math.abs(Math.sin(bot.walkPhase)) * 0.04 : 0;
          bot.mesh.rotation.x = 0;
        }
      }
    },
    routeTo(bot, x, z, ctx) {
      if (!bot.path.length) {
        const from = nearestWp(world.waypoints, bot.pos.x, bot.pos.z);
        const dest = nearestWp(world.waypoints, x, z);
        bot.path = bfs(world.waypoints, world.edges, from, dest);
        if (!bot.path.length) bot.path = [dest];
        bot.wpIndex = 0;
      }
      const wp = world.waypoints[bot.path[bot.wpIndex]];
      const arrived = moveBot(bot, ctx.dt, wp[0], wp[1], world.colliders);
      if (arrived) {
        bot.wpIndex += 1;
        if (bot.wpIndex >= bot.path.length) {
          bot.path = [];
          moveBot(bot, ctx.dt, x, z, world.colliders);
        }
      }
    },
    fire(bot, target, dist, ctx) {
      // Aim error grows with distance and target speed; headshots are luck.
      const speed = target.speed || 0;
      const err = 0.012 + dist * 0.0016 + speed * 0.006;
      const aimY = 1.15 + (Math.random() < 0.18 ? 0.42 : 0); // sometimes at the head
      const ox = bot.pos.x; const oy = 1.5; const oz = bot.pos.z;
      let dx = target.pos.x - ox;
      let dy = aimY - oy;
      let dz = target.pos.z - oz;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      dx += (ctx.random() * 2 - 1) * err;
      dy += (ctx.random() * 2 - 1) * err;
      dz += (ctx.random() * 2 - 1) * err;
      const n = Math.hypot(dx, dy, dz);
      dx /= n; dy /= n; dz /= n;
      ctx.onShot(bot, ox, oy, oz, dx, dy, dz);
      const tBody = raySphere(ox, oy, oz, dx, dy, dz, target.pos.x, 1.05, target.pos.z, 0.45);
      const tHead = raySphere(ox, oy, oz, dx, dy, dz, target.pos.x, 1.58, target.pos.z, 0.2);
      if (tHead >= 0 && (tBody < 0 || tHead < tBody)) {
        ctx.damageAgent(target, Math.round(bot.damage * 2.2), bot, true);
      } else if (tBody >= 0) {
        ctx.damageAgent(target, bot.damage, bot, false);
      }
    },
    hear(x, z, time) {
      for (const bot of bots) {
        if (!bot.alive || bot.target) continue;
        const d = Math.hypot(bot.pos.x - x, bot.pos.z - z);
        if (d < HEAR_DIST) {
          bot.heard = { x, z };
          bot.heardAt = time;
        }
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    kill(bot) {
      bot.alive = false;
      bot.mesh.rotation.x = -Math.PI / 2 * 0.9;
      bot.mesh.position.y = 0.15;
    },
    aimPoint(index) {
      const alive = bots.filter((b) => b.alive);
      const bot = alive[index % alive.length];
      if (!bot) return null;
      return { x: bot.pos.x, y: 1.2, z: bot.pos.z };
    },
  };
}
