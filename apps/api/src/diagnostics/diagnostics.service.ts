import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getHeapStatistics, writeHeapSnapshot } from 'v8';
import { mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { UPLOADS_DIRECTORY } from '../common/uploads.constants';

/**
 * RSS-leak instrumentation (2026-09-08). The api's RSS climbs with activity
 * (~0.5–1GB/day under report/export load, OOM risk between restarts) while the
 * culprit is unknown — suspects: exceljs/sharp/pdf-lib/archiver. This module
 * answers two questions the pm2 RSS number cannot:
 *
 *  1. WHICH memory grows — JS heap, external/ArrayBuffers (Buffers held by JS),
 *     or neither (RSS minus all of those = native allocations / allocator
 *     fragmentation, the classic sharp-on-glibc signature). The 60s sampler +
 *     the [memwatch] pm2-log line make the divergence visible over hours.
 *  2. WHICH routes correlate — per-handler RSS/heap deltas aggregated since
 *     boot (noisy per request because of GC and concurrency, meaningful in
 *     aggregate).
 *
 * Read it three ways: GET /api/v1/diagnostics/memory (ADMIN), the [memwatch]
 * lines in `pm2 logs ascure-api`, or `pm2 sendSignal SIGUSR2 ascure-api` which
 * dumps the full report into the pm2 log (no auth needed, VPS-shell only).
 */

const SAMPLE_INTERVAL_MS = 60_000;
/** 24h of minute samples. */
const MAX_SAMPLES = 1_440;
/** Every Nth sample also goes to the log — pm2 keeps history across crashes. */
const LOG_EVERY_N_SAMPLES = 10;
/** RSS thresholds (MB) that log a WARN with the route table when crossed. */
const WARN_RSS_MB = [500, 700, 900, 1_100];

interface MemorySample {
  at: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  inflight: number;
}

interface RouteStat {
  count: number;
  /** Requests currently inside this handler. */
  active: number;
  /** Sum of ALL rss deltas (GC makes many negative — can be negative). */
  sumRss: number;
  /** Sum of positive rss deltas only — the "growth pressure" ranking key. */
  sumRssPos: number;
  maxRss: number;
  sumHeap: number;
  maxHeap: number;
  lastAt: number;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

@Injectable()
export class DiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MemWatch');
  private readonly bootAt = Date.now();
  private readonly samples: MemorySample[] = [];
  private readonly routes = new Map<string, RouteStat>();
  private inflight = 0;
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly warnedThresholds = new Set<number>();
  private readonly signalDump = () => {
    this.logger.log(`SIGUSR2 dump: ${JSON.stringify(this.report())}`);
  };

  onModuleInit() {
    this.takeSample();
    this.timer = setInterval(() => this.takeSample(), SAMPLE_INTERVAL_MS);
    // Never keep the process alive just to sample it.
    this.timer.unref();
    // Windows dev boxes have no POSIX signals — prod (Linux/pm2) is the target.
    if (process.platform !== 'win32') {
      process.on('SIGUSR2', this.signalDump);
    }
    this.logger.log(
      `armed: ${SAMPLE_INTERVAL_MS / 1000}s sampler, [memwatch] line every ` +
        `${LOG_EVERY_N_SAMPLES} samples, WARN at rss>${WARN_RSS_MB.join('/')}MB, ` +
        `SIGUSR2 dumps the full report`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (process.platform !== 'win32') {
      process.removeListener('SIGUSR2', this.signalDump);
    }
  }

  /**
   * Called by the global interceptor when a request enters a handler; the
   * returned closure records the deltas when the response finalizes. Deltas
   * overlap under concurrency (another request's allocations land in this
   * one's delta) — the per-route AGGREGATE over many requests is the signal,
   * never a single number.
   */
  beginRequest(routeKey: string): () => void {
    const startRss = process.memoryUsage.rss();
    const startHeap = process.memoryUsage().heapUsed;
    this.inflight += 1;
    let stat = this.routes.get(routeKey);
    if (!stat) {
      stat = {
        count: 0,
        active: 0,
        sumRss: 0,
        sumRssPos: 0,
        maxRss: 0,
        sumHeap: 0,
        maxHeap: 0,
        lastAt: 0,
      };
      this.routes.set(routeKey, stat);
    }
    stat.active += 1;

    let finished = false;
    return () => {
      if (finished) {
        return;
      }
      finished = true;
      this.inflight -= 1;
      const usage = process.memoryUsage();
      const rssDelta = usage.rss - startRss;
      const heapDelta = usage.heapUsed - startHeap;
      stat.active -= 1;
      stat.count += 1;
      stat.sumRss += rssDelta;
      if (rssDelta > 0) {
        stat.sumRssPos += rssDelta;
      }
      stat.maxRss = Math.max(stat.maxRss, rssDelta);
      stat.sumHeap += heapDelta;
      stat.maxHeap = Math.max(stat.maxHeap, heapDelta);
      stat.lastAt = Date.now();
    };
  }

  /** Full diagnostics document — the ADMIN endpoint and the SIGUSR2 dump. */
  report() {
    const usage = process.memoryUsage();
    return {
      process: {
        pid: process.pid,
        node: process.version,
        bootAt: new Date(this.bootAt).toISOString(),
        uptimeHours: Math.round(((Date.now() - this.bootAt) / 3_600_000) * 100) / 100,
        inflight: this.inflight,
      },
      memoryMb: {
        rss: mb(usage.rss),
        heapTotal: mb(usage.heapTotal),
        heapUsed: mb(usage.heapUsed),
        external: mb(usage.external),
        arrayBuffers: mb(usage.arrayBuffers),
        // What none of the JS-visible categories explain — native libs
        // (libvips/sharp, zlib), thread stacks, allocator fragmentation.
        unaccounted: mb(usage.rss - usage.heapTotal - usage.external),
      },
      v8Heap: {
        limitMb: mb(getHeapStatistics().heap_size_limit),
        mallocedMb: mb(getHeapStatistics().malloced_memory),
        peakMallocedMb: mb(getHeapStatistics().peak_malloced_memory),
      },
      sharp: this.sharpStats(),
      routes: this.routeTable(40),
      // Recent 3h of minute samples; the [memwatch] pm2 lines hold the rest.
      samples: this.samples.slice(-180).map((sample) => ({
        at: new Date(sample.at).toISOString(),
        rss: mb(sample.rss),
        heapUsed: mb(sample.heapUsed),
        external: mb(sample.external),
        arrayBuffers: mb(sample.arrayBuffers),
        inflight: sample.inflight,
      })),
      heapSnapshots: this.listHeapSnapshots(),
    };
  }

  /**
   * Write a V8 heap snapshot to uploads/diagnostics for Chrome-DevTools
   * analysis. ⚠ Stalls the event loop for seconds and briefly costs roughly
   * the heap's size again — take it when heapUsed is the thing growing; a
   * native/external leak will not appear in it at all.
   */
  takeHeapSnapshot() {
    const dir = join(UPLOADS_DIRECTORY, 'diagnostics');
    mkdirSync(dir, { recursive: true });
    const path = join(
      dir,
      `heap-${new Date().toISOString().replace(/[:.]/g, '-')}.heapsnapshot`,
    );
    const startedAt = Date.now();
    const file = writeHeapSnapshot(path);
    return {
      file,
      bytesMb: mb(statSync(file).size),
      tookMs: Date.now() - startedAt,
    };
  }

  private listHeapSnapshots() {
    try {
      const dir = join(UPLOADS_DIRECTORY, 'diagnostics');
      return readdirSync(dir)
        .filter((name) => name.endsWith('.heapsnapshot'))
        .map((name) => ({ name, bytesMb: mb(statSync(join(dir, name)).size) }));
    } catch {
      return [];
    }
  }

  private sharpStats() {
    // sharp's own native-memory telemetry (libvips operation cache + counters).
    // A large/climbing cache here is directly actionable (sharp.cache(false)).
    try {
      return { cache: sharp.cache(), counters: sharp.counters(), simd: sharp.simd() };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private routeTable(limit: number) {
    return [...this.routes.entries()]
      .sort((a, b) => b[1].sumRssPos - a[1].sumRssPos)
      .slice(0, limit)
      .map(([route, stat]) => ({
        route,
        count: stat.count,
        active: stat.active,
        sumRssPosMb: mb(stat.sumRssPos),
        sumRssMb: mb(stat.sumRss),
        maxRssMb: mb(stat.maxRss),
        sumHeapMb: mb(stat.sumHeap),
        maxHeapMb: mb(stat.maxHeap),
        lastAt: stat.lastAt ? new Date(stat.lastAt).toISOString() : null,
      }));
  }

  private takeSample() {
    const usage = process.memoryUsage();
    const sample: MemorySample = {
      at: Date.now(),
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      inflight: this.inflight,
    };
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }

    this.tick += 1;
    if (this.tick % LOG_EVERY_N_SAMPLES === 1) {
      this.logger.log(
        `rss=${mb(sample.rss)}MB heapUsed=${mb(sample.heapUsed)}/${mb(sample.heapTotal)}MB ` +
          `ext=${mb(sample.external)}MB ab=${mb(sample.arrayBuffers)}MB ` +
          `inflight=${sample.inflight} up=${Math.round(((Date.now() - this.bootAt) / 3_600_000) * 10) / 10}h`,
      );
    }

    for (const thresholdMb of WARN_RSS_MB) {
      if (mb(sample.rss) >= thresholdMb && !this.warnedThresholds.has(thresholdMb)) {
        this.warnedThresholds.add(thresholdMb);
        const top = this.routeTable(5)
          .map((row) => `${row.route}=${row.count}req/${row.sumRssPosMb}MB`)
          .join(' ');
        this.logger.warn(
          `rss crossed ${thresholdMb}MB (heapUsed=${mb(sample.heapUsed)}MB ` +
            `ext=${mb(sample.external)}MB) top-routes: ${top || 'none yet'}`,
        );
      }
    }
  }
}
