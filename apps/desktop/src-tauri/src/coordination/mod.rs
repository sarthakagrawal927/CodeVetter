pub mod doc;
pub mod parser;
pub mod schema;

use automerge::AutoCommit;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Global cache of loaded Automerge documents, keyed by review_id.
/// Avoids re-loading from disk on every command call.
pub type DocCache = Arc<Mutex<HashMap<String, AutoCommit>>>;

/// Create a new empty document cache.
pub fn new_doc_cache() -> DocCache {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Build the on-disk path for a review document:
/// `<repo_path>/.codevetter/review-<review_id>.automerge`
pub fn doc_path(repo_path: &str, review_id: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(repo_path)
        .join(".codevetter")
        .join(format!("review-{review_id}.automerge"))
}
