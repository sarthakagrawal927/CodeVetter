pub mod queries;
pub mod schema;

use rusqlite::Connection;
use std::path::PathBuf;

/// Open (or create) the SQLite database in the app data directory and run
/// all migrations so that every table is guaranteed to exist.
pub fn init_db(app_data_dir: PathBuf) -> Result<Connection, rusqlite::Error> {
    std::fs::create_dir_all(&app_data_dir).ok();
    let db_path = app_data_dir.join("codevetter.db");
    let conn = Connection::open(db_path)?;

    // Performance pragmas ------------------------------------------------
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous  = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;

    schema::run_migrations(&conn)?;

    Ok(conn)
}
