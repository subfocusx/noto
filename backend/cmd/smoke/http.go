package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// ------------------------------------------------------------- http helpers --

type httpResp struct {
	status int
	header http.Header
	body   []byte
}

func (r *httpResp) json() []byte { return r.body }

func (r *httpResp) truncated() string {
	s := strings.TrimSpace(string(r.body))
	if len(s) > 400 {
		return s[:400] + "..."
	}
	return s
}

var httpClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// request performs a single HTTP request against the smoke server.
func request(method, url string, body []byte, headers map[string]string) (*httpResp, error) {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		if strings.EqualFold(k, "Host") {
			req.Host = v
			continue
		}
		req.Header.Set(k, v)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	return &httpResp{status: res.StatusCode, header: res.Header, body: data}, nil
}

func jsonBody(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func decode(r *httpResp, v any) error {
	return json.Unmarshal(r.body, v)
}

func errorCode(r *httpResp) string {
	var env errorEnvelope
	if err := decode(r, &env); err != nil {
		return ""
	}
	return env.Error.Code
}

func errorMessage(r *httpResp) string {
	var env errorEnvelope
	if err := decode(r, &env); err != nil {
		return ""
	}
	return env.Error.Message
}

// multipartBody builds a multipart/form-data body. The files map is a list of
// (field, filename, content) triples.
type filePart struct {
	field    string
	filename string
	content  []byte
}

func multipartBody(fields map[string]string, files []filePart) ([]byte, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			return nil, "", err
		}
	}
	for _, f := range files {
		part, err := w.CreateFormFile(f.field, f.filename)
		if err != nil {
			return nil, "", err
		}
		if _, err := part.Write(f.content); err != nil {
			return nil, "", err
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), w.FormDataContentType(), nil
}
