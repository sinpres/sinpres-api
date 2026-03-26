import { defineConfig } from 'vitest/config'
import path from 'path'
import { readFileSync } from 'fs'

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8')
    return content
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .reduce((acc, line) => {
        const eqIndex = line.indexOf('=')
        if (eqIndex !== -1) {
          const key = line.slice(0, eqIndex).trim()
          const value = line.slice(eqIndex + 1).trim()
          acc[key] = value
        }
        return acc
      }, {} as Record<string, string>)
  } catch {
    return {}
  }
}

export default defineConfig({
  test: {
    globals: true,
    env: loadEnvFile('.env'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
