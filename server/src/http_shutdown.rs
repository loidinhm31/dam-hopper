use std::{
    future::Future,
    net::SocketAddr,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::{
    io::{self, AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::{CancellationToken, WaitForCancellationFutureOwned};

/// Cancellable I/O stream wrapping a `TcpStream` with independent read/write cancellation waiters.
///
/// When the cancellation token fires, all pending and future `poll_read`, `poll_write`,
/// `poll_flush`, and `poll_shutdown` calls immediately return `io::ErrorKind::ConnectionAborted`.
pub struct ForceCloseIo {
    stream: TcpStream,
    force: CancellationToken,
    read_cancel: Pin<Box<WaitForCancellationFutureOwned>>,
    write_cancel: Pin<Box<WaitForCancellationFutureOwned>>,
}

impl ForceCloseIo {
    pub fn new(stream: TcpStream, force: CancellationToken) -> Self {
        Self {
            stream,
            force: force.clone(),
            read_cancel: Box::pin(force.clone().cancelled_owned()),
            write_cancel: Box::pin(force.cancelled_owned()),
        }
    }

    pub fn is_force_closed(&self) -> bool {
        self.force.is_cancelled()
    }
}

impl AsyncRead for ForceCloseIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.force.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        if self.read_cancel.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for ForceCloseIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.force.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        if self.write_cancel.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.force.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        if self.write_cancel.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.force.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        if self.write_cancel.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "connection forcibly closed by server shutdown",
            )));
        }

        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

/// Axum `serve::Listener` wrapper around `TcpListener` producing `ForceCloseIo` streams.
pub struct ForceCloseListener {
    listener: TcpListener,
    force: CancellationToken,
}

impl ForceCloseListener {
    pub fn new(listener: TcpListener, force: CancellationToken) -> Self {
        Self { listener, force }
    }
}

impl axum::serve::Listener for ForceCloseListener {
    type Io = ForceCloseIo;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.listener.accept().await {
                Ok((stream, addr)) => {
                    return (ForceCloseIo::new(stream, self.force.clone()), addr);
                }
                Err(e) => {
                    if matches!(
                        e.kind(),
                        io::ErrorKind::ConnectionRefused
                            | io::ErrorKind::ConnectionAborted
                            | io::ErrorKind::ConnectionReset
                    ) {
                        continue;
                    }
                    tracing::error!("accept error: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[tokio::test]
    async fn test_force_close_io_aborts_on_cancellation() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let force = CancellationToken::new();
        let force_clone = force.clone();

        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut io = ForceCloseIo::new(stream, force_clone);
            let mut buf = [0u8; 128];
            let mut read_buf = ReadBuf::new(&mut buf);
            // Polling read while uncancelled should be pending until data or cancel
            let res = std::future::poll_fn(|cx| Pin::new(&mut io).poll_read(cx, &mut read_buf)).await;
            res
        });

        let client = tokio::net::TcpStream::connect(addr).await.unwrap();

        // Cancel force token
        force.cancel();

        let res = server_task.await.unwrap();
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::ConnectionAborted);

        drop(client);
    }
}
