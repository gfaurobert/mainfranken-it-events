# „Heute Abend"-Plan — Pitch-Vorbereitung

Zugehörig zu `2026-06-25-pitch-demo-design.md`. Ziel: morgen früh ist alles startklar, generalprobentauglich.
Cast: **G** = Gregor (Claude/Beamer), **M** = Martin (ChatGPT/Laptop).

## Kritischer Pfad (was blockiert was)

```
[1] MCP deployt + DB geseedet  ──►  [2] Connectors anbinden  ──►  [4] Handschlag testen  ──►  [5] Fallback-Clips
            │                              ▲
            └──►  [3] Landing-UI (Snippet) ┘
[A] Persona-Project · [B] Prompt-Karten + Closer   →  unabhängig, jederzeit
[6] Generalprobe  →  ganz am Ende
```

Alles ab [2] braucht eine **stabile MCP-URL**. Deshalb [1] zuerst und mit Priorität.

---

## Phase 1 — Fundament (blockiert alles) · ~Abend, zuerst
- [ ] **MCP-Server deployt**, öffentlich über **HTTPS**, stabiler Hostname (Cloudflare Workers / Render / Fly — **kein ngrok**). · *Builder*
- [ ] Tools laufen end-to-end gegen DB: `search`, `rsvp`, `connect` (request OTP), `connect` (complete OTP), „Events meiner Kontakte". · *Builder*
- [ ] **No-Auth-Modus** für die Demo aktiv (OAuth bleibt Produktions-Story). · *Builder*
- [ ] **DB-Seeds:**
  - [ ] Mainfranken/Würzburg IT-Events inkl. **„Rust-Meetup Donnerstag"** + **„[Hackathon-Name]"**. · *Builder*
  - [ ] User-Records für **G** und **M** angelegt.
  - [ ] **M hat „Rust-Meetup Donnerstag" bereits per RSVP** (Payoff ⑤).
  - [ ] Events tragen Quellen-Herkunft (für Provenance in Beat ①).
- [ ] **Smoke-Test:** ein `search`-Call liefert das Rust-Meetup. ✅ = grünes Licht für Phase 2.

## Phase 2 — Agenten anbinden · nach Phase 1
- [ ] **G – Claude Pro:** Connector via Customize → Connectors → „+" → MCP-URL → „Allow always" geklickt. · *G*
- [ ] **M – ChatGPT Plus/Pro:** Developer Mode an → Custom MCP-Connector mit derselben URL → **`connect`-Schreib-Tool getestet** (wahrscheinlichstes Live-Risiko!). · *M*
- [ ] Quer-Check: beide sehen dieselben Events.

## Phase 3 — Landing-UI · parallel zu Phase 2 (nach Phase 1)
- [ ] Minimal-UI deployt: oben **Copy-Snippet (die MCP-URL, 1-Klick-Copy)**, darunter **basic Event-Liste** (live aus DB). · *Builder*
- [ ] Auf großem Screen lesbar (Schrift/Kontrast). Snippet = exakt die URL aus Phase 2.

## Phase A — Persona-Project (unabhängig) · jederzeit
- [ ] **G:** Claude-**Project** mit Instruktionen: „Ich mag Rust; diese Woche bin ich Donnerstag frei; Region Mainfranken." → liefert Beat ① zuverlässig. · *G*

## Phase B — Skript & Karten (unabhängig) · jederzeit
- [ ] Prompt-Karten Beats ⓪–⑤ **wörtlich** (aus §5 der Spec). · *G + M*
- [ ] **Closer-One-Liner** final entscheiden.
- [ ] Rollen-/Übergabe-Punkte markiert (wer redet wann, wann Blick zum Partner beim Handschlag).

## Phase 4 — Handschlag-Test · nach Phase 2
- [ ] ③→④→⑤ komplett durchspielen: G erzeugt OTP → M gibt ihn in ChatGPT ein → G sieht Verbindung + M's Rust-Meetup-RSVP. **3× fehlerfrei.**

## Phase 5 — Fallback-Clips · nachdem alles live klappt
- [ ] Screen-Recordings: Connector-Add (Claude) + Beats ①–⑤. Lokal gespeichert, abspielbar.

## Phase 6 — Generalprobe · ganz am Ende
- [ ] Kompletter Durchlauf **unter 5:00** mit Stoppuhr.
- [ ] Beamer-Setup geprüft (G's Claude-Web, Schriftgröße).
- [ ] **Hotspot** als Netz-Fallback bereit.
- [ ] Beide Connectors „Allow always", keine offenen Approval-Dialoge.

---

## Minimal-Demo-Notfallplan (falls die Zeit knapp wird)
Wenn heute Abend nicht alles fertig wird, in dieser Reihenfolge sichern:
1. **`search` + Persona** (Beat ①) — ohne das kein Pitch.
2. **`connect`-Handschlag** (③→④⑤) — der emotionale Kern.
3. Onboarding-Add live → sonst pre-added zeigen + Satz.
4. RSVP (②) ist „nice to have", kann notfalls entfallen.
