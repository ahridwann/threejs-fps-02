// The DOM HUD: crosshair (spreads with the weapon), hit marker, health,
// armor, ammo, money, timer, round score, kill feed, charge status, the buy
// menu and the overlay panels. It never touches the simulation; main.js
// pushes numbers in and reads callbacks out.
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';

const COPY = {
  start: {
    title: 'SABLE LINE',
    copy: 'Kestrel Yard at dusk. Vanguard holds the yard — Jackals carry the spark charge. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: { title: 'SABLE LINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorRow = $('armor-row');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const moneyVal = $('money-val');
  const timerVal = $('timer-val');
  const scoreVal = $('score-val');
  const roundVal = $('round-val');
  const weaponName = $('weapon-name');
  const feed = $('feed');
  const banner = $('banner');
  const chargeEl = $('charge');
  const progressWrap = $('progress-wrap');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const damageFlash = $('damage-flash');
  const grenadeCount = $('grenade-count');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  const buyRows = [];
  function buildBuy(onBuy) {
    const items = [
      ...WEAPON_ORDER.map((id, i) => ({ id, key: String(i + 1), name: WEAPONS[id].name, price: WEAPONS[id].price })),
      { id: 'grenade', key: '5', name: 'Frag grenade', price: GRENADE_PRICE },
      { id: 'armor', key: '6', name: 'Kevlar vest', price: ARMOR_PRICE },
    ];
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name"></span><span class="buy-price"></span>`;
      row.querySelector('.buy-name').textContent = item.name;
      row.querySelector('.buy-price').textContent = item.price === 0 ? 'FREE' : `$${item.price.toLocaleString()}`;
      row.addEventListener('click', () => onBuy(item.id));
      buyMenu.appendChild(row);
      buyRows.push({ row, item });
    }
  }

  return {
    buildBuy,
    setHealth(hp, armor) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
      armorRow.style.display = armor > 0 ? 'flex' : 'none';
      setText(armorNum, 'armor', String(Math.ceil(armor)));
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      setText(grenadeCount, 'nades', grenades > 0 ? `G x${grenades}` : '');
      ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(m) { setText(moneyVal, 'money', `$${m.toLocaleString()}`); },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerVal, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerVal.classList.toggle('buy', phase === 'buy');
    },
    setScore(v, j, round) {
      const html = `<b>VAN ${v}</b> — <i>${j} JAC</i>`;
      if (last.score !== html) { last.score = html; scoreVal.innerHTML = html; }
      setText(roundVal, 'round', `ROUND ${round}`);
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damage() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 180);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => { if (line.parentNode) line.remove(); }, 6000);
    },
    showBanner(text, ms = 2600) {
      banner.textContent = text;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    setCharge(text, cls) {
      setText(chargeEl, 'charge', text);
      chargeEl.className = cls || '';
    },
    setProgress(label, frac) {
      if (!label) { progressWrap.hidden = true; return; }
      progressWrap.hidden = false;
      setText(progressLabel, 'prog', label);
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showBuy(money) {
      setText(buyMoney, 'buymoney', `$${money.toLocaleString()}`);
      buyMenu.hidden = false;
      for (const { row, item } of buyRows) row.classList.toggle('poor', money < item.price);
    },
    hideBuy() { buyMenu.hidden = true; },
    showOverlay(mode, extra) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = extra || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    showEnd(titleText, copyText, action) {
      title.textContent = titleText;
      copy.textContent = copyText;
      play.textContent = action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
