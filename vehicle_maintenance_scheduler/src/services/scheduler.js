// 0/1 knapsack: pick a subset of `tasks` (each with integer `duration` and
// numeric `impact`) such that sum of durations <= budget and sum of impacts is
// maximised. Uses pseudo-polynomial DP — O(n * W) time, O(n * W) memory for the
// reconstruction table. Suitable for the scale shown in the spec
// (W <= a few hundred, n in the thousands).
//
// If W explodes (e.g. fractional hours scaled up by 100, or budgets in the
// millions), swap this for either:
//   - A 2-approximation greedy by impact/duration density, or
//   - An FPTAS that scales impacts down to a polynomial range.
function solveKnapsack(tasks, budget) {
  const W = Math.max(0, Math.floor(budget));
  const n = tasks.length;

  if (n === 0 || W === 0) {
    return { selected: [], totalDuration: 0, totalImpact: 0 };
  }

  // dp[i][w] = best impact using first i tasks within capacity w
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(W + 1));

  for (let i = 1; i <= n; i++) {
    const { duration, impact } = tasks[i - 1];
    const d = Math.max(0, Math.floor(duration));
    const row = dp[i];
    const prev = dp[i - 1];
    for (let w = 0; w <= W; w++) {
      if (d > w) {
        row[w] = prev[w];
      } else {
        const take = prev[w - d] + impact;
        const skip = prev[w];
        row[w] = take > skip ? take : skip;
      }
    }
  }

  // Reconstruct chosen items
  const selected = [];
  let w = W;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      const t = tasks[i - 1];
      selected.push(t);
      w -= Math.max(0, Math.floor(t.duration));
    }
  }
  selected.reverse();

  const totalDuration = selected.reduce((s, t) => s + t.duration, 0);
  const totalImpact = selected.reduce((s, t) => s + t.impact, 0);

  return { selected, totalDuration, totalImpact };
}

module.exports = { solveKnapsack };
