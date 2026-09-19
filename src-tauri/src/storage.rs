//! Content-addressed document storage on the filesystem.
//!
//! Scans never go into SQLite as BLOBs. A few hundred members' worth of ID
//! photos and certificates is several GB; inside the database that means slow
//! backups, a bloated WAL, and page-cache pressure we cannot afford on 2 GB.
//!
//! Files land at `docs/<first two hex chars>/<sha256>.<ext>`, so identical
//! uploads deduplicate for free and no directory grows unbounded.

use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};

/// Files larger than this are rejected on import. A scanned A4 page is well
/// under 5 MB; anything past this is a mistake (a video, a whole PDF archive)
/// and would hurt on a 2 GB machine.
pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

const CHUNK: usize = 64 * 1024;

pub struct Stored {
    pub sha256: String,
    pub rel_path: String,
    pub bytes: u64,
    pub mime: String,
    pub original_name: String,
}

/// Copy `source` into the document store under `data_dir`.
///
/// Streams in 64 KB chunks: the whole point is never to hold a scan in memory.
/// If a file with the same hash is already stored, the copy is skipped and the
/// existing path is returned.
pub fn import(data_dir: &Path, source: &Path) -> Result<Stored> {
    let meta = std::fs::metadata(source).map_err(|_| {
        AppError::new("storage.file_not_found", "file not found").with("path", source.display())
    })?;
    if !meta.is_file() {
        return Err(AppError::new("storage.not_a_file", "not a regular file"));
    }
    if meta.len() == 0 {
        return Err(AppError::new("storage.file_empty", "file is empty"));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::new("storage.file_too_large", "file is too large")
            .with("size", format!("{:.1}", meta.len() as f64 / 1_048_576.0))
            .with("limit", MAX_BYTES / 1_048_576));
    }

    let hash = hash_file(source)?;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()) && e.len() <= 8);

    let rel = match &ext {
        Some(e) => format!("docs/{}/{}.{}", &hash[..2], hash, e),
        None => format!("docs/{}/{}", &hash[..2], hash),
    };
    let dest = data_dir.join(&rel);

    if !dest.exists() {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Copy to a temporary name first so an interrupted import can never
        // leave a half-written file sitting at a hash-named path.
        let tmp = dest.with_extension("part");
        copy_stream(source, &tmp)?;
        std::fs::rename(&tmp, &dest)?;
    }

    Ok(Stored {
        sha256: hash,
        rel_path: rel,
        bytes: meta.len(),
        mime: guess_mime(ext.as_deref()).to_string(),
        original_name: source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("document")
            .to_string(),
    })
}

/// Absolute path of a stored document, verified to be inside the store.
///
/// `rel_path` comes from the database rather than from the user, but it is
/// still checked: a traversal bug here would hand `xdg-open` an arbitrary path.
pub fn resolve(data_dir: &Path, rel_path: &str) -> Result<PathBuf> {
    if rel_path.contains("..") || Path::new(rel_path).is_absolute() {
        return Err(AppError::new(
            "storage.suspicious_path",
            "suspicious document path",
        ));
    }
    let path = data_dir.join(rel_path);
    if !path.starts_with(data_dir) {
        return Err(AppError::new(
            "storage.path_escape",
            "document path escapes the data directory",
        ));
    }
    if !path.exists() {
        return Err(AppError::new(
            "storage.file_missing",
            "the file for this document is missing",
        )
        .with("path", rel_path));
    }
    Ok(path)
}

fn hash_file(path: &Path) -> Result<String> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    // digest 0.11 returns a byte array that does not implement LowerHex, so the
    // hex encoding is written out here rather than pulling in a crate for it.
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(hex)
}

fn copy_stream(source: &Path, dest: &Path) -> Result<()> {
    let mut reader = BufReader::new(File::open(source)?);
    let mut writer = File::create(dest)?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
    }
    writer.sync_all()?;
    Ok(())
}

fn guess_mime(ext: Option<&str>) -> &'static str {
    match ext {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("heic") => "image/heic",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gym-manager-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn imports_and_shards_by_hash() {
        let dir = tmpdir("import");
        let src = dir.join("cert.pdf");
        std::fs::write(&src, b"a health certificate").unwrap();

        let stored = import(&dir, &src).unwrap();
        assert!(stored
            .rel_path
            .starts_with(&format!("docs/{}/", &stored.sha256[..2])));
        assert!(stored.rel_path.ends_with(".pdf"));
        assert_eq!(stored.mime, "application/pdf");
        assert_eq!(stored.bytes, 20);
        assert!(dir.join(&stored.rel_path).exists());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The hex encoding is written by hand (digest 0.11 dropped `LowerHex`),
    /// so pin it against a published SHA-256 test vector. A regression here
    /// would silently re-import every document in the store as a new file.
    #[test]
    fn hashes_match_the_known_vector() {
        let dir = tmpdir("vector");
        let src = dir.join("abc.txt");
        std::fs::write(&src, b"abc").unwrap();

        let stored = import(&dir, &src).unwrap();
        assert_eq!(
            stored.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn identical_files_deduplicate() {
        let dir = tmpdir("dedup");
        let a = dir.join("a.pdf");
        let b = dir.join("b.pdf");
        std::fs::write(&a, b"same bytes").unwrap();
        std::fs::write(&b, b"same bytes").unwrap();

        let first = import(&dir, &a).unwrap();
        let second = import(&dir, &b).unwrap();
        assert_eq!(first.sha256, second.sha256);
        assert_eq!(first.rel_path, second.rel_path);
        // Different original names are still reported for the database row.
        assert_eq!(first.original_name, "a.pdf");
        assert_eq!(second.original_name, "b.pdf");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn empty_and_missing_files_are_rejected() {
        let dir = tmpdir("reject");
        let empty = dir.join("empty.pdf");
        std::fs::write(&empty, b"").unwrap();
        assert!(import(&dir, &empty).is_err());
        assert!(import(&dir, &dir.join("nope.pdf")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolve_rejects_traversal() {
        let dir = tmpdir("traversal");
        assert!(resolve(&dir, "../../etc/passwd").is_err());
        assert!(resolve(&dir, "/etc/passwd").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
