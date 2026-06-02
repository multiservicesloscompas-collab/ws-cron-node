import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

globalThis.Deno = {
  test,
  readTextFile: async (path: string | URL): Promise<string> => readFile(path, 'utf8'),
  makeTempDir: async (): Promise<string> => mkdtemp(join(tmpdir(), 'vitest-')),
  writeTextFile: async (path: string | URL, data: string): Promise<void> => {
    await writeFile(path, data, 'utf8')
  },
  remove: async (
    path: string | URL,
    options?: { recursive?: boolean },
  ): Promise<void> => {
    await rm(path, { recursive: options?.recursive ?? false, force: true })
  },
}
