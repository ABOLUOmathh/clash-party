import yaml from 'yaml'

export interface YamlParseOptions {
  maxAliasCount?: number
}

export const parse = <T = unknown>(content: string, options?: YamlParseOptions): T => {
  const processedContent = content.replace(
    /(^|\{|,)(\s*short-id:\s*)(?!['"]|null\b|Null\b|NULL\b|~)([^"'\s,}\n]+)/gm,
    '$1$2"$3"'
  )
  const doc = yaml.parseDocument(processedContent, { merge: true })
  if (doc.errors.length > 0) {
    throw doc.errors[0]
  }
  const maxAliasCount = options?.maxAliasCount
  if (typeof maxAliasCount === 'number' && maxAliasCount >= 0) {
    let aliasCount = 0
    yaml.visit(doc, {
      Alias() {
        aliasCount++
        if (aliasCount > maxAliasCount) {
          throw new ReferenceError('Excessive alias count indicates a resource exhaustion attack')
        }
      }
    })
  }
  return (doc.toJS({ maxAliasCount }) as T) || ({} as T)
}

export function stringify(content: unknown): string {
  return yaml.stringify(content)
}
