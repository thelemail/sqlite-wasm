import { afterEach, describe, expect, test } from 'vitest';
import { Harness, randomDirectory, randomKey, removeDirectory } from './client.ts';

const SQLITE_NOTADB = 26;
const live: Harness[] = [];
const dirs: string[] = [];

function harness() {
	const h = new Harness();
	live.push(h);
	return h;
}

function directory() {
	const d = randomDirectory();
	dirs.push(d);
	return d;
}

afterEach(async () => {
	for (const h of live.splice(0)) h.terminate();
	for (const d of dirs.splice(0)) await removeDirectory(d);
});

describe('build', () => {
	test('has fts5, both tokenizers and multiple ciphers', async () => {
		const p = await harness().call<Record<string, unknown>>({ op: 'probe' });
		expect(p.libVersion).toBe('3.54.0');
		expect(p.mcVersion).toMatch(/^SQLite3 Multiple Ciphers 2\.6\.1/);
		expect(p.fts5).toBe(true);
		expect(p.folded).toBe(1);
		expect(p.substring).toBe(1);
		expect(p.cjk).toBe(1);
		expect(p.ciphers).toContain('chacha20');
	});
});

describe('encrypted opfs-sahpool', () => {
	test('round-trips through close and reopen', async () => {
		const dir = directory();
		const key = randomKey();
		const a = harness();
		const opened = await a.call<{ vfs: string; cipher: string }>({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		expect(opened.cipher).toBe('chacha20');
		await a.call({ op: 'exec', sql: "CREATE VIRTUAL TABLE p USING fts5(body, tokenize='unicode61 remove_diacritics 2')" });
		await a.call({ op: 'exec', sql: 'INSERT INTO p VALUES (?)', bind: ['the quarterly invoice from Zebulon'] });
		await a.call({ op: 'close' });
		a.terminate();

		const b = harness();
		await b.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		const rows = await b.call<unknown[][]>({ op: 'select', sql: "SELECT body FROM p WHERE p MATCH 'zebulon'" });
		expect(rows).toEqual([['the quarterly invoice from Zebulon']]);
	});

	test('wrong key fails with SQLITE_NOTADB and leaves the file intact', async () => {
		const dir = directory();
		const key = randomKey();
		const a = harness();
		await a.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		await a.call({ op: 'exec', sql: 'CREATE TABLE t(x); INSERT INTO t VALUES (1)' });
		await a.call({ op: 'close' });
		a.terminate();

		const b = harness();
		const err = await b.call({ op: 'open', directory: dir, file: '/s.db', key: randomKey(), cipher: 'chacha20' }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as { code: number }).code & 0xff).toBe(SQLITE_NOTADB);
		b.terminate();

		const c = harness();
		await c.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		expect(await c.call({ op: 'select', sql: 'SELECT x FROM t' })).toEqual([[1]]);
	});

	test('a killed transaction rolls back from the hot journal', async () => {
		const dir = directory();
		const key = randomKey();
		const a = harness();
		await a.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20', cacheSize: 4 });
		await a.call({ op: 'exec', sql: 'CREATE TABLE t(x TEXT); INSERT INTO t VALUES (?)', bind: ['committed'] });
		await a.call({ op: 'exec', sql: 'BEGIN' });
		await a.call({ op: 'exec', sql: "INSERT INTO t SELECT printf('%.2000c', 'x') FROM generate_series(1, 400)" }).catch(async () => {
			await a.call({ op: 'exec', sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 400) INSERT INTO t SELECT printf('%.2000c', 'x') FROM n" });
		});
		const files = await a.call<string[]>({ op: 'files' });
		expect(files.some((f) => f.endsWith('-journal'))).toBe(true);
		a.terminate();

		const b = harness();
		await b.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		expect(await b.call({ op: 'select', sql: 'SELECT x FROM t' })).toEqual([['committed']]);
		expect(await b.call({ op: 'select', sql: 'PRAGMA integrity_check' })).toEqual([['ok']]);
	});

	test('stored bytes contain no plaintext', async () => {
		const dir = directory();
		const key = randomKey();
		const a = harness();
		await a.call({ op: 'open', directory: dir, file: '/s.db', key, cipher: 'chacha20' });
		await a.call({ op: 'exec', sql: "CREATE VIRTUAL TABLE p USING fts5(body, tokenize='unicode61 remove_diacritics 2')" });
		await a.call({ op: 'exec', sql: "CREATE VIRTUAL TABLE l USING fts5(body, tokenize='trigram')" });
		await a.call({ op: 'exec', sql: 'CREATE TABLE subjects(s TEXT)' });
		await a.call({ op: 'exec', sql: 'BEGIN' });
		for (let i = 0; i < 50; i++) {
			await a.call({ op: 'exec', sql: 'INSERT INTO p VALUES (?)', bind: [`xylophonist quarterly meeting ${i}`] });
			await a.call({ op: 'exec', sql: 'INSERT INTO l VALUES (?)', bind: [`zebulon.marsh+billing@calloway.test`] });
			await a.call({ op: 'exec', sql: 'INSERT INTO subjects VALUES (?)', bind: ['Renewal of the Hollowbrook lease'] });
		}
		await a.call({ op: 'exec', sql: 'COMMIT' });
		await a.call({ op: 'close' });
		const needles = ['xylophonist', 'zebulon', 'calloway', 'Hollowbrook', 'SQLite format 3', 'subjects', 'fts5'];
		const result = await a.call<{ bytes: number; files: number; found: string[] }>({ op: 'scan', directory: dir, needles });
		expect(result.bytes).toBeGreaterThan(8192);
		expect(result.found).toEqual([]);
	});
});
