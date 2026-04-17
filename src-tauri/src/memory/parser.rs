use crate::memory::types::ArchiveResult;

pub fn parse_archive_output(stdout: &str) -> ArchiveResult {
    if let Some(start) = stdout.find("<memory-archive-result>") {
        if let Some(end) = stdout.find("</memory-archive-result>") {
            let json_str = &stdout[start + "<memory-archive-result>".len()..end].trim();
            if let Ok(result) = serde_json::from_str::<ArchiveResultJson>(json_str) {
                return ArchiveResult {
                    files_created: result.files_created,
                    files_updated: result.files_updated,
                    summary: result.summary,
                    error: None,
                    raw_output: Some(stdout.to_string()),
                };
            }
        }
    }

    ArchiveResult {
        files_created: vec![],
        files_updated: vec![],
        summary: if stdout.chars().count() > 500 {
            format!("{}...", stdout.chars().take(500).collect::<String>())
        } else {
            stdout.to_string()
        },
        error: Some("No <memory-archive-result> block found in output".to_string()),
        raw_output: Some(stdout.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct ArchiveResultJson {
    #[serde(default)]
    files_created: Vec<String>,
    #[serde(default)]
    files_updated: Vec<String>,
    #[serde(default)]
    summary: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_result_block() {
        let output = r#"Some preamble text...
<memory-archive-result>
{"files_created": ["requirements/ERP-27118.md"], "files_updated": ["log.md"], "summary": "Created requirement page"}
</memory-archive-result>
Some trailing text"#;

        let result = parse_archive_output(output);
        assert_eq!(result.files_created, vec!["requirements/ERP-27118.md"]);
        assert_eq!(result.files_updated, vec!["log.md"]);
        assert_eq!(result.summary, "Created requirement page");
        assert!(result.error.is_none());
    }

    #[test]
    fn handles_missing_result_block() {
        let output = "Agent did some stuff but no result block";
        let result = parse_archive_output(output);
        assert!(result.files_created.is_empty());
        assert!(result.error.is_some());
        assert!(result.raw_output.is_some());
    }

    #[test]
    fn handles_empty_output() {
        let result = parse_archive_output("");
        assert!(result.files_created.is_empty());
        assert!(result.error.is_some());
    }
}
