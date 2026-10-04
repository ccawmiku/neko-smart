// SQLite online backups for routers using tmpfs. No raw copy of a live WAL database.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, openSync, closeSync, fsyncSync, renameSync, statSync, unlinkSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
const require = createRequire('/app/apps/collector/package.json');
const Database = require('better-sqlite3');
const source = process.env.DB_PATH;
const directory = process.env.PERSIST_DIR || '/app/persist';
const target = join(directory, 'stats.db');
const interval = Math.max(900, Number(process.env.DB_BACKUP_INTERVAL || 3600)) * 1000;
let busy = false;
async function backup() {
 if (busy || !source || !existsSync(source)) return;
 busy = true;
 let db;
 const temporary = target + '.new';
 try {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(temporary)) unlinkSync(temporary);
  db = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
  await db.backup(temporary);
  db.close(); db = undefined;
  const check = new Database(temporary, { readonly: true, fileMustExist: true });
  try { if (check.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Backup verification failed'); } finally { check.close(); }
  const fd = openSync(temporary, 'r');try {fsyncSync(fd);} finally {closeSync(fd);}
  if (existsSync(target)) renameSync(target, target + '.previous');
  renameSync(temporary, target);
  const dir = openSync(dirname(target), 'r');try {fsyncSync(dir);} finally {closeSync(dir);}
  console.info('[database] Backup saved: ' + statSync(target).size + ' bytes');
 } catch (error) { console.error('[database] Backup failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1; }
 finally {if (db) db.close();busy = false;}
}
if (process.argv.includes('--restore')) {
 if (!source) throw new Error('DB_PATH is required');
 mkdirSync(dirname(source), {recursive:true,mode:0o700});
 if (!existsSync(source)) {
  let restored=false;
  const candidates=[target,target+'.previous'];
  for (const file of candidates) if (existsSync(file)) {
   let saved;
   try {saved=new Database(file,{readonly:true,fileMustExist:true});if(saved.pragma('quick_check',{simple:true})!=='ok')throw new Error('Invalid snapshot');saved.close();saved=undefined;copyFileSync(file,source);chmodSync(source,0o600);restored=true;console.info('[database] Snapshot restored');break;} catch {console.warn('[database] Invalid snapshot, trying previous backup');} finally {if(saved)saved.close();}
  }
  if (!restored && candidates.some(existsSync)) throw new Error('No valid database backup');
 }
} else if (process.argv.includes('--once')) await backup();
else { const timer=setInterval(backup, interval); for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => {clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,50));await backup();process.exit(process.exitCode||0);}); }
