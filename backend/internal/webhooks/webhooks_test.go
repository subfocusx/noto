package webhooks_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"noto/backend/internal/webhooks"
)

// newStore opens a store in a temporary directory.
func newStore(t *testing.T) *webhooks.Store {
	t.Helper()
	store, err := webhooks.Open(filepath.Join(t.TempDir(), "webhooks.db"))
	if err != nil {
		t.Fatalf("open the store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// TestValidateURL makes sure that only https and the loopback addresses are
// accepted: the guard against the server side request forgery.
func TestValidateURL(t *testing.T) {
	valid := []string{
		"https://example.com/hook",
		"http://localhost:8080/hook",
		"http://127.0.0.1:9000/hook",
		"http://[::1]:9000/hook",
	}
	for _, u := range valid {
		if err := webhooks.ValidateURL(u); err != nil {
			t.Errorf("%q must be accepted: %v", u, err)
		}
	}
	invalid := []string{
		"",
		"http://example.com/hook",
		"https://",
		"ftp://example.com/hook",
		"file:///etc/passwd",
		"http://10.0.0.5/hook",
		"http://192.168.1.10/hook",
		"http://169.254.169.254/latest/meta-data/",
		"https://user:secret@example.com/hook",
	}
	for _, u := range invalid {
		if err := webhooks.ValidateURL(u); err == nil {
			t.Errorf("%q must be refused", u)
		}
	}
}

// TestTheSubscriptionIsValidated makes sure that a subscription with a bad
// url or an unknown event is refused.
func TestTheSubscriptionIsValidated(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	if _, err := store.Create(ctx, "alice", "http://example.com/hook", nil); err == nil {
		t.Fatalf("a subscription with a plain http url was accepted")
	}
	if _, err := store.Create(ctx, "alice", "https://example.com/hook", []string{"note.exploded"}); err == nil {
		t.Fatalf("a subscription with an unknown event was accepted")
	}
	sub, err := store.Create(ctx, "alice", "https://example.com/hook", []string{"note.created"})
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	if sub.Secret == "" {
		t.Fatalf("the subscription has no secret")
	}
	if sub.Owner != "alice" {
		t.Fatalf("unexpected owner: %q", sub.Owner)
	}
}

// TestTheSecretIsNeverReturned makes sure that the secret of a subscription
// is only returned by its creation.
func TestTheSecretIsNeverReturned(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	sub, err := store.Create(ctx, "alice", "https://example.com/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	if sub.Secret == "" {
		t.Fatalf("the creation does not carry the secret")
	}

	subs, err := store.Subscriptions(ctx, "alice", false)
	if err != nil {
		t.Fatalf("list the subscriptions: %v", err)
	}
	if len(subs) != 1 {
		t.Fatalf("unexpected number of the subscriptions: %d", len(subs))
	}
	if subs[0].Secret != "" {
		t.Fatalf("the listing carries the secret in clear")
	}

	got, err := store.Subscription(ctx, sub.ID)
	if err != nil {
		t.Fatalf("read the subscription: %v", err)
	}
	if got.Secret != "" {
		t.Fatalf("the subscription carries the secret in clear")
	}
}

// TestTheEventIsWrittenToTheOutbox makes sure that an event reaches the
// outbox of the subscriptions that listen to it.
func TestTheEventIsWrittenToTheOutbox(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	sub, err := store.Create(ctx, "alice", "https://example.com/hook", []string{webhooks.EventNoteCreated})
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	other, err := store.Create(ctx, "bob", "https://example.com/other", []string{webhooks.EventNoteDeleted})
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}

	count, err := store.EnqueueEvent(ctx, webhooks.EventNoteCreated, `{"event":"note.created"}`)
	if err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}
	if count != 1 {
		t.Fatalf("unexpected number of the deliveries: %d", count)
	}

	deliveries, err := store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("unexpected number of the deliveries: %d", len(deliveries))
	}
	if deliveries[0].SubscriptionID != sub.ID {
		t.Fatalf("the delivery went to the wrong subscription")
	}
	if deliveries[0].State != webhooks.StatePending {
		t.Fatalf("unexpected state: %q", deliveries[0].State)
	}
	if deliveries[0].Event != webhooks.EventNoteCreated {
		t.Fatalf("unexpected event: %q", deliveries[0].Event)
	}
	if deliveries[0].Attempts != 0 {
		t.Fatalf("unexpected number of the attempts: %d", deliveries[0].Attempts)
	}

	own, err := store.Deliveries(ctx, other.ID, 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if len(own) != 0 {
		t.Fatalf("the subscription of another event received a delivery")
	}
}

// TestTheDeliveryIsSigned makes sure that the body of a delivery is signed
// with the secret of the subscription.
func TestTheDeliveryIsSigned(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	var received atomic.Value
	received.Store("")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received.Store(string(body))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sub, err := store.Create(ctx, "alice", server.URL+"/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	payload := `{"event":"note.created","path":"a.md"}`
	if _, err := store.Enqueue(ctx, sub.ID, webhooks.EventNoteCreated, payload); err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}

	due, err := store.Due(ctx, 10)
	if err != nil {
		t.Fatalf("list the due deliveries: %v", err)
	}
	if len(due) != 1 {
		t.Fatalf("unexpected number of the due deliveries: %d", len(due))
	}

	deliverer := webhooks.NewDeliverer(store, webhooks.DelivererOptions{})
	if err := deliverer.Deliver(ctx, due[0]); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := received.Load().(string); got != payload {
		t.Fatalf("unexpected body: %q", got)
	}

	// The signature is the HMAC-SHA256 of the body with the secret.
	secret, err := store.Secret(ctx, sub.ID)
	if err != nil {
		t.Fatalf("read the secret: %v", err)
	}
	if !webhooks.VerifySignature(secret, []byte(payload), webhooks.Sign(secret, []byte(payload))) {
		t.Fatalf("the signature does not match the body")
	}
}

// TestTheFailingEndpointIsRetriedAndThenFails makes sure that a delivery
// that fails is retried with a backoff and that it ends up in the failed
// state.
func TestTheFailingEndpointIsRetriedAndThenFails(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	sub, err := store.Create(ctx, "alice", server.URL+"/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	if _, err := store.Enqueue(ctx, sub.ID, webhooks.EventNoteCreated, `{}`); err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}

	deliverer := webhooks.NewDeliverer(store, webhooks.DelivererOptions{
		MaxAttempts: 3,
		Backoff:     time.Millisecond,
	})

	// The first round fails: the delivery waits for the next attempt.
	if _, err := deliverer.ProcessDue(ctx, 10); err != nil {
		t.Fatalf("process the due deliveries: %v", err)
	}
	deliveries, err := store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("unexpected number of the deliveries: %d", len(deliveries))
	}
	if deliveries[0].State != webhooks.StatePending {
		t.Fatalf("unexpected state after the first failure: %q", deliveries[0].State)
	}
	if deliveries[0].Attempts != 1 {
		t.Fatalf("unexpected number of the attempts: %d", deliveries[0].Attempts)
	}
	if deliveries[0].LastError == "" {
		t.Fatalf("the failure is not recorded")
	}

	// The second round happens after the backoff.
	time.Sleep(5 * time.Millisecond)
	if _, err := deliverer.ProcessDue(ctx, 10); err != nil {
		t.Fatalf("process the due deliveries: %v", err)
	}
	deliveries, err = store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if deliveries[0].Attempts != 2 {
		t.Fatalf("unexpected number of the attempts: %d", deliveries[0].Attempts)
	}

	// The third failure exhausts the attempts: the delivery fails.
	time.Sleep(5 * time.Millisecond)
	if _, err := deliverer.ProcessDue(ctx, 10); err != nil {
		t.Fatalf("process the due deliveries: %v", err)
	}
	deliveries, err = store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if deliveries[0].State != webhooks.StateFailed {
		t.Fatalf("unexpected state: %q", deliveries[0].State)
	}
	if deliveries[0].Attempts != 3 {
		t.Fatalf("unexpected number of the attempts: %d", deliveries[0].Attempts)
	}
	if got := attempts.Load(); got != 3 {
		t.Fatalf("unexpected number of the requests: %d", got)
	}

	// A failed delivery can be delivered again by hand.
	if err := store.Requeue(ctx, deliveries[0].ID); err != nil {
		t.Fatalf("requeue the delivery: %v", err)
	}
	deliveries, err = store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if deliveries[0].State != webhooks.StatePending {
		t.Fatalf("unexpected state after the requeue: %q", deliveries[0].State)
	}
}

// TestTheDeliveredDeliveryIsMarked makes sure that a delivery that was
// accepted is marked as delivered.
func TestTheDeliveredDeliveryIsMarked(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sub, err := store.Create(ctx, "alice", server.URL+"/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	if _, err := store.Enqueue(ctx, sub.ID, webhooks.EventNoteCreated, `{"a":1}`); err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}
	deliverer := webhooks.NewDeliverer(store, webhooks.DelivererOptions{})
	if _, err := deliverer.ProcessDue(ctx, 10); err != nil {
		t.Fatalf("process the due deliveries: %v", err)
	}
	deliveries, err := store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if deliveries[0].State != webhooks.StateDelivered {
		t.Fatalf("unexpected state: %q", deliveries[0].State)
	}
	if deliveries[0].DeliveredAt.IsZero() {
		t.Fatalf("the delivery has no time")
	}
}

// TestTheSubscriptionCanBeRemoved makes sure that a subscription and its
// pending deliveries are removed.
func TestTheSubscriptionCanBeRemoved(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	sub, err := store.Create(ctx, "alice", "https://example.com/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	if _, err := store.Enqueue(ctx, sub.ID, webhooks.EventNoteCreated, `{}`); err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}
	if err := store.DeleteSubscription(ctx, sub.ID); err != nil {
		t.Fatalf("remove the subscription: %v", err)
	}
	if _, err := store.Subscription(ctx, sub.ID); err == nil {
		t.Fatalf("the subscription still exists")
	}
	deliveries, err := store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if len(deliveries) != 0 {
		t.Fatalf("the pending deliveries were not removed")
	}
}

// TestThePayloadIsJSON makes sure that the payload of an event is the JSON of
// the event.
func TestThePayloadIsJSON(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)

	sub, err := store.Create(ctx, "alice", "https://example.com/hook", nil)
	if err != nil {
		t.Fatalf("create the subscription: %v", err)
	}
	payload, err := json.Marshal(map[string]any{"event": "note.created", "path": "a.md"})
	if err != nil {
		t.Fatalf("encode the payload: %v", err)
	}
	if _, err := store.Enqueue(ctx, sub.ID, webhooks.EventNoteCreated, string(payload)); err != nil {
		t.Fatalf("enqueue the event: %v", err)
	}
	deliveries, err := store.Deliveries(ctx, "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if !strings.Contains(deliveries[0].Payload, `"path":"a.md"`) {
		t.Fatalf("unexpected payload: %q", deliveries[0].Payload)
	}
}
