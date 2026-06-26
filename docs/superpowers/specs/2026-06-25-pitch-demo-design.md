# Pitch-Demo „Der Handschlag" — Design & Run-of-Show

**Anlass:** Hackathon-Pitch, 5 Minuten, live mit echten Agenten.
**Datum Erstellung:** 2026-06-25 · **Auftritt:** 2026-06-26
**Ziel:** Die Idee als *Geschichte* erlebbar machen — nicht die Technik erklären, sondern die Jury mitnehmen.

---

## 1. Positionierung & These

Wir bauen **nicht** den persönlichen Assistenten. Den hat jeder schon (ChatGPT, Claude, Gemini), und er kennt Vorlieben, Kalender und Postfach. Was ihm **fehlt**, ist eine lebendige, vertrauenswürdige **Event-Quelle** — und das Wissen, *wer* hingeht.

> **These (Bühnenwortlaut):** „Dein Assistent kennt dich längst — deine Interessen, deinen Kalender, dein Postfach. Ihm fehlt nur eines: zu wissen, was da draußen passiert und wer hingeht. Wir sind die **Event-Schicht für die Agenten, die du schon nutzt.**"

### Scope-Linie

| Wir besitzen | Wir besitzen bewusst NICHT |
|---|---|
| Scraping / Ingestion-Agent (frische, deduplizierte Events) | Den User-Agenten |
| MCP-Event-Schicht: `search`, `rsvp`, `connect` | Die Personalisierung (macht der bestehende Agent) |
| Connection-Graph (Vernetzung) | Eine eigene UI mit **Filtern**/Such-Oberfläche |
| **Minimal-Landing-UI:** oben ein **Copy-Snippet** (Onboarding → gibst du deinem Agenten), darunter eine **basic Event-Liste** (Glance/Proof) | Manuelles Event-Erfassen durch Nutzer (CRUD existiert, ist aber kein Demo-Thema) |

> **Zur UI:** Sie ist *kein* Produkt-Surface, das mit dem Agenten konkurriert — sie ist Einstiegspunkt (Copy-Snippet) + Beweis (Event-Liste). Die eigentliche Interaktion läuft über den Agenten.

### Zwei Säulen — jede Sekunde zahlt auf eine ein
1. **Bereitstellung/Suche** — wir scrapen & halten frisch, der Nutzer *findet* nur noch über seinen Agenten.
2. **Vernetzen** — der OTP-Handschlag + Netzwerkeffekt.

---

## 2. Bühnen-Setup

- **Cast:** Gregor (Sprecher 1) + Martin (Sprecher 2). Beide echte Personen, beide echte Agenten.
- **Ein Beamer = Gregors „Held-Screen"** auf **Claude Web (Pro-Account)**. Alles, was das Publikum *sehen* muss, läuft hier.
- **Martin = ChatGPT** (Developer Mode, bezahlter Account) auf seinem **Laptop**, nicht projiziert. Beweist live: *zwei verschiedene Assistenten, ein Event-Netz.*
- Die Payoffs des Handschlags landen wieder auf **Gregors Beamer** (siehe Run-of-Show).
- **Das Event in der Story = genau dieser Raum, jetzt.**

---

## 3. Plattform-Realität (Recherche-Stand Juni 2026)

Begründet die Plattform-Wahl und die ehrliche „works for everyone"-Story.

| Client | Eigener MCP-Server? | Tier | Anbinden | Laien-tauglich |
|---|---|---|---|---|
| **Claude** (Web/Desktop) | **Ja, am offensten** | Free (1), Pro/Max self-serve | Customize → Connectors → „+" → URL → OAuth | **Ja** (nicht auf Mobile *hinzufügen*) |
| **ChatGPT** | Ja, hinter „Developer Mode" | **bezahlt** (Plus/Pro), Setup web-only | Settings → Apps & Connectors → Advanced → Developer mode → `/mcp`-URL | Bedingt; Schreib-Tools mobil aus |
| **Mistral Le Chat / IDEs** | Ja | Pro / Dev | Custom Connector → URL | Ja (Dev) |
| **Consumer-Gemini** | **Nein** (nur Google-kuratiert) | — | Kein URL-Feld | **Nein** → Web-Link-Fallback |

**Ehrliche Vision-Zeile:** „Ein Server, gebaut auf dem MCP-Standard, den OpenAI, Anthropic, Google & Microsoft unterschrieben haben. Funktioniert heute schon in Claude (auch Free), ChatGPT und jedem IDE — der Rest verkabelt es gerade." (Kein Overclaim: Consumer-Gemini ehrlich als „noch nicht" benennen, Web-Link als Brücke.)

**Demo-Härtung:** Server stabil gehostet (Cloudflare Workers / Render / Fly — **kein ngrok-Tunnel**). Für die Bühne **No-Auth-Tools** (weniger Fehlerquellen); OAuth nur als Produktions-Story erwähnen. Tool-Approval vorab auf „Allow always". Connector **niemals live auf dem Handy** hinzufügen.

---

## 4. Run-of-Show (5:00)

| Zeit | Beat | Wer / Sichtbar |
|---|---|---|
| **0:00–0:50** | **Hook + These.** „Wie habt ihr von diesem Hackathon erfahren?" → Events leben in 30 zerstreuten Quellen, keiner hat Überblick — und selbst wenn du hingehst, gehst du ohne neue Kontakte. → These (s. §1). **Ein Satz zur Supply-Seite:** „Wir scrapen das zerstreute Web **agentisch** zusammen — ein ausgefeiltes System, das die Event-Quelle frisch hält." (kein Live-Beat, nur Credibility). | Gregor / Beamer |
| **0:50–1:40** | **UI + Onboarding.** Landing zeigen: oben Copy-Snippet, darunter basic Event-Liste (kurz: „die hält unser agentisches System frisch"). „Das ist alles an Oberfläche. Du kopierst **das hier** — und gibst es deinem Agenten." → **live in Claude einfügen** (Beamer). „Eine URL. Derselbe Link läuft in ChatGPT — Martin hat's dort schon dran." | Gregor / Beamer |
| **1:40–4:00** | **Hero-Journey live** (Detail §5) — hat jetzt Luft. ① Personalisierte Suche m. Quellen-Herkunft → Rust-Meetup Do ② RSVP Hackathon ③ OTP **4271** ④ Martin vernetzt (ChatGPT) ⑤ Beweis + Netzwerk-Payoff auf Beamer. | Beide |
| **4:00–4:35** | **Vision.** Ehrliche Cross-Assistant-Zeile (§3): heute Claude/ChatGPT/IDEs, Standard von OpenAI/Anthropic/Google/MS getragen, der Rest verkabelt es gerade. | Gregor / Beamer |
| **4:35–5:00** | **Closer.** Einprägsamer One-Liner (kein Ask — der kommt im Q&A danach). z.B.: „Wir bauen keinen weiteren Assistenten. Wir geben dem, den du schon liebst, ein Gedächtnis für die echte Welt." | Gregor / Beamer |

---

## 5. Hero-Journey — exakte Beats & Prompts

> Agenten sind nicht-deterministisch — die **Prompt-Formulierung ist Teil des Skripts** und wird wörtlich von Karte gelesen. Antworten kurz halten, über Latenz drüber-narrieren.

**⓪ Onboarding (UI → Agent)** (Gregor, Beamer) — Beat aus §4 (1:15–1:55)
- Landing-UI zeigen: oben Copy-Snippet, darunter basic Event-Liste.
- Snippet kopieren → **live in Claude** als Custom Connector einfügen (Customize → Connectors → „+" → URL einfügen). Auf Claude-Web robust.
- Satz: „Eine URL. Derselbe Link läuft in ChatGPT — Martin hat's dort schon dran."
- **Sicherheitsnetz:** Connector ist parallel **vorab hinzugefügt** + „Allow always"; falls der Live-Add hakt, nahtlos auf die bereits verbundene Session/Clip schwenken.

**① Personalisierte Suche** (Gregor, Claude/Beamer)
- Prompt: *„Was sollte ich diese Woche besuchen?"*
- Erwartung: Agent nutzt Persona-Project (mag Rust, Do frei) → ruft `search` → antwortet z.B. *„Du bist Donnerstag frei und magst Rust → Rust-Meetup am Donnerstag"* + 1–2 weitere, **mit Quellen-Herkunft** (Eventbrite / Uni-Seite / LinkedIn).
- Pointe laut: **„Diese Personalisierung haben wir nicht gebaut. Sein Agent macht das. Wir liefern nur die Events."**

**② RSVP (grounding „dieser Raum")** (Gregor, Beamer)
- Prompt: *„Ich bin gerade auf dem [Hackathon-Name] — markier mich als anwesend."* → `rsvp`.

**③ OTP anfordern** (Gregor, Beamer)
- Prompt: *„Gib mir einen Code, um mich hier mit Martin zu vernetzen."* → `connect` (request) → **OTP 4271 erscheint auf dem Beamer.**

**④ Verbindung abschließen** (Martin, ChatGPT/Laptop)
- Martin laut + tippt: *„Vernetze mich mit Gregor, der Code ist 4271."* → `connect` (complete). **Handschlag-Moment — beide schauen hoch.**

**⑤ Beweis + Netzwerk-Payoff** (Gregor, Beamer)
- Prompt: *„Bin ich jetzt mit Martin vernetzt? Und auf welche Events geht er?"*
- Erwartung: Connection bestätigt **+** Martin geht zum **Rust-Meetup am Donnerstag** (vorab geseedet).
- Closer-Pointe: **„Genau das Meetup, das mir mein Agent vorhin empfohlen hat — und da kenne ich jetzt schon jemanden."**

---

## 6. Vorbereitung (Pre-Stage)

### Daten-Seeds (DB)
- [ ] Mainfranken/Würzburg IT-Events befüllt (echte, via Ingestion), **inkl. „Rust-Meetup Donnerstag" und „[Hackathon]"**.
- [ ] Events tragen **Quellen-Herkunft** (für Provenance-Callback in Beat ①).
- [ ] **Martin hat „Rust-Meetup Donnerstag" bereits per RSVP** (für Payoff ⑤).

### Landing-UI
- [ ] Minimal-UI deployt: oben **Copy-Snippet** (die MCP-URL, ein Klick zum Kopieren), darunter **basic Event-Liste** (zieht live aus der DB → wirkt als Beweis nach dem Ingestion-Lauf).
- [ ] Snippet-Inhalt final (genau die URL, die in Claude/ChatGPT eingefügt wird).
- [ ] Auf großem Screen lesbar (Schriftgröße/Kontrast).

### Accounts & Connectors
- [ ] Gregor: Claude **Pro**, MCP-Connector vorab hinzugefügt, „Allow always" geklickt.
- [ ] Gregor: Claude-**Project** mit Persona-Instruktionen (mag Rust; diese Woche Do frei; Region Mainfranken).
- [ ] Martin: ChatGPT **Plus/Pro**, **Developer Mode** an, MCP-Connector vorab hinzugefügt + getestet (insb. **`connect`-Schreib-Tool** auf ChatGPT-Web — wahrscheinlichstes Live-Risiko).
- [ ] DB ist vor der Bühne **gescraped/befüllt** (Ingestion läuft im Hintergrund, **kein** Live-Beat) — nur sicherstellen, dass die Daten da sind.

### Bühne & Technik
- [ ] Beamer = Gregors Claude-Web; Schriftgröße groß.
- [ ] Prompt-Karten (Beats ①–⑤ wörtlich).
- [ ] Stabiles Hosting des MCP (kein Tunnel); **Hotspot** als Netz-Fallback.

---

## 7. Risiko-Plan & Fallbacks

| Risiko | Mitigation |
|---|---|
| Live-Tool-Call schlägt fehl | **Screen-Recording-Fallback-Clip** für JEDEN Schritt (Connector-Add, ①–⑤). |
| ChatGPT Dev-Mode / Auth-Strenge (Beat ④) | Vorab 3× testen; Martins Screen ist nicht projiziert → bei Bedarf nahtlos auf Claude-Fallback oder Clip schwenken. |
| Agent liefert falsches/verboses Ergebnis | Prompts wörtlich von Karte; kurze Antworten erzwingen; über Latenz narrieren. |
| Netz weg | Hotspot; Clips lokal. |
| OTP-Pfad bricht | Vorher 3× durchspielen; fester Code im Skript (4271 als Beispiel). |
| Mobile-Connector-Falle | Niemals live auf dem Handy *hinzufügen* (geht bei Claude nicht, bei ChatGPT web-only). |

---

## 8. Generalprobe-Checkliste
- [ ] Kompletter Durchlauf unter 5:00 (mit Stoppuhr).
- [ ] Connector-Add in Claude 3× fehlerfrei (+ Fallback-Clip aktuell).
- [ ] Handschlag (③→④→⑤) 3× fehlerfrei, inkl. ChatGPT-Schreib-Tool.
- [ ] Alle Fallback-Clips abspielbar & aktuell.
- [ ] Persona-Project liefert Rust/Donnerstag verlässlich.
