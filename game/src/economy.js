// Economy: CS-style money. Start $800; kill +$300; round win +$3,250;
// round loss +$1,900. Buy menu prices live in weapon.js; this module owns
// the player's wallet and the per-round payouts.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';

export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const START_MONEY = 800;

export function createEconomy() {
  const state = { money: START_MONEY, kills: 0 };

  return {
    state,
    reset() { state.money = START_MONEY; state.kills = 0; },
    killReward() {
      state.money += KILL_REWARD;
      state.kills += 1;
    },
    roundEnd(won) {
      state.money += won ? WIN_REWARD : LOSS_REWARD;
    },
    // Returns the bought id, 'grenade', 'armor', or null when unaffordable.
    buy(id, weapon, player) {
      if (id === 'grenade') {
        if (state.money < GRENADE_PRICE || weapon.state.grenades >= 2) return null;
        state.money -= GRENADE_PRICE;
        weapon.state.grenades += 1;
        return 'grenade';
      }
      if (id === 'armor') {
        if (state.money < ARMOR_PRICE || player.state.armor >= 100) return null;
        state.money -= ARMOR_PRICE;
        player.state.armor = 100;
        return 'armor';
      }
      const def = WEAPONS[id];
      if (!def || state.money < def.price) return null;
      state.money -= def.price;
      weapon.equip(id);
      return id;
    },
  };
}
