//! The SQLite index.
//!
//! This file is a **cache**. Every column in it is derived from a Markdown file
//! and can be thrown away: `rebuild` drops the tables and repopulates them from
//! whatever the frontend parsed out of the vault. That is what makes "Rebuild
//! index" a safe command rather than a scary one, and it is why the index lives
//! in `.reader_mj/` rather than alongside the notes.
//!
//! Search uses FTS5 when the bundled SQLite has it, and falls back to `LIKE`
//! when it does not, so the app degrades instead of breaking.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::types::{BacklinkRow, IndexRecord, NoteSummary, RebuildResult, SearchQuery};

const SCHEMA_VERSION: i64 = 1;

pub struct NoteIndex {
    connection: Connection,
    full_text: bool,
}

impl NoteIndex {
    /// Open (or create) the index next to the notes.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::configure(connection)
    }

    /// An index that never touches the disk. Used by the tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::configure(Connection::open_in_memory()?)
    }

    fn configure(connection: Connection) -> Result<Self> {
        // WAL keeps reads fast while a write is in flight, which matters when
        // the file watcher and the editor both touch the index.
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;

        let mut index = Self {
            connection,
            full_text: false,
        };
        index.migrate()?;
        Ok(index)
    }

    /// True when FTS5 is available; false means search falls back to `LIKE`.
    pub fn has_full_text_search(&self) -> bool {
        self.full_text
    }

    fn migrate(&mut self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                path      TEXT PRIMARY KEY,
                id        TEXT NOT NULL,
                title     TEXT NOT NULL,
                body      TEXT NOT NULL,
                excerpt   TEXT NOT NULL,
                pinned    INTEGER NOT NULL DEFAULT 0,
                has_tasks INTEGER NOT NULL DEFAULT 0,
                created   TEXT NOT NULL,
                updated   TEXT NOT NULL,
                hash      TEXT NOT NULL,
                mtime     INTEGER NOT NULL,
                size      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE ON UPDATE CASCADE,
                tag  TEXT NOT NULL,
                PRIMARY KEY (path, tag)
            );

            CREATE TABLE IF NOT EXISTS links (
                path   TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE ON UPDATE CASCADE,
                target TEXT NOT NULL,
                PRIMARY KEY (path, target)
            );

            CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_pinned  ON notes(pinned DESC, updated DESC);
            CREATE INDEX IF NOT EXISTS idx_tags_tag      ON tags(tag);
            CREATE INDEX IF NOT EXISTS idx_links_target  ON links(target);
            "#,
        )?;

        // FTS5 is optional: some SQLite builds omit it. Try, and remember.
        self.full_text = self
            .connection
            .execute_batch(
                r#"
                CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                    path UNINDEXED,
                    title,
                    body,
                    tags,
                    tokenize = "unicode61 remove_diacritics 2"
                );
                "#,
            )
            .is_ok();

        self.connection.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SCHEMA_VERSION.to_string()],
        )?;
        Ok(())
    }

    pub fn note_count(&self) -> Result<i64> {
        Ok(self
            .connection
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?)
    }

    pub fn indexed_at(&self) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM meta WHERE key = 'indexed_at'",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Insert or replace one note.
    pub fn upsert(&mut self, record: &IndexRecord) -> Result<()> {
        let transaction = self.connection.transaction()?;
        upsert_within(&transaction, record, self.full_text)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn remove(&mut self, path: &str) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
        transaction.execute("DELETE FROM tags WHERE path = ?1", params![path])?;
        transaction.execute("DELETE FROM links WHERE path = ?1", params![path])?;
        if self.full_text {
            transaction.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Move a note's rows to a new path, preserving its tags and links.
    pub fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute("UPDATE notes SET path = ?2 WHERE path = ?1", params![from, to])?;
        transaction.execute("UPDATE tags  SET path = ?2 WHERE path = ?1", params![from, to])?;
        transaction.execute("UPDATE links SET path = ?2 WHERE path = ?1", params![from, to])?;
        if self.full_text {
            transaction.execute("UPDATE notes_fts SET path = ?2 WHERE path = ?1", params![from, to])?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Drop everything and repopulate. The only writer that clears the index.
    pub fn rebuild(&mut self, records: &[IndexRecord]) -> Result<RebuildResult> {
        let started = std::time::Instant::now();
        let full_text = self.full_text;
        let transaction = self.connection.transaction()?;

        transaction.execute("DELETE FROM links", [])?;
        transaction.execute("DELETE FROM tags", [])?;
        transaction.execute("DELETE FROM notes", [])?;
        if full_text {
            transaction.execute("DELETE FROM notes_fts", [])?;
        }
        for record in records {
            upsert_within(&transaction, record, full_text)?;
        }
        transaction.execute(
            "INSERT INTO meta(key, value) VALUES('indexed_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![now_iso()],
        )?;
        transaction.commit()?;

        Ok(RebuildResult {
            notes: records.len() as i64,
            duration_ms: started.elapsed().as_millis() as i64,
            full_text_search: full_text,
        })
    }

    /// Every note, pinned first then most recently updated.
    pub fn list(&self, limit: i64) -> Result<Vec<NoteSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT path, id, title, excerpt, pinned, created, updated
             FROM notes
             ORDER BY pinned DESC, updated DESC
             LIMIT ?1",
        )?;
        let rows = statement
            .query_map(params![limit], |row| {
                Ok(NoteSummary {
                    path: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    excerpt: row.get(3)?,
                    pinned: row.get::<_, i64>(4)? != 0,
                    created: row.get(5)?,
                    updated: row.get(6)?,
                    tags: Vec::new(),
                    snippet: None,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        self.attach_tags(rows)
    }

    /// Run a parsed query. Filters are applied in SQL; ranking comes from FTS5
    /// when it is available and from a simple heuristic when it is not.
    pub fn search(&self, query: &SearchQuery, limit: i64) -> Result<Vec<NoteSummary>> {
        if query.is_empty {
            return self.list(limit);
        }

        let mut sql = String::from(
            "SELECT n.path, n.id, n.title, n.excerpt, n.pinned, n.created, n.updated, n.body FROM notes n",
        );
        let mut wheres: Vec<String> = Vec::new();
        let mut bindings: Vec<String> = Vec::new();

        let trimmed = query.text.trim();
        // An FTS expression that sanitises down to nothing -- a query of just
        // punctuation, say -- must not reach MATCH; it is a syntax error there.
        // Falling through to LIKE keeps the search box from ever throwing.
        let match_expression = if self.full_text {
            to_match_expression(trimmed)
        } else {
            String::new()
        };
        let use_fts = !match_expression.is_empty();

        if !trimmed.is_empty() {
            if use_fts {
                sql.push_str(" JOIN notes_fts ON notes_fts.path = n.path");
                wheres.push("notes_fts MATCH ?".to_string());
                bindings.push(match_expression);
            } else {
                // Every term must appear somewhere in the note.
                for term in trimmed.split_whitespace() {
                    wheres.push(
                        "(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')".to_string(),
                    );
                    let pattern = format!("%{}%", escape_like(term));
                    bindings.push(pattern.clone());
                    bindings.push(pattern);
                }
            }
        }

        for tag in &query.tags {
            // `tag:work` also matches `work/clients/acme`.
            wheres.push(
                "EXISTS (SELECT 1 FROM tags t WHERE t.path = n.path AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))"
                    .to_string(),
            );
            bindings.push(tag.clone());
            bindings.push(format!("{}/%", escape_like(tag)));
        }
        for tag in &query.exclude_tags {
            wheres.push(
                "NOT EXISTS (SELECT 1 FROM tags t WHERE t.path = n.path AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))"
                    .to_string(),
            );
            bindings.push(tag.clone());
            bindings.push(format!("{}/%", escape_like(tag)));
        }
        if query.pinned_only {
            wheres.push("n.pinned = 1".to_string());
        }
        if query.has_tasks {
            wheres.push("n.has_tasks = 1".to_string());
        }

        if !wheres.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&wheres.join(" AND "));
        }

        if use_fts {
            // bm25 returns lower (more negative) scores for better matches.
            sql.push_str(" ORDER BY n.pinned DESC, bm25(notes_fts, 0.0, 8.0, 1.0, 4.0), n.updated DESC");
        } else {
            sql.push_str(" ORDER BY n.pinned DESC, n.updated DESC");
        }
        sql.push_str(" LIMIT ?");

        let mut statement = self.connection.prepare(&sql)?;
        let mut values: Vec<rusqlite::types::Value> = bindings
            .into_iter()
            .map(rusqlite::types::Value::Text)
            .collect();
        values.push(rusqlite::types::Value::Integer(limit));

        let terms: Vec<String> = trimmed
            .split_whitespace()
            .map(|term| term.trim_matches('"').to_lowercase())
            .filter(|term| !term.is_empty())
            .collect();

        let rows = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                let body: String = row.get(7)?;
                Ok(NoteSummary {
                    path: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    excerpt: row.get(3)?,
                    pinned: row.get::<_, i64>(4)? != 0,
                    created: row.get(5)?,
                    updated: row.get(6)?,
                    tags: Vec::new(),
                    snippet: build_snippet(&body, &terms),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        self.attach_tags(rows)
    }

    /// Notes that link to `path`, with the sentence the link appeared in.
    ///
    /// A note is registered under several keys (its path, its file name and its
    /// title), so a link written either way resolves to the same note.
    pub fn backlinks(&self, path: &str, title: &str) -> Result<Vec<BacklinkRow>> {
        let mut keys = vec![normalize_key(path), normalize_key(title)];
        if let Some(base) = path.rsplit('/').next() {
            keys.push(normalize_key(base));
        }
        keys.sort();
        keys.dedup();
        keys.retain(|key| !key.is_empty());
        if keys.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT DISTINCT n.path, n.title, n.body
             FROM links l JOIN notes n ON n.path = l.path
             WHERE l.target IN ({placeholders}) AND n.path <> ?
             ORDER BY n.updated DESC"
        );

        let mut statement = self.connection.prepare(&sql)?;
        let mut values: Vec<rusqlite::types::Value> = keys
            .iter()
            .map(|key| rusqlite::types::Value::Text(key.clone()))
            .collect();
        values.push(rusqlite::types::Value::Text(path.to_string()));

        let rows = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                let body: String = row.get(2)?;
                Ok(BacklinkRow {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    context: link_context(&body, &keys),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Title recorded for a path, used to look up backlinks by title.
    pub fn title_for(&self, path: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT title FROM notes WHERE path = ?1", params![path], |row| {
                row.get(0)
            })
            .optional()?)
    }

    /// Hash recorded for a path; lets the watcher ignore Reader_MJ's own writes.
    pub fn hash_for(&self, path: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT hash FROM notes WHERE path = ?1", params![path], |row| {
                row.get(0)
            })
            .optional()?)
    }

    fn attach_tags(&self, mut rows: Vec<NoteSummary>) -> Result<Vec<NoteSummary>> {
        if rows.is_empty() {
            return Ok(rows);
        }
        let mut statement = self
            .connection
            .prepare("SELECT tag FROM tags WHERE path = ?1 ORDER BY tag")?;
        for row in &mut rows {
            row.tags = statement
                .query_map(params![row.path], |tag| tag.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
        }
        Ok(rows)
    }
}

fn upsert_within(
    connection: &Connection,
    record: &IndexRecord,
    full_text: bool,
) -> Result<()> {
    connection.execute(
        "INSERT INTO notes (path, id, title, body, excerpt, pinned, has_tasks, created, updated, hash, mtime, size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(path) DO UPDATE SET
            id = excluded.id, title = excluded.title, body = excluded.body,
            excerpt = excluded.excerpt, pinned = excluded.pinned,
            has_tasks = excluded.has_tasks, created = excluded.created,
            updated = excluded.updated, hash = excluded.hash,
            mtime = excluded.mtime, size = excluded.size",
        params![
            record.path,
            record.id,
            record.title,
            record.body,
            record.excerpt,
            record.pinned as i64,
            record.has_tasks as i64,
            record.created,
            record.updated,
            record.hash,
            record.mtime,
            record.size,
        ],
    )?;

    connection.execute("DELETE FROM tags WHERE path = ?1", params![record.path])?;
    for tag in &record.tags {
        connection.execute(
            "INSERT OR IGNORE INTO tags(path, tag) VALUES (?1, ?2)",
            params![record.path, tag],
        )?;
    }

    connection.execute("DELETE FROM links WHERE path = ?1", params![record.path])?;
    for target in &record.links {
        connection.execute(
            "INSERT OR IGNORE INTO links(path, target) VALUES (?1, ?2)",
            params![record.path, normalize_key(target)],
        )?;
    }

    if full_text {
        connection.execute("DELETE FROM notes_fts WHERE path = ?1", params![record.path])?;
        connection.execute(
            "INSERT INTO notes_fts(path, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
            params![record.path, record.title, record.body, record.tags.join(" ")],
        )?;
    }
    Ok(())
}

/// Same normalisation as `linkKey` in `src/core/wikilinks.ts`.
fn normalize_key(target: &str) -> String {
    let mut key = target.trim().replace('\\', "/").to_lowercase();
    if let Some(stripped) = key.strip_suffix(".md") {
        key = stripped.to_string();
    }
    key = key.trim_start_matches("./").to_string();
    key.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Turn user terms into an FTS5 MATCH expression, quoting to disarm operators.
fn to_match_expression(text: &str) -> String {
    text.split_whitespace()
        .map(|term| term.replace(['"', '*', '^', ':', '(', ')', '-'], " "))
        .map(|term| term.trim().to_string())
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// A `<mark>`-highlighted excerpt around the first matching term.
fn build_snippet(body: &str, terms: &[String]) -> Option<String> {
    if terms.is_empty() {
        return None;
    }
    let lowered = body.to_lowercase();
    let hit = terms.iter().filter_map(|term| lowered.find(term)).min()?;

    let start = body[..hit]
        .char_indices()
        .rev()
        .nth(70)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let end = body[hit..]
        .char_indices()
        .nth(90)
        .map(|(index, _)| hit + index)
        .unwrap_or(body.len());

    let slice = body[start..end].split_whitespace().collect::<Vec<_>>().join(" ");
    let mut escaped = html_escape(&slice);

    // Highlight case-insensitively without a regex dependency.
    //
    // `to_lowercase` can change a string's byte length (Turkish dotted I, for
    // one), which would make offsets from the lowercased copy invalid slices
    // into the original. When the lengths disagree we skip highlighting rather
    // than risk slicing mid-character: a snippet without <mark> is a cosmetic
    // loss, a panic is not.
    for term in terms {
        if term.is_empty() {
            continue;
        }
        let haystack = escaped.to_lowercase();
        if haystack.len() != escaped.len() {
            continue;
        }
        let mut out = String::with_capacity(escaped.len() + 13);
        let mut cursor = 0;
        while let Some(found) = haystack[cursor..].find(term.as_str()) {
            let absolute = cursor + found;
            let stop = absolute + term.len();
            let Some(matched) = escaped.get(absolute..stop) else {
                break;
            };
            out.push_str(&escaped[cursor..absolute]);
            out.push_str("<mark>");
            out.push_str(matched);
            out.push_str("</mark>");
            cursor = stop;
        }
        out.push_str(&escaped[cursor..]);
        escaped = out;
    }

    Some(format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        escaped,
        if end < body.len() { "..." } else { "" }
    ))
}

/// The line a `[[link]]` appeared on, trimmed to something readable.
fn link_context(body: &str, keys: &[String]) -> String {
    for line in body.lines() {
        let lowered = line.to_lowercase();
        if !lowered.contains("[[") {
            continue;
        }
        if keys.iter().any(|key| lowered.contains(key.as_str())) {
            let trimmed = line.trim();
            if trimmed.chars().count() <= 160 {
                return trimmed.to_string();
            }
            let cut = trimmed
                .char_indices()
                .nth(160)
                .map(|(index, _)| index)
                .unwrap_or(trimmed.len());
            return format!("{}...", &trimmed[..cut]);
        }
    }
    body.lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .chars()
        .take(160)
        .collect()
}

fn now_iso() -> String {
    // Deliberately dependency-free: seconds since the epoch is enough for a
    // "last rebuilt" marker, and the frontend formats it for display.
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|delta| delta.as_secs())
        .unwrap_or(0);
    format!("@{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(path: &str, title: &str, body: &str, tags: &[&str], links: &[&str]) -> IndexRecord {
        IndexRecord {
            path: path.to_string(),
            id: format!("id-{path}"),
            title: title.to_string(),
            body: body.to_string(),
            excerpt: body.chars().take(60).collect(),
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            links: links.iter().map(|link| link.to_string()).collect(),
            pinned: false,
            created: "2026-09-01T00:00:00.000Z".into(),
            updated: "2026-09-01T00:00:00.000Z".into(),
            has_tasks: body.contains("- [ ]"),
            hash: format!("hash-{path}"),
            mtime: 1,
            size: body.len() as i64,
        }
    }

    fn seeded() -> NoteIndex {
        let mut index = NoteIndex::open_in_memory().unwrap();
        index
            .rebuild(&[
                record(
                    "welcome.md",
                    "Welcome to Reader_MJ",
                    "Reader_MJ keeps plain Markdown files. See [[Cheatsheet]].",
                    &["reader_mj"],
                    &["cheatsheet"],
                ),
                record(
                    "cheatsheet.md",
                    "Cheatsheet",
                    "Tables, tasks and code blocks.\n- [ ] try it",
                    &["reader_mj/getting-started"],
                    &[],
                ),
                record(
                    "groceries.md",
                    "Groceries",
                    "Apples and oranges. Links back to [[Welcome to Reader_MJ]].",
                    &["home/errands"],
                    &["welcome to reader_mj"],
                ),
            ])
            .unwrap();
        index
    }

    fn query(text: &str) -> SearchQuery {
        SearchQuery {
            text: text.to_string(),
            is_empty: text.trim().is_empty(),
            ..Default::default()
        }
    }

    #[test]
    fn rebuild_is_idempotent_and_replaces_everything() {
        let mut index = seeded();
        assert_eq!(index.note_count().unwrap(), 3);

        let result = index
            .rebuild(&[record("only.md", "Only", "just this one", &[], &[])])
            .unwrap();
        assert_eq!(result.notes, 1);
        assert_eq!(index.note_count().unwrap(), 1);
        assert_eq!(index.list(50).unwrap()[0].title, "Only");
    }

    #[test]
    fn full_text_search_is_available_in_the_bundled_sqlite() {
        // If this ever fails the app still works -- it falls back to LIKE --
        // but we want to know, because ranking gets noticeably worse.
        assert!(NoteIndex::open_in_memory().unwrap().has_full_text_search());
    }

    #[test]
    fn search_finds_notes_by_body_and_title() {
        let index = seeded();
        let hits = index.search(&query("oranges"), 20).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Groceries");
        assert!(hits[0].snippet.as_deref().unwrap().contains("<mark>oranges</mark>"));

        let by_title = index.search(&query("cheatsheet"), 20).unwrap();
        assert_eq!(by_title[0].title, "Cheatsheet");
    }

    #[test]
    fn search_with_no_terms_returns_everything() {
        let index = seeded();
        assert_eq!(index.search(&query(""), 20).unwrap().len(), 3);
    }

    #[test]
    fn tag_filters_match_children_and_exclusions() {
        let index = seeded();

        let parent = SearchQuery {
            tags: vec!["reader_mj".into()],
            ..Default::default()
        };
        let titles: Vec<_> = index
            .search(&parent, 20)
            .unwrap()
            .into_iter()
            .map(|note| note.title)
            .collect();
        assert_eq!(titles.len(), 2, "tag:reader_mj should match reader_mj/getting-started too");

        let excluded = SearchQuery {
            exclude_tags: vec!["reader_mj".into()],
            ..Default::default()
        };
        let remaining = index.search(&excluded, 20).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].title, "Groceries");
    }

    #[test]
    fn task_and_pin_filters_work() {
        let mut index = seeded();
        let mut pinned = record("pinned.md", "Pinned", "important", &[], &[]);
        pinned.pinned = true;
        index.upsert(&pinned).unwrap();

        let only_pinned = SearchQuery {
            pinned_only: true,
            ..Default::default()
        };
        assert_eq!(index.search(&only_pinned, 20).unwrap().len(), 1);

        let with_tasks = SearchQuery {
            has_tasks: true,
            ..Default::default()
        };
        assert_eq!(index.search(&with_tasks, 20).unwrap()[0].title, "Cheatsheet");
    }

    #[test]
    fn search_terms_with_fts_operators_do_not_explode() {
        let index = seeded();
        for hostile in ["\"", "*", "a AND", "NEAR(", "-tag", "):"] {
            assert!(
                index.search(&query(hostile), 20).is_ok(),
                "query {hostile:?} should not error"
            );
        }
    }

    #[test]
    fn backlinks_resolve_by_title_and_by_path() {
        let index = seeded();

        let inbound = index.backlinks("welcome.md", "Welcome to Reader_MJ").unwrap();
        assert_eq!(inbound.len(), 1);
        assert_eq!(inbound[0].path, "groceries.md");
        assert!(inbound[0].context.contains("[[Welcome to Reader_MJ]]"));

        let to_cheatsheet = index.backlinks("cheatsheet.md", "Cheatsheet").unwrap();
        assert_eq!(to_cheatsheet.len(), 1);
        assert_eq!(to_cheatsheet[0].path, "welcome.md");
    }

    #[test]
    fn a_note_never_backlinks_to_itself() {
        let mut index = NoteIndex::open_in_memory().unwrap();
        index
            .rebuild(&[record("self.md", "Self", "See [[Self]].", &[], &["self"])])
            .unwrap();
        assert!(index.backlinks("self.md", "Self").unwrap().is_empty());
    }

    #[test]
    fn removing_a_note_clears_its_tags_and_links() {
        let mut index = seeded();
        index.remove("groceries.md").unwrap();
        assert_eq!(index.note_count().unwrap(), 2);
        assert!(index.backlinks("welcome.md", "Welcome to Reader_MJ").unwrap().is_empty());
        let tag_rows: i64 = index
            .connection
            .query_row("SELECT COUNT(*) FROM tags WHERE path = 'groceries.md'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(tag_rows, 0);
    }

    #[test]
    fn rename_carries_tags_and_links_along() {
        let mut index = seeded();
        index.rename("groceries.md", "home/groceries.md").unwrap();

        let listed: Vec<_> = index.list(20).unwrap().into_iter().map(|note| note.path).collect();
        assert!(listed.contains(&"home/groceries.md".to_string()));

        let inbound = index.backlinks("welcome.md", "Welcome to Reader_MJ").unwrap();
        assert_eq!(inbound[0].path, "home/groceries.md");
        assert_eq!(
            index.list(20).unwrap().iter().find(|note| note.path == "home/groceries.md").unwrap().tags,
            vec!["home/errands".to_string()]
        );
    }

    #[test]
    fn list_puts_pinned_notes_first() {
        let mut index = seeded();
        let mut pinned = record("later.md", "Later", "body", &[], &[]);
        pinned.pinned = true;
        pinned.updated = "2020-01-01T00:00:00.000Z".into();
        index.upsert(&pinned).unwrap();

        assert_eq!(index.list(20).unwrap()[0].title, "Later");
    }

    #[test]
    fn normalize_key_matches_the_typescript_rules() {
        assert_eq!(normalize_key("Notes/My Note.md"), "notes/my note");
        assert_eq!(normalize_key("./Foo"), "foo");
        assert_eq!(normalize_key("  Spaced   Out  "), "spaced out");
    }
}
