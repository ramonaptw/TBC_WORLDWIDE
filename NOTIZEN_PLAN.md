# Plan: Persönliche Notizen & Textvorlagen

## Was gebaut werden soll
Ein neuer Bereich in der App, wo jeder User sich **private Notizen und Textvorlagen** anlegen kann (wie OneNote, nur einfacher). Vorlagen sollen sich per Klick in die Zwischenablage kopieren lassen, damit man sie schnell in HubSpot, E-Mails oder WhatsApp einfügen kann.

Eingebunden wird das Ganze unter **Tools & Links** — als neue Einstiegskarte oben auf der Seite.

Wichtig: Notizen sind **privat pro User**. Niemand außer dem Ersteller sieht sie.

## Backend

**1. `backend/models/database.js`**
- In `EMPTY` neue Tabelle ergänzen: `notes: []`
- Die bestehende Migration im `load()` legt das Feld automatisch an

**2. Neue Datei `backend/routes/notes.js`** (Vorlage: `routes/wiki.js`)
- `GET /` → nur Notizen des eingeloggten Users zurückgeben
- `POST /` → neue Notiz anlegen, `user_id` IMMER aus `req.user.id`
- `PUT /:id` → Update, vorher Ownership prüfen (sonst 403)
- `DELETE /:id` → Löschen, vorher Ownership prüfen
- Alles hinter `authenticate`, kein `requireRole`

**Felder pro Notiz:**
`id, user_id, title, content, category, is_template, pinned, created_at, updated_at`

**3. `backend/server.js`**
Eine Zeile ergänzen: `app.use('/api/notes', require('./routes/notes'));`

## Frontend

**1. Einstiegskarte in `frontend/js/app.js` → Funktion `loadTools`**
Oben in der Tools-Page eine neue Karte einfügen (analog zur Wiki-Karte):
„📝 Meine Notizen & Vorlagen" mit Button → `showPage('notes')`

**2. Neue Page `#page-notes` in `frontend/app.html`**
- Suchfeld, Kategorie-Filter, Filter „nur Vorlagen / angeheftet"
- Button „+ Neue Notiz"
- Grid mit Karten: Titel, kurze Vorschau, Kategorie-Badge, 📌 wenn angeheftet, 📋 wenn Vorlage
- Pro Karte: Bearbeiten, Löschen, **Kopieren** (Vorlagen)

**3. Editor-Modal**
- Wiki-Toolbar 1:1 wiederverwenden (siehe `wikiToolbar` in `app.html`, ca. Zeile 1150)
- `contenteditable`-Editor wie im Wiki
- Felder: Titel, Kategorie, Checkbox „Als Vorlage markieren", Checkbox „Anheften", Inhalt

**4. „Kopieren"-Funktion für Vorlagen**
`navigator.clipboard.writeText(plainText)` — HTML zu Plain Text wandeln, dann Toast „In Zwischenablage kopiert".

**5. Routing in `app.js` ergänzen**
In der Page-Routing-Map (`tools: loadTools` etc.) hinzufügen: `notes: loadNotes`.
Sidebar-Eintrag ist **nicht** nötig — Zugang läuft über die Tools-Page.

## Reihenfolge
1. `database.js`: `notes: []` zu `EMPTY` hinzufügen
2. `routes/notes.js` anlegen, in `server.js` mounten
3. `app.html`: Page `#page-notes` + Editor-Modal einbauen
4. `app.js`: `loadNotes`, `openNoteModal`, `saveNote`, `deleteNote`, `copyNoteToClipboard`
5. `loadTools` um Einstiegskarte ergänzen
6. Testen: anlegen, bearbeiten, anheften, kopieren, mit zweitem User checken dass Notizen privat sind

## Stil
- Bitte am bestehenden Code-Stil orientieren (siehe `routes/wiki.js` fürs Backend, Wiki-Page und `loadTools` fürs Frontend).
- Keep it simple — keine neuen Abhängigkeiten, keine Refactorings drumherum.
