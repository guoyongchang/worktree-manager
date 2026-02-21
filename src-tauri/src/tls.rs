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
    params.distinguished_name.push(DnType::CommonName, "Worktree Manager");
    params.not_before = time::OffsetDateTime::now_utc();
    params.not_after = time::OffsetDateTime::now_utc() + Duration::from_secs(365 * 24 * 60 * 60);

    let mut sans: Vec<SanType> = ips.iter().map(|ip| SanType::IpAddress(*ip)).collect();
    sans.push(SanType::DnsName("localhost".try_into().map_err(|e| format!("Invalid DNS name: {}", e))?));
    sans.push(SanType::IpAddress(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)));
    params.subject_alt_names = sans;

    let key_pair = KeyPair::generate().map_err(|e| format!("Failed to generate key pair: {}", e))?;
    let cert = params.self_signed(&key_pair).map_err(|e| format!("Failed to generate certificate: {}", e))?;

    Ok(TlsCerts {
        cert_pem: cert.pem(),
        key_pem: key_pair.serialize_pem(),
    })
}
