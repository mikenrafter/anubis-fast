package providers

import (
	"bytes"
	"context"
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
	args := []string{"--no-browser"}
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
	return Result{
		Status:      http.StatusOK,
		ContentType: "text/html; charset=utf-8",
		Body:        stdout.Bytes(),
	}, nil
}
