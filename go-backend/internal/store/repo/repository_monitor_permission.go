package repo

import (
	"errors"

	"go-backend/internal/store/model"

	"gorm.io/gorm/clause"
)

func (r *Repository) InsertMonitorPermission(userID int64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if userID <= 0 {
		return nil
	}
	row := model.MonitorPermission{UserID: userID, CreatedTime: now}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *Repository) DeleteMonitorPermission(userID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if userID <= 0 {
		return nil
	}
	return r.db.Where("user_id = ?", userID).Delete(&model.MonitorPermission{}).Error
}

func (r *Repository) HasMonitorPermission(userID int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	if userID <= 0 {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.MonitorPermission{}).Where("user_id = ?", userID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *Repository) ListMonitorPermissions() ([]model.MonitorPermission, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.MonitorPermission
	err := r.db.Order("id ASC").Find(&items).Error
	return items, err
}
