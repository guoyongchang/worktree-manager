import { describe, it, expect } from 'vitest'

function extractDirName(cwd: string): string {
  return cwd.split('/').pop() ?? cwd
}

describe('CWD tab sync', () => {
  it('extracts last directory from absolute path', () => {
    expect(extractDirName('/home/user/projects/my-app')).toBe('my-app')
  })

  it('extracts last directory from root path', () => {
    expect(extractDirName('/')).toBe('')
  })

  it('handles path without trailing slash', () => {
    expect(extractDirName('/tmp')).toBe('tmp')
  })

  it('handles single component path', () => {
    expect(extractDirName('/home')).toBe('home')
  })

  it('returns original for non-path string', () => {
    expect(extractDirName('mydir')).toBe('mydir')
  })

  it('handles empty string', () => {
    expect(extractDirName('')).toBe('')
  })
})
