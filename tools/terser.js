#!/usr/bin/env node

import { minify } from 'terser'

const config = {
	compress: {
		'dead_code': true,
		'drop_console': true,
		'drop_debugger': true,
		'keep_classnames': false,
		'keep_fargs': false,
		'keep_fnames': false,
		'keep_infinity': false,
	},
	mangle: {
		eval: false,
		'keep_classnames': false,
		'keep_fnames': false,
		toplevel: true,
		safari10: false,
		reserved: ['Session', 'Fetcher', 'run'], //TODO: Remove 'run' in production
	},
	module: false,
	sourceMap: false,
	output: {
		comments: false,
	},
}

let stdin = process.openStdin()

let data = ''
stdin.on('data', chunk => data += chunk)
await new Promise(resolve => stdin.on('end', resolve))

const minified = await minify(data, config)
process.stdout.write(minified.code)