// SQLite online backups for routers using tmpfs. No raw copy of a live WAL database.
// Includes stream-based gzip compression to minimize Flash memory usage.
import { createRequire } from 'node:module';
import {
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  statSync,
  unlinkSync,
  copyFileSync,
  chmodSync,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const require = createRequire('/app/apps/collector/package.json');
const Database = require('better-sqlite3');
const source = process.env.DB_PATH;
const directory = process.env.PERSIST_DIR || '/app/persist';
const target = join(directory, 'stats.db');
const targetGz = join(directory, 'stats.db.gz');
const previousGz = join(directory, 'stats.db.previous.gz');
const previous = join(directory, 'stats.db.previous');
const interval = Math.max(900, Number(process.env.DB_BACKUP_INTERVAL || 3600)) * 1000;
let busy = false;

async function compressFile(inputPath, outputPath) {
  await pipeline(
    createReadStream(inputPath),
    createGzip({ level: 6 }),
    createWriteStream(outputPath),
  );
}

async function decompressFile(inputPath, outputPath) {
  await pipeline(
    createReadStream(inputPath),
    createGunzip(),
    createWriteStream(outputPath),
  );
}

async function backup() {
  if (busy || !source || !existsSync(source)) return;
  busy = true;
  let db;
  const temporary = target + '.new';
  const temporaryGz = temporary + '.gz';
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (existsSync(temporary)) unlinkSync(temporary);
    if (existsSync(temporaryGz)) unlinkSync(temporaryGz);

    db = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
    await db.backup(temporary);
    db.close();
    db = undefined;

    const check = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma('quick_check', { simple: true }) !== 'ok') {
        throw new Error('Backup verification failed');
      }
    } finally {
      check.close();
    }

    // Stream-compress the verified backup
    await compressFile(temporary, temporaryGz);
    unlinkSync(temporary);

    const fd = openSync(temporaryGz, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    // Rotate existing compressed and legacy uncompressed snapshots
    if (existsSync(targetGz)) {
      renameSync(targetGz, previousGz);
    } else if (existsSync(target)) {
      await compressFile(target, previousGz);
      unlinkSync(target);
    }
    if (existsSync(previous)) {
      unlinkSync(previous);
    }

    renameSync(temporaryGz, targetGz);
    const dir = openSync(dirname(targetGz), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }

    console.info(`[database] Backup saved (compressed): ${statSync(targetGz).size} bytes`);
  } catch (error) {
    console.error('[database] Backup failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  } finally {
    if (db) db.close();
    if (existsSync(temporary)) unlinkSync(temporary);
    if (existsSync(temporaryGz)) unlinkSync(temporaryGz);
    busy = false;
    if (typeof global.gc === 'function') global.gc();
  }
}

if (process.argv.includes('--restore')) {
  if (!source) throw new Error('DB_PATH is required');
  mkdirSync(dirname(source), { recursive: true, mode: 0o700 });
  if (!existsSync(source)) {
    let restored = false;
    const candidates = [targetGz, target, previousGz, previous];
    for (const file of candidates) {
      if (existsSync(file)) {
        try {
          if (file.endsWith('.gz')) {
            await decompressFile(file, source);
            chmodSync(source, 0o600);
            const check = new Database(source, { readonly: true, fileMustExist: true });
            try {
              if (check.pragma('quick_check', { simple: true }) !== 'ok') {
                throw new Error('Invalid decompressed snapshot');
              }
            } finally {
              check.close();
            }
          } else {
            const saved = new Database(file, { readonly: true, fileMustExist: true });
            try {
              if (saved.pragma('quick_check', { simple: true }) !== 'ok') {
                throw new Error('Invalid snapshot');
              }
            } finally {
              saved.close();
            }
            copyFileSync(file, source);
            chmodSync(source, 0o600);
          }
          restored = true;
          console.info(`[database] Snapshot restored from ${file}`);
          break;
        } catch (err) {
          console.warn(`[database] Failed to restore from ${file}: ${err instanceof Error ? err.message : String(err)}, trying next candidate`);
          if (existsSync(source)) unlinkSync(source);
        }
      }
    }
    if (!restored && candidates.some(existsSync)) {
      throw new Error('No valid database backup');
    }
  }
} else if (process.argv.includes('--once')) {
  await backup();
} else {
  const timer = setInterval(backup, interval);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      clearInterval(timer);
      while (busy) await new Promise((r) => setTimeout(r, 50));
      await backup();
      process.exit(process.exitCode || 0);
    });
  }
}
