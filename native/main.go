package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"slaughter.pro/anubis-fast/native/providers"
)

func main() {
	initLog()
	binary, err := findBinary()
	if err != nil {
		fatal(err)
	}
	logf("anubis-fast-host: ready; pid=%d anubis-fetch=%s", os.Getpid(), binary)
	for {
		body, err := readMessage(os.Stdin)
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			fatal(err)
		}
		var req request
		if err := json.Unmarshal(body, &req); err != nil {
			if err := writeMessage(os.Stdout, errorResponse("", "", fmt.Errorf("invalid request: %w", err))); err != nil {
				fatal(err)
			}
			continue
		}
		logf("anubis-fast-host: request id=%s provider=%s url=%s cookie_bytes=%d", req.ID, req.Provider, req.URL, len(req.Cookie))
		if req.Type != "fetch" || req.ID == "" || req.URL == "" {
			if err := writeMessage(os.Stdout, errorResponse(req.ID, req.Provider, fmt.Errorf("request requires type=fetch, id, and url"))); err != nil {
				fatal(err)
			}
			continue
		}
		provider, err := providers.New(req.Provider, binary)
		if err != nil {
			if err := writeMessage(os.Stdout, errorResponse(req.ID, req.Provider, err)); err != nil {
				fatal(err)
			}
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		result, err := provider.Fetch(ctx, req.URL, req.Cookie)
		cancel()
		if err != nil {
			logf("anubis-fast-host: request id=%s failed: %v", req.ID, err)
			err = writeMessage(os.Stdout, errorResponse(req.ID, req.Provider, err))
		} else {
			logf("anubis-fast-host: request id=%s solved status=%d bytes=%d", req.ID, result.Status, len(result.Body))
			err = writeMessage(os.Stdout, htmlResponse(req.ID, req.Provider, result.Status, result.ContentType, result.Body, result.Cookies))
		}
		if err != nil {
			fatal(err)
		}
	}
}

func findBinary() (string, error) {
	if value := os.Getenv("ANUBIS_FETCH_BIN"); value != "" {
		return value, nil
	}
	locations := []string{}
	if executable, err := os.Executable(); err == nil {
		locations = append(locations, filepath.Dir(executable))
	}
	if here, err := os.Getwd(); err == nil {
		locations = append(locations, here)
	}
	for _, here := range locations {
		candidates := []string{
			filepath.Join(here, "..", "anubis-fetch", "result", "bin", "anubis-fetch"),
			filepath.Join(here, "..", "..", "anubis-fetch", "result", "bin", "anubis-fetch"),
		}
		for _, candidate := range candidates {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	if value, err := exec.LookPath("anubis-fetch"); err == nil {
		return value, nil
	}
	return "", fmt.Errorf("anubis-fetch binary not found; set ANUBIS_FETCH_BIN")
}

func fatal(err error) {
	logf("anubis-fast-host: %v", err)
	os.Exit(1)
}
