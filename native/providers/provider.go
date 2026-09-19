package providers

import (
	"context"
	"fmt"
)

type Result struct {
	Status      int
	ContentType string
	Body        []byte
	Cookies     []Cookie
}

type Cookie struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Provider interface {
	Fetch(context.Context, string, string, string, string) (Result, error)
}

func New(name, binary string) (Provider, error) {
	switch name {
	case "anubis":
		return NewAnubis(binary), nil
	case "cloudflare":
		return nil, fmt.Errorf("provider %q is reserved but not implemented", name)
	default:
		return nil, fmt.Errorf("unknown provider %q", name)
	}
}
