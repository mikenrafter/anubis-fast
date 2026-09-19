package providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

type Anubis struct {
	binary string
}

func NewAnubis(binary string) *Anubis { return &Anubis{binary: binary} }

func (a *Anubis) Fetch(ctx context.Context, target, cookie string) (Result, error) {
	args := []string{"--no-browser", "--json"}
	if cookie != "" {
		args = append(args, "--cookie", cookie)
	}
	args = append(args, target)
	cmd := exec.CommandContext(ctx, a.binary, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return Result{}, fmt.Errorf("anubis-fetch failed: %s", message)
	}
	var output struct {
		BodyBase64 string   `json:"body_base64"`
		Cookies    []Cookie `json:"cookies"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		return Result{}, fmt.Errorf("invalid anubis-fetch JSON: %w", err)
	}
	body, err := base64.StdEncoding.DecodeString(output.BodyBase64)
	if err != nil {
		return Result{}, fmt.Errorf("invalid anubis-fetch body: %w", err)
	}
	return Result{
		Status:      http.StatusOK,
		ContentType: "text/html; charset=utf-8",
		Body:        body,
		Cookies:     output.Cookies,
	}, nil
}
