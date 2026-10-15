import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const gate = fileURLToPath(new URL('../../scripts/verify-encoding.mjs', import.meta.url));
function runGate(files) {
  const folder = mkdtempSync(join(tmpdir(), 'cargo-encoding-test-'));
  try {
    execFileSync('git', ['init', '--quiet', folder]);
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(folder, name), contents);
    execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: folder });
    return spawnSync(process.execPath, [gate], { cwd: folder, encoding: 'utf8' });
  } finally {
    // Only the exact disposable directory returned by mkdtemp is removed.
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('Encoding gate with native image assets', () => {
  it('accepts valid UTF-8 text alongside a binary WebP asset', () => {
    const result = runGate({ 'note.md': Buffer.from('Cargo reference — illustration only', 'utf8'), 'example.webp': Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x57, 0x45, 0x42, 0x50]) });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verify:encoding passed');
  });
  it('still refuses invalid UTF-8 in a text file beside WebP', () => {
    const result = runGate({ 'bad.md': Buffer.from([0xff, 0xfe]), 'example.webp': Buffer.from([0xff, 0xfe]) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('INVALID-UTF8 bad.md');
  });
  it('still refuses reversible mojibake in tracked text', () => {
    const result = runGate({ 'bad.md': Buffer.from('caf\u00c3\u00a9', 'utf8') });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('MOJIBAKE bad.md');
  });
});
