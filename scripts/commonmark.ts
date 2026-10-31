import {
  importCommonMark as importParserCommonMark,
  type ImportDiagnostic,
  type ImportOptions,
} from '@markantolang/parser/commonmark'

export type CommonMarkLossPolicy = 'error' | 'allow'

export interface CommonMarkImportOptions extends ImportOptions {}

export interface CommonMarkImportResult {
  readonly markanto: string
  readonly diagnostics: readonly ImportDiagnostic[]
}

export class CommonMarkImportLossError extends Error {
  readonly result: CommonMarkImportResult

  constructor(result: CommonMarkImportResult) {
    super('CommonMark import would drop content or contains an unrepresentable construct')
    this.name = 'CommonMarkImportLossError'
    this.result = result
  }
}

/** Explicit foreign-Markdown conversion. This is never called by extract(). */
export function importCommonMark(source: string, options: CommonMarkImportOptions = {}): CommonMarkImportResult {
  return importParserCommonMark(source, options.rawHtml === undefined ? {} : { rawHtml: options.rawHtml })
}

export function hasHardImportLoss(diagnostics: readonly ImportDiagnostic[]): boolean {
  return diagnostics.some(({ category }) => category === 'content-dropped' || category === 'unrepresentable')
}

export function enforceImportLossPolicy(result: CommonMarkImportResult, policy: CommonMarkLossPolicy = 'error'): void {
  if (policy === 'error' && hasHardImportLoss(result.diagnostics)) throw new CommonMarkImportLossError(result)
}

export type { ImportDiagnostic, ImportDiagnosticCategory, ImportOptions } from '@markantolang/parser/commonmark'
