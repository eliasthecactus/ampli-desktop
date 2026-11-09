//! HTTP clients: one that checks certificates the usual way, and pinned ones for servers with a self-signed
//! certificate the user chose to trust (by SHA-256 of the certificate, like the iOS app).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};

pub const USER_AGENT: &str = concat!("Ampli-Desktop/", env!("CARGO_PKG_VERSION"));

/// What a pinned verifier does with the server's certificate.
#[derive(Debug)]
enum Mode {
    /// Accept only this SHA-256 (lowercase hex, no separators).
    Pin(String),
    /// Accept anything and remember the fingerprint: only used to show it to the user, never for data.
    Capture(Arc<Mutex<Option<String>>>),
}

#[derive(Debug)]
struct PinVerifier {
    mode: Mode,
    provider: Arc<CryptoProvider>,
}

pub fn fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let digest = fingerprint(end_entity.as_ref());
        match &self.mode {
            Mode::Pin(pin) if *pin == digest => Ok(ServerCertVerified::assertion()),
            Mode::Pin(_) => Err(rustls::Error::General("certificate does not match the trusted one".into())),
            Mode::Capture(slot) => {
                *slot.lock().unwrap() = Some(digest);
                Ok(ServerCertVerified::assertion())
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(60))
        // Streams can be long (radio), so only reads time out.
        .read_timeout(Duration::from_secs(45))
}

fn pinned_client(mode: Mode) -> reqwest::Client {
    let provider = provider();
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("TLS versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinVerifier { mode, provider }))
        .with_no_client_auth();
    builder().use_preconfigured_tls(config).build().expect("HTTP client")
}

/// Clients by pin, built once.
pub struct Clients {
    default: reqwest::Client,
    pinned: Mutex<HashMap<String, reqwest::Client>>,
}

impl Clients {
    pub fn new() -> Self {
        Self { default: builder().build().expect("HTTP client"), pinned: Mutex::new(HashMap::new()) }
    }

    pub fn get(&self, pin: Option<&str>) -> reqwest::Client {
        let Some(pin) = pin.map(normalize_pin).filter(|p| !p.is_empty()) else {
            return self.default.clone();
        };
        let mut map = self.pinned.lock().unwrap();
        map.entry(pin.clone()).or_insert_with(|| pinned_client(Mode::Pin(pin))).clone()
    }
}

pub fn normalize_pin(pin: &str) -> String {
    pin.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase()
}

/// Connects to a server without checking its certificate, only to read the fingerprint for the user to confirm.
pub async fn probe(url: &str) -> Result<String, String> {
    let slot = Arc::new(Mutex::new(None));
    let client = pinned_client(Mode::Capture(slot.clone()));
    // The answer doesn't matter (and isn't read), only the handshake.
    let _ = client.head(url).timeout(Duration::from_secs(15)).send().await;
    let found = slot.lock().unwrap().clone();
    found.ok_or_else(|| "The server didn't present a certificate.".to_string())
}

/// True when a request failed because of the certificate.
pub fn is_certificate_error(error: &reqwest::Error) -> bool {
    let mut source: Option<&dyn std::error::Error> = Some(error);
    while let Some(err) = source {
        let text = err.to_string().to_lowercase();
        if text.contains("certificate") || text.contains("unknownissuer") || text.contains("invalid peer") {
            return true;
        }
        source = err.source();
    }
    false
}
