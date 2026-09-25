/**
 * "Canyon Run" - stage 2. Original composition. A minor, 158 BPM, syncopated 16th riffs.
 */
const rest = (n) => '.'.repeat(n);

export default {
  id: 'stage2',
  title: 'Canyon Run',
  bpm: 158,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  sections: {
    intro: {
      bars: 4,
      chords: ['Am', 'Am', 'F', 'G'],
      patterns: {
        guitar: 'xxxxxxxxxxxxxxxx | xxxxxxxxxxxxxxxx | X-------X------- | X---X---X-X-X-X-',
        hat: 'XxxxXxxxXxxxXxxx',
        kick: `${rest(32)} x...x...x...x... x...x...x.x.x.x.`,
        snare: `${rest(48)} ....x...x.x.XXXX`,
        crash: `${rest(32)}x${rest(31)}`,
        bass: '.:32 0:8 0:8 0:4 0:4 0:4 0:4',
        arp: '0 2 1 3 2 4 3 5 0 2 1 3 2 4 3 5',
        pad: 'auto',
        swell: '.:32 x:32'
      }
    },
    verse: {
      bars: 8,
      chords: ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'Dm', 'E'],
      patterns: {
        guitar: 'xx.xx.xx.x.xX---',
        bass: '0 0 . 0 0 . 0 0 . 0 . 0 0:4',
        kick: 'x..x..x...x..x..',
        snare: '....x.......x...',
        hat: 'XxxxXxxxXxxxXxxx',
        crash: `x${rest(63)}`,
        pad: 'auto',
        lead: [
          'A5:2 A5:1 C6:2 A5:1 E6:2 D6:2 C6:2 B5:2 A5:2',
          'G5:3 A5:3 E5:10',
          'F5:2 A5:2 C6:2 F6:2 E6:4 C6:4',
          'D6:6 B5:2 G5:8',
          'A5:2 A5:1 C6:2 A5:1 E6:2 D6:2 C6:2 B5:2 A5:2',
          'G5:3 A5:3 C6:4 E6:6',
          'F6:4 E6:2 D6:2 A5:8',
          'G#5:4 B5:4 E6:4 G#6:4'
        ],
        kick2: 'x.xx.xx.x.xx.x.x',
        clap: '....x.......x...',
        tom: `${rest(120)}HhMmLlLl`
      }
    },
    chorus: {
      bars: 8,
      chords: ['F', 'C', 'G', 'Am', 'F', 'C', 'E', 'E'],
      patterns: {
        guitar: 'X-----X-----X-X-',
        bass: '0:2 0:2 0:2 0:2 0:2 0:2 0:2 0:2',
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'x.o.x.o.x.o.x.o.',
        crash: `x${rest(31)}`,
        pad: 'auto',
        arp: '0 2 1 3 2 4 3 5 0 2 1 3 2 4 3 5',
        lead: [
          'C6:3 A5:3 C6:2 F6:8',
          'E6:3 D6:3 C6:2 G5:8',
          'D6:3 B5:3 G5:2 D6:4 E6:4',
          'C6:12 .:4',
          'C6:3 A5:3 C6:2 F6:8',
          'G6:3 F6:3 E6:2 C6:8',
          'B5:4 G#5:4 E5:4 G#5:4',
          'B5:6 C6:2 D6:4 E6:4'
        ],
        shaker: '.x.x.x.x.x.x.x.x',
        kick2: '..x...x...x...x.'
      }
    },
    break: {
      bars: 8,
      chords: ['Dm', 'Dm', 'Am', 'Am', 'Bb', 'Bb', 'E', 'E'],
      patterns: {
        guitar: 'X---------------',
        bass: '0:12 12:2 0:2',
        kick: 'x.........x.....',
        snare: `${'........x.......'.repeat(7)}x.x.x.x.xxxxXXXX`,
        hat: 'x.x.x.x.x.x.x.x.',
        crash: `x${rest(63)}`,
        pad: 'auto',
        lead: [
          'D6:12 C6:2 D6:2',
          'F6:8 E6:4 D6:4',
          'C6:16',
          'E6:4 D6:4 C6:4 B5:4',
          'Bb5:12 A5:2 Bb5:2',
          'D6:8 F6:8',
          'E6:16',
          'G#6:4 F6:4 E6:4 D6:4'
        ],
        ride: 'x.x.x.x.x.x.x.x.',
        tom: `${rest(96)}h...m...l...hmlL${rest(16)}`
      }
    }
  },
  arrangement: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'break', 'chorus', 'chorus'],
  loop: 1
};
