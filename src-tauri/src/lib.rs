use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use thiserror::Error;

const SOURCE: &str = "figure.tikz";
const COMPILE_SOURCE: &str = "figureit.tex";
const COMPILE_WRAPPER: &str = "\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\input{figure.tikz}\n\\end{document}\n";
const ASSETS: &str = "assets";
const MAX_SOURCE_BYTES: usize = 1_000_000;
const MAX_REQUEST_BYTES: usize = 100_000;
const CLAUDE_STREAM_FLAGS: &[&str] = &[
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
];
const CLAUDE_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"required":["summary","operations"],"properties":{"summary":{"type":"string","maxLength":1000},"operations":{"type":"array","maxItems":32,"items":{"oneOf":[{"type":"object","additionalProperties":false,"required":["type","id","dx","dy"],"properties":{"type":{"const":"move"},"id":{"type":"string","maxLength":160},"dx":{"type":"number"},"dy":{"type":"number"}}},{"type":"object","additionalProperties":false,"required":["type","id","transform"],"properties":{"type":{"const":"transform"},"id":{"type":"string","maxLength":160},"transform":{"type":"object","additionalProperties":false,"minProperties":1,"properties":{"rotate":{"type":"number"},"xScale":{"type":"number"},"yScale":{"type":"number"},"translate":{"type":"object","additionalProperties":false,"required":["x","y"],"properties":{"x":{"type":"number"},"y":{"type":"number"}}}}}}},{"type":"object","additionalProperties":false,"required":["type","id"],"properties":{"type":{"const":"set_metadata"},"id":{"type":"string","maxLength":160},"name":{"type":"string","maxLength":160},"visible":{"type":"boolean"},"locked":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["type","id"],"properties":{"type":{"const":"update_properties"},"id":{"type":"string","maxLength":160},"geometry":{"type":"object","additionalProperties":false,"properties":{"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number"},"height":{"type":"number"}}},"style":{"type":"object","additionalProperties":false,"properties":{"fill":{"type":"string","maxLength":80},"stroke":{"type":"string","maxLength":80},"strokeWidth":{"type":"number"},"opacity":{"type":"number","minimum":0,"maximum":1}}},"text":{"type":"string","maxLength":10000},"transform":{"type":"object","additionalProperties":false,"properties":{"rotate":{"type":"number"},"xScale":{"type":"number"},"yScale":{"type":"number"},"translate":{"type":"object","additionalProperties":false,"required":["x","y"],"properties":{"x":{"type":"number"},"y":{"type":"number"}}}}}}},{"type":"object","additionalProperties":false,"required":["type","id"],"properties":{"type":{"enum":["delete","ungroup"]},"id":{"type":"string","maxLength":160}}},{"type":"object","additionalProperties":false,"required":["type","id","index"],"properties":{"type":{"const":"reorder"},"id":{"type":"string","maxLength":160},"parentId":{"type":"string","maxLength":160},"index":{"type":"integer","minimum":0,"maximum":10000}}},{"type":"object","additionalProperties":false,"required":["type","childIds"],"properties":{"type":{"const":"group"},"id":{"type":"string","maxLength":160},"parentId":{"type":"string","maxLength":160},"name":{"type":"string","maxLength":160},"childIds":{"type":"array","minItems":2,"maxItems":64,"items":{"type":"string","maxLength":160}}}}]}}}}"#;
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum BackendError {
    #[error("Invalid request")]
    InvalidRequest,
    #[error("Project is unavailable")]
    ProjectUnavailable,
    #[error("Operation could not be completed")]
    OperationFailed,
    #[error("A folder must be selected")]
    SelectionRequired,
    #[error("Git is unavailable")]
    GitUnavailable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub handle: String,
    pub title: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub time: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub line: Option<u32>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CompileResult {
    Ok {
        pdf: Vec<u8>,
        diagnostics: Vec<CompileDiagnostic>,
    },
    Unavailable {
        message: String,
    },
    Failed {
        diagnostics: Vec<CompileDiagnostic>,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ClaudeResult {
    Ok {
        text: String,
        operations: Value,
        conversation: String,
    },
    Unavailable {
        message: String,
    },
    Rejected {
        message: String,
    },
}

#[derive(Default)]
pub struct ProjectStore(Mutex<HashMap<String, PathBuf>>);

struct ClaudeConversation {
    _workspace: tempfile::TempDir,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for ClaudeConversation {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct ClaudeStore(Mutex<Option<(String, ClaudeConversation)>>);

impl ProjectStore {
    #[cfg(desktop)]
    fn insert(&self, info: &ProjectInfo, path: PathBuf) -> Result<(), BackendError> {
        self.0
            .lock()
            .map_err(|_| BackendError::OperationFailed)?
            .insert(info.handle.clone(), path);
        Ok(())
    }
    fn get(&self, handle: &str) -> Result<PathBuf, BackendError> {
        self.0
            .lock()
            .map_err(|_| BackendError::OperationFailed)?
            .get(handle)
            .cloned()
            .ok_or(BackendError::ProjectUnavailable)
    }
}

fn safe_title(path: &Path) -> String {
    path.file_name()
        .and_then(|v| v.to_str())
        .filter(|v| !v.is_empty())
        .unwrap_or("FigureIt")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .take(80)
        .collect()
}

fn next_handle() -> String {
    format!("project-{}", NEXT_HANDLE.fetch_add(1, Ordering::Relaxed))
}

fn canonical_dir(path: &Path) -> Result<PathBuf, BackendError> {
    let metadata = fs::metadata(path).map_err(|_| BackendError::ProjectUnavailable)?;
    if !metadata.is_dir() {
        return Err(BackendError::InvalidRequest);
    }
    path.canonicalize()
        .map_err(|_| BackendError::ProjectUnavailable)
}

fn source_path(project: &Path) -> PathBuf {
    project.join(SOURCE)
}

fn read_source(project: &Path) -> Result<String, BackendError> {
    let source =
        fs::read_to_string(source_path(project)).map_err(|_| BackendError::OperationFailed)?;
    if source.len() > MAX_SOURCE_BYTES {
        return Err(BackendError::InvalidRequest);
    }
    Ok(source)
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), BackendError> {
    let parent = path.parent().ok_or(BackendError::OperationFailed)?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| BackendError::OperationFailed)?;
    temp.write_all(contents.as_bytes())
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| BackendError::OperationFailed)?;
    temp.persist(path)
        .map(|_| ())
        .map_err(|_| BackendError::OperationFailed)
}

/// Test-only path-taking core. Tauri commands use handles after this boundary.
pub fn create_project_at(path: PathBuf) -> Result<ProjectInfo, BackendError> {
    fs::create_dir_all(&path).map_err(|_| BackendError::OperationFailed)?;
    let project = canonical_dir(&path)?;
    if project.join(".git").exists() {
        return Err(BackendError::InvalidRequest);
    }
    fs::create_dir_all(project.join(ASSETS)).map_err(|_| BackendError::OperationFailed)?;
    let source = source_path(&project);
    if !source.exists() {
        atomic_write(&source, "\\begin{tikzpicture}\n\\end{tikzpicture}\n")?;
    }
    Ok(ProjectInfo {
        handle: next_handle(),
        title: safe_title(&project),
        source: read_source(&project)?,
    })
}

pub fn open_project_at(path: PathBuf) -> Result<ProjectInfo, BackendError> {
    let project = canonical_dir(&path)?;
    if !project.join(ASSETS).is_dir() || !source_path(&project).is_file() {
        return Err(BackendError::InvalidRequest);
    }
    Ok(ProjectInfo {
        handle: next_handle(),
        title: safe_title(&project),
        source: read_source(&project)?,
    })
}

fn relative_asset(name: &str) -> Result<PathBuf, BackendError> {
    let path = Path::new(name);
    if name.is_empty()
        || name.len() > 160
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(BackendError::InvalidRequest);
    }
    Ok(path.to_path_buf())
}

fn contains_host_path(value: &str) -> bool {
    value.contains("/Users/")
        || value.contains("/home/")
        || value.contains("/private/var/")
        || value.contains("/var/folders/")
        || value.contains("/Volumes/")
        || value.contains("/tmp/")
        || value.contains("file://")
        || value.contains("\\\\")
        || value.as_bytes().windows(3).any(|part| {
            part[0].is_ascii_alphabetic() && part[1] == b':' && matches!(part[2], b'/' | b'\\')
        })
        || value.bytes().any(|byte| byte == 0)
}

fn has_only_keys(object: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn valid_id(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|id| !id.is_empty() && id.len() <= 160)
}

fn valid_number(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|number| number.is_finite() && (-10_000.0..=10_000.0).contains(&number))
}

fn optional(value: Option<&Value>, valid: impl FnOnce(&Value) -> bool) -> bool {
    value.map(valid).unwrap_or(true)
}

fn valid_claude_operation(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let Some(kind) = object.get("type").and_then(Value::as_str) else {
        return false;
    };
    match kind {
        "move" => {
            has_only_keys(object, &["type", "id", "dx", "dy"])
                && valid_id(object.get("id"))
                && valid_number(object.get("dx"))
                && valid_number(object.get("dy"))
        }
        "transform" => {
            has_only_keys(object, &["type", "id", "transform"])
                && valid_id(object.get("id"))
                && object
                    .get("transform")
                    .and_then(Value::as_object)
                    .is_some_and(|transform| {
                        !transform.is_empty()
                            && has_only_keys(
                                transform,
                                &["rotate", "xScale", "yScale", "translate"],
                            )
                            && optional(transform.get("rotate"), |value| valid_number(Some(value)))
                            && optional(transform.get("xScale"), |value| valid_number(Some(value)))
                            && optional(transform.get("yScale"), |value| valid_number(Some(value)))
                            && optional(transform.get("translate"), |value| {
                                value.as_object().is_some_and(|translate| {
                                    has_only_keys(translate, &["x", "y"])
                                        && valid_number(translate.get("x"))
                                        && valid_number(translate.get("y"))
                                })
                            })
                    })
        }
        "set_metadata" => {
            has_only_keys(object, &["type", "id", "name", "visible", "locked"])
                && valid_id(object.get("id"))
                && object.len() > 2
                && optional(object.get("name"), |value| {
                    value.as_str().is_some_and(|name| name.len() <= 160)
                })
                && optional(object.get("visible"), Value::is_boolean)
                && optional(object.get("locked"), Value::is_boolean)
        }
        "update_properties" => {
            has_only_keys(
                object,
                &["type", "id", "geometry", "style", "text", "transform"],
            ) && valid_id(object.get("id"))
                && object.len() > 2
                && optional(object.get("text"), |value| {
                    value.as_str().is_some_and(|text| text.len() <= 10_000)
                })
                && optional(object.get("geometry"), |value| {
                    value.as_object().is_some_and(|geometry| {
                        has_only_keys(geometry, &["x", "y", "width", "height"])
                            && !geometry.is_empty()
                            && geometry.values().all(|value| valid_number(Some(value)))
                    })
                })
                && optional(object.get("style"), |value| {
                    value.as_object().is_some_and(|style| {
                        has_only_keys(style, &["fill", "stroke", "strokeWidth", "opacity"])
                            && !style.is_empty()
                            && optional(style.get("fill"), |value| {
                                value.as_str().is_some_and(|text| text.len() <= 80)
                            })
                            && optional(style.get("stroke"), |value| {
                                value.as_str().is_some_and(|text| text.len() <= 80)
                            })
                            && optional(style.get("strokeWidth"), |value| valid_number(Some(value)))
                            && optional(style.get("opacity"), |value| {
                                value
                                    .as_f64()
                                    .is_some_and(|opacity| (0.0..=1.0).contains(&opacity))
                            })
                    })
                })
                && optional(object.get("transform"), |value| {
                    valid_claude_operation(
                        &serde_json::json!({"type":"transform","id":"x","transform":value}),
                    )
                })
        }
        "delete" | "ungroup" => {
            has_only_keys(object, &["type", "id"]) && valid_id(object.get("id"))
        }
        "reorder" => {
            has_only_keys(object, &["type", "id", "parentId", "index"])
                && valid_id(object.get("id"))
                && optional(object.get("parentId"), |value| valid_id(Some(value)))
                && object
                    .get("index")
                    .and_then(Value::as_u64)
                    .is_some_and(|index| index <= 10_000)
        }
        "group" => {
            has_only_keys(object, &["type", "id", "parentId", "name", "childIds"])
                && optional(object.get("id"), |value| valid_id(Some(value)))
                && optional(object.get("parentId"), |value| valid_id(Some(value)))
                && optional(object.get("name"), |value| {
                    value.as_str().is_some_and(|name| name.len() <= 160)
                })
                && object
                    .get("childIds")
                    .and_then(Value::as_array)
                    .is_some_and(|ids| {
                        ids.len() >= 2 && ids.len() <= 64 && ids.iter().all(|id| valid_id(Some(id)))
                    })
        }
        _ => false,
    }
}

fn parse_claude_output(bytes: &[u8]) -> Result<(String, Vec<Value>), BackendError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| BackendError::OperationFailed)?;
    let structured = value
        .get("structured_output")
        .and_then(Value::as_object)
        .ok_or(BackendError::OperationFailed)?;
    if !has_only_keys(structured, &["summary", "operations"]) {
        return Err(BackendError::OperationFailed);
    }
    let summary = structured
        .get("summary")
        .and_then(Value::as_str)
        .filter(|summary| {
            !summary.is_empty() && summary.len() <= 1000 && !contains_host_path(summary)
        })
        .ok_or(BackendError::OperationFailed)?
        .to_owned();
    let operations = structured
        .get("operations")
        .and_then(Value::as_array)
        .filter(|operations| {
            operations.len() <= 32 && operations.iter().all(valid_claude_operation)
        })
        .ok_or(BackendError::OperationFailed)?
        .to_owned();
    Ok((summary, operations))
}

fn asset_target(project: &Path, name: &str) -> Result<PathBuf, BackendError> {
    let assets = project
        .join(ASSETS)
        .canonicalize()
        .map_err(|_| BackendError::OperationFailed)?;
    let target = assets.join(relative_asset(name)?);
    if !target.starts_with(&assets) {
        return Err(BackendError::InvalidRequest);
    }
    Ok(target)
}

fn git(project: &Path, args: &[&str]) -> Result<std::process::Output, BackendError> {
    Command::new("git")
        .args(args)
        .current_dir(project)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .map_err(|_| BackendError::GitUnavailable)
}

fn ensure_git(project: &Path) -> Result<(), BackendError> {
    if !project.join(".git").is_dir() && !git(project, &["init"])?.status.success() {
        return Err(BackendError::OperationFailed);
    }
    Ok(())
}

fn checkpoint(project: &Path, message: &str) -> Result<(), BackendError> {
    ensure_git(project)?;
    if !git(project, &["add", "--", SOURCE, ASSETS])?
        .status
        .success()
    {
        return Err(BackendError::OperationFailed);
    }
    if git(project, &["diff", "--cached", "--quiet"])?
        .status
        .success()
    {
        return Ok(());
    }
    let fixed = if message == "restore" {
        "FigureIt restore"
    } else {
        "FigureIt checkpoint"
    };
    let output = git(
        project,
        &[
            "-c",
            "user.name=FigureIt",
            "-c",
            "user.email=figureit@localhost",
            "commit",
            "-m",
            fixed,
        ],
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(BackendError::GitUnavailable)
    }
}

fn commit_list(project: &Path) -> Result<Vec<CommitInfo>, BackendError> {
    ensure_git(project)?;
    let output = git(
        project,
        &["log", "--format=%H%x1f%cI%x1f%s", "--", SOURCE, ASSETS],
    )?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\x1f');
            Some(CommitInfo {
                id: fields.next()?.chars().take(64).collect(),
                time: fields.next()?.chars().take(40).collect(),
                message: fields
                    .next()?
                    .chars()
                    .filter(|c| c.is_ascii_graphic() || *c == ' ')
                    .take(120)
                    .collect(),
            })
        })
        .collect())
}

fn restore(project: &Path, handle: String, commit: &str) -> Result<ProjectInfo, BackendError> {
    if commit.len() > 64 || !commit.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(BackendError::InvalidRequest);
    }
    let output = git(project, &["show", &format!("{commit}:{SOURCE}")])?;
    if !output.status.success() {
        return Err(BackendError::InvalidRequest);
    }
    let source = String::from_utf8(output.stdout).map_err(|_| BackendError::OperationFailed)?;
    if source.len() > MAX_SOURCE_BYTES {
        return Err(BackendError::InvalidRequest);
    }
    atomic_write(&source_path(project), &source)?;
    checkpoint(project, "restore")?;
    Ok(ProjectInfo {
        handle,
        title: safe_title(project),
        source,
    })
}

#[tauri::command]
fn save_project(
    store: State<'_, ProjectStore>,
    handle: String,
    source: String,
) -> Result<(), BackendError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(BackendError::InvalidRequest);
    }
    atomic_write(&source_path(&store.get(&handle)?), &source)
}

#[tauri::command]
fn write_asset(
    store: State<'_, ProjectStore>,
    handle: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<(), BackendError> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(BackendError::InvalidRequest);
    }
    let target = asset_target(&store.get(&handle)?, &name)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| BackendError::OperationFailed)?;
        let assets = store
            .get(&handle)?
            .join(ASSETS)
            .canonicalize()
            .map_err(|_| BackendError::OperationFailed)?;
        if !parent
            .canonicalize()
            .map_err(|_| BackendError::OperationFailed)?
            .starts_with(assets)
        {
            return Err(BackendError::InvalidRequest);
        }
    }
    if target
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(BackendError::InvalidRequest);
    }
    fs::write(target, bytes).map_err(|_| BackendError::OperationFailed)
}

#[tauri::command]
fn checkpoint_project(store: State<'_, ProjectStore>, handle: String) -> Result<(), BackendError> {
    checkpoint(&store.get(&handle)?, "checkpoint")
}
#[tauri::command]
fn list_history(
    store: State<'_, ProjectStore>,
    handle: String,
) -> Result<Vec<CommitInfo>, BackendError> {
    commit_list(&store.get(&handle)?)
}
#[tauri::command]
fn restore_commit(
    store: State<'_, ProjectStore>,
    handle: String,
    commit: String,
) -> Result<ProjectInfo, BackendError> {
    restore(&store.get(&handle)?, handle, &commit)
}

#[cfg(desktop)]
fn choose_folder(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.dialog()
        .file()
        .set_title("Select FigureIt project folder")
        .blocking_pick_folder()
        .ok_or(BackendError::SelectionRequired)?
        .into_path()
        .map_err(|_| BackendError::SelectionRequired)
}

#[tauri::command]
#[cfg(desktop)]
fn create_project(
    app: AppHandle,
    store: State<'_, ProjectStore>,
) -> Result<ProjectInfo, BackendError> {
    let path = choose_folder(&app)?;
    let info = create_project_at(path.clone())?;
    store.insert(&info, canonical_dir(&path)?)?;
    Ok(info)
}
#[tauri::command]
#[cfg(desktop)]
fn open_project(
    app: AppHandle,
    store: State<'_, ProjectStore>,
) -> Result<ProjectInfo, BackendError> {
    let path = choose_folder(&app)?;
    let info = open_project_at(path.clone())?;
    store.insert(&info, canonical_dir(&path)?)?;
    Ok(info)
}

#[tauri::command]
#[cfg(mobile)]
fn create_project(
    _app: AppHandle,
    _store: State<'_, ProjectStore>,
) -> Result<ProjectInfo, BackendError> {
    Err(BackendError::SelectionRequired)
}

#[tauri::command]
#[cfg(mobile)]
fn open_project(
    _app: AppHandle,
    _store: State<'_, ProjectStore>,
) -> Result<ProjectInfo, BackendError> {
    Err(BackendError::SelectionRequired)
}

#[tauri::command]
fn compile_project(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    handle: String,
) -> Result<CompileResult, BackendError> {
    let source = read_source(&store.get(&handle)?)?;
    let temp = tempfile::tempdir().map_err(|_| BackendError::OperationFailed)?;
    fs::write(temp.path().join(SOURCE), source).map_err(|_| BackendError::OperationFailed)?;
    fs::write(temp.path().join(COMPILE_SOURCE), COMPILE_WRAPPER)
        .map_err(|_| BackendError::OperationFailed)?;
    fs::create_dir(temp.path().join("out")).map_err(|_| BackendError::OperationFailed)?;
    let executable_name = if cfg!(windows) {
        "tectonic.exe"
    } else {
        "tectonic"
    };
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join(executable_name))
        .filter(|path| path.is_file());
    let local = cfg!(debug_assertions)
        .then(|| std::env::var_os("FIGUREIT_TECTONIC").map(PathBuf::from))
        .flatten()
        .filter(|path| path.is_file());
    let Some(executable) = bundled.or(local) else {
        return Ok(CompileResult::Unavailable {
            message: "Tectonic is unavailable".into(),
        });
    };
    let output = match Command::new(executable)
        .args(["--untrusted", "--outdir", "out", COMPILE_SOURCE])
        .current_dir(temp.path())
        .env_clear()
        .output()
    {
        Ok(output) => output,
        Err(_) => {
            return Ok(CompileResult::Unavailable {
                message: "Tectonic is unavailable".into(),
            })
        }
    };
    if !output.status.success() {
        return Ok(CompileResult::Failed {
            diagnostics: vec![CompileDiagnostic {
                line: None,
                message: "Tectonic could not compile this source".into(),
            }],
        });
    }
    let pdf = fs::read(temp.path().join("out").join("figureit.pdf"))
        .map_err(|_| BackendError::OperationFailed)?;
    Ok(CompileResult::Ok {
        pdf,
        diagnostics: vec![],
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRequest {
    scene: Value,
    request: String,
    conversation: Option<String>,
}

fn valid_conversation(handle: &str) -> bool {
    handle.starts_with("conversation-")
        && handle.len() <= 80
        && handle
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn spawn_claude(app: &AppHandle) -> Result<ClaudeConversation, BackendError> {
    let workspace = tempfile::tempdir().map_err(|_| BackendError::OperationFailed)?;
    let plugin = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("figureit-claude"));
    let plugin = plugin
        .filter(|path| path.is_dir())
        .ok_or(BackendError::OperationFailed)?;
    let config = workspace.path().join("mcp.json");
    fs::write(&config, "{\"mcpServers\":{}}").map_err(|_| BackendError::OperationFailed)?;
    let system_prompt = format!("You are FigureIt's private design assistant. Use only the supplied scene and request. Return JSON matching this strict schema: {CLAUDE_SCHEMA}. Never mention or request host paths, files, tools, or credentials.");
    let mut child = Command::new("claude")
        .args(CLAUDE_STREAM_FLAGS)
        .arg(&config)
        .args(["--plugin-dir"])
        .arg(plugin)
        .args(["--json-schema", CLAUDE_SCHEMA])
        .args(["--system-prompt", &system_prompt])
        .current_dir(workspace.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| BackendError::OperationFailed)?;
    let stdin = child.stdin.take().ok_or(BackendError::OperationFailed)?;
    let stdout = child.stdout.take().ok_or(BackendError::OperationFailed)?;
    Ok(ClaudeConversation {
        _workspace: workspace,
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn encode_claude_message(payload: &str) -> Result<String, BackendError> {
    serde_json::to_string(&serde_json::json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":payload}]}}))
        .map_err(|_| BackendError::OperationFailed)
}

fn claude_turn(
    conversation: &mut ClaudeConversation,
    payload: String,
) -> Result<(String, Vec<Value>), BackendError> {
    let message = encode_claude_message(&payload)?;
    conversation
        .stdin
        .write_all(message.as_bytes())
        .and_then(|_| conversation.stdin.write_all(b"\n"))
        .map_err(|_| BackendError::OperationFailed)?;
    conversation
        .stdin
        .flush()
        .map_err(|_| BackendError::OperationFailed)?;
    for _ in 0..256 {
        let mut line = String::new();
        let count = conversation
            .stdout
            .read_line(&mut line)
            .map_err(|_| BackendError::OperationFailed)?;
        if count == 0 || line.len() > MAX_REQUEST_BYTES {
            return Err(BackendError::OperationFailed);
        }
        let event: Value =
            serde_json::from_str(&line).map_err(|_| BackendError::OperationFailed)?;
        if event.get("type").and_then(Value::as_str) == Some("result") {
            return parse_claude_output(line.as_bytes());
        }
    }
    Err(BackendError::OperationFailed)
}

#[tauri::command]
fn ask_claude(
    app: AppHandle,
    store: State<'_, ClaudeStore>,
    request: ClaudeRequest,
) -> Result<ClaudeResult, BackendError> {
    if request.request.is_empty()
        || request.request.len() > MAX_REQUEST_BYTES
        || contains_host_path(&request.request)
    {
        return Ok(ClaudeResult::Rejected {
            message: "Request is invalid".into(),
        });
    }
    let payload =
        serde_json::to_string(&request.scene).map_err(|_| BackendError::InvalidRequest)?;
    if payload.len() > MAX_REQUEST_BYTES || contains_host_path(&payload) {
        return Ok(ClaudeResult::Rejected {
            message: "Request is invalid".into(),
        });
    }
    let handle = request
        .conversation
        .filter(|handle| valid_conversation(handle))
        .unwrap_or_else(|| {
            format!(
                "conversation-{}",
                NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
            )
        });
    let mut stored = store.0.lock().map_err(|_| BackendError::OperationFailed)?;
    if stored.as_ref().is_some_and(|(active, _)| active != &handle) {
        return Ok(ClaudeResult::Unavailable {
            message: "Claude is unavailable".into(),
        });
    }
    if stored.is_none() {
        let conversation = match spawn_claude(&app) {
            Ok(conversation) => conversation,
            Err(_) => {
                return Ok(ClaudeResult::Unavailable {
                    message: "Claude is unavailable".into(),
                })
            }
        };
        *stored = Some((handle.clone(), conversation));
    }
    let result = stored
        .as_mut()
        .ok_or(BackendError::OperationFailed)
        .and_then(|(_, conversation)| {
            claude_turn(
                conversation,
                format!("Scene: {payload}\nRequest: {}", request.request),
            )
        });
    match result {
        Ok((text, operations)) => Ok(ClaudeResult::Ok {
            text,
            operations: Value::Array(operations),
            conversation: handle,
        }),
        Err(_) => {
            *stored = None;
            Ok(ClaudeResult::Unavailable {
                message: "Claude is unavailable".into(),
            })
        }
    }
}

#[tauri::command]
fn reset_claude(store: State<'_, ClaudeStore>) -> Result<(), BackendError> {
    *store.0.lock().map_err(|_| BackendError::OperationFailed)? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectStore::default())
        .manage(ClaudeStore::default())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project,
            write_asset,
            checkpoint_project,
            list_history,
            restore_commit,
            compile_project,
            ask_claude,
            reset_claude
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_core_never_exposes_a_path() {
        let temp = tempfile::tempdir().expect("test temp directory");
        let project = create_project_at(temp.path().join("figure")).expect("create project");
        assert!(!project.handle.is_empty());
        assert_eq!(project.title, "figure");
        assert!(!serde_json::to_string(&project)
            .expect("serialize")
            .contains(temp.path().to_string_lossy().as_ref()));
    }
    #[test]
    fn asset_names_cannot_escape_assets() {
        let temp = tempfile::tempdir().expect("test temp directory");
        let project = create_project_at(temp.path().join("figure")).expect("create project");
        let root = temp
            .path()
            .join("figure")
            .canonicalize()
            .expect("canonical");
        assert!(asset_target(&root, "../secret").is_err());
        assert!(asset_target(&root, "/secret").is_err());
        assert!(!format!(
            "{:?}",
            asset_target(&root, "../secret").expect_err("invalid")
        )
        .contains(temp.path().to_string_lossy().as_ref()));
        assert!(!project
            .source
            .contains(temp.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn compile_wrapper_inputs_only_the_project_source() {
        assert!(COMPILE_WRAPPER.contains("\\documentclass{standalone}"));
        assert!(COMPILE_WRAPPER.contains("\\input{figure.tikz}"));
        assert!(!COMPILE_WRAPPER.contains('/'));
    }

    #[test]
    fn claude_output_and_path_validation_are_privacy_bounded() {
        let output = br#"{"result":"ignored","structured_output":{"summary":"Move the label.","operations":[{"type":"move","id":"550e8400-e29b-41d4-a716-446655440000","dx":1.0,"dy":0.0}]}}"#;
        let (summary, operations) = parse_claude_output(output).expect("valid structured output");
        assert_eq!(summary, "Move the label.");
        assert_eq!(operations[0]["type"], "move");
        assert!(parse_claude_output(
            br#"{"structured_output":{"summary":"x","operations":[{"type":"insert"}]}}"#
        )
        .is_err());
        for path in [
            "C:\\Users\\name\\secret",
            concat!("file:", "///", "Users/name/secret"),
            "/private/var/folders/x",
            "/Volumes/USB/x",
            "/tmp/figure",
        ] {
            assert!(contains_host_path(path), "{path}");
        }
        assert!(!contains_host_path("Move the label 2 cm to the right."));
        assert!(valid_conversation("conversation-42"));
        assert!(!valid_conversation("/tmp/conversation"));
        assert!(CLAUDE_STREAM_FLAGS
            .windows(2)
            .any(|flag| flag == ["--input-format", "stream-json"]));
        assert!(CLAUDE_STREAM_FLAGS.contains(&"--no-session-persistence"));
        assert!(!CLAUDE_STREAM_FLAGS.contains(&"--resume"));
        assert!(CLAUDE_SCHEMA.contains("\"summary\""));
        let message: Value =
            serde_json::from_str(&encode_claude_message("next turn").expect("envelope"))
                .expect("json");
        assert_eq!(message["type"], "user");
        assert_eq!(message["message"]["content"][0]["text"], "next turn");
        assert!(serde_json::from_str::<Value>(CLAUDE_SCHEMA).is_ok());
        assert!(CLAUDE_SCHEMA.contains("additionalProperties"));
        assert!(!CLAUDE_SCHEMA.contains("replace_source"));
        assert!(!CLAUDE_SCHEMA.contains("insert"));
    }

    #[cfg(unix)]
    #[test]
    fn dropping_a_conversation_ends_its_process() {
        let workspace = tempfile::tempdir().expect("workspace");
        let mut child = Command::new("sh")
            .args(["-c", "cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("child");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let process_id = child.id();
        drop(ClaudeConversation {
            _workspace: workspace,
            child,
            stdin,
            stdout: BufReader::new(stdout),
        });
        assert!(!Command::new("kill")
            .args(["-0", &process_id.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("process check")
            .success());
    }

    #[test]
    fn git_lifecycle_restores_without_exposing_project_path() {
        let temp = tempfile::tempdir().expect("test temp directory");
        let root = temp.path().join("figure");
        let project = create_project_at(root.clone()).expect("create project");
        atomic_write(&source_path(&root), "first source").expect("write first source");
        checkpoint(&root, "checkpoint").expect("checkpoint");
        let history = commit_list(&root).expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].message, "FigureIt checkpoint");
        let author = git(&root, &["log", "-1", "--format=%an <%ae>"]).expect("author");
        assert_eq!(
            String::from_utf8_lossy(&author.stdout).trim(),
            "FigureIt <figureit@localhost>"
        );
        atomic_write(&source_path(&root), "second source").expect("write second source");
        let restored = restore(&root, project.handle, &history[0].id).expect("restore");
        assert_eq!(restored.source, "first source");
        assert!(!serde_json::to_string(&restored)
            .expect("serialize")
            .contains(temp.path().to_string_lossy().as_ref()));
    }
}
