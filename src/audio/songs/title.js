/**
 * "Horizon Call" - title screen. Original composition. D minor, 150 BPM,
 * arpeggiated synth intro into a heroic arcade-rock main theme.
 */
const rest = (n) => '.'.repeat(n);
const ARP = '0 2 3 2 4 2 3 2 0 2 3 2 5 4 3 2';

export default {
  id: 'title',
  title: 'Horizon Call',
  bpm: 150,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  layers: { lead: 0.3, arp: 0 },
  sections: {
    intro: {
      bars: 4,
      chords: ['Dm', 'Bb', 'F', 'C'],
      patterns: {
        arp: ARP,
        pad: 'auto',
        hat: `${rest(32)}x.x.x.x.x.x.x.x.x.x.x.x.xxxxxxxx`,
        kick: `${rest(48)}x...x...x.x.xxxx`,
        swell: '.:32 x:32',
        bass: '.:48 0:4 0:4 0:2 0:2 0:2 0:2'
      }
    },
    main: {
      bars: 8,
      chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'C'],
      patterns: {
        arp: ARP,
        pad: 'auto',
        guitar: 'X-----X-----X---',
        bass: '0:2 0:2 0:2 0:2 0:2 0:2 12:2 0:2',
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'x.o.x.o.x.o.x.o.',
        crash: `x${rest(63)}`,
        lead: [
          'D5:3 F5:3 A5:4 G5:2 F5:2 E5:2',
          'D5:6 F5:2 Bb5:8',
          'A5:3 G5:3 F5:2 C6:8',
          'G5:8 E5:4 C5:4',
          'D5:3 F5:3 A5:4 D6:6',
          'C6:2 D6:2 C6:2 Bb5:2 F5:8',
          'G5:3 A5:3 Bb5:2 C6:8',
          'Bb5:2 C6:2 D6:4 E6:8'
        ],
        shaker: '.x.x.x.x.x.x.x.x',
        kick2: '..........x...x.',
        tom: `${rest(120)}hhmmllLL`
      }
    },
    bridge: {
      bars: 4,
      chords: ['Gm', 'Bb', 'C', 'A'],
      patterns: {
        arp: ARP,
        pad: 'auto',
        guitar: 'X---------------',
        bass: '0:8 0:4 7:4',
        kick: 'x.........x.....',
        snare: `${'........x.......'.repeat(3)}x.x.x.x.xxxxXXXX`,
        hat: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(63)}`,
        lead: ['G5:12 A5:2 Bb5:2', 'D6:8 C6:4 Bb5:4', 'C6:12 E6:4', 'C#6:4 E6:4 A6:8'],
        swell: '.:32 x:32'
      }
    }
  },
  arrangement: ['intro', 'main', 'main', 'bridge', 'main'],
  loop: 1
};
