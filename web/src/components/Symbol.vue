<script setup lang="ts">
/**
 * Strich-Symbole, im Quelltext gezeichnet.
 *
 * Keine Emojis (Konvention aus PATIO) und keine Symbolschrift von außen —
 * die Anwendung soll ohne Außenkontakt auskommen.
 */
import type { SymbolName } from "./symbole";

defineProps<{ name: SymbolName; groesse?: number }>();
</script>

<template>
  <svg
    :width="groesse ?? 22"
    :height="groesse ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'scan'">
      <path
        d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"
      />
      <path d="M7 8v8M10 8v8M13 8v8M17 8v8" />
    </template>
    <template v-else-if="name === 'liste'">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </template>
    <template v-else-if="name === 'ort'">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </template>
    <template v-else-if="name === 'mehr'">
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </template>
    <template v-else-if="name === 'zurueck'">
      <path d="M15 18l-6-6 6-6" />
    </template>
    <template v-else-if="name === 'licht'">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />
    </template>
    <template v-else-if="name === 'suche'">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </template>
    <template v-else-if="name === 'haken'">
      <path d="M20 6L9 17l-5-5" />
    </template>
    <template v-else-if="name === 'warnung'">
      <path
        d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
      />
    </template>
    <template v-else-if="name === 'schliessen'">
      <path d="M18 6 6 18M6 6l12 12" />
    </template>
    <template v-else-if="name === 'tastatur'">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'weiter'">
      <path d="M9 6l6 6-6 6" />
    </template>

    <!-- ── Symbole der Computer-Oberfläche ──────────────────────────── -->
    <template v-else-if="name === 'uebersicht'">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </template>
    <template v-else-if="name === 'kalender'">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </template>
    <template v-else-if="name === 'paket'">
      <rect x="2" y="4" width="20" height="5" />
      <path d="M4 9v11h16V9M10 13h4" />
    </template>
    <template v-else-if="name === 'etikett'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </template>
    <template v-else-if="name === 'austausch'">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
    </template>
    <template v-else-if="name === 'einstellungen'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.7 8a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z"
      />
    </template>
    <template v-else-if="name === 'benutzer'">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    </template>
    <template v-else-if="name === 'abmelden'">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </template>
    <template v-else-if="name === 'stift'">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </template>
    <template v-else-if="name === 'kamera'">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </template>
    <template v-else-if="name === 'drucken'">
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </template>
    <template v-else-if="name === 'hoch'">
      <path d="M18 15l-6-6-6 6" />
    </template>
    <template v-else-if="name === 'runter'">
      <path d="M6 9l6 6 6-6" />
    </template>
    <template v-else-if="name === 'board'">
      <rect x="2" y="3" width="6" height="18" rx="1" />
      <rect x="9" y="3" width="6" height="13" rx="1" />
      <rect x="16" y="3" width="6" height="16" rx="1" />
    </template>
  </svg>
</template>
