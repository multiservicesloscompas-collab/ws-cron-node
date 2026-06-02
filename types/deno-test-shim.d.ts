declare global {
  const Deno: {
    test: (name: string, fn: () => unknown | Promise<unknown>) => void
    readTextFile: (path: string | URL) => Promise<string>
    makeTempDir: () => Promise<string>
    writeTextFile: (path: string | URL, data: string) => Promise<void>
    remove: (path: string | URL, options?: { recursive?: boolean }) => Promise<void>
  }
}

export {}
