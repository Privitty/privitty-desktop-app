import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { unzipSync } from 'fflate'

export function extractZipToDirectory(zipPath: string, destDir: string) {
  const entries = unzipSync(readFileSync(zipPath))

  for (const [relativePath, content] of Object.entries(entries)) {
    if (relativePath.endsWith('/')) {
      mkdirSync(join(destDir, relativePath), { recursive: true })
      continue
    }

    const outputPath = join(destDir, relativePath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, content)
  }
}
