// Enemy archetypes. `model` refers to src/models designs; `anchor` = 'rail'
// (moves in rail-relative space, follows the stage path) or 'world'.
//
//   size          real bounding half-extent of the model (m). Aircraft get
//                 `radius = size * 1.2` below (collisions, fuses, lock size).
//   visScale      render scale for readability (EnemyRenderer multiplies the
//                 instance scale by it): fighters 1.8, stealth 1.6, helos 1.4,
//                 big aircraft 1.15, ground/sea units 1.
//   lockRange     lock-on range from the player (m): air 1600, big aircraft and
//                 ground/sea units 2400 (defaults below; LockOn ×1.5 in Climax).
//   canRam        may be used by the `rammer` (kamikaze) behaviour / waves.
//   missileStrong chance that a missile this type fires is the red "strong"
//                 variant (homes harder, more damage).
export const ENEMY_TYPES = {
  fighterA: {
    model: 'fighterA', hp: 8, size: 9.1, score: 1000, lockable: true, air: true, visScale: 1.8, canRam: true,
    speed: 210, missile: 0.35, gun: 0.45, threat: 1, missileStrong: 0.1
  },
  stealthB: {
    model: 'stealthB', hp: 16, size: 10.1, score: 3000, lockable: true, air: true, visScale: 1.6, canRam: true,
    speed: 250, missile: 0.6, gun: 0.6, threat: 2, missileStrong: 0.35
  },
  ace: {
    model: 'stealthB', hp: 60, size: 10.1, score: 30000, lockable: true, air: true, visScale: 1.6,
    speed: 260, missile: 1, gun: 1, threat: 3, ace: true, missileStrong: 0.5
  },
  heloCH47: {
    model: 'heloCH47', hp: 18, size: 13.7, score: 2000, lockable: true, air: true, visScale: 1.4,
    speed: 70, missile: 0, gun: 0.2, threat: 0.5
  },
  bomberXB: {
    model: 'bomberXB', hp: 220, size: 28.2, score: 50000, lockable: true, air: true, big: true, visScale: 1.15,
    speed: 200, missile: 0, gun: 0.3, threat: 1.5, lockPoints: [[0, 0, 0], [-10, 0, 8], [10, 0, 8], [0, 0, -18]]
  },
  bomberB52: {
    model: 'bomberB52', hp: 160, size: 28.3, score: 150000, lockable: true, air: true, big: true, visScale: 1.15,
    speed: 200, missile: 0.5, gun: 1, threat: 3, missileStrong: 0.3
  },
  destroyer: {
    model: 'destroyer', hp: 70, radius: 60, score: 8000, lockable: true, air: false, ground: true, sea: true, visScale: 1,
    speed: 12, missile: 0.9, gun: 0.4, threat: 2, anchor: 'world', lockOffset: [0, 14, 0], missileStrong: 0.3
  },
  samBoat: {
    model: 'destroyer', scale: 0.32, hp: 14, radius: 22, score: 2500, lockable: true, air: false, ground: true, sea: true, visScale: 1,
    speed: 18, missile: 0.6, gun: 0.2, threat: 1.5, anchor: 'world', lockOffset: [0, 5, 0], missileStrong: 0.15
  },
  samSite: {
    model: 'samLauncher', hp: 6, radius: 8, score: 1500, lockable: true, air: false, ground: true, visScale: 1,
    speed: 0, missile: 0.8, gun: 0, threat: 2, anchor: 'world', lockOffset: [0, 3, 0], missileStrong: 0.2
  },
  aaGun: {
    model: 'samLauncher', hp: 5, radius: 7, score: 1200, lockable: true, air: false, ground: true, visScale: 1,
    speed: 0, missile: 0, gun: 1, threat: 1, anchor: 'world', lockOffset: [0, 3, 0]
  },
  target: {
    model: 'bunker', hp: 40, radius: 20, score: 30000, lockable: true, air: false, ground: true, visScale: 1,
    speed: 0, missile: 0, gun: 0, threat: 0, anchor: 'world'
  },
  bossPod: {
    model: 'none', hp: 26, radius: 5, score: 15000, lockable: true, air: true, visScale: 1,
    speed: 0, missile: 0, gun: 0, threat: 1, anchor: 'world'
  },
  cruiseMissile: {
    model: 'missile', scale: 1.8, hp: 2, radius: 5, score: 2000, lockable: true, air: true, visScale: 1.3,
    speed: 280, missile: 0, gun: 0, threat: 0.5
  }
};

// collision radius = real size x 1.2 (aircraft)
for (const d of Object.values(ENEMY_TYPES)) if (d.size) d.radius = +(d.size * 1.2).toFixed(1);
// lock range: fighters / helos / cruise missiles 1600 m, big aircraft, boss parts and ground/sea units 2400 m
ENEMY_TYPES.bossPod.lockRange = 2400;
for (const d of Object.values(ENEMY_TYPES)) d.lockRange ??= d.big || d.air === false ? 2400 : 1600;

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
