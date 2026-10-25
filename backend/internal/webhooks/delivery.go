package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// The headers of a delivery.
const (
	// HeaderSignature carries the signature of the body.
	HeaderSignature = "X-Noto-Signature"
	// HeaderEvent carries the identifier of the event.
	HeaderEvent = "X-Noto-Event"
	// HeaderDelivery carries the identifier of the delivery.
	HeaderDelivery = "X-Noto-Delivery"
)

// SignatureHeader is the prefix of the value of the signature header.
const SignatureHeader = "sha256="

// The defaults of the delivery.
const (
	// DefaultTimeout is the timeout of a single delivery.
	DefaultTimeout = 10 * time.Second
	// DefaultMaxAttempts is the number of the attempts of a delivery before
	// it is marked as failed.
	DefaultMaxAttempts = 5
	// DefaultBackoff is the wait between two attempts. The wait of the n-th
	// attempt is the backoff multiplied by 2^(n-1).
	DefaultBackoff = 30 * time.Second
)

// Sign returns the signature of a body: the HMAC-SHA256 of the body with the
// secret of the subscription, in hexadecimal.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return SignatureHeader + hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature reports whether the signature of a body is the expected
// one. The comparison is constant time.
func VerifySignature(secret string, body []byte, signature string) bool {
	want := Sign(secret, body)
	return hmac.Equal([]byte(want), []byte(signature))
}

// Deliverer posts the events of the outbox to the endpoints of the
// subscriptions.
type Deliverer struct {
	store *Store
	// client is the HTTP client of the deliveries.
	client *http.Client
	// maxAttempts is the number of the attempts before a delivery fails.
	maxAttempts int
	// backoff is the base of the wait between two attempts.
	backoff time.Duration
	// log receives the events of the worker.
	log *slog.Logger
}

// DelivererOptions holds the tunables of the deliverer.
type DelivererOptions struct {
	// Client is the HTTP client of the deliveries.
	Client *http.Client
	// MaxAttempts is the number of the attempts before a delivery fails.
	MaxAttempts int
	// Backoff is the base of the wait between two attempts.
	Backoff time.Duration
	// Logger receives the events of the worker.
	Logger *slog.Logger
}

// NewDeliverer creates the deliverer of a store.
func NewDeliverer(store *Store, opts DelivererOptions) *Deliverer {
	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: DefaultTimeout}
	}
	maxAttempts := opts.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = DefaultMaxAttempts
	}
	backoff := opts.Backoff
	if backoff <= 0 {
		backoff = DefaultBackoff
	}
	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	return &Deliverer{
		store:       store,
		client:      client,
		maxAttempts: maxAttempts,
		backoff:     backoff,
		log:         log,
	}
}

// BackoffFor returns the wait before the next attempt of a delivery.
func (d *Deliverer) BackoffFor(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	wait := d.backoff
	for i := 1; i < attempts; i++ {
		wait *= 2
	}
	return wait
}

// Deliver posts one event to the endpoint of its subscription. The body is
// signed with the secret of the subscription.
func (d *Deliverer) Deliver(ctx context.Context, delivery Delivery) error {
	sub, err := d.store.Subscription(ctx, delivery.SubscriptionID)
	if err != nil {
		return err
	}
	if err := ValidateURL(sub.URL); err != nil {
		return err
	}
	secret, err := d.store.Secret(ctx, sub.ID)
	if err != nil {
		return err
	}
	body := []byte(delivery.Payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("webhooks: cannot build the request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set(HeaderSignature, Sign(secret, body))
	req.Header.Set(HeaderEvent, delivery.Event)
	req.Header.Set(HeaderDelivery, fmt.Sprintf("%d", delivery.ID))
	req.ContentLength = int64(len(body))

	res, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("webhooks: the delivery failed: %w", err)
	}
	defer res.Body.Close()
	// The body of the answer is not read entirely: it is not needed and it
	// must never be written to the logs.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("webhooks: the endpoint answered with the status %d", res.StatusCode)
	}
	return nil
}

// ProcessDue delivers the deliveries that are due. It returns the number of
// the deliveries that were attempted.
//
// A delivery that fails is scheduled again with a backoff. When the number of
// the attempts is reached, the delivery is marked as failed and it waits for
// a manual redelivery.
func (d *Deliverer) ProcessDue(ctx context.Context, limit int) (int, error) {
	due, err := d.store.Due(ctx, limit)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, delivery := range due {
		attempts := delivery.Attempts + 1
		err := d.Deliver(ctx, delivery)
		if err == nil {
			if err := d.store.MarkDelivered(ctx, delivery.ID); err != nil {
				return count, err
			}
			count++
			continue
		}
		if attempts >= d.maxAttempts {
			if err := d.store.MarkFailed(ctx, delivery.ID, attempts, err.Error()); err != nil {
				return count, err
			}
			d.log.Warn("webhook: the delivery failed", "delivery", delivery.ID,
				"attempts", attempts, "err", err)
			count++
			continue
		}
		next := time.Now().UTC().Add(d.BackoffFor(attempts))
		if err := d.store.MarkPending(ctx, delivery.ID, attempts, next, err.Error()); err != nil {
			return count, err
		}
		d.log.Warn("webhook: the delivery is postponed", "delivery", delivery.ID,
			"attempts", attempts, "err", err)
		count++
	}
	return count, nil
}

// Worker delivers the events of the outbox in the background.
type Worker struct {
	deliverer *Deliverer
	// interval is the wait between two rounds.
	interval time.Duration
	// batch is the number of the deliveries of a round.
	batch int
	log   *slog.Logger
}

// NewWorker creates the worker of a deliverer.
func NewWorker(d *Deliverer, interval time.Duration, batch int, log *slog.Logger) *Worker {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	if batch <= 0 {
		batch = 20
	}
	if log == nil {
		log = slog.Default()
	}
	return &Worker{deliverer: d, interval: interval, batch: batch, log: log}
}

// Run delivers the events until the context is cancelled.
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		if _, err := w.deliverer.ProcessDue(ctx, w.batch); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			w.log.Warn("webhook: the worker cannot deliver the events", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
