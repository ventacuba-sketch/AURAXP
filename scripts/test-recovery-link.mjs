import assert from 'node:assert/strict';
import { readRecoveryLink } from '../src/services/recoveryLink.ts';

// Production reproduction: error arrives in the fragment on a Home URL.
assert.deepEqual(readRecoveryLink('', '#error=access_denied&error_code=otp_expired&sb='),
  { error: 'otp_expired', recovery: false });
assert.equal(readRecoveryLink('?error_code=otp_expired', '').error, 'otp_expired');
assert.equal(readRecoveryLink('', '#access_token=test&refresh_token=test&type=recovery').recovery, true);
assert.equal(readRecoveryLink('', '#access_token=test&type=signup').recovery, false);
assert.equal(readRecoveryLink('', '#type=recovery').recovery, false);
assert.equal(readRecoveryLink('', '#access_token=test&type=recovery&error=access_denied').recovery, false);
assert.deepEqual(readRecoveryLink('?ref=friend', ''), { error: null, recovery: false });
console.log('Recovery callback: fragment/query errors, recovery success and normal login PASS');
