<script setup lang="ts">
import { STATUS_TEXT, type GeraetStatus } from "@/typen";

defineProps<{ status: GeraetStatus; gross?: boolean }>();
</script>

<template>
  <!-- Das Wort trägt die Information, nicht die Farbe: bei Sonnenlicht und
       bei Farbsehschwäche ist der Ton allein wertlos. -->
  <span class="pt-chip" :class="[`pt-chip--${status}`, { 'chip--gross': gross }]">
    {{ STATUS_TEXT[status] }}
  </span>
</template>

<style scoped>
.chip--gross {
  padding: var(--space-2) var(--space-4);
  font-size: var(--fs-14);
}
</style>
