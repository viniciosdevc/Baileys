const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

if (!existsSync('./node_modules/typescript/bin/tsc')) {
	process.exit(0)
}

const result = spawnSync(process.execPath, ['./node_modules/typescript/bin/tsc'], {
	stdio: 'inherit',
})

process.exit(result.status ?? 0)