<template>
  <div class="login-wrapper">
    <div class="card login-card">
      <h2 class="login-title">MAPS 6.0 系統登入</h2>
      <p class="login-desc">請輸入管理員密碼以啟用控制功能</p>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label class="label">管理員密碼</label>
          <input
            type="password"
            v-model="password"
            placeholder="預設密碼: adminpassword"
            class="input"
            autofocus
          />
        </div>

        <div v-if="errorMsg" class="error-text">
          {{ errorMsg }}
        </div>

        <button type="submit" class="btn btn-primary login-btn" :disabled="loading">
          {{ loading ? '登入中...' : '登入' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const password = ref('');
const errorMsg = ref('');
const loading = ref(false);
const router = useRouter();
const { login } = useAuth();

async function handleLogin() {
  errorMsg.value = '';
  loading.value = true;
  const ok = await login(password.value);
  loading.value = false;
  if (ok) {
    router.push('/');
  } else {
    errorMsg.value = '密碼錯誤，請重新輸入';
  }
}
</script>

<style scoped>
.login-wrapper {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-card {
  width: 100%;
  max-width: 380px;
  padding: 32px;
}

.login-title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 4px;
}

.login-desc {
  font-size: 13px;
  color: var(--color-body);
  margin-bottom: 24px;
}

.form-group {
  margin-bottom: 16px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
}

.input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 6px;
  font-size: 14px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
}

.error-text {
  color: var(--color-danger);
  font-size: 13px;
  margin-bottom: 12px;
}
</style>
