// Verify the priority-inbox logic without hitting the network.
// Run: node examples/synthetic.js

const { topNNotifications, priorityScore, TYPE_WEIGHT, PriorityInbox } = require('../src/priority-inbox');

const synthetic = [
  { ID: 'p-old',   Type: 'Placement', Message: 'AMD hiring (oldest)',     Timestamp: '2026-04-22 17:49:42' },
  { ID: 'p-new',   Type: 'Placement', Message: 'CSX Corporation hiring',  Timestamp: '2026-04-22 17:51:18' },
  { ID: 'r-new',   Type: 'Result',    Message: 'mid-sem',                 Timestamp: '2026-04-22 17:51:30' },
  { ID: 'r-mid',   Type: 'Result',    Message: 'project-review',          Timestamp: '2026-04-22 17:50:42' },
  { ID: 'r-old',   Type: 'Result',    Message: 'external',                Timestamp: '2026-04-22 17:50:30' },
  { ID: 'e-new',   Type: 'Event',     Message: 'tech-fest',               Timestamp: '2026-04-22 17:50:06' },
  { ID: 'e-newer', Type: 'Event',     Message: 'farewell',                Timestamp: '2026-04-22 17:51:25' },
];

console.log('Type weights:', TYPE_WEIGHT, '\n');

console.log('Score per notification:');
synthetic.forEach((n) => {
  console.log(`  ${n.ID.padEnd(8)} ${n.Type.padEnd(9)} ${n.Timestamp}  score=${priorityScore(n).toExponential(3)}`);
});

console.log('\nTop 3 (single-pass, sort + slice equivalent):');
topNNotifications(synthetic, 3).forEach((n, i) => {
  console.log(`  ${i + 1}. ${n.Type.padEnd(9)} ${n.Timestamp}  ${n.Message}`);
});

console.log('\nLive ingest via PriorityInbox (top 3, items arriving one at a time):');
const inbox = new PriorityInbox(3);
synthetic.forEach((n) => inbox.ingest(n));
// New arrival mid-stream:
inbox.ingest({ ID: 'p-newest', Type: 'Placement', Message: 'late breaking placement', Timestamp: '2026-04-22 17:52:00' });
inbox.top().forEach((n, i) => {
  console.log(`  ${i + 1}. ${n.Type.padEnd(9)} ${n.Timestamp}  ${n.Message}`);
});

// Sanity assertions
const top3 = topNNotifications(synthetic, 3);
const types = top3.map((n) => n.Type);
const ok = types.every((t) => t === 'Placement' || t === 'Result');
console.log('\nSanity:', ok ? 'OK — top 3 contains only Placements/Results, never Events (weight strictly dominates).' : 'FAIL');
