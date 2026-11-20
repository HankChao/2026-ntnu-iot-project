<template>
  <div class="page">
    <div class="page-head">
      <h1>晾衣紀錄</h1>
      <button type="button" class="ui-btn" @click="exportCsv">匯出 CSV</button>
    </div>

    <section aria-label="本月統計" class="ui-stats">
      <div class="ui-stat"><span class="ui-stat__label">本月晾衣</span><span class="ui-stat__value">{{ monthCount }}<small> 次</small></span></div>
      <div class="ui-stat"><span class="ui-stat__label">平均預測誤差</span>
        <span v-if="!predicting" class="ui-stat__value muted">NONE</span>
        <span v-else class="ui-stat__value ac-tx">{{ avgError == null ? '—' : `±${avgError}` }}<small> 分</small></span></div>
      <div class="ui-stat"><span class="ui-stat__label">平均乾燥時間</span>
        <span class="ui-stat__value">
          <template v-if="avgDry != null">{{ Math.floor(avgDry / 60) }}<small> 小時 </small>{{ avgDry % 60 }}<small> 分</small></template>
          <template v-else>—</template>
        </span></div>
    </section>

    <div class="layout">
      <section class="panel main-col">
        <h2>每次晾衣</h2>
        <div class="ui-table-wrap">
          <table class="ui-table">
            <thead><tr><th scope="col">日期</th><th scope="col">衣物</th><th scope="col">實際</th><th scope="col">預測</th><th scope="col">誤差</th></tr></thead>
            <tbody>
              <tr v-if="!rows.length"><td colspan="5" class="muted">還沒有晾衣紀錄</td></tr>
              <tr v-for="row in rows" :key="row.id">
                <td>{{ row.date }}</td>
                <td class="strong">{{ row.name }} <small class="muted">{{ row.material }}</small></td>
                <td :class="row.actualTone">{{ row.actual }}</td>
                <td>{{ row.predicted }}</td>
                <td :class="row.errorTone">{{ row.error }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="side-col">
        <section class="panel">
          <h2>各材質乾燥時間</h2>
          <div v-for="m in byMaterial" :key="m.material" class="bar-row">
            <div class="bar-top"><span>{{ m.material }}</span><span class="muted-2">{{ shortDuration(m.avg) }}</span></div>
            <span class="ui-bar thick"><span :style="{ width: `${m.pct}%` }"></span></span>
          </div>
          <p v-if="!byMaterial.length" class="muted">還沒有完成的紀錄</p>
        </section>
        <section class="panel">
          <h2>感測法預測誤差</h2>
          <div v-for="m in methods" :key="m.key" class="method-row">
            <span>{{ m.label }}</span>
            <span v-if="!predicting" class="muted">NONE</span>
            <strong v-else-if="m.best" class="ac-tx">±{{ m.err }} 分</strong><span v-else>±{{ m.err }} 分</span>
          </div>
        </section>
      </aside>
    </div>

    <div v-if="predicting" class="demo-note foot">
      <span>示範資料：晾衣紀錄、預測與誤差目前為前端模擬，存在這台瀏覽器。可在設定關閉示範資料。</span>
      <button type="button" class="ui-btn ui-btn--ghost" @click="resetDemo">重設示範資料</button>
    </div>
    <p v-else class="demo-note">示範資料已關閉，只列出實際的晾衣紀錄（目前存在這台瀏覽器）。乾燥預測尚未實作，預測與誤差顯示 NONE。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SENSORS } from '../composables/useClothesData';
import { METHOD_ERROR, useClothesMock } from '../composables/useClothesMock';
import { TAIPEI_MS, monthDay, shortDuration } from '../utils/format';

const mock = useClothesMock();
// Predictions (and so errors) only exist as demo data for now.
const predicting = computed(() => mock.demoEnabled.value);

const nameOf = (garmentId: string) => mock.garmentById(garmentId)?.name ?? '已刪除的衣物';
const materialOf = (garmentId: string) => mock.garmentById(garmentId)?.material ?? '—';

const rows = computed(() => {
  const active = mock.state.sessions.map((s) => ({
    id: s.id, at: s.startedAt, date: monthDay(s.startedAt), name: nameOf(s.garmentId), material: materialOf(s.garmentId),
    actual: '晾衣中', actualTone: 'ac-tx', predicted: predicting.value ? shortDuration(s.totalMin) : 'NONE', error: predicting.value ? '—' : 'NONE', errorTone: 'muted',
  }));
  const done = mock.state.records.map((r) => {
    const err = r.actualMin == null ? null : Math.abs(r.actualMin - r.predictedMin);
    return {
      id: r.id, at: r.startedAt, date: monthDay(r.startedAt), name: nameOf(r.garmentId), material: materialOf(r.garmentId),
      actual: r.actualMin == null ? '提早收起' : shortDuration(r.actualMin), actualTone: r.actualMin == null ? 'muted' : '',
      predicted: predicting.value ? shortDuration(r.predictedMin) : 'NONE',
      error: !predicting.value ? 'NONE' : err == null ? '不列入' : shortDuration(err),
      errorTone: !predicting.value || err == null ? 'muted' : err >= 30 ? 'wa-tx strong' : '',
    };
  });
  return [...active, ...done].sort((a, b) => b.at - a.at);
});

const monthStart = computed(() => {
  const d = new Date(mock.now.value + TAIPEI_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TAIPEI_MS;
});
const monthCount = computed(() => mock.state.records.filter((r) => r.startedAt >= monthStart.value).length
  + mock.state.sessions.filter((s) => s.startedAt >= monthStart.value).length);
const finished = computed(() => mock.state.records.filter((r) => r.actualMin != null));
const avgError = computed(() => finished.value.length
  ? Math.round(finished.value.reduce((sum, r) => sum + Math.abs(r.actualMin! - r.predictedMin), 0) / finished.value.length) : null);
const avgDry = computed(() => finished.value.length
  ? Math.round(finished.value.reduce((sum, r) => sum + r.actualMin!, 0) / finished.value.length) : null);

const byMaterial = computed(() => {
  const groups = new Map<string, number[]>();
  for (const r of finished.value) {
    const m = materialOf(r.garmentId);
    groups.set(m, [...(groups.get(m) ?? []), r.actualMin!]);
  }
  const list = [...groups].map(([material, mins]) => ({ material, avg: Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) }));
  const max = Math.max(...list.map((m) => m.avg), 1);
  return list.sort((a, b) => a.avg - b.avg).map((m) => ({ ...m, pct: Math.round((m.avg / (max / 0.95)) * 100) }));
});

const methods = computed(() => {
  const best = Math.min(...SENSORS.map((s) => METHOD_ERROR[s.key]));
  return SENSORS.map((s) => ({ key: s.key, label: s.method, err: METHOD_ERROR[s.key], best: METHOD_ERROR[s.key] === best }));
});

function exportCsv() {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['開始時間（台北）', '衣物', '材質', '實際（分）', '預測（分）', '結果'].map(esc).join(',')];
  const all = [
    ...mock.state.sessions.map((s) => ({ at: s.startedAt, g: s.garmentId, actual: '', predicted: predicting.value ? s.totalMin : '', result: '晾衣中' })),
    ...mock.state.records.map((r) => ({ at: r.startedAt, g: r.garmentId, actual: r.actualMin ?? '', predicted: predicting.value ? r.predictedMin : '', result: r.outcome === 'dry' ? '已乾' : '提早收起' })),
  ].sort((a, b) => b.at - a.at);
  for (const r of all) {
    const local = new Date(r.at + TAIPEI_MS).toISOString().slice(0, 16).replace('T', ' ');
    lines.push([local, nameOf(r.g), materialOf(r.g), r.actual, r.predicted, r.result].map(esc).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(Date.now() + TAIPEI_MS).toISOString().slice(0, 10).replace(/-/g, '');
  const link = Object.assign(document.createElement('a'), { href: url, download: `clothes_sessions${predicting.value ? '_demo' : ''}_${stamp}.csv` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetDemo() {
  if (window.confirm('重設後，示範的衣物、晾衣中項目與紀錄都會回到初始內容。確定要重設嗎？')) mock.reset();
}
</script>

<style scoped>
.layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.main-col { flex: 999 1 640px; }
.side-col { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.ui-table td { padding: 16px 12px; }
.strong { font-weight: 700; }
.strong small { font-weight: 400; font-size: 0.8125rem; margin-left: 4px; }
.bar-row { display: flex; flex-direction: column; gap: 8px; }
.bar-top { display: flex; justify-content: space-between; gap: 12px; }
.thick { height: 10px; border-radius: 5px; }
.muted-2 { color: var(--tx2); }
.method-row { display: flex; justify-content: space-between; gap: 12px; }
.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
</style>
