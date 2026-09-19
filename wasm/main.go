package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"syscall/js"
)

func solve(_ js.Value, args []js.Value) interface{} {
	if len(args) != 2 {
		return ""
	}
	randomData := args[0].String()
	difficulty := args[1].Int()
	prefix := strings.Repeat("0", difficulty)
	for nonce := 0; ; nonce++ {
		sum := sha256.Sum256([]byte(randomData + strconv.Itoa(nonce)))
		digest := hex.EncodeToString(sum[:])
		if strings.HasPrefix(digest, prefix) {
			return strconv.Itoa(nonce) + ":" + digest
		}
	}
}

func main() {
	js.Global().Set("anubisSolve", js.FuncOf(solve))
	select {}
}
