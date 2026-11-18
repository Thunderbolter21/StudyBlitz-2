// session.js — thin wrapper around Supabase Auth.
// Returns error MESSAGES (strings) instead of throwing, so the auth page
// can show them inline without try/catch noise.

export function createSession(client) {
  return {
    // Resolves to the current session or null (e.g. on first visit).
    async current() {
      const { data } = await client.auth.getSession();
      return data.session ?? null;
    },

    // cb(event, session) — fires on SIGNED_IN / SIGNED_OUT / token refresh.
    onChange(cb) {
      const { data } = client.auth.onAuthStateChange(cb);
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? error.message : null;
    },

    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return error.message;
      // Session present = confirmation off, user is in. Otherwise they need
      // to click the link we just emailed them.
      return data.session ? null : '__confirm_email__';
    },

    // Magic link — passwordless sign-in via email.
    async sendMagicLink(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: typeof location !== 'undefined' ? location.origin : undefined },
      });
      return error ? error.message : null;
    },

    async signOut() {
      await client.auth.signOut();
    },

    // Who's signed in right now (for Settings display).
    async currentUser() {
      const { data } = await client.auth.getUser();
      return data.user ?? null;
    },

    // Change email. Supabase emails a confirmation link to the NEW address
    // (and, if configured, the old one); the change applies once clicked.
    async changeEmail(email) {
      const { error } = await client.auth.updateUser({ email });
      return error ? error.message : null;
    },

    async changePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      return error ? error.message : null;
    },
  };
}
