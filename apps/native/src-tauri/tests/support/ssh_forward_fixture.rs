use std::{
    env, fs, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{sleep, timeout},
};

pub struct TempFixture(PathBuf);

impl TempFixture {
    pub fn new() -> io::Result<Self> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = env::temp_dir().join(format!("dam-hopper-ssh-forward-{nonce}"));
        fs::create_dir_all(&root)?;
        Ok(Self(root))
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    pub fn cleanup(&self) -> io::Result<()> {
        fs::remove_dir_all(&self.0)
    }
}

impl Drop for TempFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub struct ChildGuard(Child);

impl ChildGuard {
    pub fn new(child: Child) -> Self {
        Self(child)
    }

    pub fn stop(&mut self) -> io::Result<()> {
        if self.0.try_wait()?.is_some() {
            return Ok(());
        }
        self.0.kill()?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.0.try_wait()?.is_some() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "OpenSSH child did not exit after termination",
        ))
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub fn executable(name: &str, variable: &str) -> PathBuf {
    if let Some(value) = env::var_os(variable) {
        return PathBuf::from(value);
    }
    env::split_paths(&env::var_os("PATH").unwrap_or_default())
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| name.into())
}

pub fn run_keygen(program: &Path, output: &Path) {
    let status = Command::new(program)
        .args(["-q", "-t", "ed25519", "-N", "", "-f"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("OpenSSH keygen unavailable");
    assert!(status.success(), "OpenSSH key generation failed");
}

pub fn config_path(path: &Path, server: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let is_msys = server
        .to_string_lossy()
        .to_ascii_lowercase()
        .contains("msys");
    if is_msys && value.as_bytes().get(1) == Some(&b':') {
        format!("/{}/{}", value[..1].to_ascii_lowercase(), &value[3..])
    } else {
        value
    }
}

pub fn reserve_port() -> io::Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

pub async fn wait_for_port(address: SocketAddr) {
    timeout(Duration::from_secs(10), async {
        loop {
            if TcpStream::connect(address).await.is_ok() {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("OpenSSH fixture did not become ready");
}

pub async fn echo_server(listener: TcpListener) {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        tokio::spawn(async move {
            let mut buffer = [0u8; 4096];
            loop {
                let Ok(read) = stream.read(&mut buffer).await else {
                    return;
                };
                if read == 0 {
                    return;
                }
                if stream.write_all(&buffer[..read]).await.is_err() {
                    return;
                }
            }
        });
    }
}
