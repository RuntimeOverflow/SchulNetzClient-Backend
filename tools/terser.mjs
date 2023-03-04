#!/usr/bin/env node
/* eslint-disable camelcase */

import { minify } from 'terser'

const config = {
	compress: {
		drop_console: true,
		keep_fargs: false,
		
		arguments: true,
		booleans_as_integers: true,
		passes: 5,
		unsafe: true,
		unsafe_arrows: true,
		unsafe_comps: true,
		unsafe_Function: true,
		unsafe_math: true,
		unsafe_symbols: true,
		unsafe_methods: true,
		unsafe_proto: true,
		unsafe_regexp: true,
		unsafe_undefined: true,
		top_retain: ['Session', 'Parser', 'diff', 'link', 'ObjectType', 'Page'],
	},
	// TODO
	mangle: false,
	/*mangle: {
		eval: true,
		reserved: ['Session', 'diff', 'Fetcher', 'ObjectType', 'Page'],
		properties: {
			reserved: [
				'type', 'func', 'message', 'level', 'url', 'errorCode', // Exceptions
				'TEACHER', 'STUDENT', 'TRANSACTION', 'ABSENCE', 'ABSENCE_REPORT', 'OPEN_ABSENCE', 'LATE_ABSENCE', 'SUBJECT', 'GRADE', // ObjectTypes
			]
		}
	},*/
	toplevel: true,
	format: {
		comments: false,
	},
	ecma: 9,
}

let stdin = process.openStdin()

let data = ''
stdin.on('data', chunk => data += chunk)
await new Promise(resolve => stdin.on('end', resolve))

const minified = await minify(data, config)
process.stdout.write(minified.code)