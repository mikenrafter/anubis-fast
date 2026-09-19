package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"slaughter.pro/anubis-fast/native/providers"
)

var logOutput io.Writer = os.Stderr

func initLog() {
	path := os.Getenv("ANUBIS_FAST_LOG")
	if path == "" {
		path = "/tmp/anubis-fast-host.log"
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "anubis-fast-host: cannot open log %s: %v\n", path, err)
		return
	}
	logOutput = io.MultiWriter(os.Stderr, file)
}

type request struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Provider  string `json:"provider"`
	URL       string `json:"url"`
	Cookie    string `json:"cookie,omitempty"`
	Challenge string `json:"challenge,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`
}

type response struct {
	ID          string             `json:"id"`
	OK          bool               `json:"ok"`
	Provider    string             `json:"provider,omitempty"`
	Status      int                `json:"status,omitempty"`
	ContentType string             `json:"content_type,omitempty"`
	BodyBase64  string             `json:"body_base64,omitempty"`
	Cookies     []providers.Cookie `json:"cookies,omitempty"`
	Error       string             `json:"error,omitempty"`
	Protocol    string             `json:"protocol,omitempty"`
	Type        string             `json:"type,omitempty"`
	HostPath    string             `json:"host_path,omitempty"`
	AnubisFetch string             `json:"anubis_fetch,omitempty"`
}

func readMessage(r io.Reader) ([]byte, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length == 0 || length > 64<<20 {
		return nil, fmt.Errorf("invalid native-message length %d", length)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}

func writeMessage(w io.Writer, value response) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(body) > 64<<20 {
		return fmt.Errorf("native-message response is too large")
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(body))); err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

func errorResponse(id, provider string, err error) response {
	return response{ID: id, OK: false, Provider: provider, Error: err.Error()}
}

func htmlResponse(id, provider string, status int, contentType string, body []byte, cookies []providers.Cookie) response {
	return response{
		ID: id, OK: true, Provider: provider, Status: status,
		ContentType: contentType,
		BodyBase64:  base64.StdEncoding.EncodeToString(body),
		Cookies:     cookies,
		Protocol:    "cookies-v1",
	}
}

func logf(format string, args ...any) {
	_, _ = fmt.Fprintf(logOutput, format+"\n", args...)
}
