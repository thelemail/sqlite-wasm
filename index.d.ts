export type SqlValue = string | number | bigint | Uint8Array | null;
export type BindValue = SqlValue | boolean | undefined;
export type Bindable = readonly BindValue[] | Record<string, BindValue>;
export type Pointer = number;

export interface ExecOptions {
	sql?: string;
	bind?: Bindable;
	rowMode?: 'array' | 'object' | 'stmt' | number | `$${string}`;
	returnValue?: 'this' | 'resultRows' | 'saveSql';
	resultRows?: unknown[];
	callback?: (row: unknown) => boolean | void;
}

export interface PreparedStatement {
	readonly pointer: Pointer | undefined;
	readonly columnCount: number;
	readonly parameterCount: number;
	bind(values: Bindable): this;
	bind(index: number | string, value: BindValue): this;
	clearBindings(): this;
	reset(alsoClearBinds?: boolean): this;
	step(): boolean;
	stepReset(): this;
	stepFinalize(): boolean;
	get(index: number): SqlValue;
	get(target: SqlValue[]): SqlValue[];
	get(target: Record<string, SqlValue>): Record<string, SqlValue>;
	getInt(index: number): number | null;
	getString(index: number): string | null;
	getBlob(index: number): Uint8Array | null;
	getColumnName(index: number): string;
	finalize(): number | undefined;
}

export interface Database {
	readonly pointer: Pointer | undefined;
	readonly filename: string;
	exec(sql: string, options?: ExecOptions): this;
	exec(options: ExecOptions & { sql: string }): this;
	prepare(sql: string): PreparedStatement;
	selectValue(sql: string, bind?: Bindable): SqlValue | undefined;
	selectValues(sql: string, bind?: Bindable): SqlValue[];
	selectArray(sql: string, bind?: Bindable): SqlValue[] | undefined;
	selectArrays(sql: string, bind?: Bindable): SqlValue[][];
	selectObject(sql: string, bind?: Bindable): Record<string, SqlValue> | undefined;
	selectObjects(sql: string, bind?: Bindable): Record<string, SqlValue>[];
	transaction<T>(callback: (db: this) => T): T;
	transaction<T>(qualifier: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE', callback: (db: this) => T): T;
	changes(total?: boolean, sixtyFour?: boolean): number | bigint;
	isOpen(): boolean;
	close(): void;
}

export interface DatabaseConstructor {
	new (filename?: string, flags?: string, vfs?: string): Database;
	new (options: { filename?: string; flags?: string; vfs?: string }): Database;
	wrapHandle(pDb: Pointer, takeOwnership?: boolean): Database;
}

export interface SAHPoolUtil {
	readonly vfsName: string;
	addCapacity(n: number): Promise<number>;
	reduceCapacity(n: number): Promise<number>;
	getCapacity(): number;
	getFileCount(): number;
	getFileNames(): string[];
	reserveMinimumCapacity(min: number): Promise<number>;
	exportFile(name: string): Uint8Array;
	importDb(name: string, bytes: Uint8Array | ArrayBuffer): number;
	wipeFiles(): Promise<void>;
	unlink(filename: string): boolean;
	removeVfs(): Promise<boolean>;
	pauseVfs(): this;
	unpauseVfs(): Promise<this>;
	isPaused(): boolean;
}

export interface SAHPoolOptions {
	name?: string;
	directory?: string;
	initialCapacity?: number;
	clearOnInit?: boolean;
	verbosity?: 0 | 1 | 2 | 3;
	forceReinitIfPreviouslyFailed?: boolean;
	preserveOnInitFailure?: boolean;
}

export interface CApi {
	readonly SQLITE_OK: number;
	readonly SQLITE_ERROR: number;
	readonly SQLITE_BUSY: number;
	readonly SQLITE_NOMEM: number;
	readonly SQLITE_IOERR: number;
	readonly SQLITE_CORRUPT: number;
	readonly SQLITE_FULL: number;
	readonly SQLITE_CANTOPEN: number;
	readonly SQLITE_NOTADB: number;
	readonly SQLITE_OPEN_READONLY: number;
	readonly SQLITE_OPEN_READWRITE: number;
	readonly SQLITE_OPEN_CREATE: number;
	readonly SQLITE_OPEN_EXRESCODE: number;
	sqlite3_libversion(): string;
	sqlite3_sourceid(): string;
	sqlite3_open_v2(filename: string, ppDb: Pointer, flags: number, vfs: string | null): number;
	sqlite3_close_v2(pDb: Pointer): number;
	sqlite3_errmsg(pDb: Pointer): string;
	sqlite3_errstr(rc: number): string;
	sqlite3_extended_errcode(pDb: Pointer): number;
	sqlite3_vfs_find(name: string | null): Pointer;
	sqlite3_memory_used(): number | bigint;
	sqlite3_memory_highwater(reset: number): number | bigint;
	sqlite3_compileoption_used(name: string): number;
	sqlite3_key_v2(pDb: Pointer, schema: string, pKey: Pointer, nKey: number): number;
	sqlite3_rekey_v2(pDb: Pointer, schema: string, pKey: Pointer, nKey: number): number;
	sqlite3mc_version(): string;
	sqlite3mc_cipher_count(): number;
	sqlite3mc_cipher_index(name: string): number;
	sqlite3mc_cipher_name(index: number): string;
	sqlite3mc_config(pDb: Pointer, param: string, value: number): number;
	sqlite3mc_config_cipher(pDb: Pointer, cipher: string, param: string, value: number): number;
	sqlite3mc_vfs_create(vfsName: string, makeDefault: number): number;
	sqlite3mc_vfs_destroy(vfsName: string): void;
}

export interface WasmApi {
	alloc(n: number): Pointer;
	dealloc(p: Pointer): void;
	heap8u(): Uint8Array;
	peekPtr(p: Pointer): Pointer;
	pstack: {
		readonly pointer: Pointer;
		restore(p: Pointer): void;
		allocPtr(): Pointer;
	};
}

export interface SQLite3Error extends Error {
	readonly resultCode: number;
}

export interface Sqlite3Static {
	readonly version: { libVersion: string; libVersionNumber: number; sourceId: string };
	readonly capi: CApi;
	readonly wasm: WasmApi;
	readonly oo1: { DB: DatabaseConstructor };
	readonly SQLite3Error: { new (...args: unknown[]): SQLite3Error; prototype: SQLite3Error };
	installOpfsSAHPoolVfs(options?: SAHPoolOptions): Promise<SAHPoolUtil>;
}

export interface InitOptions {
	print?: (...args: unknown[]) => void;
	printErr?: (...args: unknown[]) => void;
	locateFile?: (path: string, prefix: string) => string;
}

export default function sqlite3InitModule(options?: InitOptions): Promise<Sqlite3Static>;
