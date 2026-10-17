package handler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/kernel"
	"go-backend/internal/store/model"
)

var (
	externalProbeInterval = 3 * time.Minute
	externalProbeTimeout  = 4 * time.Second
)

const externalProbeParallel = 16

// externalProbe is the last TCP reachability check of an imported node, made
// from the panel server. UDP-only protocols (Hysteria2, TUIC) are skipped.
type externalProbe struct {
	OK        bool   `json:"ok"`
	Skipped   bool   `json:"skipped,omitempty"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Error     string `json:"error,omitempty"`
	CheckedAt int64  `json:"checkedAt"`
}

type externalProbeStore struct {
	mu      sync.RWMutex
	results map[int64]externalProbe
	// failStreak counts consecutive failed probes; down marks nodes already
	// reported as unreachable, so alerts fire once per outage.
	failStreak map[int64]int
	down       map[int64]bool
}

func newExternalProbeStore() *externalProbeStore {
	return &externalProbeStore{
		results:    make(map[int64]externalProbe),
		failStreak: make(map[int64]int),
		down:       make(map[int64]bool),
	}
}

type probeTransition struct {
	row  model.NodeInbound
	down bool
	err  string
}

// track updates the outage state of enabled nodes and returns the ones that
// just went down (after notifyInboundDownStreak failures) or came back.
func (s *externalProbeStore) track(rows map[int64]model.NodeInbound, results map[int64]externalProbe) []probeTransition {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []probeTransition
	for id, p := range results {
		row, ok := rows[id]
		if !ok || p.Skipped || row.Enabled != 1 {
			delete(s.failStreak, id)
			delete(s.down, id)
			continue
		}
		if p.OK {
			delete(s.failStreak, id)
			if s.down[id] {
				delete(s.down, id)
				out = append(out, probeTransition{row: row})
			}
			continue
		}
		s.failStreak[id]++
		if s.failStreak[id] >= notifyInboundDownStreak && !s.down[id] {
			s.down[id] = true
			out = append(out, probeTransition{row: row, down: true, err: p.Error})
		}
	}
	return out
}

func (s *externalProbeStore) get(id int64) (externalProbe, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.results[id]
	return p, ok
}

// replace stores fresh results and drops entries of inbounds that no longer
// exist when the whole set was probed.
func (s *externalProbeStore) replace(results map[int64]externalProbe, all bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if all {
		s.results = make(map[int64]externalProbe, len(results))
		for id := range s.failStreak {
			if _, ok := results[id]; !ok {
				delete(s.failStreak, id)
			}
		}
		for id := range s.down {
			if _, ok := results[id]; !ok {
				delete(s.down, id)
			}
		}
	}
	for id, p := range results {
		s.results[id] = p
	}
}

func externalProbeSkipped(row *model.NodeInbound) bool {
	return row.Protocol == kernel.ProtocolHysteria2 || row.Protocol == kernel.ProtocolTUIC
}

func probeExternalInbound(ctx context.Context, row model.NodeInbound) externalProbe {
	now := time.Now()
	if externalProbeSkipped(&row) {
		return externalProbe{Skipped: true, CheckedAt: now.UnixMilli()}
	}
	dialer := net.Dialer{Timeout: externalProbeTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(row.Listen, strconv.Itoa(row.Port)))
	if err != nil {
		return externalProbe{Error: probeErrorText(err), CheckedAt: time.Now().UnixMilli()}
	}
	_ = conn.Close()
	latency := time.Since(now).Milliseconds()
	if latency < 1 {
		latency = 1
	}
	return externalProbe{OK: true, LatencyMs: latency, CheckedAt: time.Now().UnixMilli()}
}

func probeErrorText(err error) string {
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "域名解析失败"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "连接超时"
	}
	return "无法连接"
}

// probeExternalInbounds checks the given imported nodes (all of them when
// ids is empty) in parallel and records the results.
func (h *Handler) probeExternalInbounds(ctx context.Context, ids []int64) (map[int64]externalProbe, error) {
	rows, err := h.repo.ListNodeInbounds()
	if err != nil {
		return nil, err
	}
	want := make(map[int64]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	targets := make([]model.NodeInbound, 0)
	for _, row := range rows {
		if !isExternalInbound(&row) || (len(ids) > 0 && !want[row.ID]) {
			continue
		}
		targets = append(targets, row)
	}

	results := make(map[int64]externalProbe, len(targets))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, externalProbeParallel)
	for _, row := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(row model.NodeInbound) {
			defer wg.Done()
			defer func() { <-sem }()
			p := probeExternalInbound(ctx, row)
			mu.Lock()
			results[row.ID] = p
			mu.Unlock()
		}(row)
	}
	wg.Wait()
	h.externalProbes.replace(results, len(ids) == 0)

	byID := make(map[int64]model.NodeInbound, len(targets))
	for _, row := range targets {
		byID[row.ID] = row
	}
	for _, t := range h.externalProbes.track(byID, results) {
		addr := net.JoinHostPort(t.row.Listen, strconv.Itoa(t.row.Port))
		if t.down {
			h.notify(notifyEventInboundDown, "导入节点连不上",
				fmt.Sprintf("节点：%s\n地址：%s\n原因：%s（从面板服务器检测）", t.row.Name, addr, t.err))
		} else {
			h.notify(notifyEventInboundDown, "导入节点已恢复",
				fmt.Sprintf("节点：%s\n地址：%s", t.row.Name, addr))
		}
	}
	return results, nil
}

func (h *Handler) runExternalProbeLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(externalProbeInterval)
	defer ticker.Stop()
	for {
		if _, err := h.probeExternalInbounds(ctx, nil); err != nil && ctx.Err() == nil {
			log.Printf("imported node probe failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// inboundProbe checks imported nodes now: the given ids, or all of them.
func (h *Handler) inboundProbe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	results, err := h.probeExternalInbounds(r.Context(), req.IDs)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	out := make(map[string]externalProbe, len(results))
	for id, p := range results {
		out[strconv.FormatInt(id, 10)] = p
	}
	response.WriteJSON(w, response.OK(out))
}
