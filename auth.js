(() => {
  const SESSION_KEY = 'magneticblox-authenticated';
  const EXPECTED_CREDENTIAL_HASH = 'aff03ee0e185fb860cc7984f77bb9d6346282335a5c0b98e243babde9dd16e7e';

  const appRoot = document.getElementById('appRoot');
  const loginGate = document.getElementById('loginGate');
  const loginForm = document.getElementById('loginForm');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');
  const logoutButton = document.getElementById('logoutBtn');

  function unlockApp() {
    document.body.classList.remove('auth-locked');
    loginGate.hidden = true;
    appRoot.removeAttribute('inert');
    appRoot.removeAttribute('aria-hidden');
  }

  async function credentialHash(username, password) {
    const bytes = new TextEncoder().encode(`${username}\0${password}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  if (sessionStorage.getItem(SESSION_KEY) === EXPECTED_CREDENTIAL_HASH) {
    unlockApp();
  } else {
    usernameInput.focus();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Kontrol ediliyor…';

    try {
      const submittedHash = await credentialHash(usernameInput.value.trim(), passwordInput.value);
      if (submittedHash !== EXPECTED_CREDENTIAL_HASH) {
        loginError.textContent = 'Kullanıcı adı veya şifre hatalı.';
        passwordInput.value = '';
        passwordInput.focus();
        return;
      }

      sessionStorage.setItem(SESSION_KEY, EXPECTED_CREDENTIAL_HASH);
      unlockApp();
    } catch {
      loginError.textContent = 'Giriş doğrulanamadı. Lütfen tekrar deneyin.';
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Giriş';
    }
  });

  logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
  });
})();
