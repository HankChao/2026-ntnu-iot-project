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
</script>

<style>
.content {
  flex: 1;
}
</style>
