<template>
  <span :class="['badge', online ? 'badge-online' : 'badge-offline']">
    <span class="dot"></span>
    <span>{{ online ? '連線中' : '離線' }}</span>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  online: boolean;
}>();
</script>
