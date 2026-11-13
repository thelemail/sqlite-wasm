import sqlite3InitModule, {
	type Database,
	type SAHPoolUtil,
	type Sqlite3Static,
	type SqlValue
} from '@thelemail/sqlite-wasm';

export type Request =
	| { op: 'probe' }
	| { op: 'open'; directory: string; file: string; key: Uint8Array; cipher: string; cacheSize?: number }
	| { op: 'exec'; sql: string; bind?: SqlValue[] }
	| { op: 'select'; sql: string; bind?: SqlValue[] }
	| { op: 'files' }
	| { op: 'close' }
	| { op: 'scan'; directory: string; needles: string[] };

export type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string; code?: number };

let sqlite3: Sqlite3Static | undefined;
let pool: SAHPoolUtil | undefined;
let db: Database | undefined;

async function load(): Promise<Sqlite3Static> {
	sqlite3 ??= await sqlite3InitModule({ print: () => {}, printErr: () => {} });
	return sqlite3;
}

function keyDatabase(s: Sqlite3Static, pDb: number, key: Uint8Array): number {
	const prefix = new TextEncoder().encode('raw:');
	const n = prefix.length + key.length;
	const p = s.wasm.alloc(n);
	try {
		const heap = s.wasm.heap8u();
		heap.set(prefix, p);
		heap.set(key, p + prefix.length);
		return s.capi.sqlite3_key_v2(pDb, 'main', p, n);
	} finally {
		s.wasm.heap8u().fill(0, p, p + n);
		s.wasm.dealloc(p);
	}
}

async function open(r: Extract<Request, { op: 'open' }>) {
	const s = await load();
	const name = `pool-${r.directory}`;
	pool = await s.installOpfsSAHPoolVfs({ name, directory: `/${r.directory}` });
	const mcName = `multipleciphers-${name}`;
	if (!s.capi.sqlite3_vfs_find(mcName)) {
		const rc = s.capi.sqlite3mc_vfs_create(name, 0);
		if (rc !== s.capi.SQLITE_OK) throw Object.assign(new Error('mc vfs'), { code: rc });
	}
	const stack = s.wasm.pstack.pointer;
	try {
		const ppDb = s.wasm.pstack.allocPtr();
		const flags = s.capi.SQLITE_OPEN_READWRITE | s.capi.SQLITE_OPEN_CREATE | s.capi.SQLITE_OPEN_EXRESCODE;
		const rc = s.capi.sqlite3_open_v2(r.file, ppDb, flags, mcName);
		const pDb = s.wasm.peekPtr(ppDb);
		if (rc !== s.capi.SQLITE_OK) {
			if (pDb) s.capi.sqlite3_close_v2(pDb);
			throw Object.assign(new Error('open'), { code: rc });
		}
		const idx = s.capi.sqlite3mc_cipher_index(r.cipher);
		const crc = s.capi.sqlite3mc_config(pDb, 'cipher', idx);
		if (crc !== idx) {
			s.capi.sqlite3_close_v2(pDb);
			throw Object.assign(new Error('cipher'), { code: crc });
		}
		const krc = keyDatabase(s, pDb, r.key);
		if (krc !== s.capi.SQLITE_OK) {
			s.capi.sqlite3_close_v2(pDb);
			throw Object.assign(new Error('key'), { code: krc });
		}
		const handle = s.oo1.DB.wrapHandle(pDb, true);
		try {
			handle.selectValue('SELECT count(*) FROM sqlite_schema');
		} catch (e) {
			handle.close();
			throw e;
		}
		if (r.cacheSize !== undefined) handle.exec(`PRAGMA cache_size=${r.cacheSize}`);
		db = handle;
		return { vfs: mcName, cipher: s.capi.sqlite3mc_cipher_name(idx) };
	} finally {
		s.wasm.pstack.restore(stack);
	}
}

async function scan(directory: string, needles: string[]) {
	pool?.pauseVfs();
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle(directory);
	const encoded = needles.map((n) => new TextEncoder().encode(n));
	const found = new Set<string>();
	let bytes = 0;
	let files = 0;
	const walk = async (d: FileSystemDirectoryHandle) => {
		for await (const [, h] of d as unknown as AsyncIterable<[string, FileSystemHandle]>) {
			if (h.kind === 'directory') {
				await walk(h as FileSystemDirectoryHandle);
				continue;
			}
			const data = new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
			bytes += data.length;
			files++;
			encoded.forEach((needle, i) => {
				if (indexOf(data, needle) >= 0) found.add(needles[i]);
			});
		}
	};
	await walk(dir);
	await pool?.unpauseVfs();
	return { bytes, files, found: [...found] };
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
	outer: for (let i = 0; i + needle.length <= hay.length; i++) {
		for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
		return i;
	}
	return -1;
}

async function handle(r: Request): Promise<unknown> {
	switch (r.op) {
		case 'probe': {
			const s = await load();
			const mem = new s.oo1.DB(':memory:');
			try {
				mem.exec("CREATE VIRTUAL TABLE w USING fts5(body, tokenize='unicode61 remove_diacritics 2')");
				mem.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='trigram')");
				mem.exec("INSERT INTO w VALUES ('Café crème brûlée'), ('plain words')");
				mem.exec("INSERT INTO t VALUES ('INV-2026/0007 東京都の請求書')");
				return {
					libVersion: s.version.libVersion,
					sourceId: s.version.sourceId,
					mcVersion: s.capi.sqlite3mc_version(),
					fts5: s.capi.sqlite3_compileoption_used('ENABLE_FTS5') === 1,
					folded: mem.selectValue("SELECT count(*) FROM w WHERE w MATCH 'cafe creme'"),
					substring: mem.selectValue("SELECT count(*) FROM t WHERE t MATCH '\"2026/00\"'"),
					cjk: mem.selectValue("SELECT count(*) FROM t WHERE t MATCH '\"京都の\"'"),
					ciphers: Array.from({ length: s.capi.sqlite3mc_cipher_count() }, (_, i) => s.capi.sqlite3mc_cipher_name(i + 1))
				};
			} finally {
				mem.close();
			}
		}
		case 'open':
			return open(r);
		case 'exec':
			db!.exec({ sql: r.sql, bind: r.bind });
			return null;
		case 'select':
			return db!.selectArrays(r.sql, r.bind);
		case 'files':
			return pool!.getFileNames();
		case 'close':
			db?.close();
			db = undefined;
			return null;
		case 'scan':
			return scan(r.directory, r.needles);
	}
}

self.onmessage = async (e: MessageEvent<Request & { id: number }>) => {
	const { id } = e.data;
	try {
		const value = await handle(e.data);
		self.postMessage({ id, ok: true, value } satisfies Reply);
	} catch (err) {
		const code = (err as { resultCode?: number; code?: number }).resultCode ?? (err as { code?: number }).code;
		self.postMessage({ id, ok: false, error: String((err as Error).message ?? err), code } satisfies Reply);
	}
};
