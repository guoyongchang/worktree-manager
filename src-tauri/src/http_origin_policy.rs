fn parse_origin_url(origin: &str) -> Option<url::Url> {
    let parsed = url::Url::parse(origin).ok()?;
    matches!(parsed.scheme(), "http" | "https").then_some(parsed)
}

fn is_loopback_origin(origin: &url::Url) -> bool {
    match origin.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ipv4)) => ipv4.is_loopback(),
        Some(url::Host::Ipv6(ipv6)) => ipv6.is_loopback(),
        None => false,
    }
}

fn is_private_lan_origin(origin: &url::Url) -> bool {
    matches!(origin.host(), Some(url::Host::Ipv4(ipv4)) if ipv4.is_private() || is_cgnat(ipv4))
}

/// Carrier-grade NAT range (100.64.0.0/10), used by Tailscale, etc.
fn is_cgnat(ip: std::net::Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..128).contains(&octets[1])
}

fn same_origin(left: &url::Url, right: &url::Url) -> bool {
    left.scheme() == right.scheme()
        && match (left.host(), right.host()) {
            (Some(url::Host::Domain(a)), Some(url::Host::Domain(b))) => a.eq_ignore_ascii_case(b),
            (Some(url::Host::Ipv4(a)), Some(url::Host::Ipv4(b))) => a == b,
            (Some(url::Host::Ipv6(a)), Some(url::Host::Ipv6(b))) => a == b,
            _ => false,
        }
        && left.port_or_known_default() == right.port_or_known_default()
}

pub fn is_allowed_origin(origin: &str, ngrok_url: Option<&str>) -> bool {
    let Some(parsed_origin) = parse_origin_url(origin) else {
        return false;
    };

    if is_loopback_origin(&parsed_origin) || is_private_lan_origin(&parsed_origin) {
        return true;
    }

    if let Some(ngrok_url) = ngrok_url {
        if let Some(parsed_ngrok) = parse_origin_url(ngrok_url) {
            if same_origin(&parsed_origin, &parsed_ngrok) {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin;

    #[test]
    fn allows_exact_loopback_and_private_lan_origins_only() {
        assert!(is_allowed_origin("http://localhost:1420", None));
        assert!(is_allowed_origin("https://127.0.0.1", None));
        assert!(is_allowed_origin("http://[::1]:8080", None));
        assert!(is_allowed_origin("http://192.168.1.8:3000", None));
        assert!(is_allowed_origin("http://10.0.0.8", None));
        assert!(is_allowed_origin("http://172.16.5.4", None));
        // CGNAT / Tailscale
        assert!(is_allowed_origin("https://100.96.211.238:64896", None));
        assert!(is_allowed_origin("http://100.64.0.1:3000", None));
        assert!(is_allowed_origin("http://100.127.255.254", None));

        assert!(!is_allowed_origin("http://100.63.255.255", None)); // below CGNAT
        assert!(!is_allowed_origin("http://100.128.0.0", None)); // above CGNAT
        assert!(!is_allowed_origin("https://localhost.evil.example", None));
        assert!(!is_allowed_origin("https://127.0.0.1.evil.example", None));
        assert!(!is_allowed_origin("https://192.168.1.8.evil.example", None));
        assert!(!is_allowed_origin("not-a-url", None));
    }

    #[test]
    fn only_allows_exact_active_ngrok_origin() {
        assert!(is_allowed_origin(
            "https://demo.ngrok-free.app",
            Some("https://demo.ngrok-free.app/")
        ));
        assert!(is_allowed_origin(
            "https://demo.ngrok-free.app:443",
            Some("https://demo.ngrok-free.app/")
        ));
        assert!(!is_allowed_origin(
            "https://demo.ngrok-free.app.evil.example",
            Some("https://demo.ngrok-free.app/")
        ));
        assert!(!is_allowed_origin(
            "https://other.ngrok-free.app",
            Some("https://demo.ngrok-free.app/")
        ));
    }
}
