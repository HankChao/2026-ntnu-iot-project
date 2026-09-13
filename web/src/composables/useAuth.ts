import { ref } from 'vue';

const isAuthenticated = ref(Boolean(localStorage.getItem('maps6_token')));
const user = ref<{ username: string } | null>(
  localStorage.getItem('maps6_user') ? JSON.parse(localStorage.getItem('maps6_user')!) : null
);

export function useAuth() {
  async function login(password: string): Promise<boolean> {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('maps6_token', data.token);
        localStorage.setItem('maps6_user', JSON.stringify(data.user));
        isAuthenticated.value = true;
        user.value = data.user;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem('maps6_token');
    localStorage.removeItem('maps6_user');
    isAuthenticated.value = false;
    user.value = null;
  }

  return {
    isAuthenticated,
    user,
    login,
    logout,
  };
}
