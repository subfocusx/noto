package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"noto/backend/internal/notes"
	"noto/backend/internal/webhooks"
)

// webhookRequest is the body of the creation of a subscription.
type webhookRequest struct {
	// URL is the address the events are posted to.
	URL string `json:"url"`
	// Events is the list of the events the subscription listens to. An empty
	// list means every event.
	Events []string `json:"events"`
}

// handleListWebhooks lists the subscriptions of the user. An administrator
// may ask for the subscriptions of every user with the parameter "all".
//
// The secret of a subscription is never part of the answer.
func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	if s.webhookStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the webhooks are disabled")
		return
	}
	id := identityFrom(r.Context())
	all := id.IsAdmin() && strings.EqualFold(r.URL.Query().Get("all"), "true")
	subs, err := s.webhookStore.Subscriptions(r.Context(), id.Name, all)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	for i := range subs {
		subs[i].Secret = ""
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": subs})
}

// handleCreateWebhook registers a subscription.
//
// The answer carries the secret of the subscription: it is the only time the
// secret leaves the server.
func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	if s.webhookStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the webhooks are disabled")
		return
	}
	var req webhookRequest
	if err := decodeJSON(w, r, maxJSONBody, &req); err != nil {
		writeError(w, s.log, err)
		return
	}
	id := identityFrom(r.Context())
	sub, err := s.webhookStore.Create(r.Context(), id.Name, req.URL, req.Events)
	if err != nil {
		writeAuthError(w, webhookStatus(err), webhookCode(err), webhooks.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

// handleDeleteWebhook removes a subscription.
func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	if s.webhookStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the webhooks are disabled")
		return
	}
	subID := r.PathValue("id")
	sub, err := s.webhookStore.Subscription(r.Context(), subID)
	if err != nil {
		writeAuthError(w, webhookStatus(err), webhookCode(err), webhooks.Message(err))
		return
	}
	id := identityFrom(r.Context())
	if sub.Owner != id.Name && !id.IsAdmin() {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the subscription belongs to another user")
		return
	}
	if err := s.webhookStore.DeleteSubscription(r.Context(), subID); err != nil {
		writeAuthError(w, webhookStatus(err), webhookCode(err), webhooks.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleListDeliveries lists the deliveries of the outbox.
func (s *Server) handleListDeliveries(w http.ResponseWriter, r *http.Request) {
	if s.webhookStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the webhooks are disabled")
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeAuthError(w, http.StatusBadRequest, notes.CodeBadRequest,
				"the limit parameter is not valid")
			return
		}
		limit = n
	}
	deliveries, err := s.webhookStore.Deliveries(r.Context(), "", limit)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deliveries": deliveries})
}

// handleRedeliver puts a failed delivery back into the outbox.
func (s *Server) handleRedeliver(w http.ResponseWriter, r *http.Request) {
	if s.webhookStore == nil {
		writeAuthError(w, http.StatusForbidden, notes.CodeForbidden,
			"the webhooks are disabled")
		return
	}
	raw := strings.TrimSpace(r.PathValue("id"))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeAuthError(w, http.StatusBadRequest, notes.CodeBadRequest,
			"the identifier of the delivery is not valid")
		return
	}
	if err := s.webhookStore.Requeue(r.Context(), id); err != nil {
		writeAuthError(w, webhookStatus(err), webhookCode(err), webhooks.Message(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// webhookCode maps the error of the webhooks package to a stable API error
// code.
func webhookCode(err error) string {
	switch webhooks.Code(err) {
	case "not_found":
		return notes.CodeNotFound
	case "bad_request":
		return notes.CodeBadRequest
	case "conflict":
		return notes.CodeConflict
	default:
		return notes.CodeInternal
	}
}

// webhookStatus returns the HTTP status of an error of the webhooks package.
func webhookStatus(err error) int {
	switch webhooks.Code(err) {
	case "not_found":
		return http.StatusNotFound
	case "bad_request":
		return http.StatusBadRequest
	case "conflict":
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

// registerNoteHooks registers the hook of the notes that writes the events to
// the outbox of the webhooks.
func (s *Server) registerNoteHooks(svc *notes.Service) {
	if svc == nil || s.webhookStore == nil {
		return
	}
	svc.AddHook(func(ctx context.Context, ev notes.NoteEvent) {
		event := webhookEvent(ev.Op)
		if event == "" {
			return
		}
		payload, err := json.Marshal(map[string]any{
			"event":     event,
			"path":      ev.Path,
			"revision":  ev.Revision,
			"updatedAt": ev.UpdatedAt.UTC().Format(time.RFC3339),
		})
		if err != nil {
			s.log.Warn("cannot encode the webhook event", "err", err)
			return
		}
		if _, err := s.webhookStore.EnqueueEvent(ctx, event, string(payload)); err != nil {
			s.log.Warn("cannot write the webhook event to the outbox", "err", err)
		}
	})
}

// webhookEvent maps an operation of the notes to an event of the webhooks.
func webhookEvent(op notes.NoteOp) string {
	switch op {
	case notes.NoteOpCreated:
		return webhooks.EventNoteCreated
	case notes.NoteOpUpdated:
		return webhooks.EventNoteUpdated
	case notes.NoteOpDeleted:
		return webhooks.EventNoteDeleted
	case notes.NoteOpRenamed:
		return webhooks.EventNoteRenamed
	case notes.NoteOpMoved:
		return webhooks.EventNoteMoved
	case notes.NoteOpRestored:
		return webhooks.EventNoteRestored
	default:
		return ""
	}
}
