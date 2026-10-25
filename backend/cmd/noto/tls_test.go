package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"noto/backend/internal/config"
)

// writeTestCertificate writes a certificate and its key for the tests and
// returns their paths.
func writeTestCertificate(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate the key: %v", err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		IsCA:         true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create the certificate: %v", err)
	}
	certPath := filepath.Join(dir, "cert.pem")
	certFile, err := os.Create(certPath)
	if err != nil {
		t.Fatalf("create the certificate file: %v", err)
	}
	if err := pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		t.Fatalf("write the certificate: %v", err)
	}
	certFile.Close()

	keyBytes, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal the key: %v", err)
	}
	keyPath := filepath.Join(dir, "key.pem")
	keyFile, err := os.Create(keyPath)
	if err != nil {
		t.Fatalf("create the key file: %v", err)
	}
	if err := pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes}); err != nil {
		t.Fatalf("write the key: %v", err)
	}
	keyFile.Close()

	return certPath, keyPath
}

// TestServeHTTPWithTLS makes sure that the server serves HTTPS when the
// certificate and the key are configured.
func TestServeHTTPWithTLS(t *testing.T) {
	certPath, keyPath := writeTestCertificate(t)

	// A free port of the loopback interface.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	listener.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) }),
		ReadHeaderTimeout: 5 * time.Second,
	}
	cfg := config.Config{TLSCertFile: certPath, TLSKeyFile: keyPath}
	if !cfg.TLSEnabled() {
		t.Fatalf("the TLS must be enabled")
	}

	errCh := make(chan error, 1)
	go func() { errCh <- serveHTTP(srv, cfg) }()

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // the certificate is a test one.
		},
		Timeout: 5 * time.Second,
	}
	var body string
	for i := 0; i < 50; i++ {
		res, err := client.Get("https://" + addr + "/")
		if err == nil {
			data, _ := io.ReadAll(res.Body)
			res.Body.Close()
			body = string(data)
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if body != "ok" {
		t.Fatalf("the server did not answer over TLS")
	}

	if err := srv.Close(); err != nil {
		t.Fatalf("close the server: %v", err)
	}
	if err := <-errCh; err != nil && err != http.ErrServerClosed {
		t.Fatalf("unexpected error of the server: %v", err)
	}
}
