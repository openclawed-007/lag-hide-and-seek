#!/usr/bin/env python3
"""Serve LAG over HTTP and HTTPS so phones can use GPS."""
import http.server
import ssl
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CERT = ROOT / "certs" / "cert.pem"
KEY = ROOT / "certs" / "key.pem"
LOG = ROOT / "access.log"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        line = "%s - %s\n" % (self.address_string(), fmt % args)
        print(line, end="", flush=True)
        try:
            with LOG.open("a") as fh:
                fh.write(line)
        except OSError:
            pass


def serve(port, tls=False):
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        label = "https"
    else:
        label = "http"
    print("%s://0.0.0.0:%s" % (label, port), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    threading.Thread(target=serve, args=(8877, False), daemon=True).start()
    serve(8878, True)
