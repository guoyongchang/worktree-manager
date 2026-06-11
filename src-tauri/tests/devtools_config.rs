#[test]
fn release_build_enables_tauri_devtools_feature() {
    let manifest = include_str!("../Cargo.toml");

    assert!(
        manifest.contains("default = [\"devtools\"]")
            && manifest.contains("devtools = [\"tauri/devtools\"]"),
        "release DevTools requires this crate's default devtools feature to enable tauri/devtools"
    );
}
