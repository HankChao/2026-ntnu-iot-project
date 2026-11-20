<template>
  <div id="app">
    <NavBar />
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import NavBar from './components/NavBar.vue';
import './composables/useTheme';
</script>

<style>
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
