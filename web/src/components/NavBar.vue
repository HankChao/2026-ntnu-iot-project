<template>
  <header class="header">
    <div class="brand">
      <router-link to="/" class="brand-link">
        <span class="brand-title">NTNU IoT</span>
        <span class="brand-subtitle">智慧衣夾與環境觀測</span>
      </router-link>
    </div>
    <nav class="nav">
      <router-link to="/" class="nav-item" active-class="active">智慧衣夾</router-link>
      <router-link to="/air" class="nav-item" active-class="active">空氣盒子</router-link>
      <router-link to="/history" class="nav-item" active-class="active">空氣歷史資料</router-link>
      <router-link to="/settings" class="nav-item" active-class="active">系統設定</router-link>
    </nav>
    <div class="user-action">
      <span v-if="user" class="user-tag">{{ user.username }}</span>
      <button v-if="isAuthenticated" @click="logout" class="btn btn-sm">登出</button>
      <router-link v-else to="/login" class="btn btn-sm btn-primary">登入</router-link>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useAuth } from '../composables/useAuth';

const { isAuthenticated, user, logout } = useAuth();
</script>

<style scoped>
.header {
  flex-wrap: wrap;
  gap: 12px;
  background-color: var(--color-canvas);
  border-bottom: 1px solid var(--color-hairline-strong);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-link {
  text-decoration: none;
  color: inherit;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.brand-title {
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.5px;
}

.brand-subtitle {
  font-size: 13px;
  color: var(--color-body);
}

.nav {
  flex-wrap: wrap;
  display: flex;
  gap: 16px;
}

.nav-item {
  text-decoration: none;
  color: var(--color-body);
  font-size: 14px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.15s;
}

.nav-item:hover, .nav-item.active {
  color: var(--color-ink);
  background-color: var(--color-hairline);
}

.user-action {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-tag {
  font-size: 13px;
  color: var(--color-body);
  font-family: var(--font-mono);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
</style>
