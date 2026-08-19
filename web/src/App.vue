<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppShell from "@/components/AppShell.vue";

const route = useRoute();
// Die Anmeldeseite steht für sich — ohne Navigation, die ohnehin
// nirgendwohin führen würde.
const mitShell = computed(() => route.meta.ohneShell !== true);
</script>

<template>
  <AppShell v-if="mitShell">
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
  </AppShell>
  <RouterView v-else />
</template>
