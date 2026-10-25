package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"

	"noto/backend/internal/webhooks"
)

// webhookSubscription is a subscription of the webhooks.
type webhookSubscription struct {
	ID     string   `json:"id"`
	Owner  string   `json:"owner"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Secret string   `json:"secret"`
}

// TestTheWebhookSubscriptionIsCreatedAndRemoved makes sure that the routes of
// the subscriptions work and that the secret is only returned once.
func TestTheWebhookSubscriptionIsCreatedAndRemoved(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/webhooks",
		`{"url":"https://example.com/hook","events":["note.created"]}`, "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	var sub webhookSubscription
	if err := json.NewDecoder(res.Body).Decode(&sub); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if sub.ID == "" {
		t.Fatalf("the subscription has no identifier")
	}
	if sub.Secret == "" {
		t.Fatalf("the creation does not carry the secret")
	}
	if len(sub.Events) != 1 || sub.Events[0] != webhooks.EventNoteCreated {
		t.Fatalf("unexpected events: %v", sub.Events)
	}

	// The listing never carries the secret in clear.
	res = env.do(t, http.MethodGet, "/api/webhooks", "", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}
	var list struct {
		Subscriptions []webhookSubscription `json:"subscriptions"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if len(list.Subscriptions) != 1 {
		t.Fatalf("unexpected number of the subscriptions: %d", len(list.Subscriptions))
	}
	if list.Subscriptions[0].Secret != "" {
		t.Fatalf("the listing carries the secret in clear")
	}

	res = env.do(t, http.MethodDelete, "/api/webhooks/"+sub.ID, "", "")
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", res.StatusCode)
	}

	res = env.do(t, http.MethodGet, "/api/webhooks", "", "")
	defer res.Body.Close()
	var empty struct {
		Subscriptions []webhookSubscription `json:"subscriptions"`
	}
	if err := json.NewDecoder(res.Body).Decode(&empty); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if len(empty.Subscriptions) != 0 {
		t.Fatalf("the subscription was not removed")
	}
}

// TestTheWebhookRefusesAnUnsafeURL makes sure that the guard against the
// server side request forgery is applied by the route.
func TestTheWebhookRefusesAnUnsafeURL(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/webhooks", `{"url":"http://example.com/hook"}`, "")
	if res.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	res.Body.Close()

	res = env.do(t, http.MethodPost, "/api/webhooks", `{"url":"https://example.com/hook","events":["nope"]}`, "")
	if res.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	res.Body.Close()
}

// TestTheEventReachesTheOutbox makes sure that a write of the notes writes an
// event to the outbox of the subscriptions.
func TestTheEventReachesTheOutbox(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/webhooks",
		`{"url":"https://example.com/hook","events":["note.created","note.updated"]}`, "")
	res.Body.Close()

	res = env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPut, "/api/notes", `{"path":"a.md","content":"hello","revision":0}`, "")
	res.Body.Close()

	res = env.do(t, http.MethodGet, "/api/webhooks/deliveries", "", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}
	var list struct {
		Deliveries []struct {
			ID       int64  `json:"id"`
			Event    string `json:"event"`
			State    string `json:"state"`
			Payload  string `json:"payload"`
			Attempts int    `json:"attempts"`
		} `json:"deliveries"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatalf("decode the answer: %v", err)
	}
	if len(list.Deliveries) != 2 {
		t.Fatalf("unexpected number of the deliveries: %d", len(list.Deliveries))
	}
	events := map[string]bool{}
	for _, d := range list.Deliveries {
		events[d.Event] = true
		if d.State != webhooks.StatePending {
			t.Errorf("unexpected state: %q", d.State)
		}
	}
	if !events[webhooks.EventNoteCreated] || !events[webhooks.EventNoteUpdated] {
		t.Fatalf("unexpected events: %+v", list.Deliveries)
	}
}

// TestTheFailedDeliveryIsDeliveredAgain makes sure that a failed delivery can
// be delivered again by hand.
func TestTheFailedDeliveryIsDeliveredAgain(t *testing.T) {
	env := newAuthEnv(t, false)

	res := env.do(t, http.MethodPost, "/api/webhooks", `{"url":"https://example.com/hook"}`, "")
	res.Body.Close()
	res = env.do(t, http.MethodPost, "/api/files", `{"parentPath":"","name":"a"}`, "")
	res.Body.Close()

	deliveries, err := env.hooks.Deliveries(contextBackground(), "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if len(deliveries) == 0 {
		t.Fatalf("the outbox is empty")
	}
	id := deliveries[0].ID
	if err := env.hooks.MarkFailed(contextBackground(), id, 3, "the endpoint is down"); err != nil {
		t.Fatalf("mark the delivery as failed: %v", err)
	}

	res = env.do(t, http.MethodPost, "/api/webhooks/deliveries/"+strconv.FormatInt(id, 10)+"/redeliver", "", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("unexpected status %d: %s", res.StatusCode, body)
	}

	deliveries, err = env.hooks.Deliveries(contextBackground(), "", 10)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	if deliveries[0].State != webhooks.StatePending {
		t.Fatalf("unexpected state: %q", deliveries[0].State)
	}
}
