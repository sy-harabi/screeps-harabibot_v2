interface PriorityQueueEntry<T> {
  readonly value: T;
  readonly priority: number;
  readonly order: number;
}

/**
 * A max-priority queue with stable FIFO ordering for equal priorities.
 */
export class PriorityQueue<T> {
  private readonly heap: PriorityQueueEntry<T>[] = [];
  private nextOrder = 0;

  get size(): number {
    return this.heap.length;
  }

  push(value: T, priority: number): void {
    const entry: PriorityQueueEntry<T> = {
      value,
      priority,
      order: this.nextOrder,
    };
    this.nextOrder++;

    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const root = this.heap[0];
    const last = this.heap.pop();

    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return root.value;
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);

      if (!this.comesBefore(this.heap[index], this.heap[parentIndex])) {
        return;
      }

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex;

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let bestIndex = index;

      if (
        leftIndex < this.heap.length &&
        this.comesBefore(this.heap[leftIndex], this.heap[bestIndex])
      ) {
        bestIndex = leftIndex;
      }

      if (
        rightIndex < this.heap.length &&
        this.comesBefore(this.heap[rightIndex], this.heap[bestIndex])
      ) {
        bestIndex = rightIndex;
      }

      if (bestIndex === index) {
        return;
      }

      this.swap(index, bestIndex);
      index = bestIndex;
    }
  }

  private comesBefore(
    first: PriorityQueueEntry<T>,
    second: PriorityQueueEntry<T>,
  ): boolean {
    if (first.priority !== second.priority) {
      return first.priority > second.priority;
    }

    return first.order < second.order;
  }

  private swap(firstIndex: number, secondIndex: number): void {
    const first = this.heap[firstIndex];
    this.heap[firstIndex] = this.heap[secondIndex];
    this.heap[secondIndex] = first;
  }
}
