use rcgen::{CertificateParams, DnType, KeyPair, SanType};
use std::net::IpAddr;
use std::time::Duration;

pub struct TlsCerts {
    pub cert_pem: String,
    pub key_pem: String,
}

/// Generate a self-signed TLS certificate.
/// SAN includes all provided IPs, plus localhost and 127.0.0.1. Valid for 365 days.
pub fn generate_self_signed(ips: &[IpAddr]) -> Result<TlsCerts, String> {
    let mut params = CertificateParams::default();
    params
        .distinguished_name
        .push(DnType::CommonName, "Worktree Manager");
    params.not_before = time::OffsetDateTime::now_utc();
    params.not_after = time::OffsetDateTime::now_utc() + Duration::from_secs(365 * 24 * 60 * 60);

    let mut sans: Vec<SanType> = ips.iter().map(|ip| SanType::IpAddress(*ip)).collect();
    sans.push(SanType::DnsName(
        "localhost"
            .try_into()
            .map_err(|e| format!("Invalid DNS name: {}", e))?,
    ));
    sans.push(SanType::IpAddress(IpAddr::V4(
        std::net::Ipv4Addr::LOCALHOST,
    )));
    params.subject_alt_names = sans;

    let key_pair =
        KeyPair::generate().map_err(|e| format!("Failed to generate key pair: {}", e))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to generate certificate: {}", e))?;

    Ok(TlsCerts {
        cert_pem: cert.pem(),
        key_pem: key_pair.serialize_pem(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::io::BufReader;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[serial]
    #[test]
    fn generate_self_signed_returns_non_empty_pem_blocks() {
        let certs = generate_self_signed(&[]).expect("generate localhost cert");

        assert!(certs.cert_pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(certs.cert_pem.ends_with("-----END CERTIFICATE-----\n"));
        assert!(certs.key_pem.contains("-----BEGIN PRIVATE KEY-----"));
        assert!(certs.key_pem.ends_with("-----END PRIVATE KEY-----\n"));
    }

    #[serial]
    #[test]
    fn generated_self_signed_certificate_and_key_parse_as_pem() {
        let certs = generate_self_signed(&[
            IpAddr::V4(Ipv4Addr::new(192, 0, 2, 10)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
        ])
        .expect("generate cert for provided IPs");

        let mut cert_reader = BufReader::new(certs.cert_pem.as_bytes());
        let parsed_certs = rustls_pemfile::certs(&mut cert_reader)
            .collect::<Result<Vec<_>, _>>()
            .expect("parse generated certificate PEM");

        assert_eq!(parsed_certs.len(), 1);
        assert!(!parsed_certs[0].as_ref().is_empty());

        let mut key_reader = BufReader::new(certs.key_pem.as_bytes());
        let parsed_key = rustls_pemfile::private_key(&mut key_reader)
            .expect("parse generated private key PEM")
            .expect("generated PEM should contain a private key");

        assert!(!parsed_key.secret_der().is_empty());
    }
}
