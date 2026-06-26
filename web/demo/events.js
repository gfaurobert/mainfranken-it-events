const API_PARAM = new URLSearchParams(window.location.search).get("api");
const FALLBACK_DATA = "./data/events.json";

const DEFAULT_API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3789/events"
    : "https://mie.faurobert.fr/events";

const USE_DEMO_DATA = API_PARAM === "demo";
const API_BASE = USE_DEMO_DATA ? FALLBACK_DATA : API_PARAM || DEFAULT_API_BASE;

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

function todayDateParam() {
  return new Date().toISOString().slice(0, 10);
}

function buildEventsUrl() {
  if (USE_DEMO_DATA || API_BASE === FALLBACK_DATA) {
    return FALLBACK_DATA;
  }

  const url = new URL(API_BASE);

  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "50");
  }
  if (!url.searchParams.has("date_from")) {
    url.searchParams.set("date_from", todayDateParam());
  }

  return url.toString();
}

function normalizeEvent(event) {
  const title = event.title || event.name || "Unbenannte Veranstaltung";
  const startsAt = event.starts_at || event.startDate;
  const endsAt = event.ends_at || event.endDate;
  const city = event.city || event.locationCity || "";
  const locationName = event.location_name || event.locationName || "";
  const address = event.address || event.locationAddress || "";
  const zip = event.location_zip || event.locationZip || "";

  return {
    id: event.id,
    title,
    startsAt,
    endsAt,
    city,
    locationName,
    address,
    zip,
    url: event.url || event.source_url || event.sourceUrl || "#",
    organizer: event.organizer || "",
    tags: Array.isArray(event.tags) ? event.tags : [],
    isFree: event.is_free ?? event.isFree ?? true,
    price: event.price || "",
  };
}

// Events ohne erkennbare Uhrzeit kommen mit Mitternacht (00:00) an. "00:00 Uhr"
// anzuzeigen wirkt wie eine echte Startzeit – stattdessen leer lassen. Geprüft
// wird das formatierte Ergebnis (nicht getHours), damit es zur Anzeige-Zeitzone passt.
function formatClock(date) {
  const t = timeFormatter.format(date);
  return t === "00:00" ? "" : `${t} Uhr`;
}

function formatDateParts(isoDate) {
  const date = new Date(isoDate);
  return {
    day: dateFormatter.formatToParts(date).find((part) => part.type === "day")?.value || "",
    month: dateFormatter.formatToParts(date).find((part) => part.type === "month")?.value || "",
    year: dateFormatter.formatToParts(date).find((part) => part.type === "year")?.value || "",
    time: formatClock(date),
  };
}

function formatTimeRange(startsAt, endsAt) {
  const start = formatClock(new Date(startsAt));
  if (!start) return "";
  if (!endsAt) return start;

  const end = formatClock(new Date(endsAt));
  if (!end) return start;
  return `${start} – ${end}`;
}

function formatLocation(event) {
  const parts = [event.locationName, event.address, [event.zip, event.city].filter(Boolean).join(" ")]
    .filter(Boolean);

  return parts.join(", ");
}

function renderTags(tags) {
  if (!tags.length) return "";

  return `<div class="events-table__tags">${tags
    .map((tag) => `<span class="events-table__tag">${escapeHtml(tag)}</span>`)
    .join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRow(event) {
  const date = formatDateParts(event.startsAt);
  const hasUrl = event.url && event.url !== "#";

  return `
    <tr>
      <td class="events-table__date">
        <span class="events-table__date-day">${escapeHtml(date.day)}. ${escapeHtml(date.month)}</span>
        <span class="events-table__date-meta">${escapeHtml(date.year)}</span>
      </td>
      <td>${escapeHtml(formatTimeRange(event.startsAt, event.endsAt))}</td>
      <td>
        <p class="events-table__title">${escapeHtml(event.title)}</p>
        ${event.organizer ? `<p class="events-table__organizer">${escapeHtml(event.organizer)}</p>` : ""}
        ${renderTags(event.tags)}
      </td>
      <td class="events-table__location">${escapeHtml(formatLocation(event))}</td>
      <td>
        ${
          hasUrl
            ? `<a class="events-table__link" href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">
          Details <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </a>`
            : `<span class="events-table__link events-table__link--muted">—</span>`
        }
      </td>
    </tr>
  `;
}

function setWidgetState(state, message) {
  const widget = document.getElementById("events-widget");
  if (!widget) return;

  widget.innerHTML = `<div class="events-widget__${state}"><p>${escapeHtml(message)}</p></div>`;
}

function parseEventsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.events)) return payload.events;
  return payload.data || [];
}

async function fetchEvents(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  return parseEventsPayload(payload);
}

function prepareEvents(rawEvents) {
  return rawEvents
    .map(normalizeEvent)
    .filter((event) => event.startsAt)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

async function loadEventsFromSource(url) {
  const rawEvents = await fetchEvents(url);
  return prepareEvents(rawEvents);
}

async function loadEvents() {
  setWidgetState("loading", "Veranstaltungen werden geladen …");

  try {
    let events = await loadEventsFromSource(buildEventsUrl());

    if (!events.length && !USE_DEMO_DATA) {
      events = await loadEventsFromSource(FALLBACK_DATA);
    }

    if (!events.length) {
      setWidgetState("empty", "Es wurden keine Veranstaltungen gefunden.");
      return;
    }

    renderEventsTable(events);
  } catch (error) {
    if (!USE_DEMO_DATA) {
      try {
        const events = await loadEventsFromSource(FALLBACK_DATA);
        if (events.length) {
          renderEventsTable(events);
          return;
        }
      } catch (fallbackError) {
        console.error(fallbackError);
      }
    }

    console.error(error);
    setWidgetState(
      "error",
      "Veranstaltungen konnten nicht geladen werden. Bitte später erneut versuchen.",
    );
  }
}

function renderEventsTable(events) {
  const widget = document.getElementById("events-widget");
  if (!widget) return;

  widget.innerHTML = `
    <div class="events-widget__toolbar">
      <p class="events-widget__count">${events.length} Veranstaltung${events.length === 1 ? "" : "en"}</p>
      <div class="events-widget__search">
        <label class="visually-hidden" for="events-search">Veranstaltungen durchsuchen</label>
        <input id="events-search" type="search" placeholder="Suche nach Titel, Ort oder Thema …" autocomplete="off">
      </div>
    </div>
    <div class="events-table-wrap">
      <table class="events-table" aria-label="IT-Events in der Region">
        <thead>
          <tr>
            <th scope="col">Datum</th>
            <th scope="col">Uhrzeit</th>
            <th scope="col">Veranstaltung</th>
            <th scope="col">Ort</th>
            <th scope="col">Link</th>
          </tr>
        </thead>
        <tbody id="events-table-body">
          ${events.map(renderRow).join("")}
        </tbody>
      </table>
    </div>
  `;

  const searchInput = document.getElementById("events-search");
  const tableBody = document.getElementById("events-table-body");
  const countLabel = widget.querySelector(".events-widget__count");

  searchInput?.addEventListener("input", () => {
    const query = searchInput.value.trim();
    filterEventsClientSide(query, events, tableBody, countLabel);
  });
}

function filterEventsClientSide(query, events, tableBody, countLabel) {
  const normalizedQuery = query.toLowerCase();
  const filtered = events.filter((event) => {
    const haystack = [
      event.title,
      event.organizer,
      event.city,
      event.locationName,
      event.address,
      event.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return !normalizedQuery || haystack.includes(normalizedQuery);
  });

  if (!filtered.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="events-widget__empty">
          <p>Es wurden keine Veranstaltungen gefunden.</p>
        </td>
      </tr>
    `;
  } else {
    tableBody.innerHTML = filtered.map(renderRow).join("");
  }

  if (countLabel) {
    countLabel.textContent = `${filtered.length} Veranstaltung${filtered.length === 1 ? "" : "en"}`;
  }
}

function setupHeader() {
  const toggle = document.querySelector(".site-header__toggle");
  const nav = document.querySelector(".site-header__nav");

  toggle?.addEventListener("click", () => {
    const isOpen = nav?.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
}

function setupBackToTop() {
  const button = document.querySelector(".back-to-top");
  if (!button) return;

  window.addEventListener("scroll", () => {
    button.classList.toggle("is-visible", window.scrollY > 100);
  });

  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupHeader();
  setupBackToTop();
  loadEvents();
});
