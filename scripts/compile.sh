#!/usr/bin/env bash
set -euo pipefail

inputs=/inputs
out=/out
checkin="$1"
mc_version="$2"
arch="$(dpkg --print-architecture)"

export DEBIAN_FRONTEND=noninteractive
dpkg -i "$inputs/wabt_${arch}.deb" >/dev/null
command -v wasm-strip >/dev/null

export SOURCE_DATE_EPOCH=0
export TZ=UTC
export LC_ALL=C.UTF-8

src=/build/sqlite
mkdir -p /build/mc
cd /build
unzip -q "$inputs/sqlite-src.zip"
mv sqlite-src-* "$src"
unzip -q "$inputs/sqlite3mc-amalgamation.zip" -d /build/mc

test "$(cat "$src/manifest.uuid")" = "$checkin"

cd "$src"
./configure --enable-all >/build/configure.log 2>&1 || { tail -40 /build/configure.log; exit 1; }
make sqlite3.c >/build/amalgamation.log 2>&1 || { tail -40 /build/amalgamation.log; exit 1; }

patch -p0 --forward --quiet < /patches/GNUmakefile.patch
patch -p0 --forward --quiet < /patches/EXPORTED_FUNCTIONS.c-pp.patch
patch -p0 --forward --quiet < /patches/sqlite3-api-glue.c-pp.js.patch
patch -p0 --forward --quiet < /patches/mkwasmbuilds.c.patch

cp /build/mc/sqlite3mc_amalgamation.c "$src/sqlite3-see.c"
cp /build/mc/sqlite3mc_amalgamation.h "$src/sqlite3.h"
grep -q "SQLite3 Multiple Ciphers" "$src/sqlite3-see.c"
grep -Eq "SQLITE3MC_VERSION_STRING +\"SQLite3 Multiple Ciphers ${mc_version//./\\.}\"" "$src/sqlite3-see.c"

cd "$src/ext/wasm"
make dist dist.build=oz >/build/make.log 2>&1 || { tail -50 /build/make.log; exit 1; }

dist="$(find . -maxdepth 1 -type d -name 'sqlite-wasm-see-*' | head -1)"
test -n "$dist"
cp "$dist/jswasm/sqlite3.mjs" "$dist/jswasm/sqlite3.wasm" "$out/"
