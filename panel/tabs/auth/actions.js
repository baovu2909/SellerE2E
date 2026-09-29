module.exports = {
  login: {
    args: () => ['test', '--project=setup'],
  },
  lockout: {
    args: () => ['test', '--project=flows', 'tests/flows/login-lockout.spec.ts'],
    env: (p) => ({
      ...(p.lockUser ? { LOCK_TEST_USERNAME: String(p.lockUser).trim() } : {}),
      ...(p.lockPass ? { LOCK_TEST_PASSWORD: String(p.lockPass) } : {}),
    }),
  },
};
