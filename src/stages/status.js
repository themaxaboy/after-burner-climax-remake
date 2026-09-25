// STATUS REPORT maths: cumulative run figures graded AAA–C against the
// stages' par values (def.par = {time, combo, downRate, score}).

export const GRADES = ['AAA', 'AA', 'A', 'B', 'C'];

/** Grade for a performance ratio (1 = par). */
export function gradeFor(ratio) {
  if (!(ratio > 0)) return 'C';
  if (ratio >= 1.3) return 'AAA';
  if (ratio >= 1.15) return 'AA';
  if (ratio >= 1.0) return 'A';
  if (ratio >= 0.8) return 'B';
  return 'C';
}

/**
 * Cumulative report over stage results ({stage: def, kills, bestCombo, time,
 * downRate, total}). Returns the four rows with values and grades.
 */
export function statusReport(results, total = null) {
  let kills = 0, maxCombo = 0, time = 0, rateSum = 0;
  let parTime = 0, parCombo = 0, parRate = 0, parScore = 0;
  for (const r of results) {
    const par = r.stage?.par || {};
    kills += r.kills || 0;
    maxCombo = Math.max(maxCombo, r.bestCombo || 0);
    time += r.time || 0;
    rateSum += r.downRate || 0;
    parTime += par.time || 60;
    parCombo = Math.max(parCombo, par.combo || 20);
    parRate += par.downRate || 70;
    parScore += par.score || 100000;
  }
  const n = Math.max(1, results.length);
  const score = total ?? (results.length ? results[results.length - 1].total || 0 : 0);
  const downRate = rateSum / n;
  return {
    stages: results.length,
    score: { value: score, grade: gradeFor(score / Math.max(1, parScore)) },
    downed: { value: kills, rate: downRate, grade: gradeFor(downRate / Math.max(1, parRate / n)) },
    combo: { value: maxCombo, grade: gradeFor(maxCombo / Math.max(1, parCombo)) },
    time: { value: time, grade: gradeFor(time > 0 ? parTime / time : 0) }
  };
}
