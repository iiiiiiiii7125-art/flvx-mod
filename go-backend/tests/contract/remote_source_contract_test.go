package contract_test

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"go-backend/internal/auth"
)

func ssLink(host, port, name string) string {
	cred := base64.RawURLEncoding.EncodeToString([]byte("aes-128-gcm:pw"))
	return "ss://" + cred + "@" + host + ":" + port + "#" + name
}

func TestRemoteSourceContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)
	admin, _ := auth.GenerateToken(1, "admin_user", 0, secret)

	var mu sync.Mutex
	body := strings.Join([]string{ssLink("203.0.113.1", "8388", "香港 01"), ssLink("203.0.113.2", "8388", "日本 01")}, "\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Subscription-Userinfo", "upload=1; download=2; total=3; expire=4")
		_, _ = w.Write([]byte(base64.StdEncoding.EncodeToString([]byte(body))))
	}))
	defer srv.Close()
	serve := func(lines ...string) {
		mu.Lock()
		body = strings.Join(lines, "\n")
		mu.Unlock()
	}

	if out := kernelContractPost(t, router, admin, "/api/v1/subscription/source/save", `{"name":"机场","url":"ftp://x"}`); out.Code == 0 {
		t.Fatal("non-http url must be rejected")
	}
	out := kernelContractPost(t, router, admin, "/api/v1/subscription/source/save",
		`{"name":"机场","url":"`+srv.URL+`","intervalHours":12}`)
	data := out.Data.(map[string]interface{})
	src := data["source"].(map[string]interface{})
	srcID := int64(src["id"].(float64))
	if out.Code != 0 || valueAsInt(src["nodeCount"]) != 2 || src["userinfo"] != "upload=1; download=2; total=3; expire=4" {
		t.Fatalf("create: %+v", out)
	}
	hk := mustQueryInt64(t, r, `SELECT id FROM node_inbound WHERE name = '香港 01' AND source_id = ?`, srcID)

	// Inbound list names the source; a subscription can take the whole source.
	list := kernelContractPost(t, router, admin, "/api/v1/inbound/list", `{}`).Data.([]interface{})
	if len(list) != 2 || list[0].(map[string]interface{})["sourceName"] != "机场" {
		t.Fatalf("inbound list: %v", list)
	}
	sub := kernelContractPost(t, router, admin, "/api/v1/subscription/save",
		`{"name":"合并","sourceAll":false,"inboundIds":[],"sourceIds":[`+jsonInt64(srcID)+`]}`)
	subView := sub.Data.(map[string]interface{})
	if sub.Code != 0 || valueAsInt(subView["nodeCount"]) != 2 || len(subView["inboundIds"].([]interface{})) != 0 {
		t.Fatalf("subscription from source: %+v", sub)
	}

	// The provider moves 香港 01, drops 日本 01 and adds 美国 01.
	serve(ssLink("203.0.113.9", "8388", "香港 01"), ssLink("203.0.113.3", "443", "美国 01"))
	out = kernelContractPost(t, router, admin, "/api/v1/subscription/source/refresh", `{"id":`+jsonInt64(srcID)+`}`)
	res := out.Data.(map[string]interface{})["result"].(map[string]interface{})
	if out.Code != 0 || valueAsInt(res["added"]) != 1 || valueAsInt(res["updated"]) != 1 || valueAsInt(res["removed"]) != 1 {
		t.Fatalf("refresh: %+v", out)
	}
	if got := mustQueryString(t, r, `SELECT listen FROM node_inbound WHERE id = ?`, hk); got != "203.0.113.9" {
		t.Fatalf("moved node must keep its id and get the new address, got %q", got)
	}
	subs := kernelContractPost(t, router, admin, "/api/v1/subscription/list", `{}`).Data.(map[string]interface{})["items"].([]interface{})
	for _, it := range subs {
		if v := it.(map[string]interface{}); v["name"] == "合并" && valueAsInt(v["nodeCount"]) != 2 {
			t.Fatalf("new source nodes follow into the subscription: %v", v)
		}
	}

	// An empty answer keeps the nodes and records the error.
	serve("")
	if out := kernelContractPost(t, router, admin, "/api/v1/subscription/source/refresh", `{"id":`+jsonInt64(srcID)+`}`); out.Code == 0 {
		t.Fatal("empty subscription must fail")
	}
	if n := mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound WHERE source_id = ?`, srcID); n != 2 {
		t.Fatalf("nodes kept on a failed refresh, got %d", n)
	}
	src = kernelContractPost(t, router, admin, "/api/v1/subscription/source/list", `{}`).Data.([]interface{})[0].(map[string]interface{})
	if src["lastError"] == "" {
		t.Fatal("refresh error must be recorded")
	}

	if out := kernelContractPost(t, router, admin, "/api/v1/subscription/source/delete", `{"id":`+jsonInt64(srcID)+`,"keepNodes":true}`); out.Code != 0 {
		t.Fatalf("delete: %+v", out)
	}
	if n := mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound WHERE source_id = 0`); n != 2 {
		t.Fatalf("keepNodes leaves plain imports, got %d", n)
	}
}
