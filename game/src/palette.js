// SABLE LINE look plan, in one place. Dusk freight yard: warm amber sodium
// lamps against deep blue-teal shadow, rusted steel, hazard amber accents.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#101820', // dusk sky / fog
  surface: '#232a2e', // concrete
  hairline: '#39424a', // steel
  ink: '#ece5d3', // warm off-white
  muted: '#7d94a0', // cool teal-grey
  accent: '#f5a623', // sodium amber
  danger: '#e4572e', // hazard orange-red
  jackal: '#c65a3a', // attacker team
  vanguard: '#4d8fa3', // defender team
  grass: '#3d4a35',
};

// Procedural canvas textures: no external assets, no network.
import * as THREE from 'three';

export function makeCanvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Deterministic speckled noise, seeded so every load paints the same yard.
export function speckle(ctx, size, seed, colors, n) {
  let a = seed;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    ctx.globalAlpha = 0.08 + rnd() * 0.22;
    const s = 1 + rnd() * 4;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
  ctx.globalAlpha = 1;
}
