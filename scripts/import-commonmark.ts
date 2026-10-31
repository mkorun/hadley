#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs'

import { CommonMarkImportLossError, enforceImportLossPolicy, importCommonMark } from './commonmark.ts'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
const outputIndex = args.indexOf('--output')
const output = outputIndex === -1 ? undefined : args[outputIndex + 1]
const allowLoss = args.includes('--allow-loss')

if (file === undefined || (outputIndex !== -1 && output === undefined)) {
  process.stderr.write('usage: bun run import:commonmark <file> [--output <file>] [--allow-loss]\n')
  process.exit(2)
}

try {
  const imported = importCommonMark(readFileSync(file, 'utf8'))
  enforceImportLossPolicy(imported, allowLoss ? 'allow' : 'error')
  for (const diagnostic of imported.diagnostics) {
    process.stderr.write(
      `${diagnostic.location.line}:${diagnostic.location.column}: ${diagnostic.category}: ${diagnostic.message}\n`,
    )
  }
  if (output === undefined) process.stdout.write(imported.markanto)
  else writeFileSync(output, imported.markanto)
} catch (error) {
  if (!(error instanceof CommonMarkImportLossError)) throw error
  for (const diagnostic of error.result.diagnostics) {
    process.stderr.write(
      `${diagnostic.location.line}:${diagnostic.location.column}: ${diagnostic.category}: ${diagnostic.message}\n`,
    )
  }
  process.stderr.write(`${error.message}; rerun with --allow-loss to accept it explicitly.\n`)
  process.exit(1)
}
