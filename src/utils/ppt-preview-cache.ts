// 新进入视口的页面允许 SDK 分阶段完成布局；真正空白的幻灯片同样会正常收敛。
const SETTLE_DELAYS = [200, 800, 2400]

export class PptPreviewCache<T extends object> {
  private entries = new Map<T, { key: string; paintedAt: number; retries: number }>()

  needsPaint(target: T, key: string, now: number): boolean {
    const entry = this.entries.get(target)
    return !entry || entry.key !== key ||
      (entry.retries < SETTLE_DELAYS.length && now >= entry.paintedAt + SETTLE_DELAYS[entry.retries]!)
  }

  painted(target: T, key: string, now: number): void {
    const entry = this.entries.get(target)
    if (!entry || entry.key !== key) this.entries.set(target, { key, paintedAt: now, retries: 0 })
    else entry.retries++
  }

  nextRetry(target: T): number | undefined {
    const entry = this.entries.get(target)
    if (entry && entry.retries < SETTLE_DELAYS.length) return entry.paintedAt + SETTLE_DELAYS[entry.retries]!
  }

  release(target: T): void { this.entries.delete(target) }
  clear(): void { this.entries.clear() }
}
