//! Windows-only native crash capture.
//!
//! The Rust panic hook only sees Rust panics. Native faults — access violations
//! (`0xC0000005`), stack overflow, illegal instructions, and the WebView2 renderer
//! crashes that abruptly close the app — never reach it, so today an abnormal exit is
//! detected (via the session marker) but with no reason recorded.
//!
//! This installs a top-level Structured-Exception-Handling filter that records the
//! exception code, the faulting instruction address and its owning module into the same
//! crash log the panic hook uses, so the reason survives to the next launch and surfaces
//! through `get_crash_report`. It also redirects the process stderr — which a
//! `windows_subsystem = "windows"` build otherwise discards — to a file, capturing any
//! last-gasp native/abort output.
//!
//! Handler constraints: a top-level exception filter runs in a compromised process, so it
//! keeps to pre-resolved paths and direct `WriteFile` calls and guards against re-entry.
//! It still formats through the allocator, which is fine for the heap-intact faults
//! (access violation / WebView2) this is primarily meant to catch.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, WriteFile, CREATE_ALWAYS, FILE_APPEND_DATA, FILE_ATTRIBUTE_NORMAL,
    FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_ALWAYS,
};
use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE};
use windows_sys::Win32::System::Diagnostics::Debug::{
    SetUnhandledExceptionFilter, EXCEPTION_POINTERS,
};
use windows_sys::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};

/// Let the OS proceed with its default handling (terminate + WER) after we record.
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC000_0005;

// Wide, null-terminated paths resolved once at install time so the handler never builds
// them at crash time.
static CRASH_LOG_WIDE: OnceLock<Vec<u16>> = OnceLock::new();
static PENDING_ERROR_WIDE: OnceLock<Vec<u16>> = OnceLock::new();

fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Install native crash capture: redirect stderr to `stderr_log` and register the SEH
/// filter that records crash reasons into `crash_log` (append, historical) and
/// `pending_error` (overwrite, read on the next launch as the crash detail).
pub fn install(crash_log: &Path, pending_error: &Path, stderr_log: &Path) {
    let _ = CRASH_LOG_WIDE.set(to_wide(crash_log));
    let _ = PENDING_ERROR_WIDE.set(to_wide(pending_error));

    redirect_stderr(stderr_log);

    unsafe {
        SetUnhandledExceptionFilter(Some(exception_handler));
    }
}

/// Point the process STD_ERROR_HANDLE at a file so native/abort output isn't lost on a
/// windowed (no-console) build.
fn redirect_stderr(path: &Path) {
    let wide = to_wide(path);
    unsafe {
        let handle: HANDLE = CreateFileW(
            wide.as_ptr(),
            FILE_APPEND_DATA,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return;
        }
        let _ = SetStdHandle(STD_ERROR_HANDLE, handle);
    }
}

/// Write `bytes` to `wide_path`. `truncate` picks overwrite (CREATE_ALWAYS) vs append.
fn write_all(wide_path: &[u16], bytes: &[u8], truncate: bool) {
    unsafe {
        let (access, disposition) = if truncate {
            (FILE_GENERIC_WRITE, CREATE_ALWAYS)
        } else {
            (FILE_APPEND_DATA, OPEN_ALWAYS)
        };
        let handle: HANDLE = CreateFileW(
            wide_path.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            disposition,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return;
        }
        let mut written: u32 = 0;
        let _ = WriteFile(
            handle,
            bytes.as_ptr(),
            bytes.len() as u32,
            &mut written,
            std::ptr::null_mut(),
        );
        let _ = CloseHandle(handle);
    }
}

fn exception_name(code: u32) -> &'static str {
    match code {
        0xC000_0005 => "ACCESS_VIOLATION",
        0xC000_00FD => "STACK_OVERFLOW",
        0xC000_001D => "ILLEGAL_INSTRUCTION",
        0xC000_0094 => "INTEGER_DIVIDE_BY_ZERO",
        0xC000_0374 => "HEAP_CORRUPTION",
        0xC000_0409 => "STACK_BUFFER_OVERRUN",
        0xC000_0006 => "IN_PAGE_ERROR",
        0xE06D_7363 => "CPP_EXCEPTION",
        0x8000_0003 => "BREAKPOINT",
        _ => "UNKNOWN",
    }
}

/// Best-effort file path of the module that owns `addr` (e.g. the faulting DLL).
fn module_for_address(addr: usize) -> Option<String> {
    unsafe {
        let mut hmod = std::ptr::null_mut();
        let ok = GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            addr as *const u16,
            &mut hmod,
        );
        if ok == 0 {
            return None;
        }
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameW(hmod, buf.as_mut_ptr(), buf.len() as u32);
        if len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

unsafe extern "system" fn exception_handler(info: *const EXCEPTION_POINTERS) -> i32 {
    // Never recurse: if formatting/writing itself faults, bail to the OS default.
    static HANDLING: AtomicBool = AtomicBool::new(false);
    if HANDLING.swap(true, Ordering::SeqCst) {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    if info.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let record = (*info).ExceptionRecord;
    if record.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    let code = (*record).ExceptionCode as u32;
    let addr = (*record).ExceptionAddress as usize;
    let num_params = (*record).NumberParameters as usize;
    let params = &(*record).ExceptionInformation;

    let mut detail = format!(
        "timestamp: {}\nversion: {}\nnative_exception: {} (0x{:08X})\naddress: 0x{:016X}\n",
        chrono::Local::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION"),
        exception_name(code),
        code,
        addr,
    );
    // For an access violation the first two parameters are the operation and the
    // faulting data address — the most useful clue for a null/dangling deref.
    if code == EXCEPTION_ACCESS_VIOLATION && num_params >= 2 {
        let op = match params[0] {
            0 => "read",
            1 => "write",
            8 => "execute",
            _ => "access",
        };
        detail.push_str(&format!("access: {} at 0x{:016X}\n", op, params[1]));
    }
    if let Some(module) = module_for_address(addr) {
        detail.push_str(&format!("module: {}\n", module));
    }

    let bytes = detail.into_bytes();
    if let Some(crash_log) = CRASH_LOG_WIDE.get() {
        write_all(crash_log, &bytes, false);
    }
    if let Some(pending) = PENDING_ERROR_WIDE.get() {
        write_all(pending, &bytes, true);
    }

    // Let default OS handling (terminate + Windows Error Reporting) proceed.
    EXCEPTION_CONTINUE_SEARCH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exception_name_maps_common_codes_and_defaults_unknown() {
        assert_eq!(exception_name(0xC000_0005), "ACCESS_VIOLATION");
        assert_eq!(exception_name(0xC000_00FD), "STACK_OVERFLOW");
        assert_eq!(exception_name(0xE06D_7363), "CPP_EXCEPTION");
        assert_eq!(exception_name(0x1234_5678), "UNKNOWN");
    }

    #[test]
    fn to_wide_is_null_terminated() {
        let w = to_wide(std::path::Path::new("ab"));
        assert_eq!(w, vec![b'a' as u16, b'b' as u16, 0]);
    }
}
