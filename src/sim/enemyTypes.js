// Enemy archetypes. `model` refers to src/models designs; `anchor` = 'rail'
// (moves in rail-relative space, follows the stage path) or 'world'.
export const ENEMY_TYPES = {
  fighterA: {
    model: 'fighterA', hp: 8, radius: 8, score: 1000, lockable: true, air: true,
    speed: 210, missile: 0.35, gun: 0.45, threat: 1
  },
  stealthB: {
    model: 'stealthB', hp: 16, radius: 9, score: 3000, lockable: true, air: true,
    speed: 250, missile: 0.6, gun: 0.6, threat: 2
  },
  ace: {
    model: 'stealthB', hp: 60, radius: 9, score: 30000, lockable: true, air: true,
    speed: 260, missile: 1, gun: 1, threat: 3, ace: true
  },
  heloCH47: {
    model: 'heloCH47', hp: 18, radius: 12, score: 2000, lockable: true, air: true,
    speed: 70, missile: 0, gun: 0.2, threat: 0.5
  },
  bomberXB: {
    model: 'bomberXB', hp: 220, radius: 28, score: 50000, lockable: true, air: true, big: true,
    speed: 200, missile: 0, gun: 0.3, threat: 1.5, lockPoints: [[0, 0, 0], [-10, 0, 8], [10, 0, 8], [0, 0, -18]]
  },
  bomberB52: {
    model: 'bomberB52', hp: 400, radius: 30, score: 100000, lockable: true, air: true, big: true,
    speed: 200, missile: 0.5, gun: 1, threat: 3
  },
  destroyer: {
    model: 'destroyer', hp: 70, radius: 60, score: 8000, lockable: true, air: false, ground: true, sea: true,
    speed: 12, missile: 0.9, gun: 0.4, threat: 2, anchor: 'world', lockOffset: [0, 14, 0]
  },
  samBoat: {
    model: 'destroyer', scale: 0.32, hp: 14, radius: 22, score: 2500, lockable: true, air: false, ground: true, sea: true,
    speed: 18, missile: 0.6, gun: 0.2, threat: 1.5, anchor: 'world', lockOffset: [0, 5, 0]
  },
  samSite: {
    model: 'samLauncher', hp: 6, radius: 8, score: 1500, lockable: true, air: false, ground: true,
    speed: 0, missile: 0.8, gun: 0, threat: 2, anchor: 'world', lockOffset: [0, 3, 0]
  },
  aaGun: {
    model: 'samLauncher', hp: 5, radius: 7, score: 1200, lockable: true, air: false, ground: true,
    speed: 0, missile: 0, gun: 1, threat: 1, anchor: 'world', lockOffset: [0, 3, 0]
  },
  target: {
    model: 'bunker', hp: 40, radius: 20, score: 30000, lockable: true, air: false, ground: true,
    speed: 0, missile: 0, gun: 0, threat: 0, anchor: 'world'
  },
  cruiseMissile: {
    model: 'missile', scale: 1.8, hp: 2, radius: 5, score: 2000, lockable: true, air: true,
    speed: 280, missile: 0, gun: 0, threat: 0.5
  }
};

export const SCORE = {
  comboWindow: 4.0,
  comboStep: 10,
  comboBonus: 5000,
  comboHighStart: 60,
  comboHighStep: 20,
  comboHighBonus: 10000,
  flightPerKmNeutral: 100,
  flightPerKmFast: 250
};
