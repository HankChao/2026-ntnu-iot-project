<template>
  <header class="header">
    <div class="bar">
      <router-link to="/" class="brand">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="30" height="30" stroke="currentColor" stroke-width="2" />
          <path d="M12 7v18M20 7v18M12 15h8" stroke="currentColor" stroke-width="2.5" />
        </svg>
        <span>智慧衣夾</span>
      </router-link>

      <nav aria-label="主選單" class="nav">
        <router-link v-for="item in items" :key="item.to" :to="item.to" class="nav-item"
          :class="{ active: item.match(route.path) }" :aria-current="item.match(route.path) ? 'page' : undefined">{{ item.label }}</router-link>
      </nav>

      <div class="actions">
        <router-link to="/settings" class="icon-btn" aria-label="系統設定" title="系統設定">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </router-link>
        <button type="button" class="icon-btn" :aria-label="isLight ? '切換為深色模式' : '切換為亮色模式'" :title="isLight ? '切換為深色模式' : '切換為亮色模式'" @click="toggle">
          <svg v-if="isLight" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useTheme } from '../composables/useTheme';

const route = useRoute();
const { isLight, toggle } = useTheme();

// Clip detail (/clips/:id) and air box detail (/devices/:id) both live under 設備狀況.
const items = [
  { to: '/', label: '總覽', match: (p: string) => p === '/' || p === '/start' },
  { to: '/devices', label: '設備狀況', match: (p: string) => p.startsWith('/devices') || p.startsWith('/clips/') },
  { to: '/sessions', label: '晾衣紀錄', match: (p: string) => p === '/sessions' },
  { to: '/history', label: '空氣歷史', match: (p: string) => p === '/history' },
];
</script>

<style scoped>
.header { background: var(--hdr); border-bottom: 1px solid var(--bd); }
.bar { max-width: 1320px; margin: 0 auto; padding: 0 24px; display: flex; flex-wrap: wrap; align-items: stretch; gap: 0 32px; min-height: 64px; }
.brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--tx); font-weight: 900; font-size: 1.125rem; letter-spacing: 0.04em; }
.brand svg { color: var(--ac); }
.nav { display: flex; flex-wrap: wrap; align-items: stretch; }
.nav-item { display: flex; align-items: center; padding: 0 18px; min-height: 64px; text-decoration: none; color: var(--tx2); border-bottom: 3px solid transparent; }
.nav-item:hover { color: var(--tx); }
.nav-item.active { color: var(--tx); font-weight: 700; border-bottom-color: var(--ac); }
.actions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 0.875rem; color: var(--tx2); padding: 10px 0; }
.icon-btn { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--bd); background: transparent; color: var(--tx); cursor: pointer; text-decoration: none; }
.icon-btn:hover { background: var(--sf2); }
@media (max-width: 900px) {
  .bar { gap: 0 16px; padding: 0 16px; }
  .nav { order: 3; width: 100%; overflow-x: auto; flex-wrap: nowrap; }
  .nav-item { min-height: 52px; padding: 0 14px; white-space: nowrap; }
}
</style>
