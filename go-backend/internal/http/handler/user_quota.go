package handler

import (
	"errors"
	"net/http"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func isUserQuotaExceeded(view *model.UserQuotaView) bool {
	if view == nil {
		return false
	}
	if view.DailyLimitGB > 0 && view.DailyUsedBytes >= view.DailyLimitGB*bytesPerGB {
		return true
	}
	if view.MonthlyLimitGB > 0 && view.MonthlyUsedBytes >= view.MonthlyLimitGB*bytesPerGB {
		return true
	}
	return false
}

func (h *Handler) userQuotaBlockReason(userID int64, now int64) (string, error) {
	if h == nil || h.repo == nil || userID <= 0 {
		return "", nil
	}
	quota, err := h.repo.GetUserQuotaView(userID, time.UnixMilli(now))
	if err != nil || quota == nil {
		return "", err
	}
	if quota.DisabledByQuota == 1 || isUserQuotaExceeded(quota) {
		return "该用户流量配额已超额，禁止开启转发", nil
	}
	return "", nil
}

func (h *Handler) enforceUserQuotaIfNeeded(userID int64, quota *model.UserQuotaView) {
	if h == nil || h.repo == nil || userID <= 0 || quota == nil {
		return
	}
	if quota.DisabledByQuota == 1 || !isUserQuotaExceeded(quota) {
		return
	}

	forwards, err := h.listActiveForwardsByUser(userID)
	if err != nil {
		return
	}
	pausedIDs := make([]int64, 0, len(forwards))
	now := time.Now().UnixMilli()
	for i := range forwards {
		forward := &forwards[i]
		if forward.Status != 1 {
			continue
		}
		if err := h.controlForwardServices(forward, "PauseService", false); err != nil {
			continue
		}
		if err := h.repo.UpdateForwardStatus(forward.ID, 0, now); err != nil {
			continue
		}
		pausedIDs = append(pausedIDs, forward.ID)
	}
	_ = h.repo.MarkUserQuotaDisabled(userID, pausedIDs, now)
}

func (h *Handler) applyUserQuotaRelease(release *repo.UserQuotaRelease, now int64) {
	if h == nil || h.repo == nil || release == nil || release.UserID <= 0 || !release.UnblockUser {
		return
	}
	for _, forwardID := range release.ForwardIDs {
		forward, err := h.getForwardRecord(forwardID)
		if err != nil || forward == nil {
			continue
		}
		if err := h.ensureUserTunnelForwardAllowed(forward.UserID, forward.TunnelID, now); err != nil {
			continue
		}
		if err := h.controlForwardServices(forward, "ResumeService", false); err != nil {
			continue
		}
		_ = h.repo.UpdateForwardStatus(forwardID, 1, now)
	}
}

func (h *Handler) resetUserQuotaWindows(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}
	releases, err := h.repo.RollUserQuotaWindows(now)
	if err != nil {
		return
	}
	nowMs := now.UnixMilli()
	for i := range releases {
		h.applyUserQuotaRelease(&releases[i], nowMs)
	}
}

func (h *Handler) userQuotaReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	var req struct {
		UserID int64  `json:"userId"`
		Scope  string `json:"scope"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("用户ID不能为空"))
		return
	}
	release, err := h.repo.ResetUserQuotaUsage(req.UserID, req.Scope, time.Now())
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	nowMs := time.Now().UnixMilli()
	h.applyUserQuotaRelease(release, nowMs)
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) ensureUserForwardAllowedByQuota(userID int64, now int64) error {
	reason, err := h.userQuotaBlockReason(userID, now)
	if err != nil {
		return err
	}
	if reason != "" {
		return errors.New(reason)
	}
	return nil
}
