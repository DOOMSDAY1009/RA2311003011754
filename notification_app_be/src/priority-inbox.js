// Priority Inbox — Stage 6
//
// Composite priority score: weight dominates, recency is the tiebreaker.
//
//   priority(n) = TYPE_WEIGHT[n.Type] * 1e15 + epochMs(n.Timestamp)
//
// Multiplying the type weight by a constant larger than any plausible
// timestamp guarantees strict ordering by type, with newer items winning
// within a type. This matches the natural reading of "weight (placement >
// result > event) AND recency".

const TYPE_WEIGHT = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

const TYPE_WEIGHT_MULTIPLIER = 1e15;

function epochMs(timestamp) {
  if (!timestamp) return 0;
  // Accept both ISO 8601 and "YYYY-MM-DD HH:mm:ss" (the API's format).
  const normalised = typeof timestamp === 'string' && timestamp.includes(' ') && !timestamp.includes('T')
    ? timestamp.replace(' ', 'T') + 'Z'
    : timestamp;
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : 0;
}

function priorityScore(notification) {
  const weight = TYPE_WEIGHT[notification.Type] ?? 0;
  return weight * TYPE_WEIGHT_MULTIPLIER + epochMs(notification.Timestamp);
}

// Bounded min-heap. The heap holds at most `capacity` items; the smallest
// score sits at the root, so the cheapest discard decision is also O(1).
class BoundedMinHeap {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.data = [];
  }

  size() { return this.data.length; }
  peek() { return this.data[0]; }

  // Either insert (heap not full) or replace-root if the new score beats
  // the current minimum. Discards otherwise. O(log capacity) worst case.
  consider(item) {
    if (this.data.length < this.capacity) {
      this.data.push(item);
      this._siftUp(this.data.length - 1);
      return true;
    }
    if (item.score > this.data[0].score) {
      this.data[0] = item;
      this._siftDown(0);
      return true;
    }
    return false;
  }

  toSortedDesc() {
    return [...this.data].sort((a, b) => b.score - a.score);
  }

  _siftUp(i) {
    const data = this.data;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (data[i].score < data[p].score) {
        [data[i], data[p]] = [data[p], data[i]];
        i = p;
      } else break;
    }
  }

  _siftDown(i) {
    const data = this.data;
    const n = data.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let smallest = i;
      if (l < n && data[l].score < data[smallest].score) smallest = l;
      if (r < n && data[r].score < data[smallest].score) smallest = r;
      if (smallest !== i) {
        [data[i], data[smallest]] = [data[smallest], data[i]];
        i = smallest;
      } else break;
    }
  }
}

// Single-pass top-N over a list of notifications.
function topNNotifications(notifications, n) {
  const heap = new BoundedMinHeap(n);
  for (const notif of notifications) {
    heap.consider({ notif, score: priorityScore(notif) });
  }
  return heap.toSortedDesc().map((entry) => entry.notif);
}

// Live priority inbox — accepts notifications one at a time. Keeps the top-N
// in O(log n) per arrival, regardless of how many total notifications stream
// in. Use this in the long-running case (websocket subscription, polling
// loop, etc).
class PriorityInbox {
  constructor(n) {
    this.heap = new BoundedMinHeap(n);
  }
  ingest(notification) {
    return this.heap.consider({ notif: notification, score: priorityScore(notification) });
  }
  ingestMany(notifications) {
    for (const n of notifications) this.ingest(n);
  }
  top() {
    return this.heap.toSortedDesc().map((entry) => entry.notif);
  }
}

module.exports = {
  TYPE_WEIGHT,
  priorityScore,
  BoundedMinHeap,
  topNNotifications,
  PriorityInbox,
};
