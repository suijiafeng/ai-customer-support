/**
 * 按 key 串行执行的异步锁（单进程内）。同一个 key 的任务排队依次执行，不同 key 并行。
 * 任务失败不会卡住后面的任务；队列空了就删除 key，不会无限增长。
 * 多实例部署时需要换成分布式锁（如 Redis），见 docs/reference.md「已知限制」。
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** 正在排队或执行的 key 数（测试用） */
  get size(): number {
    return this.tails.size;
  }
}
