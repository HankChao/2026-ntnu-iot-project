import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import HistoryView from '../views/HistoryView.vue';
import DeviceDetailView from '../views/DeviceDetailView.vue';
import SettingsView from '../views/SettingsView.vue';
import LoginView from '../views/LoginView.vue';

const routes = [
  { path: '/', name: 'Dashboard', component: DashboardView },
  { path: '/history', name: 'History', component: HistoryView },
  { path: '/devices/:id', name: 'DeviceDetail', component: DeviceDetailView },
  { path: '/settings', name: 'Settings', component: SettingsView },
  { path: '/login', name: 'Login', component: LoginView },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
