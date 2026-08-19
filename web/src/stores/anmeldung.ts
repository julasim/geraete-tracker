import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api, ApiError } from "@/api";
import type { Benutzer } from "@/typen";

/**
 * Wer ist angemeldet.
 *
 * Es wird kein Token verwaltet — das steckt im httpOnly-Cookie und ist für
 * JavaScript unsichtbar. Ob die Anmeldung noch gilt, weiß nur der Server;
 * deshalb fragt `pruefe()` bei ihm nach, statt etwas zwischenzuspeichern.
 */
export const useAnmeldung = defineStore("anmeldung", () => {
  const benutzer = ref<Benutzer | null>(null);
  const rechte = ref<string[]>([]);
  const passwortWechselNoetig = ref(false);
  const geprueft = ref(false);

  const angemeldet = computed(() => benutzer.value !== null);

  /**
   * Darf der angemeldete Benutzer das?
   *
   * Damit werden Knöpfe aus- und eingeblendet. Das ist BEQUEMLICHKEIT, kein
   * Schutz: Wer hier im Browser nachhilft, sieht mehr Knöpfe — und bekommt
   * beim Drücken einen 403 vom Server. Dort sitzt die Entscheidung.
   */
  function darf(recht: string): boolean {
    return rechte.value.includes(recht);
  }

  /** Sieht dieser Benutzer überhaupt Verwaltungsfunktionen? */
  const istVerwaltung = computed(() => darf("benutzer.verwalten"));

  async function pruefe(): Promise<boolean> {
    try {
      const antwort = await api.get<{
        benutzer: Benutzer;
        rechte: string[];
        passwortWechselNoetig: boolean;
      }>("/auth/me");
      benutzer.value = antwort.benutzer;
      rechte.value = antwort.rechte ?? [];
      passwortWechselNoetig.value = antwort.passwortWechselNoetig;
      return true;
    } catch {
      benutzer.value = null;
      rechte.value = [];
      return false;
    } finally {
      geprueft.value = true;
    }
  }

  async function anmelden(kennung: string, passwort: string): Promise<void> {
    const antwort = await api.post<{
      benutzer: Benutzer;
      rechte: string[];
      passwortWechselNoetig: boolean;
    }>("/auth/login", { kennung, passwort });
    benutzer.value = antwort.benutzer;
    rechte.value = antwort.rechte ?? [];
    passwortWechselNoetig.value = antwort.passwortWechselNoetig;
  }

  async function abmelden(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } catch (fehler) {
      // Ein abgelaufenes Cookie ist beim Abmelden kein Problem — das Ziel
      // ist ja gerade, nicht mehr angemeldet zu sein.
      if (!(fehler instanceof ApiError) || !fehler.istNichtAngemeldet) throw fehler;
    } finally {
      benutzer.value = null;
      rechte.value = [];
    }
  }

  async function abmeldenUeberall(): Promise<void> {
    await api.post("/auth/logout-alle");
    benutzer.value = null;
    rechte.value = [];
  }

  /** Wird vom API-Modul gerufen, wenn der Server 401 meldet. */
  function verwerfen(): void {
    benutzer.value = null;
    rechte.value = [];
  }

  return {
    benutzer,
    rechte,
    passwortWechselNoetig,
    geprueft,
    angemeldet,
    darf,
    istVerwaltung,
    pruefe,
    anmelden,
    abmelden,
    abmeldenUeberall,
    verwerfen,
  };
});
