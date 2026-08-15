#![cfg(windows)]

//! Windows-only OpenSSH fixture smoke gate using generated disposable identities.

#[path = "support/ssh_forward_fixture.rs"]
mod ssh_forward_fixture;

use std::{
    env, fs,
    net::SocketAddr,
    process::{Command, Stdio},
    time::Duration,
};

use ssh_forward_fixture::{
    config_path, echo_server, executable, reserve_port, run_keygen, wait_for_port, ChildGuard,
    TempFixture,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{sleep, timeout},
};

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires Windows OpenSSH server and client binaries"]
async fn open_ssh_fixture_forwards_bytes_to_remote_loopback_and_closes_cleanly() {
    // This external OpenSSH fixture gate complements native manager tests.
    // Product ACL, trust, lifecycle, and packaged-runtime behavior remain
    // covered by native tests and protected manual runtime evidence.
    let fixture = TempFixture::new().expect("temporary fixture");
    let keygen = executable("ssh-keygen.exe", "SMOKE_KEYGEN");
    let ssh = executable("ssh.exe", "SMOKE_SSH");
    let sshd = executable("sshd.exe", "SMOKE_SSHD");
    let client_key = fixture.path("client");
    let host_key = fixture.path("host");
    run_keygen(&keygen, &client_key);
    run_keygen(&keygen, &host_key);
    fs::copy(
        client_key.with_extension("pub"),
        fixture.path("authorized_keys"),
    )
    .expect("authorized key fixture");

    let ssh_port = reserve_port().expect("SSH port");
    let local_port = reserve_port().expect("local forward port");
    let target = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("remote-loopback target");
    let target_port = target.local_addr().expect("target address").port();
    let target_task = tokio::spawn(echo_server(target));
    let config = fixture.path("sshd_config");
    fs::write(
        &config,
        format!(
            "Port {ssh_port}\nListenAddress 127.0.0.1\nHostKey {}\nAuthorizedKeysFile {}\nStrictModes no\nPasswordAuthentication no\nPubkeyAuthentication yes\nAllowTcpForwarding local\nGatewayPorts no\nPermitRootLogin no\nLogLevel QUIET\n",
            config_path(&host_key, &sshd),
            config_path(&fixture.path("authorized_keys"), &sshd),
        ),
    )
    .expect("sshd config");

    let server = Command::new(&sshd)
        .args(["-D", "-e", "-f"])
        .arg(&config)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("OpenSSH server unavailable");
    let mut server = ChildGuard::new(server);
    wait_for_port(SocketAddr::from(([127, 0, 0, 1], ssh_port))).await;

    let client = Command::new(&ssh)
        .args([
            "-N",
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=NUL",
            "-i",
        ])
        .arg(&client_key)
        .args(["-p"])
        .arg(ssh_port.to_string())
        .args(["-L"])
        .arg(format!("127.0.0.1:{local_port}:127.0.0.1:{target_port}"))
        .arg(format!(
            "{}@127.0.0.1",
            env::var("USERNAME").expect("Windows username")
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("OpenSSH client unavailable");
    let mut client = ChildGuard::new(client);
    wait_for_port(SocketAddr::from(([127, 0, 0, 1], local_port))).await;

    let mut forwarded = TcpStream::connect(("127.0.0.1", local_port))
        .await
        .expect("forward listener");
    let message = b"dam-hopper-windows-ssh-forward";
    forwarded.write_all(message).await.expect("forward write");
    let mut received = vec![0; message.len()];
    forwarded
        .read_exact(&mut received)
        .await
        .expect("forward read");
    assert_eq!(received, message);

    client.stop().expect("stop and reap OpenSSH client");
    timeout(Duration::from_secs(5), async {
        loop {
            if TcpStream::connect(("127.0.0.1", local_port)).await.is_err() {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("forward listener remained reachable after client exit");
    target_task.abort();
    let _ = target_task.await;
    server.stop().expect("stop and reap OpenSSH server");
    fixture.cleanup().expect("remove temporary OpenSSH fixture");
}
