/**
 * "Debrief" - results / score screen. Original composition. D major, 150 BPM half-time,
 * relaxed victory-lap groove.
 */
const rest = (n) => '.'.repeat(n);

export default {
  id: 'results',
  title: 'Debrief',
  bpm: 150,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  layers: { lead: 0.3, arp: 0, guitar: 0 },
  mix: { guitar: 0.6, kick: 0.85 },
  sections: {
    intro: {
      bars: 2,
      chords: ['D', 'G'],
      patterns: {
        pad: 'auto',
        arp: '0 1 2 3 4 3 2 1 0 1 2 3 4 5 4 3',
        crash: `x${rest(31)}`,
        kick: `x${rest(15)}x.........x.x.x.`,
        guitar: 'X---------------',
        bass: '0:16'
      }
    },
    main: {
      bars: 8,
      chords: ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A'],
      patterns: {
        pad: 'auto',
        arp: '0 1 2 3 4 3 2 1 0 1 2 3 4 5 4 3',
        guitar: 'X-------X-------',
        bass: '0:6 0:2 7:4 12:4',
        kick: 'x.........x.....',
        snare: '........x.......',
        hat: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(127)}`,
        lead: [
          'F#5:6 E5:2 D5:4 A5:4',
          'E5:8 C#5:4 E5:4',
          'F#5:6 G5:2 A5:4 B5:4',
          'D6:12 .:4',
          'F#5:6 E5:2 D5:4 A5:4',
          'C#6:6 B5:2 A5:4 E5:4',
          'B5:4 A5:4 G5:4 D5:4',
          'E5:12 .:4'
        ],
        shaker: '.x.x.x.x.x.x.x.x'
      }
    },
    main2: {
      bars: 8,
      chords: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'],
      patterns: {
        pad: 'auto',
        arp: '0 1 2 3 4 3 2 1 0 1 2 3 4 5 4 3',
        guitar: 'X-------X-------',
        bass: '0:6 0:2 7:4 12:4',
        kick: 'x.........x.....',
        snare: '........x.......',
        hat: 'x.o.x.o.x.o.x.o.',
        crash: `x${rest(127)}`,
        lead: [
          'B5:6 A5:2 G5:4 D6:4',
          'C#6:6 B5:2 A5:8',
          'A5:4 C#6:4 F#6:8',
          'F#6:4 E6:4 D6:4 B5:4',
          'D6:6 B5:2 G5:4 B5:4',
          'E6:6 D6:2 C#6:4 A5:4',
          'D6:16',
          '.:16'
        ],
        shaker: '.x.x.x.x.x.x.x.x',
        tom: `${rest(120)}h.m.l.L.`
      }
    }
  },
  arrangement: ['intro', 'main', 'main2'],
  loop: 1
};
