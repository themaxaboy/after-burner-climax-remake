/**
 * "Final Vector" - stage 3. Original composition. F# minor, 160 BPM, dark and relentless
 * (phrygian bII riff, double-kick at high intensity).
 */
const rest = (n) => '.'.repeat(n);

export default {
  id: 'stage3',
  title: 'Final Vector',
  bpm: 160,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  sections: {
    intro: {
      bars: 4,
      chords: ['F#m', 'F#m', 'D', 'E'],
      patterns: {
        guitar: 'X--------------- | X--------------- | x.x.x.x.x.x.x.x. | xxxxxxxxXXXXXXXX',
        ride: 'x.x.x.x.x.x.x.x.',
        kick: `x${rest(15)}x${rest(15)} x.x.x.x.x.x.x.x. xxxxxxxxxxxxxxxx`,
        snare: `${rest(48)} x.x.x.x.XxXxXXXX`,
        crash: `x${rest(15)}x${rest(47)}`,
        swell: '.:32 x:32',
        bass: '0:16 0:16 0:2 0:2 0:2 0:2 0:2 0:2 0:2 0:2 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
        pad: 'auto',
        timpani: `X${rest(15)}X${rest(47)}`
      }
    },
    verse: {
      bars: 8,
      chords: ['F#m', 'F#m', 'G', 'F#m', 'F#m', 'F#m', 'D', 'E', 'F#m', 'F#m', 'G', 'F#m', 'D', 'E', 'C#', 'C#'],
      patterns: {
        guitar: 'x.xxx.x.X---x.x.',
        bass: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 12 0',
        kick: 'x.x.x.x.x.x.x.x.',
        kick2: 'xxxxxxxxxxxxxxxx',
        snare: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(63)}`,
        pad: 'auto',
        lead: [
          'F#5:2 C#6:2 F#5:2 C#6:2 A5:2 C#6:2 F#6:4',
          'G5:2 B5:2 D6:4 C#6:4 A5:4',
          'F#5:2 A5:2 C#6:2 F#6:2 E6:4 C#6:4',
          'D6:4 A5:4 B5:4 G#5:4',
          'F#5:2 C#6:2 F#5:2 C#6:2 A5:2 C#6:2 F#6:4',
          'B5:2 D6:2 G6:4 F#6:8',
          'F#6:4 D6:4 E6:4 B5:4',
          'E#6:4 C#6:4 G#5:4 E#5:4'
        ],
        tom: `${rest(120)}HHMMLLLL`
      }
    },
    chorus: {
      bars: 8,
      chords: ['Bm', 'D', 'E', 'F#m', 'Bm', 'D', 'C#', 'C#'],
      patterns: {
        guitar: 'X-----X-----X-x.',
        bass: '0:2 0:2 0:2 0:2 0:2 0:2 12:2 0:2',
        kick: 'x...x...x...x...',
        kick2: 'x.xxx.xxx.xxx.xx',
        snare: '....x.......x...',
        hat: 'x.o.x.o.x.o.x.o.',
        crash: `x${rest(31)}`,
        pad: 'auto',
        lead: [
          'F#5:4 B5:4 D6:6 C#6:2',
          'A5:6 F#5:2 A5:4 D6:4',
          'E6:4 D6:4 C#6:4 B5:4',
          'C#6:12 .:4',
          'F#5:4 B5:4 D6:6 E6:2',
          'F#6:6 E6:2 D6:4 A5:4',
          'G#5:4 C#6:4 E#6:8',
          'G#6:8 F#6:4 E#6:4'
        ],
        clap: '....x.......x...',
        shaker: 'XxxxXxxxXxxxXxxx'
      }
    },
    bridge: {
      bars: 8,
      chords: ['Bm', 'Bm', 'G', 'G', 'D', 'D', 'C#', 'C#'],
      patterns: {
        guitar: 'X-------X-------',
        bass: '0:8 0:4 7:2 12:2',
        kick: 'x.........x.....',
        snare: '........x.......',
        ride: 'x.x.x.x.x.x.x.x.',
        hat: 'x...x...x...x...',
        crash: `x${rest(63)}`,
        pad: 'auto',
        timpani: `x${rest(31)}`,
        lead: ['B5:16', 'D6:4 C#6:4 B5:8', 'D6:16', 'G6:8 F#6:4 D6:4', 'F#6:16', 'E6:4 D6:4 A5:8', 'G#5:16', 'C#6:4 E#6:4 G#6:8'],
        swell: '.:96 x:32',
        tom: `${rest(112)}h.h.m.m.l.l.LLLL`
      }
    }
  },
  arrangement: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'chorus'],
  loop: 1
};
