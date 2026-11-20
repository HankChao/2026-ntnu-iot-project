import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import DevicesView from '../views/DevicesView.vue';
import ClipDetailView from '../views/ClipDetailView.vue';
import SessionsView from '../views/SessionsView.vue';
import StartFlowView from '../views/StartFlowView.vue';
import HistoryView from '../views/HistoryView.vue';
import DeviceDetailView from '../views/DeviceDetailView.vue';
import SettingsView from '../views/SettingsView.vue';

const routes = [
  // 智慧衣夾
  { path: '/', name: 'Overview', component: OverviewView },
  { path: '/start', name: 'StartFlow', component: StartFlowView },
  { path: '/devices', name: 'Devices', component: DevicesView },
  { path: '/clips/:id', name: 'ClipDetail', component: ClipDetailView },
  { path: '/sessions', name: 'Sessions', component: SessionsView },
  // 空氣盒子（MAPS）：清單併入設備狀況
  { path: '/devices/:id', name: 'DeviceDetail', component: DeviceDetailView },
  { path: '/history', name: 'History', component: HistoryView },
  { path: '/settings', name: 'Settings', component: SettingsView },
  // 舊網址
  { path: '/air', redirect: '/devices' },
  { path: '/login', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
});
