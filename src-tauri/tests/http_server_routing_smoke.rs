use axum::http::Method;

fn extract_api_routes_from_routing_source() -> Vec<(Method, String)> {
    let src = include_str!("../src/http_server/routing.rs");
    let mut routes = Vec::new();

    let mut i = 0usize;
    while let Some(found) = src[i..].find(".route(") {
        let start = i + found + ".route(".len();
        let bytes = src.as_bytes();
        let mut depth = 1i32;
        let mut j = start;
        while j < bytes.len() && depth > 0 {
            match bytes[j] as char {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            j += 1;
        }
        if depth != 0 {
            break;
        }

        let call = &src[start..(j - 1)];
        let q1 = match call.find('"') {
            Some(x) => x,
            None => {
                i = j;
                continue;
            }
        };
        let q2 = match call[q1 + 1..].find('"') {
            Some(x) => q1 + 1 + x,
            None => {
                i = j;
                continue;
            }
        };
        let path = call[q1 + 1..q2].to_string();

        let method = if call.contains("get(") {
            Method::GET
        } else if call.contains("post(") {
            Method::POST
        } else {
            i = j;
            continue;
        };

        if path.starts_with("/api/") {
            routes.push((method, path));
        }

        i = j;
    }

    routes.sort_by(|a, b| a.1.cmp(&b.1));
    routes
}

#[test]
fn routing_source_contains_expected_api_routes() {
    let routes = extract_api_routes_from_routing_source();
    assert!(!routes.is_empty());
    assert!(routes.contains(&(Method::POST, "/api/get_share_state".to_string())));
    assert!(routes.contains(&(Method::POST, "/api/auth/challenge".to_string())));
    assert!(routes.contains(&(Method::POST, "/api/auth/verify".to_string())));
}

#[test]
fn create_router_source_keeps_required_middlewares_wired() {
    let src = include_str!("../src/http_server.rs");
    assert!(src.contains("auth_middleware"));
    assert!(src.contains("localhost_only_middleware"));
    assert!(src.contains("security_headers_middleware"));
    assert!(src.contains("RequestBodyLimitLayer::new"));
    assert!(src.contains("header::ORIGIN"));
    assert!(src.contains("Origin not allowed"));
}
