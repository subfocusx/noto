package webhooks

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The states of a delivery.
const (
	// StatePending is the state of a delivery that waits for its attempt.
	StatePending = "pending"
	// StateDelivered is the state of a delivery that was accepted by the
	// endpoint.
	StateDelivered = "delivered"
	// StateFailed is the state of a delivery that ran out of attempts.
	StateFailed = "failed"
)

// Delivery is one entry of the outbox.
type Delivery struct {
	// ID is the monotonic identifier of the delivery.
	ID int64 `json:"id"`
	// SubscriptionID is the subscription the event is delivered to.
	SubscriptionID string `json:"subscriptionId"`
	// Event is the identifier of the event.
	Event string `json:"event"`
	// Payload is the JSON body of the request.
	Payload string `json:"payload"`
	// State is the state of the delivery.
	State string `json:"state"`
	// Attempts is the number of the attempts that were made.
	Attempts int `json:"attempts"`
	// NextAttempt is the moment of the next attempt.
	NextAttempt time.Time `json:"nextAttempt"`
	// LastError is the message of the last failure.
	LastError string `json:"lastError"`
	// CreatedAt is the moment the event was written to the outbox.
	CreatedAt time.Time `json:"createdAt"`
	// DeliveredAt is the moment the endpoint accepted the event.
	DeliveredAt time.Time `json:"deliveredAt,omitempty"`
}

// Enqueue writes an event to the outbox. The event is delivered later by the
// worker.
func (s *Store) Enqueue(ctx context.Context, subscriptionID, event, payload string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("webhooks: the store is not open")
	}
	created := now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO outbox (subscription_id, event, payload, state, attempts, next_attempt, created_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?)`,
		subscriptionID, event, payload, StatePending, created.UnixMilli(), created.UnixMilli())
	if err != nil {
		return 0, fmt.Errorf("webhooks: cannot enqueue the event: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("webhooks: cannot read the identifier of the event: %w", err)
	}
	return id, nil
}

// EnqueueEvent writes an event to the outbox of every subscription that
// listens to it. It returns the number of the written deliveries.
func (s *Store) EnqueueEvent(ctx context.Context, event string, payload string) (int, error) {
	subs, err := s.Subscriptions(ctx, "", true)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, sub := range subs {
		if !sub.Matches(event) {
			continue
		}
		if _, err := s.Enqueue(ctx, sub.ID, event, payload); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// Deliveries returns the deliveries of the outbox, the newest first.
func (s *Store) Deliveries(ctx context.Context, subscriptionID string, limit int) ([]Delivery, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("webhooks: the store is not open")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	query := `SELECT id, subscription_id, event, payload, state, attempts, next_attempt, last_error, created_at, delivered_at FROM outbox WHERE 1 = 1`
	args := []any{}
	if subscriptionID != "" {
		query += ` AND subscription_id = ?`
		args = append(args, subscriptionID)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("webhooks: cannot list the deliveries: %w", err)
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		d, err := scanDelivery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Due returns the deliveries that wait for an attempt: the pending ones
// whose next attempt is due.
func (s *Store) Due(ctx context.Context, limit int) ([]Delivery, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("webhooks: the store is not open")
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, subscription_id, event, payload, state, attempts, next_attempt, last_error, created_at, delivered_at
		 FROM outbox WHERE state = ? AND next_attempt <= ? ORDER BY id LIMIT ?`,
		StatePending, now().UnixMilli(), limit)
	if err != nil {
		return nil, fmt.Errorf("webhooks: cannot list the due deliveries: %w", err)
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		d, err := scanDelivery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// MarkDelivered marks a delivery as accepted by the endpoint.
func (s *Store) MarkDelivered(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE outbox SET state = ?, delivered_at = ?, last_error = '' WHERE id = ?`,
		StateDelivered, now().UnixMilli(), id)
	if err != nil {
		return fmt.Errorf("webhooks: cannot mark the delivery as delivered: %w", err)
	}
	return nil
}

// MarkFailed marks a delivery as failed: it will not be retried.
func (s *Store) MarkFailed(ctx context.Context, id int64, attempts int, lastError string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE outbox SET state = ?, attempts = ?, last_error = ? WHERE id = ?`,
		StateFailed, attempts, lastError, id)
	if err != nil {
		return fmt.Errorf("webhooks: cannot mark the delivery as failed: %w", err)
	}
	return nil
}

// MarkPending keeps a delivery pending and schedules the next attempt.
func (s *Store) MarkPending(ctx context.Context, id int64, attempts int, next time.Time, lastError string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE outbox SET state = ?, attempts = ?, next_attempt = ?, last_error = ? WHERE id = ?`,
		StatePending, attempts, next.UnixMilli(), lastError, id)
	if err != nil {
		return fmt.Errorf("webhooks: cannot schedule the delivery: %w", err)
	}
	return nil
}

// Requeue puts a failed delivery back into the outbox, so that it is
// delivered again. It is the manual redelivery of the interface.
func (s *Store) Requeue(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE outbox SET state = ?, attempts = 0, next_attempt = ?, last_error = '' WHERE id = ? AND state = ?`,
		StatePending, now().UnixMilli(), id, StateFailed)
	if err != nil {
		return fmt.Errorf("webhooks: cannot requeue the delivery: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return newError(ErrNotFound, "the delivery is not failed")
	}
	return nil
}

// deliveryScanner reads the columns of a delivery.
type deliveryScanner interface {
	Scan(dest ...any) error
}

// scanDelivery reads a delivery from a row.
func scanDelivery(row deliveryScanner) (Delivery, error) {
	var d Delivery
	var next, created, delivered int64
	if err := row.Scan(&d.ID, &d.SubscriptionID, &d.Event, &d.Payload, &d.State,
		&d.Attempts, &next, &d.LastError, &created, &delivered); err != nil {
		return Delivery{}, err
	}
	d.NextAttempt = time.UnixMilli(next).UTC()
	d.CreatedAt = time.UnixMilli(created).UTC()
	if delivered > 0 {
		d.DeliveredAt = time.UnixMilli(delivered).UTC()
	}
	return d, nil
}
