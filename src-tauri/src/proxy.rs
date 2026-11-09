//! A small HTTP server on 127.0.0.1 that the web view talks to instead of the music servers.
//!
//! - Answers with CORS headers, so the web view can read every server's answers and run streams through the
//!   Web Audio equalizer (a cross-origin stream without CORS plays silence there).
//! - Trusts self-signed certificates the user pinned, per request.
//! - Turns http servers into a local, "potentially trustworthy" origin, so streams aren't blocked as mixed content.
//! - Reads ICY metadata ("Artist - Title") out of radio streams and keeps the audio clean.
//! - Serves downloaded files (with ranges, for seeking).
//!
//! Every path starts with a random token made at launch, so other programs and web pages on the machine
//! can't use it as an open proxy.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use tower_http::services::ServeDir;

use crate::tls::{is_certificate_error, Clients};

#[derive(Clone)]
pub struct ProxyState {
    pub clients: Arc<Clients>,
    /// Current ICY titles by stream id.
    pub titles: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Clone, serde::Serialize)]
pub struct ProxyInfo {
    pub port: u16,
    pub token: String,
}

#[derive(Deserialize)]
struct ForwardQuery {
    u: String,
    pin: Option<String>,
    icy: Option<String>,
}

#[derive(Deserialize)]
struct IcyQuery {
    id: String,
}

const DROP_REQUEST: &[&str] = &[
    "host", "origin", "referer", "connection", "content-length", "user-agent", "cookie", "keep-alive", "upgrade",
    "proxy-connection", "te", "trailer", "transfer-encoding",
];
const DROP_RESPONSE: &[&str] = &["connection", "transfer-encoding", "keep-alive", "set-cookie", "upgrade", "trailer"];

pub async fn start(clients: Arc<Clients>, files: PathBuf) -> ProxyInfo {
    let token = {
        use rand::RngCore;
        let mut bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut bytes);
        hex::encode(bytes)
    };
    let state = ProxyState { clients, titles: Arc::new(Mutex::new(HashMap::new())) };

    let inner = Router::new()
        .route("/f", any(forward))
        .route("/icy", get(icy_title))
        .nest_service("/files", ServeDir::new(files))
        .with_state(state);
    let app = Router::new()
        .nest(&format!("/{token}"), inner)
        .layer(axum::middleware::map_response(cors));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind proxy");
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    ProxyInfo { port, token }
}

async fn cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("*"));
    response
}

async fn icy_title(State(state): State<ProxyState>, Query(query): Query<IcyQuery>) -> impl IntoResponse {
    let title = state.titles.lock().unwrap().get(&query.id).cloned();
    Json(serde_json::json!({ "title": title }))
}

fn error(status: StatusCode, kind: &str, message: String) -> Response {
    let mut response = (status, message).into_response();
    response.headers_mut().insert("x-ampli-error", HeaderValue::from_str(kind).unwrap());
    response
}

async fn forward(State(state): State<ProxyState>, method: Method, Query(query): Query<ForwardQuery>, headers: HeaderMap, body: Bytes) -> Response {
    if method == Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
            .body(Body::empty())
            .unwrap();
    }
    let url = match reqwest::Url::parse(&query.u) {
        Ok(url) if url.scheme() == "http" || url.scheme() == "https" => url,
        _ => return error(StatusCode::BAD_REQUEST, "url", "Not a web address".into()),
    };

    let client = state.clients.get(query.pin.as_deref());
    let mut request = client.request(reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(), url);
    for (name, value) in headers.iter() {
        let lower = name.as_str();
        if DROP_REQUEST.contains(&lower) || lower.starts_with("sec-") || lower.starts_with("access-control-") {
            continue;
        }
        request = request.header(name.as_str(), value.as_bytes());
    }
    let icy = query.icy.clone();
    if icy.is_some() {
        request = request.header("Icy-MetaData", "1");
    }
    if !body.is_empty() {
        request = request.body(body);
    }

    let upstream = match request.send().await {
        Ok(response) => response,
        Err(err) => {
            let kind = if is_certificate_error(&err) { "certificate" } else if err.is_timeout() { "timeout" } else { "network" };
            let mut message = err.to_string();
            let mut source = std::error::Error::source(&err);
            while let Some(inner) = source {
                message = format!("{message}: {inner}");
                source = inner.source();
            }
            return error(StatusCode::BAD_GATEWAY, kind, message);
        }
    };

    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let metaint = icy
        .as_ref()
        .and(upstream.headers().get("icy-metaint"))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|v| *v > 0);

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream.headers().iter() {
        let lower = name.as_str();
        if DROP_RESPONSE.contains(&lower) || lower.starts_with("access-control-") {
            continue;
        }
        if metaint.is_some() && (lower == "content-length" || lower == "icy-metaint") {
            continue;
        }
        if let (Ok(n), Ok(v)) = (HeaderName::from_bytes(name.as_str().as_bytes()), HeaderValue::from_bytes(value.as_bytes())) {
            builder = builder.header(n, v);
        }
    }

    let body = match (metaint, icy) {
        (Some(metaint), Some(id)) => Body::from_stream(icy_stream(upstream, metaint, id, state.titles.clone())),
        _ => Body::from_stream(upstream.bytes_stream()),
    };
    builder.body(body).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// The audio of an ICY stream without its metadata blocks. Titles go to `titles[id]`.
fn icy_stream(
    upstream: reqwest::Response,
    metaint: usize,
    id: String,
    titles: Arc<Mutex<HashMap<String, String>>>,
) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> {
    struct Parser {
        metaint: usize,
        audio_left: usize,
        meta_len: Option<usize>,
        meta: Vec<u8>,
    }
    let parser = Parser { metaint, audio_left: metaint, meta_len: None, meta: Vec::new() };
    let source = upstream.bytes_stream();

    stream::unfold((source, parser, id, titles), |(mut source, mut p, id, titles)| async move {
        let chunk = match source.next().await? {
            Ok(chunk) => chunk,
            Err(err) => return Some((Err(std::io::Error::other(err)), (source, p, id, titles))),
        };
        let mut out = Vec::with_capacity(chunk.len());
        let mut i = 0;
        while i < chunk.len() {
            if p.audio_left > 0 {
                let take = p.audio_left.min(chunk.len() - i);
                out.extend_from_slice(&chunk[i..i + take]);
                p.audio_left -= take;
                i += take;
            } else if let Some(len) = p.meta_len {
                let take = (len - p.meta.len()).min(chunk.len() - i);
                p.meta.extend_from_slice(&chunk[i..i + take]);
                i += take;
                if p.meta.len() == len {
                    if let Some(title) = stream_title(&p.meta) {
                        titles.lock().unwrap().insert(id.clone(), title);
                    }
                    p.meta.clear();
                    p.meta_len = None;
                    p.audio_left = p.metaint;
                }
            } else {
                let len = chunk[i] as usize * 16;
                i += 1;
                if len == 0 {
                    p.audio_left = p.metaint;
                } else {
                    p.meta_len = Some(len);
                }
            }
        }
        Some((Ok(Bytes::from(out)), (source, p, id, titles)))
    })
}

/// `StreamTitle='Artist - Title';` from a metadata block, in UTF-8 or Latin-1.
fn stream_title(block: &[u8]) -> Option<String> {
    let trimmed: Vec<u8> = block.iter().copied().take_while(|b| *b != 0).collect();
    let text = match String::from_utf8(trimmed.clone()) {
        Ok(text) => text,
        Err(_) => trimmed.iter().map(|b| *b as char).collect(),
    };
    let start = text.find("StreamTitle='")? + "StreamTitle='".len();
    let rest = &text[start..];
    let end = rest.find("';").unwrap_or(rest.len());
    Some(rest[..end].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{start, stream_title};
    use crate::tls::{probe, Clients};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn proxy() -> (String, reqwest::Client) {
        let dir = std::env::temp_dir().join("ampli-proxy-test");
        std::fs::create_dir_all(&dir).unwrap();
        let _ = rustls::crypto::ring::default_provider().install_default();
        let info = start(Arc::new(Clients::new()), dir).await;
        (format!("http://127.0.0.1:{}/{}", info.port, info.token), reqwest::Client::new())
    }

    fn enc(url: &str) -> String {
        url.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
    }

    /// A fake Icecast server: 16 bytes of audio, then a metadata block, again and again.
    async fn icy_server() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf).await;
            let meta = b"StreamTitle='Daft Punk - One More Time';";
            let blocks = meta.len().div_ceil(16);
            let mut block = meta.to_vec();
            block.resize(blocks * 16, 0);
            let mut body = Vec::new();
            for _ in 0..3 {
                body.extend_from_slice(&[b'A'; 16]);
                body.push(blocks as u8);
                body.extend_from_slice(&block);
                body.extend_from_slice(&[b'A'; 16]);
                body.push(0);
            }
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nicy-metaint: 16\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn strips_icy_metadata_and_keeps_the_title() {
        let (base, client) = proxy().await;
        let port = icy_server().await;
        let res = client.get(format!("{base}/f?u={}&icy=s1", enc(&format!("http://127.0.0.1:{port}/stream")))).send().await.unwrap();
        assert_eq!(res.headers().get("access-control-allow-origin").unwrap(), "*");
        assert!(res.headers().get("icy-metaint").is_none());
        let body = res.bytes().await.unwrap();
        assert_eq!(body.len(), 16 * 6, "only audio is left");
        assert!(body.iter().all(|b| *b == b'A'));
        let text = client.get(format!("{base}/icy?id=s1")).send().await.unwrap().text().await.unwrap();
        let title: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(title["title"], "Daft Punk - One More Time");
    }

    #[tokio::test]
    async fn rejects_unknown_paths_and_bad_urls() {
        let (base, client) = proxy().await;
        let wrong = base.rsplit_once('/').unwrap().0.to_string() + "/not-the-token/f?u=http%3A%2F%2Fexample.com";
        assert_eq!(client.get(wrong).send().await.unwrap().status(), 404);
        assert_eq!(client.get(format!("{base}/f?u=file%3A%2F%2F%2Fetc%2Fpasswd")).send().await.unwrap().status(), 400);
    }

    /// Needs the test servers from ampli-ios (scripts/test-servers.sh up): a self-signed https proxy on 14443.
    #[tokio::test]
    async fn pins_self_signed_certificates() {
        let target = "https://127.0.0.1:14443/rest/ping.view";
        if reqwest::Client::builder().danger_accept_invalid_certs(true).build().unwrap().get(target).send().await.is_err() {
            eprintln!("skipped: no test server on 14443");
            return;
        }
        let (base, client) = proxy().await;
        let plain = client.get(format!("{base}/f?u={}", enc(target))).send().await.unwrap();
        assert_eq!(plain.status(), 502);
        assert_eq!(plain.headers().get("x-ampli-error").unwrap(), "certificate");

        let pin = probe("https://127.0.0.1:14443").await.unwrap();
        assert_eq!(pin.len(), 64);
        let pinned = client.get(format!("{base}/f?u={}&pin={pin}", enc(target))).send().await.unwrap();
        assert_eq!(pinned.status(), 200);

        let wrong = client.get(format!("{base}/f?u={}&pin={}", enc(target), "00".repeat(32))).send().await.unwrap();
        assert_eq!(wrong.headers().get("x-ampli-error").unwrap(), "certificate");
    }

    #[test]
    fn reads_stream_titles() {
        assert_eq!(stream_title(b"StreamTitle='Daft Punk - One More Time';StreamUrl='';\0\0").as_deref(), Some("Daft Punk - One More Time"));
        assert_eq!(stream_title(b"StreamTitle='Beyonc\xe9 - Halo';").as_deref(), Some("Beyoncé - Halo"));
        assert_eq!(stream_title(b"nothing"), None);
    }
}
