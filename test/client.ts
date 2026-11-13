import type { Reply, Request } from './harness.ts';

export class Harness {
	#worker = new Worker(new URL('./harness.ts', import.meta.url), { type: 'module' });
	#next = 0;
	#pending = new Map<number, (r: Reply) => void>();

	constructor() {
		this.#worker.onmessage = (e: MessageEvent<Reply>) => {
			this.#pending.get(e.data.id)?.(e.data);
			this.#pending.delete(e.data.id);
		};
	}

	call<T = unknown>(r: Request): Promise<T> {
		const id = this.#next++;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, (reply) => {
				if (reply.ok) resolve(reply.value as T);
				else reject(Object.assign(new Error(reply.error), { code: reply.code }));
			});
			this.#worker.postMessage({ ...r, id });
		});
	}

	send(r: Request) {
		this.#worker.postMessage({ ...r, id: this.#next++ });
	}

	terminate() {
		this.#worker.terminate();
		for (const resolve of this.#pending.values()) resolve({ id: -1, ok: false, error: 'terminated' });
		this.#pending.clear();
	}
}

export function randomKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

export function randomDirectory(): string {
	return `t-${crypto.randomUUID()}`;
}

export async function removeDirectory(name: string) {
	const root = await navigator.storage.getDirectory();
	await root.removeEntry(name, { recursive: true }).catch(() => {});
}
