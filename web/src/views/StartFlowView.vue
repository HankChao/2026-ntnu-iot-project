<template>
  <section class="hero" aria-label="開始晾衣">
    <div class="inner">
      <div class="page-head">
        <h1>開始晾衣</h1>
        <router-link to="/" class="ui-btn ui-btn--ghost">取消</router-link>
      </div>

      <ol aria-label="步驟" class="steps">
        <li v-for="(label, i) in LABELS" :key="label" :aria-current="i + 1 === step ? 'step' : undefined" :class="{ reached: i + 1 <= step }">
          <span class="num">{{ i + 1 < step ? '✓' : i + 1 }}</span><span class="label">{{ label }}</span>
        </li>
      </ol>

      <div class="stage">
        <div class="preview">
          <svg class="line" aria-hidden="true" width="100%" height="60" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M0,15 Q50,30 100,15" fill="none" :stroke="palette.tx2" stroke-width="2.5" vector-effect="non-scaling-stroke" /></svg>
          <GarmentFigure uid="start" :garment="chosen" :label="chosen ? `預覽：${chosen.name}` : '尚未選擇衣物'" />
          <p class="caption">{{ caption }}</p>
        </div>

        <div class="side">
          <!-- step 1 -->
          <div v-if="step === 1" class="card">
            <h2>要用哪個衣夾？</h2>
            <p class="muted">只列出目前沒有在用的衣夾，離線的衣夾無法使用。</p>
            <button v-for="o in clipOptions" :key="o.device.id" type="button" class="option" :class="{ on: clipId === o.device.id }"
              :disabled="!o.status.online" :aria-pressed="clipId === o.device.id" @click="clipId = o.device.id">
              <span class="option-text"><b>{{ o.device.name }}</b><small>{{ o.meta }}</small></span>
              <span class="status" :class="o.status.online ? 'status--on' : 'status--off'"><i></i>{{ o.status.online ? '在線' : '離線' }}</span>
            </button>
            <p v-if="!clipOptions.length" class="muted">所有衣夾都在使用中，先到總覽結束一次晾衣。</p>
          </div>

          <!-- step 2 -->
          <div v-else-if="step === 2" class="card">
            <h2>要晾哪件衣物？</h2>
            <template v-if="!creating">
              <div class="ui-field">
                <label for="garment-search" class="sr-only">搜尋衣物</label>
                <input id="garment-search" v-model="query" class="ui-input" type="search" placeholder="搜尋晾過的衣物" />
              </div>
              <div class="library">
                <button v-for="g in library" :key="g.id" type="button" class="option" :class="{ on: garmentId === g.id }"
                  :disabled="g.busy" :aria-pressed="garmentId === g.id" @click="garmentId = g.id">
                  <i class="swatch" :style="{ background: g.color }"></i>
                  <span class="option-text"><b>{{ g.name }}</b><small>{{ g.meta }}</small></span>
                  <span class="tag">{{ g.busy ? '晾衣中' : '' }}</span>
                </button>
                <p v-if="!library.length" class="muted">{{ mock.state.garments.length ? '找不到符合的衣物' : '還沒有衣物，請先新增一件' }}</p>
              </div>
              <button type="button" class="ui-btn ui-btn--lg ui-btn--dashed" @click="creating = true">＋ 新增一件衣物</button>
            </template>
            <template v-else>
              <GarmentForm v-model="draft" id-prefix="new-garment" placeholder="例如：白色班服" />
              <p v-if="mock.demoEnabled.value" class="ui-note ui-note--info">第一次晾的衣物還不知道乾燥時間，會先用材質估算，預測可能較不準；收衣後會自動記住。</p>
              <button type="button" class="ui-btn ui-btn--ghost start" @click="creating = false">← 改選晾過的衣物</button>
            </template>
          </div>

          <!-- step 3 -->
          <div v-else class="card">
            <h2>確認後開始</h2>
            <dl class="summary">
              <div><dt>衣夾</dt><dd>{{ clip?.name }}</dd></div>
              <div><dt>衣物</dt><dd>{{ chosen?.name }}</dd></div>
              <div><dt>預計乾燥</dt><dd>{{ clip?.live ? 'NONE' : `約 ${minutesText(predicted)}` }}</dd></div>
            </dl>
            <div class="ui-field">
              <label for="start-airbox">室內環境來自</label>
              <AirboxSelect id="start-airbox" />
            </div>
          </div>

          <div class="actions">
            <button v-if="step > 1" type="button" class="ui-btn ui-btn--lg" @click="step--">上一步</button>
            <button v-if="step < 3" type="button" class="ui-btn ui-btn--primary ui-btn--lg push" :disabled="!canNext" @click="step++">下一步</button>
            <button v-else type="button" class="ui-btn ui-btn--primary ui-btn--lg push" @click="start">開始晾衣</button>
          </div>
        </div>
      </div>
      <p v-if="mock.demoEnabled.value" class="demo-note">示範資料：衣物庫與晾衣紀錄目前存在這台瀏覽器；空氣盒子清單為實際資料。可在設定關閉示範資料。</p>
      <p v-else class="demo-note">示範資料已關閉。衣物與晾衣紀錄目前存在這台瀏覽器；空氣盒子清單為實際資料。衣夾-01 的乾燥預測尚未實作。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import GarmentFigure from '../components/clothes/GarmentFigure.vue';
import GarmentForm from '../components/clothes/GarmentForm.vue';
import { SHAPES } from '../constants/garments';
import { useTheme } from '../composables/useTheme';
import AirboxSelect from '../components/clothes/AirboxSelect.vue';
import { useClothesLive } from '../composables/useClothesData';
import { useClothesMock, type GarmentDraft } from '../composables/useClothesMock';
import { agoText, minutesText } from '../utils/format';

const router = useRouter();
const { palette } = useTheme();
useClothesLive();
const mock = useClothesMock();

const LABELS = ['選衣夾', '選衣物', '確認'];
const step = ref(1);
const clipId = ref<string | null>(null);
const garmentId = ref<string | null>(null);
const creating = ref(false);
const query = ref('');
const draft = ref<GarmentDraft>({ name: '', style: 'tee', color: '#F2F1EC', material: '棉' });

const clipOptions = computed(() => mock.devices.value
  .filter((d) => !mock.activeClipIds.value.has(d.id))
  .map((device) => {
    const status = mock.clipStatus(device);
    const meta = !status.online ? `最後回報 ${status.lastSeenMs == null ? '—' : agoText(status.lastSeenMs)}`
      : device.live ? '實體衣夾' : device.lastBox ? `上次搭配 ${device.lastBox}空氣盒子` : '待命中';
    return { device, status, meta };
  })
  .sort((a, b) => Number(b.status.online) - Number(a.status.online)));
const clip = computed(() => clipId.value ? mock.clipById(clipId.value) : undefined);

const library = computed(() => {
  const q = query.value.trim();
  return mock.state.garments
    .filter((g) => !q || g.name.includes(q) || g.material.includes(q))
    .map((g) => {
      const count = mock.dryCount(g.id);
      return { ...g, count, busy: mock.busyGarmentIds.value.has(g.id),
        meta: `${g.material} · ${SHAPES[g.style].label}${count ? ` · 晾過 ${count} 次` : ' · 新衣物'}` };
    })
    .sort((a, b) => Number(a.busy) - Number(b.busy) || b.count - a.count);
});

const chosen = computed(() => {
  if (creating.value) return { ...draft.value, name: draft.value.name.trim() || '新衣物' };
  const g = garmentId.value ? mock.garmentById(garmentId.value) : undefined;
  return g ?? null;
});
const predicted = computed(() => chosen.value ? mock.predictMinutes({ ...chosen.value, id: creating.value ? undefined : garmentId.value ?? undefined }) : 0);
const caption = computed(() => {
  const c = clip.value ? `${clip.value.name} · ` : '';
  if (!chosen.value) return clip.value ? `${clip.value.name} · 尚未選擇衣物` : '尚未選擇衣夾';
  return `${c}${chosen.value.name} · ${chosen.value.material} ${SHAPES[chosen.value.style].label}`;
});

const canNext = computed(() => (step.value === 1 && !!clip.value)
  || (step.value === 2 && (creating.value ? draft.value.name.trim().length > 0 : !!garmentId.value)));

function start() {
  if (!clipId.value) return;
  const target = creating.value ? { ...draft.value, name: draft.value.name.trim() } : garmentId.value ? { id: garmentId.value } : null;
  if (!target) return;
  mock.startSession(clipId.value, target);
  void router.push('/');
}
</script>

<style scoped>
.hero { background: var(--sf); border-bottom: 1px solid var(--bd); flex: 1; }
.inner { max-width: 1320px; margin: 0 auto; padding: 36px 24px 40px; display: flex; flex-direction: column; gap: 28px; }
.inner h1 { font-size: 1.75rem; }
.steps { list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.steps li { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 3px solid var(--bd); color: var(--mu); }
.steps li.reached { border-bottom-color: var(--ac); color: var(--tx); }
.steps .num { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: var(--sf2); color: var(--mu); }
.steps li.reached .num { background: var(--ac); color: #0B0F14; }
.steps .label { font-size: 1.0625rem; font-weight: 700; }
.stage { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 40px 64px; }
.preview { flex: 1 1 460px; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; container-type: inline-size; }
/* A fifth of the garment width (60 of its 300 units), so the line always runs through the hanger hook. */
.line { position: absolute; left: 0; top: 0; height: min(76px, 20cqw); }
.caption { color: var(--tx2); text-align: center; }
.side { flex: 1 1 440px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.card { display: flex; flex-direction: column; gap: 16px; padding: 28px; border-radius: 20px; border: 1px solid var(--bd); background: var(--bg); }
.card h2 { font-size: 1.5rem; }
.option { display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 10px 18px; border-radius: 12px; border: 1px solid var(--bd); background: var(--sf); text-align: left; cursor: pointer; }
.option:hover:not(:disabled) { background: var(--sf2); }
.option.on { border: 2px solid var(--ac); }
.option:disabled { opacity: 0.45; cursor: not-allowed; }
.option-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.option-text b { font-size: 1.125rem; }
.option-text small { font-size: 0.875rem; color: var(--mu); }
.option .status { font-size: 0.9375rem; font-weight: 400; }
.swatch { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--bd2); }
.tag { font-size: 0.875rem; color: var(--tx2); }
.library { display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; }
.start { align-self: flex-start; }
.summary { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border-radius: 12px; background: var(--sf); }
.summary div { display: flex; justify-content: space-between; gap: 12px; }
.summary dt { color: var(--mu); }
.summary dd { font-weight: 700; text-align: right; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
.push { margin-left: auto; }
@media (max-width: 640px) {
  .inner { padding: 28px 16px 32px; }
  .steps .label { font-size: 0.9375rem; }
  .card { padding: 20px; }
}
</style>
