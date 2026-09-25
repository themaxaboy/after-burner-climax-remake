/**
 * "Carrier Dawn" - anthem for carrier launch / landing cinematics. Original composition.
 * C major, 72 BPM: warm brass-like pads, strings, a noble horn melody and timpani swells.
 */
const rest = (n) => '.'.repeat(n);
const DOWNBEAT = 'x...............';

export default {
  id: 'anthem',
  title: 'Carrier Dawn',
  bpm: 72,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  sections: {
    intro: {
      bars: 4,
      chords: ['Fmaj7', 'Fmaj7', 'Gsus4', 'G'],
      patterns: {
        strings: 'auto',
        brass: `${rest(32)}X---------------X---------------`,
        sub: '0:16',
        timpani: `x${rest(15)}x.......x.......${rest(8)}rrrrrrrrrrrrrrrrrrrrrrrr`,
        swell: '.:32 x:32'
      }
    },
    theme: {
      bars: 8,
      chords: ['C', 'G/B', 'Am', 'F', 'C/E', 'F', 'Dm7', 'G'],
      patterns: {
        strings: 'auto',
        brass: 'X---------------',
        sub: '0:16',
        horn: [
          'G4:6 C5:2 E5:8',
          'D5:6 B4:2 G4:8',
          'A4:6 C5:2 E5:6 D5:2',
          'C5:12 A4:4',
          'G4:6 C5:2 G5:8',
          'F5:6 E5:2 C5:4 A4:4',
          'D5:4 E5:4 F5:4 A5:4',
          'G5:12 .:4'
        ],
        timpani: `${DOWNBEAT.repeat(7)}x.......rrrrrrrr`,
        crash: `x${rest(127)}`
      }
    },
    climax: {
      bars: 8,
      chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
      patterns: {
        strings: 'auto',
        brass: 'X-------X-------',
        sub: '0:8 0:8',
        horn: [
          'A5:6 G5:2 F5:4 C5:4',
          'D5:6 E5:2 G5:8',
          'B5:6 A5:2 G5:4 E5:4',
          'A5:8 C6:4 B5:4',
          'A5:6 G5:2 F5:4 A5:4',
          'B5:6 C6:2 D6:8',
          'E6:16',
          'E6:4 D6:4 C6:8'
        ],
        timpani: `${'X.......x.......'.repeat(5)}X...x...x...rrrr${DOWNBEAT}X.......rrrrrrrr`,
        crash: `x${rest(63)}`,
        swell: '.:96 x:32'
      }
    },
    outro: {
      bars: 4,
      chords: ['F', 'G', 'C', 'C'],
      patterns: {
        strings: 'auto',
        brass: 'X---------------',
        sub: '0:16',
        horn: 'A5:6 G5:2 F5:8 D5:6 E5:2 G5:8 E5:16 .:16',
        timpani: `${DOWNBEAT.repeat(3)}x.......rrrrrrrr`
      }
    }
  },
  arrangement: ['intro', 'theme', 'climax', 'outro'],
  loop: 1
};
