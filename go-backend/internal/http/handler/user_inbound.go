package handler

import (
	"net/http"

	"go-backend/internal/http/response"
)

// getUserInbounds returns the inbound IDs assigned to a user (admin only).
func (h *Handler) getUserInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil || roleID != 0 {
		response.WriteJSON(w, response.Err(403, "无权限"))
		return
	}
	var req struct {
		UserID int64 `json:"userId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	ids, err := h.repo.ListUserInboundIDs(req.UserID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(ids))
}

// setUserInbounds replaces the inbound IDs assigned to a user (admin only).
func (h *Handler) setUserInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil || roleID != 0 {
		response.WriteJSON(w, response.Err(403, "无权限"))
		return
	}
	var req struct {
		UserID     int64   `json:"userId"`
		InboundIDs []int64 `json:"inboundIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if err := h.repo.SetUserInbounds(req.UserID, req.InboundIDs); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(true))
}

// getMyInbounds returns the inbound details assigned to the current user.
func (h *Handler) getMyInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	userID, err := userIDFromRequest(r)
	if err != nil || userID <= 0 {
		response.WriteJSON(w, response.ErrDefault("未登录"))
		return
	}
	ids, err := h.repo.ListUserInboundIDs(userID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	// Fetch inbound details for the assigned IDs
	type inboundInfo struct {
		ID       int64  `json:"id"`
		Name     string `json:"name"`
		Protocol string `json:"protocol"`
		NodeName string `json:"nodeName"`
	}
	var inbounds []inboundInfo
	if len(ids) > 0 {
		rows, err := h.repo.ListNodeInbounds()
		if err == nil {
			allowed := make(map[int64]bool, len(ids))
			for _, id := range ids {
				allowed[id] = true
			}
			// Get node names
			nodes := make(map[int64]string)
			for _, row := range rows {
				if allowed[row.ID] && row.Enabled == 1 {
					if _, ok := nodes[row.NodeID]; !ok {
						if node, _ := h.repo.GetNodeByID(row.NodeID); node != nil {
							nodes[row.NodeID] = node.Name
						}
					}
					inbounds = append(inbounds, inboundInfo{
						ID:       row.ID,
						Name:     row.Name,
						Protocol: row.Protocol,
						NodeName: nodes[row.NodeID],
					})
				}
			}
		}
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"userId":   userID,
		"inbounds": inbounds,
	}))
}
