// Round state machine: buy phase (15 s) -> live (100 s) -> round end ->
// next buy phase, until one team reaches 5 rounds. The charge (bomb) state
// lives here too: planted at a site with a 35 s fuse, defusable by Vanguard.
// Phases: 'buy' | 'live' | 'over' | 'match'
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const WIN_ROUNDS = 5;
export const PLANT_SECONDS = 3.5;
export const DEFUSE_SECONDS = 5;
export const FUSE_SECONDS = 35;

export function createRounds() {
  const state = {
    phase: 'buy',
    timeLeft: BUY_SECONDS,
    round: 1,
    vanguard: 0,
    jackal: 0,
    charge: 'none', // 'none' | 'planted'
    site: null, // 'A' | 'B'
    fuse: 0,
    planting: 0, // 0..1 progress of the current plant
    defusing: 0, // 0..1 progress of the current defuse
    planter: null,
    defuser: null,
    winner: null, // 'vanguard' | 'jackal' | null
    reason: '',
    message: '',
    messageAt: 0,
  };

  return {
    state,
    startBuy() {
      state.phase = 'buy';
      state.timeLeft = BUY_SECONDS;
      state.charge = 'none';
      state.site = null;
      state.fuse = 0;
      state.planting = 0;
      state.defusing = 0;
      state.planter = null;
      state.defuser = null;
      state.winner = null;
      state.reason = '';
    },
    startLive() {
      state.phase = 'live';
      state.timeLeft = ROUND_SECONDS;
    },
    plant(site) {
      state.charge = 'planted';
      state.site = site;
      state.fuse = FUSE_SECONDS;
      state.planting = 0;
      state.planter = null;
    },
    endRound(winner, reason) {
      state.phase = 'over';
      state.timeLeft = 4;
      state.winner = winner;
      state.reason = reason;
      if (winner === 'vanguard') state.vanguard += 1;
      else state.jackal += 1;
      if (state.vanguard >= WIN_ROUNDS || state.jackal >= WIN_ROUNDS) state.phase = 'match';
    },
    nextRound() {
      state.round += 1;
      this.startBuy();
    },
    resetMatch() {
      state.round = 1;
      state.vanguard = 0;
      state.jackal = 0;
      this.startBuy();
    },
    banner(text) {
      state.message = text;
      state.messageAt = 0;
    },
  };
}
