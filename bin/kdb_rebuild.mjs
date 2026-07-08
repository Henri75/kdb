#!/usr/bin/env node
/**
 * Regenerate kdb/*.md views from the authoritative kdb/*.log files (§2.7).
 * Views are plain copies with a generated-file banner; logs are NEVER touched.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const kdbDir = join(process.cwd(), 'kdb');
if (!existsSync(kdbDir)) {
  console.error('no kdb/ directory here');
  process.exit(1);
}

const banner = (src) =>
  `<!-- GENERATED VIEW — do not edit. Rebuilt from ${src} by bin/kdb_rebuild.mjs -->\n\n`;

let rebuilt = 0;
const rebuild = (dir) => {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.log')) continue;
    const log = join(dir, name);
    const md = join(dir, `${basename(name, '.log')}.md`);
    writeFileSync(md, banner(name) + readFileSync(log, 'utf8'));
    rebuilt++;
  }
};

rebuild(kdbDir);
if (existsSync(join(kdbDir, 'components'))) rebuild(join(kdbDir, 'components'));
console.log(`rebuilt ${rebuilt} view(s)`);
