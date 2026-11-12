import { describe, expect, it } from 'vitest'
import { formatAppVersion } from '../src/integrations/desktop/appVersion'

describe('app version', () => {
  it('uses the release version when provided', () => {
    expect(formatAppVersion('0.1.0', '0.2.0-rc1')).toBe('0.2.0-rc1')
  })

  it('marks builds without a release version as development', () => {
    expect(formatAppVersion('0.1.0')).toBe('0.1.0-dev')
    expect(formatAppVersion('0.1.0', ' ')).toBe('0.1.0-dev')
  })
})
