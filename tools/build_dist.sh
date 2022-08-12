#!/bin/bash

cd "${0%/*}/.."

npx tsc

if [ -z ${1+x} ]; then
	DIST_NAME=test
else
	DIST_NAME=$1
fi

[ ! -d "dist" ] && mkdir "dist"

sed '1d' "build/index.js" | node "tools/terser.js" > "dist/$DIST_NAME.js"

# TODO: zlib-flate -compress=9 < "dist/$DIST_NAME.js" > "dist/$DIST_NAME.zlib"