<script setup lang="ts">
import { useRouter } from "vue-router";
import Symbol from "./Symbol.vue";

defineProps<{ titel: string; zurueck?: boolean; unter?: string }>();
const router = useRouter();
</script>

<template>
  <header class="kopf">
    <button v-if="zurueck" class="kopf__zurueck" aria-label="Zurück" @click="router.back()">
      <Symbol name="zurueck" :groesse="24" />
    </button>
    <div class="kopf__text">
      <h1 class="kopf__titel">{{ titel }}</h1>
      <p v-if="unter" class="kopf__unter">{{ unter }}</p>
    </div>
    <div class="kopf__rechts"><slot name="rechts" /></div>
  </header>
</template>

<style scoped>
.kopf {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--kopf-hoehe);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.kopf__zurueck {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tippziel);
  height: var(--tippziel);
  margin-left: calc(var(--space-3) * -1);
  background: none;
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--fg-body);
  cursor: pointer;
}
.kopf__zurueck:hover {
  background: var(--surface-muted);
}

.kopf__text {
  flex: 1;
  min-width: 0;
}

.kopf__titel {
  font-size: var(--fs-18);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kopf__unter {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kopf__rechts {
  display: flex;
  gap: var(--space-2);
}
</style>
