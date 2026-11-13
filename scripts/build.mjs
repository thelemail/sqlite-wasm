import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		pin: { type: 'boolean', default: false },
		out: { type: 'string', default: join(root, 'dist') },
		arch: { type: 'string', default: process.arch === 'arm64' ? 'arm64' : 'amd64' }
	}
});

const pinsPath = join(root, 'pins.json');
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
if (!pins.emsdk[args.arch]) fail(`unsupported arch ${args.arch}`);
const cache = join(root, 'work', 'inputs');
mkdirSync(cache, { recursive: true });

function digest(algorithm, bytes) {
	return createHash(algorithm).update(bytes).digest('hex');
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

async function fetchVerified(name, url, expected) {
	const path = join(cache, name);
	if (!existsSync(path)) {
		const res = await fetch(url);
		if (!res.ok) fail(`${name}: HTTP ${res.status}`);
		writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
	}
	const bytes = readFileSync(path);
	for (const [algorithm, hex] of Object.entries(expected)) {
		const actual = digest(algorithm, bytes);
		if (actual !== hex) {
			rmSync(path);
			fail(`${name}: ${algorithm} ${actual} does not match pin ${hex}`);
		}
	}
	return path;
}

for (const [name, hex] of Object.entries(pins.patches)) {
	const actual = digest('sha256', readFileSync(join(root, 'patches', name)));
	if (actual !== hex) fail(`patches/${name}: sha256 ${actual} does not match pin ${hex}`);
}

const inputs = mkdtempSync(join(root, 'work', 'run-'));
const out = join(inputs, 'out');
mkdirSync(out);
try {
	const files = {
		'sqlite-src.zip': await fetchVerified('sqlite-src.zip', pins.sqlite.url, {
			sha256: pins.sqlite.sha256,
			'sha3-256': pins.sqlite['sha3-256']
		}),
		'sqlite3mc-amalgamation.zip': await fetchVerified('sqlite3mc-amalgamation.zip', pins.sqlite3mc.url, {
			sha256: pins.sqlite3mc.sha256
		})
	};
	for (const arch of ['amd64', 'arm64']) {
		files[`wabt_${arch}.deb`] = await fetchVerified(`wabt_${arch}.deb`, pins.wabt[arch].url, {
			sha256: pins.wabt[arch].sha256
		});
	}
	for (const [name, path] of Object.entries(files)) copyFileSync(path, join(inputs, name));

	const docker = [
		'run',
		'--rm',
		'--network',
		'none',
		'--platform',
		`linux/${args.arch}`,
		'-v',
		`${inputs}:/inputs:ro`,
		'-v',
		`${join(root, 'patches')}:/patches:ro`,
		'-v',
		`${join(root, 'scripts', 'compile.sh')}:/compile.sh:ro`,
		'-v',
		`${out}:/out`,
		pins.emsdk[args.arch],
		'bash',
		'/compile.sh',
		pins.sqlite.checkin,
		pins.sqlite3mc.version
	];
	execFileSync('docker', docker, { stdio: 'inherit' });

	const output = {};
	for (const name of Object.keys(pins.output)) output[name] = digest('sha256', readFileSync(join(out, name)));

	if (args.pin) {
		pins.output = output;
		writeFileSync(pinsPath, `${JSON.stringify(pins, null, '\t')}\n`);
	} else {
		for (const [name, hex] of Object.entries(output)) {
			if (hex !== pins.output[name]) fail(`${name}: sha256 ${hex} does not match pin ${pins.output[name] || '(none)'}`);
		}
	}

	mkdirSync(args.out, { recursive: true });
	for (const name of Object.keys(output)) copyFileSync(join(out, name), join(args.out, name));
	const manifest = {
		sqlite: { version: pins.sqlite.version, checkin: pins.sqlite.checkin, sha256: pins.sqlite.sha256, 'sha3-256': pins.sqlite['sha3-256'] },
		sqlite3mc: { version: pins.sqlite3mc.version, sha256: pins.sqlite3mc.sha256 },
		patches: pins.patches,
		emsdk: pins.emsdk,
		wabt: { version: pins.wabt.version, amd64: pins.wabt.amd64.sha256, arm64: pins.wabt.arm64.sha256 },
		output
	};
	writeFileSync(join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(JSON.stringify(output, null, '\t'));
} finally {
	rmSync(inputs, { recursive: true, force: true });
}
