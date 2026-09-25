/**
 * "Strike Package" - stage 1. Original composition. E minor, 156 BPM, driving synth-rock.
 * Pattern syntax: see src/audio/music.js. 16 steps per bar.
 */
const rest = (n) => '.'.repeat(n);

export default {
  id: 'stage1',
  title: 'Strike Package',
  bpm: 156,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  sections: {
    intro: {
      bars: 4,
      chords: ['Em', 'Em', 'C', 'D'],
      patterns: {
        guitar: 'X-------x.x.x.x. | x.x.x.x.x.x.xxxx | X---x.xxX---x.xx | X---x.xxX-X-X-X-',
        hat: 'x.x.x.x.x.x.x.x.',
        kick: `${rest(32)} x.......x.x..... x.......x.xx.x..`,
        snare: `${rest(16)} ............x.x. ....x.......x... ....x...x.x.xxxX`,
        crash: `x${rest(31)}x${rest(31)}`,
        bass: '.:32 0:2 0:1 0:1 0:2 0:1 0:1 0:2 0:1 0:1 0:2 0:1 0:1 0:4 0:4 0:4 0:4',
        pad: 'auto',
        lead: '.:32 B5:4 E6:4 D6:2 B5:2 A5:4 G5:4 A5:4 B5:8',
        tom: `${rest(56)}hhmmllll`
      }
    },
    verse: {
      bars: 8,
      chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'Am', 'B'],
      patterns: {
        guitar: 'x.xxx.xxx.xxx.xx | X-----X-----X-x.',
        bass: '0:2 0:1 0:1 0:2 0:1 0:1 0:2 0:1 0:1 0:2 0:1 0:1 | 0:6 0:6 0:2 12:1 0:1',
        kick: 'x.......x.x..... | x.....x.....x...',
        snare: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(63)}`,
        pad: 'auto',
        lead: [
          'B4:2 E5:2 G5:2 E5:2 A5:2 G5:2 E5:2 D5:2',
          'E5:6 .:2 B4:2 D5:2 E5:4',
          'C5:2 E5:2 G5:2 E5:2 C6:4 B5:4',
          'A5:4 F#5:4 D5:4 F#5:2 A5:2',
          'B4:2 E5:2 G5:2 E5:2 A5:2 G5:2 E5:2 D5:2',
          'E5:6 .:2 G5:2 A5:2 B5:4',
          'C6:4 B5:2 A5:2 E5:4 A5:4',
          'B5:8 D#6:4 F#6:4'
        ],
        shaker: '.x.x.x.x.x.x.x.x',
        clap: '....x.......x...',
        tom: `${rest(120)}h.h.m.l.`
      }
    },
    chorus: {
      bars: 8,
      chords: ['C', 'D', 'Em', 'Em', 'C', 'D', 'B', 'B'],
      patterns: {
        guitar: 'X-----X-----X---',
        bass: '0:2 0:2 0:2 0:2 0:2 0:2 12:2 0:2',
        kick: 'x...x...x...x...',
        kick2: '......x.......x.',
        snare: '....x.......x...',
        hat: 'x.o.x.o.x.o.x.o.',
        crash: `x${rest(31)}`,
        pad: 'auto',
        lead: [
          'E5:4 G5:4 C6:6 B5:2',
          'A5:6 F#5:2 D5:4 F#5:4',
          'G5:4 B5:4 E6:8',
          'D6:2 E6:2 D6:2 B5:2 G5:8',
          'E5:4 G5:4 C6:4 E6:4',
          'D6:6 C6:2 A5:4 F#5:4',
          'D#6:8 B5:4 F#5:4',
          'B5:8 A5:2 G5:2 F#5:4'
        ],
        shaker: 'XxxxXxxxXxxxXxxx',
        clap: '....x.......x...'
      }
    },
    bridge: {
      bars: 8,
      chords: ['Am', 'C', 'D', 'D', 'Am', 'C', 'B', 'B'],
      patterns: {
        guitar: 'X---------------',
        bass: '0:12 7:2 12:2',
        kick: 'x.........x.....',
        snare: '........x.......',
        hat: 'x...x...x...x...',
        ride: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(127)}`,
        pad: 'auto',
        lead: [
          'A5:12 G5:2 A5:2',
          'C6:8 B5:4 G5:4',
          'A5:16',
          'F#5:4 A5:4 D6:8',
          'E6:12 D6:2 C6:2',
          'D6:8 C6:4 B5:4',
          'B5:16',
          'D#6:4 F#6:4 B6:8'
        ],
        tom: `${rest(112)}hhhhmmmmllllLLLL`
      }
    }
  },
  arrangement: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus'],
  loop: 1
};
