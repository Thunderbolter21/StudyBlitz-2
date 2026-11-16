// AuthPage.js — sign-in / sign-up screen on the desk.
// Only the session wrapper is called here — no Supabase imports.

import { mountDeskDecorations } from '../ui/decorations.js';

export function renderAuthPage(container, { session }) {
  mountDeskDecorations();
  let mode = 'signin'; // 'signin' | 'signup'

  function render() {
    const isSignUp = mode === 'signup';
    container.innerHTML = `
      <main class="auth-wrap app-layer">
        <form class="auth-card paper-sheet" id="auth-form">
          <h1 class="wordmark" style="font-size:var(--text-2xl)">Study<span class="accent">Blitz</span></h1>
          <p class="auth-sub">${isSignUp ? 'Create your account' : 'Welcome back'}</p>

          <label for="auth-email">Email</label>
          <input id="auth-email" type="email" autocomplete="email" required />

          <label for="auth-pw">Password</label>
          <input id="auth-pw" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                 minlength="6" required />

          ${isSignUp ? `
            <label for="auth-pw2">Confirm password</label>
            <input id="auth-pw2" type="password" autocomplete="new-password" minlength="6" required />
          ` : ''}

          <p class="auth-error" id="auth-error" role="alert"></p>

          <button type="submit" class="btn-primary" id="auth-submit">
            ${isSignUp ? 'Create Account' : 'Sign In'}
          </button>
          ${isSignUp ? '' : `
            <button type="button" class="btn-ghost" id="auth-magic">Email me a sign-in link</button>
          `}
          <button type="button" class="btn-link" id="auth-toggle">
            ${isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </form>
      </main>`;

    const g = (id) => container.querySelector('#' + id);
    const errEl = g('auth-error');
    const setBusy = (busy, label) => {
      g('auth-submit').disabled = busy;
      g('auth-submit').textContent = label;
    };

    g('auth-toggle').onclick = () => {
      mode = isSignUp ? 'signin' : 'signup';
      render();
    };

    g('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const email = g('auth-email').value.trim();
      const pw = g('auth-pw').value;
      if (isSignUp && pw !== g('auth-pw2').value) {
        errEl.textContent = 'Passwords do not match';
        return;
      }
      setBusy(true, isSignUp ? 'Creating account…' : 'Signing in…');
      const err = isSignUp
        ? await session.signUp(email, pw)
        : await session.signIn(email, pw);

      if (err === '__confirm_email__') {
        container.querySelector('.auth-card').innerHTML = `
          <h1>📬 Check your email</h1>
          <p class="auth-sub">We sent a confirmation link to <strong>${email}</strong>.
          Click it, then come back and sign in.</p>`;
      } else if (err) {
        errEl.textContent = err.toLowerCase().includes('not confirmed')
          ? 'Email not confirmed yet — check your inbox for the link.'
          : err;
        setBusy(false, isSignUp ? 'Create Account' : 'Sign In');
      }
      // On success the auth listener in main.js takes over — nothing to do.
    };

    const magic = g('auth-magic');
    if (magic) {
      magic.onclick = async () => {
        errEl.textContent = '';
        const email = g('auth-email').value.trim();
        if (!email) {
          errEl.textContent = 'Enter your email first, then tap the link button.';
          return;
        }
        const err = await session.sendMagicLink(email);
        errEl.textContent = err || '';
        if (!err) {
          magic.textContent = 'Link sent — check your email ✓';
          magic.disabled = true;
        }
      };
    }
  }

  render();
}
